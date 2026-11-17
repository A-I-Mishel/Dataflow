"""FILE: backend/crud.py
PURPOSE: DB reads/writes for users, auth sessions, saved pipelines + logs.
HOW IT FITS: main.py -> crud.create/get/list/log. Stores nodes_json/edges_json blobs, owner-scoped.
WHERE TO EDIT: To add query: copy one func, keep owner filter or users see each other data.
"""
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from sqlalchemy.orm import Session

from models_db import AuthSession, ExecutionLog, SavedPipeline, SessionMeta, User

# Any is unavoidable here: pipeline nodes/edges are arbitrary JSON blobs
# (ids, types, configs, positions) that must round-trip byte-identically.


def create_user(db: Session, email: str, password_hash: str) -> User:
    row: User = User(
        id=str(uuid4()),
        email=email,
        password_hash=password_hash,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_user(db: Session, user_id: str) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(User.email == email).first()


def create_auth_session(
    db: Session,
    token_hash: str,
    user_id: str,
    created_at: datetime,
    expires_at: datetime,
) -> AuthSession:
    row: AuthSession = AuthSession(
        token_hash=token_hash,
        user_id=user_id,
        created_at=created_at,
        expires_at=expires_at,
    )
    db.add(row)
    db.commit()
    return row


def get_auth_session(db: Session, token_hash: str) -> Optional[AuthSession]:
    return db.query(AuthSession).filter(AuthSession.token_hash == token_hash).first()


def delete_auth_session(db: Session, token_hash: str) -> int:
    deleted: int = (
        db.query(AuthSession)
        .filter(AuthSession.token_hash == token_hash)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


def delete_expired_auth_sessions(db: Session, cutoff: datetime) -> int:
    deleted: int = (
        db.query(AuthSession)
        .filter(AuthSession.expires_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


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


def ensure_pipeline_schema(db: Session) -> None:
    """Upgrade pre-account SQLite databases in place.

    Two historical shapes need fixing:

    1. Tables created before the `owner` column existed get it added and
       backfilled with 'default' (those rows were anonymous/test data).
    2. Tables whose `name` column is globally UNIQUE get rebuilt with a
       (owner, name) UNIQUE constraint, so two accounts may reuse a template
       name. A fresh database already has the new shape, and SQLAlchemy's
       create_all never alters an existing table, hence the manual rebuild.

    Postgres uses Alembic-less create_all too, but production is a fresh Neon
    database; this helper is a no-op on non-SQLite dialects.
    """
    from sqlalchemy import text

    if db.bind is None or db.bind.dialect.name != "sqlite":
        return
    cols = [row[1] for row in db.execute(text("PRAGMA table_info(saved_pipelines)"))]
    if "owner" not in cols:
        db.execute(text("ALTER TABLE saved_pipelines ADD COLUMN owner VARCHAR DEFAULT 'default'"))
        db.execute(text("UPDATE saved_pipelines SET owner = 'default' WHERE owner IS NULL"))
        db.commit()

    legacy_name_unique: bool = False
    for row in db.execute(text("PRAGMA index_list(saved_pipelines)")).fetchall():
        # (seq, index_name, is_unique, origin, partial)
        index_name, is_unique = row[1], row[2]
        if not is_unique:
            continue
        indexed_cols = [
            info[2] for info in db.execute(text(f'PRAGMA index_info("{index_name}")'))
        ]
        if indexed_cols == ["name"]:
            legacy_name_unique = True
            break

    if not legacy_name_unique:
        return

    # SQLite cannot DROP a constraint; rebuild the small metadata table.
    # Clear a leftover from a previously interrupted migration first.
    db.execute(text("DROP TABLE IF EXISTS saved_pipelines_new"))
    db.execute(
        text(
            """
            CREATE TABLE saved_pipelines_new (
                id VARCHAR NOT NULL PRIMARY KEY,
                name VARCHAR NOT NULL,
                nodes_json TEXT NOT NULL,
                edges_json TEXT NOT NULL,
                created_at DATETIME,
                owner VARCHAR NOT NULL DEFAULT 'default',
                CONSTRAINT uq_saved_pipelines_owner_name UNIQUE (owner, name)
            )
            """
        )
    )
    db.execute(
        text(
            """
            INSERT INTO saved_pipelines_new
                (id, name, nodes_json, edges_json, created_at, owner)
            SELECT id, name, nodes_json, edges_json, created_at,
                   COALESCE(owner, 'default')
            FROM saved_pipelines
            """
        )
    )
    db.execute(text("DROP TABLE saved_pipelines"))
    db.execute(text("ALTER TABLE saved_pipelines_new RENAME TO saved_pipelines"))
    db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_saved_pipelines_owner "
            "ON saved_pipelines (owner)"
        )
    )
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
