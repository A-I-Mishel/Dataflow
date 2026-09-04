import os
from collections.abc import Iterator
from typing import Any, Dict

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


def resolve_database_url() -> str:
    raw: str = os.environ.get("DATABASE_URL", "").strip()
    if not raw:
        return "sqlite:///./app.db"
    if raw.startswith("postgres://"):
        return "postgresql://" + raw[len("postgres://") :]
    return raw


SQLALCHEMY_DATABASE_URL: str = resolve_database_url()


class Base(DeclarativeBase):
    pass


def _engine_kwargs() -> Dict[str, Any]:
    # check_same_thread is a SQLite/pysqlite-only argument.
    if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    return {}


# Any is unavoidable here: SQLAlchemy engine kwargs differ per backend.
engine = create_engine(SQLALCHEMY_DATABASE_URL, **_engine_kwargs())
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Iterator[Session]:
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
