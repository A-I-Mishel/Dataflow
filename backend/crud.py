"""FILE: backend/crud.py
PURPOSE: DB reads/writes for saved pipelines + logs.
HOW IT FITS: main.py -> crud.create/get/list/log. Stores nodes_json/edges_json blobs, owner-scoped.
WHERE TO EDIT: To add query: copy one func, keep owner filter or users see each other data.
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from sqlalchemy.orm import Session

from models_db import ExecutionLog, SavedPipeline, SessionMeta

# Any is unavoidable here: pipeline nodes/edges are arbitrary JSON blobs
# (ids, types, configs, positions) that must round-trip byte-identically.


def create_pipeline(
    db: Session,
    name: str,
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, str]],
    owner: str = "default",
) -> SavedPipeline:
    row: SavedPipeline = SavedPipeline(
        id=str(uuid4()),
        name=name,
        nodes_json=json.dumps(nodes),
        edges_json=json.dumps(edges),
        owner=owner,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_pipeline_by_name(
    db: Session, name: str, owner: str = "default"
) -> Optional[SavedPipeline]:
    return (
        db.query(SavedPipeline)
        .filter(SavedPipeline.name == name, SavedPipeline.owner == owner)
        .first()
    )


def get_pipelines(db: Session, owner: str = "default") -> List[SavedPipeline]:
    return (
        db.query(SavedPipeline)
        .filter(SavedPipeline.owner == owner)
        .order_by(SavedPipeline.created_at.desc())
        .all()
    )


def get_pipeline(db: Session, pipeline_id: str, owner: str = "default") -> Optional[SavedPipeline]:
    return (
        db.query(SavedPipeline)
        .filter(SavedPipeline.id == pipeline_id, SavedPipeline.owner == owner)
        .first()
    )


def delete_pipeline(db: Session, pipeline_id: str, owner: str = "default") -> int:
    deleted: int = (
        db.query(SavedPipeline)
        .filter(SavedPipeline.id == pipeline_id, SavedPipeline.owner == owner)
        .delete()
    )
    db.commit()
    return deleted


def ensure_owner_column(db: Session) -> None:
    """Add SavedPipeline.owner to databases created before the column existed.

    Fresh databases get it from create_all; this ALTER covers existing
    app.db files (including the on-disk dev DB). Backfills 'default'.
    No-op on Postgres (column exists) and when already applied.
    """
    from sqlalchemy import text

    if db.bind is None or db.bind.dialect.name != "sqlite":
        return
    cols = [row[1] for row in db.execute(text("PRAGMA table_info(saved_pipelines)"))]
    if "owner" not in cols:
        db.execute(text("ALTER TABLE saved_pipelines ADD COLUMN owner VARCHAR DEFAULT 'default'"))
        db.execute(text("UPDATE saved_pipelines SET owner = 'default' WHERE owner IS NULL"))
        db.commit()


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


def purge_old_records(db: Session, days: int = 30) -> int:
    """Delete telemetry older than `days` (session metadata + execution logs).

    Saved pipelines are user data and are never touched. Cutoff is naive
    UTC: SQLite returns naive datetimes, and Postgres interprets naive
    comparisons in the session timezone (UTC on Render).
    """
    cutoff: datetime = datetime.now(timezone.utc).replace(tzinfo=None)
    removed: int = 0
    removed += (
        db.query(SessionMeta).filter(SessionMeta.created_at < cutoff).delete()
    )
    removed += (
        db.query(ExecutionLog).filter(ExecutionLog.executed_at < cutoff).delete()
    )
    db.commit()
    return removed
