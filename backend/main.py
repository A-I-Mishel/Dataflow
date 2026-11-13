"""FILE: backend/main.py
PURPOSE: FastAPI app — all HTTP routes.
HOW IT FITS: Browser -> main.py routes -> engine.py -> transforms/*.py. Upload mints session, execute runs pipeline, generate returns pandas code.
WHERE TO EDIT: To add endpoint: copy one @app.post block + add Pydantic model in models.py. Route groups: upload/execute/generate/profile/pipelines.
"""
import codecs
import io
import json
import logging
import os
import tempfile
import uuid
from collections.abc import Callable, Iterator
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text
from sqlalchemy.orm import Session

import auth
import crud
from database import Base, SessionLocal, engine, get_db
from engine import (
    execute_pipeline_large_file,
    execute_pipeline_with_intermediates,
)
from ratelimit import RateLimitMiddleware
from generator import generate_script
from models import (
    MAX_EDGES,
    MAX_ID_LENGTH,
    MAX_NODES,
    ExecuteRequest,
    ExecuteResponse,
    GenerateResponse,
    NodePreview,
    ProfileResponse,
    UploadResponse,
)
from models_db import SavedPipeline, User
from profiler import profile_dataframe
from sanitize import dtypes_dict as _dtypes_dict
from sanitize import missing_dict as _missing_dict
from sanitize import neutralize_formulas as _neutralize_formulas
from sanitize import sanitize_records as _sanitize_records
from session_store import (
    discard_large_session,
    evict_old_sessions,
    get_large_session,
    get_result,
    get_session,
    is_large_session,
    log_memory_usage,
    store_large_session,
    store_result,
    store_session,
)

# Render only shows WARNING+ by default: the root logger ships at WARNING
# and uvicorn's logging config never touches it, so every app logger.info
# (request telemetry, mem[...] lines, evictions) was silently discarded.
# basicConfig attaches a handler to root exactly once; uvicorn's later
# dictConfig leaves it alone (disable_existing_loggers=False).
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create SQLite tables on import so they exist under uvicorn, TestClient,
# and pytest alike (lifespan/startup hooks do not run for bare TestClient).
Base.metadata.create_all(bind=engine)
# Upgrade pre-account databases in place (no-op when already applied).
with SessionLocal() as _upgrade_db:
    try:
        crud.ensure_pipeline_schema(_upgrade_db)
    except Exception:
        logger.warning("pipeline-schema upgrade skipped", exc_info=True)
# Telemetry retention: session metadata and execution logs accumulate one
# row per upload/run with no other cleanup. Purge at boot (workers restart
# often on free-tier hosting, so this runs frequently enough) instead of
# per request.
with SessionLocal() as _purge_db:
    try:
        crud.purge_old_records(_purge_db)
    except Exception:
        logger.warning("telemetry purge skipped", exc_info=True)
    try:
        auth.purge_expired_sessions(_purge_db)
    except Exception:
        logger.warning("login-session purge skipped", exc_info=True)

MAX_UPLOAD_SIZE_BYTES: int = 200 * 1024 * 1024
UPLOAD_CHUNK_SIZE_BYTES: int = 1024 * 1024
# Uploads at or below this size are parsed fully into memory (previous
# behaviour). Larger uploads stay on disk and are processed in chunks.
LARGE_FILE_THRESHOLD_BYTES: int = 50 * 1024 * 1024
PREVIEW_ROWS: int = 1000
LARGE_SCAN_CHUNK_ROWS: int = 20000
EXEC_CHUNK_ROWS: int = 10000


class ProfileRequest(BaseModel):
    session_id: str = Field(max_length=MAX_ID_LENGTH)


# Any is unavoidable below: saved pipeline nodes/edges are arbitrary JSON
# blobs (ids, types, configs, positions) that must round-trip byte-identically.
class PipelineSaveRequest(BaseModel):
    name: str = Field(max_length=MAX_ID_LENGTH)
    nodes: List[Dict[str, Any]] = Field(max_length=MAX_NODES)
    edges: List[Dict[str, str]] = Field(max_length=MAX_EDGES)


