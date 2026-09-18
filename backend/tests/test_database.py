import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest

from database import resolve_database_url


def test_default_is_sqlite(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert resolve_database_url() == "sqlite:///./app.db"


def test_blank_falls_back_to_sqlite(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "   ")
    assert resolve_database_url() == "sqlite:///./app.db"


def test_postgres_scheme_fixed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@host:5432/db")
    assert resolve_database_url() == "postgresql://user:pass@host:5432/db"


def test_postgresql_passthrough(monkeypatch: pytest.MonkeyPatch) -> None:
    url: str = "postgresql://user:pass@host:5432/db"
    monkeypatch.setenv("DATABASE_URL", url)
    assert resolve_database_url() == url


def test_purge_old_records_keeps_pipelines_and_recent() -> None:
    import crud
    from database import SessionLocal
    from models_db import ExecutionLog, SavedPipeline, SessionMeta
    from datetime import datetime, timedelta, timezone
    from uuid import uuid4

    db = SessionLocal()
    try:
        old = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=40)
        db.add(SessionMeta(id="purge-old-meta", filename="x", row_count=1, columns_json="[]", created_at=old))
        db.add(
            ExecutionLog(
                session_id="purge-old", pipeline_name="x", result_rows=1, executed_at=old
            )
        )
        pipe_id: str = uuid4().hex
        db.add(
            SavedPipeline(
                id=pipe_id, name="purge-never-" + pipe_id[:8], nodes_json="[]", edges_json="[]"
            )
        )
        db.commit()
        removed: int = crud.purge_old_records(db)
        assert removed >= 2
        assert db.query(SessionMeta).filter(SessionMeta.id == "purge-old-meta").first() is None
        assert (
            db.query(SavedPipeline).filter(SavedPipeline.id == pipe_id).first() is not None
        )
    finally:
        db.query(SessionMeta).filter(SessionMeta.id == "purge-old-meta").delete()
        db.query(ExecutionLog).filter(ExecutionLog.session_id == "purge-old").delete()
        db.query(SavedPipeline).filter(SavedPipeline.id == pipe_id).delete()
        db.commit()
        db.close()
