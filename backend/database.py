"""FILE: backend/database.py
PURPOSE: DB connection — sqlite local, postgres (Neon/Render) in production.
HOW IT FITS: DATABASE_URL env -> engine/SessionLocal/get_db used by main.py via Depends.
WHERE TO EDIT: To change DB: set DATABASE_URL env. SQLite needs
  check_same_thread=False; remote Postgres needs pre-ping so sleeping/free-tier
  databases do not hand the app dead pooled connections.
"""
import os
from collections.abc import Iterator
from typing import Any, Dict

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


def resolve_database_url() -> str:
    raw: str = os.environ.get("DATABASE_URL", "").strip()
    if not raw:
        # Render's disk is ephemeral: accounts saved to SQLite there vanish on
        # the next sleep/deploy. Refuse to boot instead of silently losing
        # every login. Local development still falls back to SQLite.
        if os.environ.get("RENDER"):
            raise RuntimeError(
                "DATABASE_URL is required on Render. Create a free Neon "
                "PostgreSQL database and set DATABASE_URL "
                "(postgresql://...?sslmode=require). SQLite on Render is "
                "ephemeral and would erase accounts on restart."
            )
        return "sqlite:///./app.db"
    # Render/Heroku-style URLs use the old scheme; SQLAlchemy 2 only knows
    # postgresql://. Neon connection strings already use postgresql://.
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
    # Hosted Postgres (Neon free tier included) drops idle connections and
    # wakes slowly after suspend. pre_ping turns a dead checkout into a
    # transparent reconnect instead of a 500 on the next login/upload.
    # pool_recycle stays below common 5-minute idle cutoffs.
    return {
        "pool_pre_ping": True,
        "pool_recycle": 280,
        "pool_size": 5,
        "max_overflow": 5,
        "pool_timeout": 30,
    }


# Any is unavoidable here: SQLAlchemy engine kwargs differ per backend.
engine = create_engine(SQLALCHEMY_DATABASE_URL, **_engine_kwargs())
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Iterator[Session]:
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