class PipelineSummary(BaseModel):
    id: str
    name: str
    created_at: str


class PipelineDetail(BaseModel):
    id: str
    name: str
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, str]]
    created_at: str


class DeleteResult(BaseModel):
    message: str


class AuthRequest(BaseModel):
    email: str = Field(max_length=254)
    # Hashing caps real passwords at 128 chars in auth.validate_password;
    # this outer bound only stops absurd payloads from reaching scrypt.
    password: str = Field(max_length=1024)


class AuthUser(BaseModel):
    id: str
    email: str
    created_at: str


class AuthResponse(BaseModel):
    token: str
    user: AuthUser


class AuthMeResponse(BaseModel):
    user: AuthUser


def _auth_user(user: User) -> AuthUser:
    return AuthUser(
        id=user.id,
        email=user.email,
        created_at=user.created_at.isoformat() if user.created_at else "",
    )


def _pipeline_created_at(row: SavedPipeline) -> str:
    return row.created_at.isoformat() if row.created_at else ""

app = FastAPI(
    title="Data Cleaning Pipeline API",
    # API explorer stays on for local development; on Render the schema and
    # docs endpoints are disabled to shrink the probing surface.
    **({} if not os.environ.get("RENDER") else {"docs_url": None, "redoc_url": None, "openapi_url": None}),
)

# JSON bodies are capped: /upload streams multipart to disk under its own
# 200MB cap, but /execute and /pipelines/save accept arbitrary JSON
# (NodeConfig.value/default take Any) with no framework limit otherwise.
MAX_JSON_BODY_BYTES: int = 10 * 1024 * 1024


@app.middleware("http")
async def limit_json_body_size(request: Request, call_next: Callable) -> JSONResponse:
    if request.url.path != "/upload":
        length: Optional[str] = request.headers.get("content-length")
        if length is not None:
            try:
                if int(length) > MAX_JSON_BODY_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Request body too large. Maximum 10MB."},
                    )
            except ValueError:
                pass
    return await call_next(request)  # type: ignore[no-any-return]

# Production origin, FRONTEND_URLS="https://dataflow-cleaner.vercel.app".
# Must match the Vercel project URL (see render.yaml) or browsers block
# every API call. Localhost origins exist for development only and are
# excluded on Render (RENDER=true is set automatically there).
ALLOW_ORIGINS: List[str] = (
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    if not os.environ.get("RENDER")
    else []
) + [
    url.strip()
    for url in (os.environ.get("FRONTEND_URLS") or "").split(",")
    if url.strip()
]

# Registered BEFORE CORS so it runs inside it: rejected requests still
# carry CORS headers and the frontend can read the 429 body for its toast.
# Abuse friction for expensive endpoints (uploads, executes). In-memory and
# single-worker by design — see ratelimit.py.
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-Session-Id", "X-Api-Key"],
)


# Preview sanitization lives in sanitize.py so engine.py can share it
# without importing the FastAPI app module.


def _bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, sep, token = authorization.partition(" ")
    if not sep or scheme.lower() != "bearer":
        return None
    cleaned: str = token.strip()
    return cleaned or None


