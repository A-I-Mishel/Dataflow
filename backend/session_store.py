"""FILE: backend/session_store.py
PURPOSE: In-memory sessions/results (RAM) + large_files on disk + TTL 2h.
HOW IT FITS: main.py upload->store_session, execute->get_session/get_result. Large files use LargeFileEntry preview.
WHERE TO EDIT: To change memory: edit MAX_* caps. TTL cleanup via evict_old_sessions().
"""
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

logger = logging.getLogger(__name__)

SESSION_TTL_HOURS: int = 2

# Hard caps bound RAM within the TTL window: without these, every upload
# parks a full dataframe and every run parks another, until the 2h expiry.
# Oldest entries go first (dicts preserve insertion order; re-storing a key
# refreshes its position).
MAX_SESSIONS: int = 20
MAX_RESULTS: int = 20
MAX_LARGE_FILES: int = 5

sessions: Dict[str, Tuple[datetime, pd.DataFrame]] = {}
results: Dict[str, Tuple[datetime, pd.DataFrame]] = {}


@dataclass
class LargeFileEntry:
    """On-disk backing for uploads too big to keep fully in memory.

    Only a small preview is held in RAM; the full CSV stays in a temp file
    and is processed in chunks.
    """

    path: str
    preview_df: pd.DataFrame = field(repr=False)
    total_rows: int
    encoding: str
    # Delimiter sniffed at upload (shared rule with the Sieve parser), so
    # chunk re-reads split identically without re-sniffing.
    sep: str = ","


large_files: Dict[str, Tuple[datetime, LargeFileEntry]] = {}


def _is_expired(stored_at: datetime) -> bool:
    now: datetime = datetime.now()
    expiry: timedelta = timedelta(hours=SESSION_TTL_HOURS)
    return (now - stored_at) > expiry


def _enforce_cap(
    store: Dict[str, Tuple[datetime, object]], limit: int, name: str
) -> None:
    while len(store) > limit:
        oldest: str = next(iter(store))
        store.pop(oldest, None)
        logger.info("Evicted oldest %s entry '%s' (store cap %d)", name, oldest, limit)


def store_session(session_id: str, df: pd.DataFrame) -> None:
    # Stored and returned by reference (no copies anywhere on this path):
    # execute_pipeline copies its input before transforming, and the
    # profiler only reads, so the stored frame is never mutated.
    sessions.pop(session_id, None)
    sessions[session_id] = (datetime.now(), df)
    _enforce_cap(sessions, MAX_SESSIONS, "session")


