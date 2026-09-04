import io
import json
import logging
import os
import uuid
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import crud
from database import Base, engine, get_db
from engine import execute_pipeline
from generator import generate_script
from models import (
    ExecuteRequest,
    ExecuteResponse,
    GenerateResponse,
    ProfileResponse,
    UploadResponse,
)
from models_db import SavedPipeline
from profiler import profile_dataframe
from session_store import (
    evict_old_sessions,
    get_result,
    get_session,
    store_result,
    store_session,
)

# Create SQLite tables on import so they exist under uvicorn, TestClient,
# and pytest alike (lifespan/startup hooks do not run for bare TestClient).
Base.metadata.create_all(bind=engine)

logger = logging.getLogger(__name__)

MAX_UPLOAD_SIZE_BYTES: int = 50 * 1024 * 1024
UPLOAD_CHUNK_SIZE_BYTES: int = 1024 * 1024


class ProfileRequest(BaseModel):
    session_id: str


# Any is unavoidable below: saved pipeline nodes/edges are arbitrary JSON
# blobs (ids, types, configs, positions) that must round-trip byte-identically.
class PipelineSaveRequest(BaseModel):
    name: str
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, str]]


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

app = FastAPI(title="Data Cleaning Pipeline API")

# Comma-separated extra origins, e.g. FRONTEND_URLS="https://my-app.vercel.app".
# Localhost is always allowed for development.
ALLOW_ORIGINS: List[str] = ["http://localhost:5173"] + [
    url.strip()
    for url in (os.environ.get("FRONTEND_URLS") or "").split(",")
    if url.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Any denotes arbitrary JSON-serializable cell values from CSV data.
def _sanitize_value(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        f: float = float(value)
        return None if np.isnan(f) else f
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, float) and np.isnan(value):
        return None
    return value


def _sanitize_records(df: pd.DataFrame, limit: int = 5) -> List[Dict[str, Any]]:
    preview_df: pd.DataFrame = df.head(limit)
    records: List[Dict[str, Any]] = preview_df.to_dict(orient="records")
    sanitized: List[Dict[str, Any]] = []
    for row in records:
        clean: Dict[str, Any] = {str(k): _sanitize_value(v) for k, v in row.items()}
        sanitized.append(clean)
    return sanitized


def _dtypes_dict(df: pd.DataFrame) -> Dict[str, str]:
    return {str(col): str(dtype) for col, dtype in df.dtypes.items()}


def _missing_dict(df: pd.DataFrame) -> Dict[str, int]:
    return {str(col): int(df[col].isna().sum()) for col in df.columns}


def _storage_key(api_key: Optional[str], session_id: str) -> str:
    namespace: str = api_key.strip() if api_key and api_key.strip() else "default"
    return f"{namespace}:{session_id}"


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
                raise HTTPException(status_code=413, detail="Upload exceeds 50MB limit")
        except ValueError:
            pass

    session_id: str = x_session_id.strip() if x_session_id and x_session_id.strip() else uuid.uuid4().hex

    try:
        chunks: List[bytes] = []
        total_size: int = 0
        while True:
            chunk: bytes = await file.read(UPLOAD_CHUNK_SIZE_BYTES)
            if not chunk:
                break
            total_size += len(chunk)
            if total_size > MAX_UPLOAD_SIZE_BYTES:
                raise HTTPException(status_code=413, detail="Upload exceeds 50MB limit")
            chunks.append(chunk)
        contents: bytes = b"".join(chunks)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed reading upload: {exc}") from exc
    finally:
        try:
            await file.close()
        except Exception:
            pass

    if not contents.strip():
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    df: pd.DataFrame
    try:
        df = pd.read_csv(io.BytesIO(contents))
    except UnicodeDecodeError:
        try:
            df = pd.read_csv(io.BytesIO(contents), encoding="latin-1")
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

    store_session(_storage_key(x_api_key, session_id), df)
    logger.info("Stored session %s with shape %s", session_id, df.shape)
    try:
        crud.create_session_meta(
            db,
            session_id,
            file.filename or "upload.csv",
            int(df.shape[0]),
            [str(c) for c in df.columns.tolist()],
        )
    except Exception as exc:
        logger.warning("Session metadata logging failed: %s", exc)

    return UploadResponse(
        session_id=session_id,
        columns=[str(c) for c in df.columns.tolist()],
        dtypes=_dtypes_dict(df),
        row_count=int(df.shape[0]),
        preview=_sanitize_records(df, 5),
        missing_values=_missing_dict(df),
    )


@app.post("/execute", response_model=ExecuteResponse)
def execute(
    request: ExecuteRequest,
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    db: Session = Depends(get_db),
) -> ExecuteResponse:
    evict_old_sessions()
    original: pd.DataFrame = get_session(_storage_key(x_api_key, request.session_id))
    result: pd.DataFrame = execute_pipeline(original, request.nodes, request.edges)
    store_result(_storage_key(x_api_key, request.session_id), result)
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
    )


@app.post("/profile", response_model=ProfileResponse)
def profile(
    request: ProfileRequest,
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> ProfileResponse:
    evict_old_sessions()
    df: pd.DataFrame = get_session(_storage_key(x_api_key, request.session_id))
    profile_dict: Dict[str, Any] = profile_dataframe(df)
    return ProfileResponse(**profile_dict)


@app.post("/generate", response_model=GenerateResponse)
def generate(
    request: ExecuteRequest,
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> GenerateResponse:
    evict_old_sessions()
    get_session(_storage_key(x_api_key, request.session_id))
    code: str = generate_script(request.nodes, request.edges, filename="data.csv")
    return GenerateResponse(code=code)


@app.get("/download/{session_id}")
def download(
    session_id: str,
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> StreamingResponse:
    evict_old_sessions()
    df: pd.DataFrame = get_result(_storage_key(x_api_key, session_id))
    csv_text: str = df.to_csv(index=False)
    stream: io.StringIO = io.StringIO(csv_text)
    logger.info("Download result for session %s shape %s", session_id, df.shape)
    return StreamingResponse(
        stream,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cleaned_data.csv"},
    )


@app.post("/pipelines/save", response_model=PipelineSummary)
def save_pipeline(
    payload: PipelineSaveRequest, db: Session = Depends(get_db)
) -> PipelineSummary:
    evict_old_sessions()
    name: str = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Pipeline name must not be empty")
    if crud.get_pipeline_by_name(db, name) is not None:
        raise HTTPException(
            status_code=400, detail=f"A pipeline named '{name}' already exists"
        )
    row: SavedPipeline = crud.create_pipeline(db, name, payload.nodes, payload.edges)
    return PipelineSummary(
        id=row.id, name=row.name, created_at=_pipeline_created_at(row)
    )


@app.get("/pipelines", response_model=List[PipelineSummary])
def list_pipelines(db: Session = Depends(get_db)) -> List[PipelineSummary]:
    evict_old_sessions()
    rows: List[SavedPipeline] = crud.get_pipelines(db)
    return [
        PipelineSummary(id=row.id, name=row.name, created_at=_pipeline_created_at(row))
        for row in rows
    ]


@app.get("/pipelines/{pipeline_id}", response_model=PipelineDetail)
def get_pipeline(pipeline_id: str, db: Session = Depends(get_db)) -> PipelineDetail:
    evict_old_sessions()
    row = crud.get_pipeline(db, pipeline_id)
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
def delete_pipeline(pipeline_id: str, db: Session = Depends(get_db)) -> DeleteResult:
    evict_old_sessions()
    deleted: int = crud.delete_pipeline(db, pipeline_id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return DeleteResult(message="Deleted")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}