def require_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Mandatory account gate for every data/pipeline endpoint.

    Missing, malformed, expired, or revoked tokens all answer 401 with the
    same shape so the browser can return to the sign-in screen. The old
    X-API-Key / anonymous fallbacks are deliberately gone: no account means
    no data plane.
    """
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Sign in required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = _bearer_token(authorization)
    if token is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user: Optional[User] = auth.resolve_token(db, token)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Your session expired — please sign in again",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def _owner(user: User) -> str:
    """Every uploaded session and saved pipeline lives under user:<id>."""
    return f"user:{user.id}"


def _storage_key(user: User, session_id: str) -> str:
    return f"{_owner(user)}:{session_id}"


def _unlink_upload_tmp(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _detect_csv_encoding(path: str) -> str:
    try:
        pd.read_csv(path, nrows=5)
        return "utf-8"
    except UnicodeDecodeError:
        pass
    except Exception:
        return "utf-8"
    try:
        with open(path, "rb") as handle:
            head: bytes = handle.read(4)
        if head.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
            return "utf-16"
    except OSError:
        pass
    # Deliberately windows-1252, not latin-1: it decodes the same bytes but
    # maps 0x80-0x9F to smart quotes/dashes (Windows reality), matching the
    # Sieve fallback ladder (utf-8 strict -> utf-16 BOM -> windows-1252).
    return "windows-1252"


def _detect_delimiter(path: str, encoding: str) -> str:
    """Header sniffing with the exact Sieve rule (see engine.js
    parseCSVText): most frequent of , ; tab | on the first line wins, ties
    keep list order, all-zero falls back to comma. Same rule on both sides
    keeps local and backend parses cell-identical on TSV/SSV files."""
    candidates: List[str] = [",", ";", "\t", "|"]
    try:
        with open(path, "r", encoding=encoding, errors="strict") as handle:
            head: str = handle.readline()
    except Exception:
        return ","
    counts: List[Tuple[str, int]] = [(d, head.count(d)) for d in candidates]
    # Stable max: first candidate with the highest count wins (ties included).
    top: int = max(count for _, count in counts)
    if top <= 0:
        return ","
    for delim, count in counts:
        if count == top:
            return delim
    return ","  # unreachable; keeps type checkers calm.


def _is_excel_filename(filename: Optional[str]) -> bool:
    name: str = (filename or "").strip().lower()
    return name.endswith(".xlsx") or name.endswith(".xlsm")


def _is_excel_bytes(path: str) -> bool:
    """ZIP magic (PK\x03\x04) identifies OOXML workbooks regardless of name."""
    try:
        with open(path, "rb") as handle:
            return handle.read(4) == b"PK\x03\x04"
    except OSError:
        return False


def _read_excel_df(path: str) -> Tuple[pd.DataFrame, Optional[str], Optional[int]]:
    """Read the first sheet of a workbook. Returns (df, sheet_name, sheet_count).

    First-sheet-only by design: multi-sheet workbooks warn, never fan out.
    Values mirror the frontend SheetJS path (first row = headers, cached
    formula values, dates as read by openpyxl/pandas).
    """
    try:
        with pd.ExcelFile(path, engine="openpyxl") as xls:
            sheet_names: List[str] = list(xls.sheet_names or [])
            sheet_count: Optional[int] = len(sheet_names) if sheet_names else None
            sheet: Optional[str] = sheet_names[0] if sheet_names else None
            try:
                df: pd.DataFrame = pd.read_excel(xls, sheet_name=0, engine="openpyxl")
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Excel is empty or invalid") from exc
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Failed parsing Excel: {exc}") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed parsing Excel: {exc}") from exc
    if df.shape[1] == 0:
        raise HTTPException(status_code=400, detail="Excel is empty or invalid")
    try:
        df.columns = [
            f"column_{i + 1}" if pd.isna(c) else str(c) for i, c in enumerate(df.columns)
        ]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Excel headers: {exc}") from exc
    # Dedupe like the CSV path (a,a -> a,a_2) so downstream ops never collide.
    seen: Dict[str, int] = {}
    deduped: List[str] = []
    for i, col in enumerate(df.columns.tolist()):
        name: str = str(col).strip() or f"column_{i + 1}"
        if name in seen:
            k: int = seen[name]
            candidate: str = ""
            while True:
                k += 1
                candidate = f"{name}_{k}"
                if candidate not in seen:
                    break
            seen[name] = k
            seen[candidate] = 1
            deduped.append(candidate)
        else:
            seen[name] = 1
            deduped.append(name)
    df.columns = deduped
    return df, sheet, sheet_count


def _read_preview_df(path: str, encoding: str, sep: str = ",") -> pd.DataFrame:
    try:
        df: pd.DataFrame = pd.read_csv(path, nrows=PREVIEW_ROWS, encoding=encoding, sep=sep)
    except pd.errors.EmptyDataError as exc:
        raise HTTPException(status_code=400, detail="CSV is empty or invalid") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed parsing CSV: {exc}") from exc
    try:
        df.columns = [str(c) for c in df.columns]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid CSV headers: {exc}") from exc
    return df


def _scan_large_file(path: str, encoding: str, sep: str = ",") -> Tuple[int, Dict[str, int]]:
    """Single pass over a large CSV counting rows and per-column missing values."""
    total_rows: int = 0
    missing: Dict[str, int] = {}
    try:
        for chunk_df in pd.read_csv(path, chunksize=LARGE_SCAN_CHUNK_ROWS, encoding=encoding, sep=sep):
            total_rows += int(chunk_df.shape[0])
            for col in chunk_df.columns:
                missing[str(col)] = missing.get(str(col), 0) + int(chunk_df[col].isna().sum())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed scanning CSV: {exc}") from exc
    return total_rows, missing


def _log_session_meta(
    db: Session, session_id: str, filename: Optional[str], row_count: int, columns: List[str]
) -> None:
    try:
        crud.create_session_meta(db, session_id, filename or "upload.csv", row_count, columns)
    except Exception as exc:
        logger.warning("Session metadata logging failed: %s", exc)


def _store_small_df(
    tmp_path: str,
    key: str,
    session_id: str,
    filename: Optional[str],
    db: Session,
    df: pd.DataFrame,
    file_kind: str = "csv",
    sheet: Optional[str] = None,
    sheet_count: Optional[int] = None,
) -> UploadResponse:
    # Temp file is fully parsed at this point; remove it before storing the
    # frame (idempotent helper, safe if a caller already unlinked).
    _unlink_upload_tmp(tmp_path)

    # Exact upload-time cardinality over the complete frame (never the
    # 5-row preview). Columns that fail to compute are omitted (unknown),
    # never zero. Matches get_dummies' default dummy_na=False semantics.
    unique_counts: Dict[str, int] = {}
    for col in df.columns.tolist():
        try:
            unique_counts[str(col)] = int(df[col].nunique(dropna=True))
        except Exception as exc:
            logger.warning("Cardinality scan failed for column '%s': %s", col, exc)

    store_session(key, df)
    logger.info("Stored session %s with shape %s", session_id, df.shape)
    log_memory_usage("upload")
    _log_session_meta(db, session_id, filename, int(df.shape[0]), [str(c) for c in df.columns.tolist()])

    return UploadResponse(
        session_id=session_id,
        filename=filename or ("upload.xlsx" if file_kind == "xlsx" else "upload.csv"),
        columns=[str(c) for c in df.columns.tolist()],
        dtypes=_dtypes_dict(df),
        row_count=int(df.shape[0]),
        preview=_sanitize_records(df, 5),
        missing_values=_missing_dict(df),
        file_kind=file_kind,
        sheet=sheet,
        sheet_count=sheet_count,
        unique_counts=unique_counts,
        cardinality_available=True,
    )


def _handle_small_upload(
    tmp_path: str,
    key: str,
    session_id: str,
    filename: Optional[str],
    db: Session,
    encoding: str,
    sep: str,
) -> UploadResponse:
    try:
        df: pd.DataFrame
        try:
            df = pd.read_csv(tmp_path, encoding=encoding, sep=sep)
        except UnicodeDecodeError:
            try:
                df = pd.read_csv(tmp_path, encoding="windows-1252", sep=sep)
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Failed parsing CSV: {exc}") from exc
        except pd.errors.EmptyDataError as exc:
            raise HTTPException(status_code=400, detail="CSV is empty or invalid") from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed parsing CSV: {exc}") from exc

        try:
            df.columns = [str(c) for c in df.columns]
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid CSV headers: {exc}") from exc
    except HTTPException:
        _unlink_upload_tmp(tmp_path)
        raise
    return _store_small_df(tmp_path, key, session_id, filename, db, df, file_kind="csv")


def _handle_small_excel_upload(
    tmp_path: str,
    key: str,
    session_id: str,
    filename: Optional[str],
    db: Session,
) -> UploadResponse:
    try:
        df, sheet, sheet_count = _read_excel_df(tmp_path)
    except HTTPException:
        _unlink_upload_tmp(tmp_path)
        raise
    return _store_small_df(
        tmp_path, key, session_id, filename, db, df, file_kind="xlsx", sheet=sheet, sheet_count=sheet_count
    )


def _handle_large_upload(
    tmp_path: str,
    key: str,
    session_id: str,
    filename: Optional[str],
    db: Session,
) -> UploadResponse:
    try:
        encoding: str = _detect_csv_encoding(tmp_path)
        sep: str = _detect_delimiter(tmp_path, encoding)
        preview_df: pd.DataFrame = _read_preview_df(tmp_path, encoding, sep)
        total_rows, missing = _scan_large_file(tmp_path, encoding, sep)
        store_large_session(key, tmp_path, preview_df, total_rows, encoding, sep)
    except HTTPException:
        _unlink_upload_tmp(tmp_path)
        raise
    except Exception as exc:
        _unlink_upload_tmp(tmp_path)
        raise HTTPException(status_code=400, detail=f"Failed processing CSV: {exc}") from exc

    columns: List[str] = [str(c) for c in preview_df.columns.tolist()]
    logger.info(
        "Stored large-file session %s with %d rows at %s", session_id, total_rows, tmp_path
    )
    log_memory_usage("upload-large")
    _log_session_meta(db, session_id, filename, total_rows, columns)

    return UploadResponse(
        session_id=session_id,
        filename=filename or "upload.csv",
        columns=columns,
        # Preview-sample statistics: dtypes come from the first 1,000 rows
        # and may miss later type changes — flagged, never presented as exact.
        dtypes=_dtypes_dict(preview_df),
        row_count=total_rows,
        preview=_sanitize_records(preview_df, 5),
        # Missing-value counts are exact (computed in the scan pass above).
        missing_values={col: missing.get(col, 0) for col in columns},
        large=True,
        estimated=True,
        # No full scan for cardinality on large files by design:
        # cardinality stays unavailable rather than fabricated.
        unique_counts=None,
        cardinality_available=False,
    )


# ROUTE GROUP: accounts — signup/login/logout/me. Passwords are scrypt
# hashes; tokens are random and stored only as SHA-256 digests. Every data
# route below requires one of these tokens: the app has no anonymous mode.
@app.post("/auth/signup", response_model=AuthResponse, status_code=201)
def signup(payload: AuthRequest, db: Session = Depends(get_db)) -> AuthResponse:
    email: str = auth.normalize_email(payload.email)
    problem: str = auth.email_error(email) or auth.validate_password(payload.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if crud.get_user_by_email(db, email) is not None:
        raise HTTPException(
            status_code=409, detail="An account with this email already exists"
        )
    try:
        user: User = crud.create_user(db, email, auth.hash_password(payload.password))
    except IntegrityError:
        # Concurrent signup for the same address: the unique index is the
        # final arbiter, so report the same friendly 409, never a 500.
        db.rollback()
        raise HTTPException(
            status_code=409, detail="An account with this email already exists"
        ) from None
    auth.purge_expired_sessions(db)
    token: str = auth.issue_token(db, user)
    return AuthResponse(token=token, user=_auth_user(user))


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: AuthRequest, db: Session = Depends(get_db)) -> AuthResponse:
    email: str = auth.normalize_email(payload.email)
    user: Optional[User] = crud.get_user_by_email(db, email)
    # verify_login also burns the dummy scrypt hash for unknown emails so
    # account existence cannot be inferred from response time.
    if not auth.verify_login(payload.password, user):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    assert user is not None
    auth.purge_expired_sessions(db)
    token: str = auth.issue_token(db, user)
    return AuthResponse(token=token, user=_auth_user(user))


@app.post("/auth/logout", response_model=DeleteResult)
def logout(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> DeleteResult:
    # Idempotent: signing out with an already-expired token still succeeds
    # so the browser can always clear its local copy.
    auth.revoke_token(db, _bearer_token(authorization))
    return DeleteResult(message="Signed out")


@app.get("/auth/me", response_model=AuthMeResponse)
def me(user: User = Depends(require_user)) -> AuthMeResponse:
    return AuthMeResponse(user=_auth_user(user))


# ROUTE GROUP: data in/out — ★ CHANGE HERE for upload limits/errors.
# upload: CSV/XLSX -> session (RAM or disk if > threshold for CSV). 413 if >200MB. Returns session_id + 5-row preview.
@app.post("/upload", response_model=UploadResponse)
async def upload_csv(
    request: Request,
    file: UploadFile = File(...),
    x_session_id: Optional[str] = Header(default=None, alias="x-session-id"),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> UploadResponse:
    evict_old_sessions()

    content_length: Optional[str] = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_UPLOAD_SIZE_BYTES:
                raise HTTPException(status_code=413, detail="File too large. Maximum 200MB.")
        except ValueError:
            pass

    session_id: str = x_session_id.strip() if x_session_id and x_session_id.strip() else uuid.uuid4().hex
    key: str = _storage_key(user, session_id)
    # A retried upload under the same session id must not orphan a temp file.
    discard_large_session(key)

    # Stream to a temp file instead of buffering the whole upload in RAM,
    # so 200MB files cannot exhaust server memory.
    tmp_path: Optional[str] = None
    total_size: int = 0
    first_bytes: bytes = b""
    try:
        with tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".upload") as tmp:
            tmp_path = tmp.name
            while True:
                chunk: bytes = await file.read(UPLOAD_CHUNK_SIZE_BYTES)
                if not chunk:
                    break
                if not first_bytes:
                    first_bytes = chunk[:4]
                total_size += len(chunk)
                if total_size > MAX_UPLOAD_SIZE_BYTES:
                    raise HTTPException(status_code=413, detail="File too large. Maximum 200MB.")
                tmp.write(chunk)
    except HTTPException:
        if tmp_path is not None:
            _unlink_upload_tmp(tmp_path)
        raise
    except Exception as exc:
        if tmp_path is not None:
            _unlink_upload_tmp(tmp_path)
        raise HTTPException(status_code=400, detail=f"Failed reading upload: {exc}") from exc
    finally:
        try:
            await file.close()
        except Exception:
            pass

    assert tmp_path is not None
    if total_size == 0:
        _unlink_upload_tmp(tmp_path)
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    is_excel: bool = _is_excel_filename(file.filename) or first_bytes == b"PK\x03\x04"
    # Double-check by content when the name lies (e.g. .csv containing ZIP).
    if not is_excel and total_size > 0:
        is_excel = _is_excel_bytes(tmp_path)
    if is_excel:
        # Workbooks cannot be chunk-scanned like CSV: reject huge ones with
        # an actionable hint instead of OOMing the worker.
        if total_size > LARGE_FILE_THRESHOLD_BYTES:
            _unlink_upload_tmp(tmp_path)
            raise HTTPException(
                status_code=400,
                detail="Excel files over 50MB are not supported - save as CSV and retry.",
            )
        return _handle_small_excel_upload(tmp_path, key, session_id, file.filename, db)

    if total_size <= LARGE_FILE_THRESHOLD_BYTES:
        encoding: str = _detect_csv_encoding(tmp_path)
        sep: str = _detect_delimiter(tmp_path, encoding)
        return _handle_small_upload(tmp_path, key, session_id, file.filename, db, encoding, sep)
    return _handle_large_upload(tmp_path, key, session_id, file.filename, db)


# ROUTE: /execute — ★ runs pipeline nodes in order via engine.py. Returns 5-row previews per step (never full frame).
@app.post("/execute", response_model=ExecuteResponse)
def execute(
    request: ExecuteRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> ExecuteResponse:
    evict_old_sessions()
    key: str = _storage_key(user, request.session_id)
    result: pd.DataFrame
    intermediates: List[NodePreview] = []
    if is_large_session(key):
        large = get_large_session(key)
        result = execute_pipeline_large_file(
            large.path, request.nodes, request.edges,
            chunk_size=EXEC_CHUNK_ROWS, encoding=large.encoding, sep=large.sep,
        )
        # Step previews for large files come from the first chunk only and
        # are explicitly approximate (per-chunk stats, no global sort). A
        # preview failure must never fail an otherwise successful run.
        try:
            first_chunk: pd.DataFrame = pd.read_csv(
                large.path, nrows=EXEC_CHUNK_ROWS, encoding=large.encoding, sep=large.sep
            )
            first_chunk.columns = [str(c) for c in first_chunk.columns]
            _ignored, intermediates = execute_pipeline_with_intermediates(
                first_chunk, request.nodes, request.edges, approximate=True
            )
        except Exception as exc:
            logger.warning("First-chunk step previews failed: %s", exc)
            intermediates = []
    else:
        original: pd.DataFrame = get_session(key)
        result, intermediates = execute_pipeline_with_intermediates(
            original, request.nodes, request.edges
        )
    store_result(key, result)
    log_memory_usage("execute")
    try:
        crud.log_execution(db, request.session_id, "custom", int(result.shape[0]))
    except Exception as exc:
        logger.warning("Execution logging failed: %s", exc)
    # Any JSON payload from profiler matching ProfileResponse schema.
    profile_dict: Dict[str, Any] = profile_dataframe(result)
    profile: ProfileResponse = ProfileResponse(**profile_dict)
    return ExecuteResponse(
        preview=_sanitize_records(result, 5),
        shape=[int(result.shape[0]), int(result.shape[1])],
        columns=[str(c) for c in result.columns.tolist()],
        dtypes=_dtypes_dict(result),
        profile=profile,
        intermediates=intermediates,
    )


# ROUTE: /profile — ★ column stats via profiler.py. Large files: profiles preview only (OOM guard), true row count reported.
@app.post("/profile", response_model=ProfileResponse)
def profile(
    request: ProfileRequest,
    user: User = Depends(require_user),
) -> ProfileResponse:
    evict_old_sessions()
    key: str = _storage_key(user, request.session_id)
    if is_large_session(key):
        # Profiling 200MB row-by-row would OOM; profile the stored preview
        # but report the true row count. Column stats are estimates.
        large = get_large_session(key)
        profile_dict = profile_dataframe(large.preview_df)
        profile_dict["shape"] = [large.total_rows, int(large.preview_df.shape[1])]
        return ProfileResponse(**profile_dict)
    df: pd.DataFrame = get_session(key)
    profile_dict = profile_dataframe(df)
    return ProfileResponse(**profile_dict)


# ROUTE: /generate — ★ sessionless by design (works after session expiry). Replays node configs on dummy frame via generator.py.
@app.post("/generate", response_model=GenerateResponse)
def generate(
    request: ExecuteRequest, _user: User = Depends(require_user)
) -> GenerateResponse:
    # Sessionless by design: code generation only replays node configs
    # against a dummy frame and never touches uploaded data, so an expired
    # session must not block exporting code after a successful run.
    # The optional filename hint selects read_excel/to_excel for workbooks.
    filename: str = request.filename or "data.csv"
    code: str = generate_script(request.nodes, request.edges, filename=filename)
    return GenerateResponse(code=code)


def _csv_chunks(df: pd.DataFrame, chunk_rows: int = 50000) -> Iterator[str]:
    """Yield a CSV in small pieces so downloads never buffer the whole file."""
    yield df.iloc[0:0].to_csv(index=False)
    for start in range(0, len(df), chunk_rows):
        yield df.iloc[start : start + chunk_rows].to_csv(index=False, header=False)


@app.get("/download/{session_id}", response_model=None)
def download(
    session_id: str,
    bom: bool = False,
    format: Optional[str] = Query(default=None),
    user: User = Depends(require_user),
):
    evict_old_sessions()
    df: pd.DataFrame = get_result(_storage_key(user, session_id))
    logger.info("Download result for session %s shape %s", session_id, df.shape)
    # Neutralize spreadsheet-formula cells (=HYPERLINK(...) etc.) so the
    # download cannot execute code when opened in Excel/Sheets.
    # Operates on a copy — the stored result frame is never mutated.
    safe_df: pd.DataFrame = _neutralize_formulas(df)
    wants_xlsx: bool = (format or "").strip().lower() in ("xlsx", "excel")
    if wants_xlsx:
        buf = io.BytesIO()
        try:
            safe_df.to_excel(buf, index=False, sheet_name="cleaned", engine="openpyxl")
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed writing Excel: {exc}") from exc
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=cleaned_data.xlsx"},
        )
    # The BOM is opt-in (?bom=1) for Excel users: on by default it would
    # corrupt naive Unix parsers (a leading \ufeff lands in the first
    # column name), including re-imports of our own exports.
    stream = _csv_chunks(safe_df)
    if bom:
        stream = _with_bom(stream)
    return StreamingResponse(
        stream,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cleaned_data.csv"},
    )


def _with_bom(chunks: Iterator[str]) -> Iterator[bytes]:
    """Prepend a UTF-8 BOM for Excel, yielding bytes thereafter."""
    first: bool = True
    for text in chunks:
        data: bytes = text.encode("utf-8")
        if first:
            first = False
            yield codecs.BOM_UTF8 + data
        else:
            yield data


def _pipelines_read_only() -> bool:
    """True when the deployment disables template mutations.

    Local default is writable. Setting PIPELINES_READ_ONLY=true keeps
    listing/reading open (no PII in templates) while save/delete return
    403, e.g. to freeze a library around a demo. render.yaml leaves it
    false so signed-in users manage their own templates. Read at request
    time so tests can toggle it via monkeypatch.
    """
    return (os.environ.get("PIPELINES_READ_ONLY") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _require_pipelines_writable() -> None:
    if _pipelines_read_only():
        raise HTTPException(
            status_code=403,
            detail="Pipeline saving is disabled on this deployment",
        )


@app.post("/pipelines/save", response_model=PipelineSummary)
def save_pipeline(
    payload: PipelineSaveRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> PipelineSummary:
    _require_pipelines_writable()
    evict_old_sessions()
    owner: str = _owner(user)
    name: str = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Pipeline name must not be empty")
    if crud.get_pipeline_by_name(db, name, owner) is not None:
        raise HTTPException(
            status_code=400, detail=f"A pipeline named '{name}' already exists"
        )
    try:
        row: SavedPipeline = crud.create_pipeline(db, name, payload.nodes, payload.edges, owner)
    except IntegrityError:
        # Two concurrent saves for the same (owner, name) can both pass the
        # pre-check; the composite UNIQUE constraint is the final arbiter.
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"A pipeline named '{name}' already exists"
        ) from None
    return PipelineSummary(
        id=row.id, name=row.name, created_at=_pipeline_created_at(row)
    )


@app.get("/pipelines", response_model=List[PipelineSummary])
def list_pipelines(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> List[PipelineSummary]:
    evict_old_sessions()
    rows: List[SavedPipeline] = crud.get_pipelines(db, _owner(user))
    return [
        PipelineSummary(id=row.id, name=row.name, created_at=_pipeline_created_at(row))
        for row in rows
    ]


@app.get("/pipelines/{pipeline_id}", response_model=PipelineDetail)
def get_pipeline(
    pipeline_id: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> PipelineDetail:
    evict_old_sessions()
    # Scoped by owner: another account's id reads as 404, never 403, so
    # ids cannot be probed for existence across accounts.
    row = crud.get_pipeline(db, pipeline_id, _owner(user))
    if row is None:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    try:
        nodes: List[Dict[str, Any]] = json.loads(row.nodes_json)
        edges: List[Dict[str, str]] = json.loads(row.edges_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500, detail="Stored pipeline is corrupt"
        ) from exc
    return PipelineDetail(
        id=row.id,
        name=row.name,
        nodes=nodes,
        edges=edges,
        created_at=_pipeline_created_at(row),
    )


@app.delete("/pipelines/{pipeline_id}", response_model=DeleteResult)
def delete_pipeline(
    pipeline_id: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> DeleteResult:
    _require_pipelines_writable()
    evict_old_sessions()
    deleted: int = crud.delete_pipeline(db, pipeline_id, _owner(user))
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return DeleteResult(message="Deleted")


@app.get("/health")
def health() -> Dict[str, str]:
    # Liveness stays unconditional (Render restarts on non-200); database
    # state rides along so dashboards can tell a sick DB from a live app.
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        db_state: str = "ok"
    except Exception:
        db_state = "error"
    return {"status": "ok", "db": db_state}
