import os
import sys
import tempfile
from typing import Generator, List

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import pytest

import session_store as ss
from session_store import (
    MAX_RESULTS,
    MAX_SESSIONS,
    get_result,
    get_session,
    store_large_session,
    store_result,
    store_session,
)


@pytest.fixture
def isolated_stores() -> Generator[None, None, None]:
    saved_sessions = dict(ss.sessions)
    saved_results = dict(ss.results)
    saved_large = dict(ss.large_files)
    ss.sessions.clear()
    ss.results.clear()
    ss.large_files.clear()
    try:
        yield
    finally:
        # Unlink temp files created by the test, then restore shared state so
        # test files running in the same process are unaffected.
        for key, (_stored_at, entry) in list(ss.large_files.items()):
            if key not in saved_large:
                ss._unlink_quietly(entry.path)
        ss.sessions.clear()
        ss.sessions.update(saved_sessions)
        ss.results.clear()
        ss.results.update(saved_results)
        ss.large_files.clear()
        ss.large_files.update(saved_large)


def _tiny_df(n: int = 3) -> pd.DataFrame:
    return pd.DataFrame({"A": list(range(n)), "B": ["x"] * n})


def test_session_cap_evicts_oldest(isolated_stores: None) -> None:
    first_key = "cap-first"
    store_session(first_key, _tiny_df())
    for i in range(MAX_SESSIONS):
        store_session(f"cap-{i}", _tiny_df())
    # 21 inserts at cap 20: exactly the oldest ("cap-first") is gone.
    assert len(ss.sessions) == MAX_SESSIONS
    assert first_key not in ss.sessions
    assert "cap-0" in ss.sessions
    assert f"cap-{MAX_SESSIONS - 1}" in ss.sessions
    # One more insert evicts the next-oldest.
    store_session("cap-overflow", _tiny_df())
    assert len(ss.sessions) == MAX_SESSIONS
    assert "cap-0" not in ss.sessions
    assert "cap-overflow" in ss.sessions


def test_result_cap_evicts_oldest(isolated_stores: None) -> None:
    store_result("res-first", _tiny_df())
    for i in range(MAX_RESULTS):
        store_result(f"res-{i}", _tiny_df())
    assert len(ss.results) == MAX_RESULTS
    assert "res-first" not in ss.results
    assert "res-0" in ss.results
    store_result("res-overflow", _tiny_df())
    assert len(ss.results) == MAX_RESULTS
    assert "res-0" not in ss.results
    assert "res-overflow" in ss.results


def test_large_cap_evicts_oldest_and_unlinks(
    isolated_stores: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ss, "MAX_LARGE_FILES", 1)
    paths: List[str] = []
    for i in range(2):
        tmp = tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".csv", encoding="utf-8"
        )
        tmp.write("A\n1\n")
        tmp.close()
        paths.append(tmp.name)
        store_large_session(f"large-{i}", tmp.name, _tiny_df(), 1, "utf-8")
    assert len(ss.large_files) == 1
    assert "large-0" not in ss.large_files
    assert "large-1" in ss.large_files
    assert not os.path.exists(paths[0])
    assert os.path.exists(paths[1])


def test_get_session_returns_stored_frame_without_copy(
    isolated_stores: None,
) -> None:
    # Locks the by-reference contract: execute_pipeline copies its input and
    # the profiler only reads, so the extra deep copy per request is saved.
    df: pd.DataFrame = _tiny_df()
    store_session("nocopy", df)
    assert get_session("nocopy") is df


def test_get_result_returns_stored_frame_without_copy(
    isolated_stores: None,
) -> None:
    # Locks the by-reference contract: the only reader streams read-only
    # CSV chunks for download and never mutates the frame.
    df: pd.DataFrame = _tiny_df()
    store_result("nocopy", df)
    assert get_result("nocopy") is df


def test_restoring_same_key_refreshes_position(
    isolated_stores: None,
) -> None:
    for i in range(MAX_SESSIONS):
        store_session(f"k-{i}", _tiny_df())
    # Re-storing k-0 moves it to the back; the next insert evicts k-1.
    store_session("k-0", _tiny_df())
    store_session("overflow", _tiny_df())
    assert "k-0" in ss.sessions
    assert "k-1" not in ss.sessions
    assert "overflow" in ss.sessions


def test_restoring_large_key_with_new_path_refreshes_position(
    isolated_stores: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Regression: re-storing a large-file key under a new temp path unlinked
    # the old file but skipped the pop, so the dict kept the stale insertion
    # position and the just-refreshed entry could be evicted as "oldest".
    monkeypatch.setattr(ss, "MAX_LARGE_FILES", 2)
    first = tempfile.NamedTemporaryFile(
        mode="w", delete=False, suffix=".csv", encoding="utf-8"
    )
    first.write("A\n1\n")
    first.close()
    store_large_session("large-0", first.name, _tiny_df(), 1, "utf-8")
    second = tempfile.NamedTemporaryFile(
        mode="w", delete=False, suffix=".csv", encoding="utf-8"
    )
    second.write("A\n1\n")
    second.close()
    store_large_session("large-1", second.name, _tiny_df(), 1, "utf-8")
    refresh = tempfile.NamedTemporaryFile(
        mode="w", delete=False, suffix=".csv", encoding="utf-8"
    )
    refresh.write("A\n1\n")
    refresh.close()
    # Re-storing large-0 under a new path must move it to the back and
    # unlink the abandoned temp file; the next insert evicts large-1.
    store_large_session("large-0", refresh.name, _tiny_df(), 1, "utf-8")
    assert not os.path.exists(first.name)
    overflow = tempfile.NamedTemporaryFile(
        mode="w", delete=False, suffix=".csv", encoding="utf-8"
    )
    overflow.write("A\n1\n")
    overflow.close()
    store_large_session("overflow", overflow.name, _tiny_df(), 1, "utf-8")
    assert "large-0" in ss.large_files
    assert "large-1" not in ss.large_files
    assert "overflow" in ss.large_files


def test_no_eager_sklearn_import() -> None:
    import transforms.encode_categorical as ec

    assert not hasattr(ec, "LabelEncoder")


def test_log_memory_usage_never_raises(
    isolated_stores: None, caplog: pytest.LogCaptureFixture
) -> None:
    store_session("mem", _tiny_df())
    with caplog.at_level("INFO", logger="session_store"):
        ss.log_memory_usage("test")
    assert any("mem[test]" in message for message in caplog.messages)
