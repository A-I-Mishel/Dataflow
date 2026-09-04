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