def get_session(session_id: str) -> pd.DataFrame:
    entry: Optional[Tuple[datetime, pd.DataFrame]] = sessions.get(session_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found or expired")
    stored_at, df = entry
    if _is_expired(stored_at):
        sessions.pop(session_id, None)
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found or expired")
    # No copy: callers must not mutate the returned frame (see store_session).
    return df


def store_result(session_id: str, df: pd.DataFrame) -> None:
    # Same by-reference contract as store_session: the only reader
    # (CSV download) streams read-only chunks and never mutates.
    results.pop(session_id, None)
    results[session_id] = (datetime.now(), df)
    _enforce_cap(results, MAX_RESULTS, "result")


def get_result(session_id: str) -> pd.DataFrame:
    entry: Optional[Tuple[datetime, pd.DataFrame]] = results.get(session_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Result for session '{session_id}' not found or expired")
    stored_at, df = entry
    if _is_expired(stored_at):
        results.pop(session_id, None)
        raise HTTPException(status_code=404, detail=f"Result for session '{session_id}' not found or expired")
    # No copy: callers must not mutate the returned frame (see store_result).
    return df


def evict_old_sessions() -> int:
    evicted: int = 0
    for store in (sessions, results):
        expired_keys: List[str] = [key for key, (stored_at, _df) in store.items() if _is_expired(stored_at)]
        for key in expired_keys:
            store.pop(key, None)
            evicted += 1
    expired_large: List[str] = [
        key for key, (stored_at, _entry) in large_files.items() if _is_expired(stored_at)
    ]
    for key in expired_large:
        _, entry = large_files.pop(key)
        _unlink_quietly(entry.path)
        evicted += 1
    if evicted:
        logger.info("Evicted %d expired session entries", evicted)
        log_memory_usage("evict")
    return evicted


def _process_rss_mb() -> Optional[float]:
    try:
        import resource
        import sys

        # ru_maxrss is kilobytes on Linux, bytes on macOS.
        rss: float = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        if sys.platform == "darwin":
            return rss / (1024.0 * 1024.0)
        return rss / 1024.0
    except Exception:
        return None


def _store_frame_mb() -> float:
    total_bytes: int = 0
    for _stored_at, df in list(sessions.values()):
        try:
            total_bytes += int(df.memory_usage(deep=True).sum())
        except Exception:
            continue
    for _stored_at, df in list(results.values()):
        try:
            total_bytes += int(df.memory_usage(deep=True).sum())
        except Exception:
            continue
    return total_bytes / (1024.0 * 1024.0)


def log_memory_usage(context: str) -> None:
    """One-line memory telemetry for the (paywalled) Render metrics gap."""
    rss_mb: Optional[float] = _process_rss_mb()
    logger.info(
        "mem[%s] rss=%.1fMB stored_frames=%.1fMB sessions=%d results=%d large_files=%d",
        context,
        rss_mb if rss_mb is not None else -1.0,
        _store_frame_mb(),
        len(sessions),
        len(results),
        len(large_files),
    )


def _unlink_quietly(path: str) -> None:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    except Exception as exc:
        logger.warning("Failed removing temp file %s: %s", path, exc)


def store_large_session(
    session_id: str,
    path: str,
    preview_df: pd.DataFrame,
    total_rows: int,
    encoding: str,
    sep: str = ",",
) -> None:
    old: Optional[Tuple[datetime, LargeFileEntry]] = large_files.get(session_id)
    if old is not None and old[1].path != path:
        _unlink_quietly(old[1].path)
    # Pop-then-set in every branch: reassigning an existing dict key keeps
    # its original insertion position, which would let a just-refreshed
    # entry be evicted as "oldest" below.
    large_files.pop(session_id, None)
    large_files[session_id] = (
        datetime.now(),
        LargeFileEntry(
            path=path,
            preview_df=preview_df.copy(deep=True),
            total_rows=total_rows,
            encoding=encoding,
            sep=sep,
        ),
    )
    while len(large_files) > MAX_LARGE_FILES:
        oldest: str = next(iter(large_files))
        _, evicted_entry = large_files.pop(oldest)
        _unlink_quietly(evicted_entry.path)
        logger.info(
            "Evicted oldest large-file entry '%s' (store cap %d)",
            oldest,
            MAX_LARGE_FILES,
        )


def is_large_session(session_id: str) -> bool:
    entry: Optional[Tuple[datetime, LargeFileEntry]] = large_files.get(session_id)
    if entry is None:
        return False
    stored_at, large = entry
    if _is_expired(stored_at):
        large_files.pop(session_id, None)
        _unlink_quietly(large.path)
        return False
    return True


def get_large_session(session_id: str) -> LargeFileEntry:
    entry: Optional[Tuple[datetime, LargeFileEntry]] = large_files.get(session_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found or expired")
    stored_at, large = entry
    if _is_expired(stored_at):
        large_files.pop(session_id, None)
        _unlink_quietly(large.path)
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found or expired")
    return LargeFileEntry(
        path=large.path,
        preview_df=large.preview_df.copy(deep=True),
        total_rows=large.total_rows,
        encoding=large.encoding,
        sep=large.sep,
    )


def discard_large_session(session_id: str) -> None:
    """Remove a large-file entry (and its temp file) without raising."""
    entry: Optional[Tuple[datetime, LargeFileEntry]] = large_files.pop(session_id, None)
    if entry is not None:
        _unlink_quietly(entry[1].path)
