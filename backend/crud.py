import json
from typing import Any, Dict, List, Optional
from uuid import uuid4

from sqlalchemy.orm import Session

from models_db import ExecutionLog, SavedPipeline, SessionMeta

# Any is unavoidable here: pipeline nodes/edges are arbitrary JSON blobs
# (ids, types, configs, positions) that must round-trip byte-identically.


def create_pipeline(
    db: Session, name: str, nodes: List[Dict[str, Any]], edges: List[Dict[str, str]]
) -> SavedPipeline:
    row: SavedPipeline = SavedPipeline(
        id=str(uuid4()),
        name=name,
        nodes_json=json.dumps(nodes),
        edges_json=json.dumps(edges),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_pipeline_by_name(db: Session, name: str) -> Optional[SavedPipeline]:
    return db.query(SavedPipeline).filter(SavedPipeline.name == name).first()


def get_pipelines(db: Session) -> List[SavedPipeline]:
    return db.query(SavedPipeline).order_by(SavedPipeline.created_at.desc()).all()


def get_pipeline(db: Session, pipeline_id: str) -> Optional[SavedPipeline]:
    return db.query(SavedPipeline).filter(SavedPipeline.id == pipeline_id).first()


def delete_pipeline(db: Session, pipeline_id: str) -> int:
    deleted: int = (
        db.query(SavedPipeline).filter(SavedPipeline.id == pipeline_id).delete()
    )
    db.commit()
    return deleted


def log_execution(
    db: Session, session_id: str, pipeline_name: str, result_rows: int
) -> ExecutionLog:
    row: ExecutionLog = ExecutionLog(
        session_id=session_id,
        pipeline_name=pipeline_name,
        result_rows=result_rows,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def create_session_meta(
    db: Session, session_id: str, filename: str, row_count: int, columns: List[str]
) -> SessionMeta:
    existing: Optional[SessionMeta] = (
        db.query(SessionMeta).filter(SessionMeta.id == session_id).first()
    )
    if existing is not None:
        existing.filename = filename
        existing.row_count = row_count
        existing.columns_json = json.dumps(columns)
        db.commit()
        db.refresh(existing)
        return existing
    row: SessionMeta = SessionMeta(
        id=session_id,
        filename=filename,
        row_count=row_count,
        columns_json=json.dumps(columns),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
