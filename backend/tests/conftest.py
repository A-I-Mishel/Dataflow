"""Suite hermeticity: reset shared in-memory state around every test.

Two order-dependent flakes lived here before this file existed:

- The rate-limit buckets (30 uploads/min/IP) accumulate across test files
  in one pytest process, so late tests 429 for reasons unrelated to the
  code under test. The fake clock below is frozen within a test
  (multi-request limit tests still accumulate) and advanced a full window
  between tests.
- The 20-session/20-result/5-large-file caps do the same for stored
  frames. Snapshot/restore keeps each test hermetic without touching the
  production caps (which are intentional abuse friction, not test config).

Only the `ratelimit` module namespace sees the fake clock; `datetime`
 TTLs and everything else keep real time.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest

import session_store


class _ManualClock:
    def __init__(self) -> None:
        self._base: float = time.monotonic()
        self._tick: float = 0.0

    def monotonic(self) -> float:
        return self._base + self._tick

    def advance(self) -> None:
        self._tick += 61.0


_CLOCK = _ManualClock()


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
