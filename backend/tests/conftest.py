"""Suite hermeticity: isolated test DB, shared in-memory state, auth override.

Three things used to leak between tests:

- The database: main.py runs `Base.metadata.create_all` at import, so without
  forcing DATABASE_URL first, pytest could write into the developer's
  `backend/app.db` (or, worse, a production Postgres URL in the environment).
  A unique temp SQLite file is selected before any test module imports main.
- The rate-limit buckets (30 uploads/min/IP) accumulate across test files in
  one pytest process, so late tests 429 for reasons unrelated to the code
  under test. The fake clock below is frozen within a test (multi-request
  limit tests still accumulate) and advanced a full window between tests.
- The 20-session/20-result/5-large-file caps do the same for stored frames.
  Snapshot/restore keeps each test hermetic without touching the production
  caps (which are intentional abuse friction, not test config).

Authentication: production now rejects anonymous data requests. Legacy tests
predate accounts and call `/upload`, `/execute`, etc. without a token, so the
session fixture overrides `require_user` with one stable test account. Any
request that DOES send `Authorization: Bearer …` is delegated to the real
dependency, which lets auth/scoping tests use real signup tokens without
special cases. Tests that specifically assert a missing-token 401 use the
`real_auth_gate` fixture to remove the override for one test.
"""

import atexit
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional
from uuid import uuid4

# This must happen before importing main/database: main creates tables at
# import time, and engine/SessionLocal capture the URL at import time too.
TEST_DB_PATH = Path(tempfile.gettempdir()) / (
    f"sieve-tests-{os.getpid()}-{uuid4().hex[:10]}.db"
)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH.as_posix()}"

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from fastapi import Depends, Header
from sqlalchemy.orm import Session

import session_store

TEST_ACCOUNT_EMAIL = "suite-runner@example.test"


def _remove_test_db() -> None:
    try:
        from database import engine

        engine.dispose()
    except Exception:
        pass
    for suffix in ("", "-wal", "-shm"):
        try:
            Path(str(TEST_DB_PATH) + suffix).unlink()
        except OSError:
            pass


atexit.register(_remove_test_db)


class _ManualClock:
    def __init__(self) -> None:
        self._base: float = time.monotonic()
        self._tick: float = 0.0

    def monotonic(self) -> float:
        return self._base + self._tick

    def advance(self) -> None:
        self._tick += 61.0


_CLOCK = _ManualClock()


@pytest.fixture(scope="session", autouse=True)
def _account_gate():
    """Create the shared test account and give legacy tests a valid identity."""
    from types import SimpleNamespace

    import auth
    import crud
    from database import SessionLocal, get_db
    from main import app, require_user

    with SessionLocal() as db:
        user = crud.get_user_by_email(db, TEST_ACCOUNT_EMAIL)
        if user is None:
            user = crud.create_user(
                db,
                TEST_ACCOUNT_EMAIL,
                auth.hash_password("suite-not-a-real-password"),
            )
        test_user = SimpleNamespace(id=user.id, email=user.email)

    def _require_user_for_legacy_tests(
        authorization: Optional[str] = Header(default=None),
        db: Session = Depends(get_db),
    ):
        # Real tokens must hit the real resolver; only headerless legacy
        # requests get the suite account.
        if authorization:
            return require_user(authorization=authorization, db=db)
        return test_user

    app.dependency_overrides[require_user] = _require_user_for_legacy_tests
    try:
        yield
    finally:
        app.dependency_overrides.pop(require_user, None)


@pytest.fixture
def real_auth_gate():
    """Temporarily remove the legacy-test auth override for 401 assertions."""
    from main import app, require_user

    previous = app.dependency_overrides.pop(require_user, None)
    try:
        yield
    finally:
        if previous is not None:
            app.dependency_overrides[require_user] = previous


@pytest.fixture(autouse=True)
def _hermetic_shared_state(monkeypatch: pytest.MonkeyPatch):
    import ratelimit

    _CLOCK.advance()
    monkeypatch.setattr(ratelimit, "time", _CLOCK)
    saved_sessions = dict(session_store.sessions)
    saved_results = dict(session_store.results)
    saved_large = dict(session_store.large_files)
    session_store.sessions.clear()
    session_store.results.clear()
    session_store.large_files.clear()
    try:
        yield
    finally:
        for key, (_stored_at, entry) in list(session_store.large_files.items()):
            if key not in saved_large:
                session_store._unlink_quietly(entry.path)
        session_store.sessions.clear()
        session_store.sessions.update(saved_sessions)
        session_store.results.clear()
        session_store.results.update(saved_results)
        session_store.large_files.clear()
        session_store.large_files.update(saved_large)
