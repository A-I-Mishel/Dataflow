import codecs
import json
import logging
import os
import tempfile
import uuid
from collections.abc import Callable, Iterator
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text
from sqlalchemy.orm import Session

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
from models_db import SavedPipeline
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
# Upgrade pre-owner databases in place (no-op when already applied).
with SessionLocal() as _upgrade_db:
    try:
        crud.ensure_owner_column(_upgrade_db)
    except Exception:
        logger.warning("owner-column upgrade skipped", exc_info=True)
# Telemetry retention: session metadata and execution logs accumulate one
# row per upload/run with no other cleanup. Purge at boot (workers restart
# often on free-tier hosting, so this runs frequently enough) instead of
# per request.
with SessionLocal() as _purge_db:
    try:
        crud.purge_old_records(_purge_db)
    except Exception:
        logger.warning("telemetry purge skipped", exc_info=True)

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
    allow_headers=["Content-Type", "X-Session-Id", "X-Api-Key"],
)


# Preview sanitization lives in sanitize.py so engine.py can share it
# without importing the FastAPI app module.


def _storage_key(api_key: Optional[str], session_id: str) -> str:
    namespace: str = api_key.strip() if api_key and api_key.strip() else "default"
    return f"{namespace}:{session_id}"


def _owner(api_key: Optional[str]) -> str:
    """API-key namespace owning saved pipelines. Same rule as _storage_key
    so data-plane and pipeline-plane isolation agree."""
    return api_key.strip() if api_key and api_key.strip() else "default"


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
    finally:
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
        filename=filename or "upload.csv",
        columns=[str(c) for c in df.columns.tolist()],
        dtypes=_dtypes_dict(df),
        row_count=int(df.shape[0]),
        preview=_sanitize_records(df, 5),
        missing_values=_missing_dict(df),
        unique_counts=unique_counts,
        cardinality_available=True,
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


@app.post("/upload", response_model=UploadResponse)
async def upload_csv(
    request: Request,
    file: UploadFile = File(...),
    x_session_id: Optional[str] = Header(default=None, alias="x-session-id"),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
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
    key: str = _storage_key(x_api_key, session_id)
    # A retried upload under the same session id must not orphan a temp file.
    discard_large_session(key)

    # Stream to a temp file instead of buffering the whole upload in RAM,
    # so 200MB files cannot exhaust server memory.
    tmp_path: Optional[str] = None
    total_size: int = 0
    try:
        with tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".csv") as tmp:
            tmp_path = tmp.name
            while True:
                chunk: bytes = await file.read(UPLOAD_CHUNK_SIZE_BYTES)
                if not chunk:
                    break
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

    if total_size <= LARGE_FILE_THRESHOLD_BYTES:
        encoding: str = _detect_csv_encoding(tmp_path)
        sep: str = _detect_delimiter(tmp_path, encoding)
        return _handle_small_upload(tmp_path, key, session_id, file.filename, db, encoding, sep)
    return _handle_large_upload(tmp_path, key, session_id, file.filename, db)


@app.post("/execute", response_model=ExecuteResponse)
def execute(
    request: ExecuteRequest,
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    db: Session = Depends(get_db),
) -> ExecuteResponse:
    evict_old_sessions()
    key: str = _storage_key(x_api_key, request.session_id)
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


@app.post("/profile", response_model=ProfileResponse)
def profile(
    request: ProfileRequest,
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> ProfileResponse:
    evict_old_sessions()
    key: str = _storage_key(x_api_key, request.session_id)
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


@app.post("/generate", response_model=GenerateResponse)
def generate(request: ExecuteRequest) -> GenerateResponse:
    # Sessionless by design: code generation only replays node configs
    # against a dummy frame and never touches uploaded data, so an expired
    # session must not block exporting code after a successful run.
    code: str = generate_script(request.nodes, request.edges, filename="data.csv")
    return GenerateResponse(code=code)


def _csv_chunks(df: pd.DataFrame, chunk_rows: int = 50000) -> Iterator[str]:
    """Yield a CSV in small pieces so downloads never buffer the whole file."""
    yield df.iloc[0:0].to_csv(index=False)
    for start in range(0, len(df), chunk_rows):
        yield df.iloc[start : start + chunk_rows].to_csv(index=False, header=False)


@app.get("/download/{session_id}")
def download(
    session_id: str,
    bom: bool = False,
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> StreamingResponse:
    evict_old_sessions()
    df: pd.DataFrame = get_result(_storage_key(x_api_key, session_id))
    logger.info("Download result for session %s shape %s", session_id, df.shape)
    # Neutralize spreadsheet-formula cells (=HYPERLINK(...) etc.) so the
    # downloaded CSV cannot execute code when opened in Excel/Sheets.
    # Operates on a copy — the stored result frame is never mutated.
    # The BOM is opt-in (?bom=1) for Excel users: on by default it would
    # corrupt naive Unix parsers (a leading \ufeff lands in the first
    # column name), including re-imports of our own exports.
    stream = _csv_chunks(_neutralize_formulas(df))
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
    """True when the deployment disables shared-template mutations.

    Local default is writable. Production sets PIPELINES_READ_ONLY=true
    (see render.yaml): listing/reading stays open (no PII in templates),
    but anonymous save/delete — i.e. vandalism — is refused with 403.
    Read at request time so tests can toggle it via monkeypatch.
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
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> PipelineSummary:
    _require_pipelines_writable()
    evict_old_sessions()
    owner: str = _owner(x_api_key)
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
        # `name` stays globally unique at the DB level (see models_db), so a
        # second namespace reusing the name trips the constraint even though
        # the per-owner pre-check passed. Report the same 400, never a 500.
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"A pipeline named '{name}' already exists"
        ) from None
    return PipelineSummary(
        id=row.id, name=row.name, created_at=_pipeline_created_at(row)
    )


@app.get("/pipelines", response_model=List[PipelineSummary])
def list_pipelines(
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> List[PipelineSummary]:
    evict_old_sessions()
    rows: List[SavedPipeline] = crud.get_pipelines(db, _owner(x_api_key))
    return [
        PipelineSummary(id=row.id, name=row.name, created_at=_pipeline_created_at(row))
        for row in rows
    ]


@app.get("/pipelines/{pipeline_id}", response_model=PipelineDetail)
def get_pipeline(
    pipeline_id: str,
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> PipelineDetail:
    evict_old_sessions()
    # Scoped by owner: another key's id reads as 404, never 403, so ids
    # cannot be probed for existence across namespaces.
    row = crud.get_pipeline(db, pipeline_id, _owner(x_api_key))
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
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> DeleteResult:
    _require_pipelines_writable()
    evict_old_sessions()
    deleted: int = crud.delete_pipeline(db, pipeline_id, _owner(x_api_key))
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
