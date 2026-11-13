"""FILE: backend/models_db.py
PURPOSE: DB tables: User, AuthSession, SavedPipeline, SessionMeta, ExecutionLog.
HOW IT FITS: SQLAlchemy models created via Base.metadata in database.py.
WHERE TO EDIT: Rarely edit. Pipeline names are unique per account and
  ownership is scoped by the `owner` column (always user:<id>).
"""
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    # Always stored lowercase (auth.normalize_email) so casing cannot create
    # duplicate accounts.
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class AuthSession(Base):
    """Opaque login token. Only the SHA-256 hash is stored, never the token."""

    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)


class SavedPipeline(Base):
    __tablename__ = "saved_pipelines"
    # Names are unique per account, not globally: two students can each save
    # "clean sales.csv". Existing SQLite files with the old global unique
    # index are rebuilt by crud.ensure_pipeline_schema() at startup.
    __table_args__ = (
        UniqueConstraint("owner", "name", name="uq_saved_pipelines_owner_name"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    nodes_json: Mapped[str] = mapped_column(Text, nullable=False)
    edges_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    # Owning account namespace: always "user:<id>" in production. The
    # index keeps per-account list queries cheap.
    owner: Mapped[str] = mapped_column(String, nullable=False, default="default", index=True)


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
