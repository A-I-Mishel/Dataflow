"""FILE: backend/models_db.py
PURPOSE: DB tables: SavedPipeline, SessionMeta, ExecutionLog.
HOW IT FITS: SQLAlchemy models created via Base.metadata in database.py.
WHERE TO EDIT: Rarely edit. name is globally unique (add owner later if multi-user).
"""
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SavedPipeline(Base):
    __tablename__ = "saved_pipelines"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    nodes_json: Mapped[str] = mapped_column(Text, nullable=False)
    edges_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    # Owning API-key namespace ("default" when no key is sent). Added after
    # launch: existing databases gain the column via ensure_owner_column().
    # NOTE: `name` stays globally unique at the DB level (SQLite cannot drop
    # the constraint without a rebuild), so per-key scoping is enforced in
    # crud queries while duplicate names across keys still 400.
    owner: Mapped[str] = mapped_column(String, nullable=False, default="default")


class SessionMeta(Base):
    __tablename__ = "session_meta"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    filename: Mapped[str | None] = mapped_column(String, nullable=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    columns_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class ExecutionLog(Base):
    __tablename__ = "execution_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str | None] = mapped_column(String, nullable=True)
    pipeline_name: Mapped[str | None] = mapped_column(String, nullable=True)
    result_rows: Mapped[int | None] = mapped_column(Integer, nullable=True)
    executed_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
