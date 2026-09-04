import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

logger = logging.getLogger(__name__)

SESSION_TTL_HOURS: int = 2

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


large_files: Dict[str, Tuple[datetime, LargeFileEntry]] = {}


def _is_expired(stored_at: datetime) -> bool:
    now: datetime = datetime.now()
    expiry: timedelta = timedelta(hours=SESSION_TTL_HOURS)
    return (now - stored_at) > expiry


def store_session(session_id: str, df: pd.DataFrame) -> None:
    sessions[session_id] = (datetime.now(), df.copy(deep=True))


def get_session(session_id: str) -> pd.DataFrame:
    entry: Optional[Tuple[datetime, pd.DataFrame]] = sessions.get(session_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found or expired")
    stored_at, df = entry
    if _is_expired(stored_at):
        sessions.pop(session_id, None)
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found or expired")
    return df.copy(deep=True)


def store_result(session_id: str, df: pd.DataFrame) -> None:
    results[session_id] = (datetime.now(), df.copy(deep=True))


def get_result(session_id: str) -> pd.DataFrame:
    entry: Optional[Tuple[datetime, pd.DataFrame]] = results.get(session_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Result for session '{session_id}' not found or expired")
    stored_at, df = entry
    if _is_expired(stored_at):
        results.pop(session_id, None)
        raise HTTPException(status_code=404, detail=f"Result for session '{session_id}' not found or expired")
    return df.copy(deep=True)


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
    return evicted


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
) -> None:
    old: Optional[Tuple[datetime, LargeFileEntry]] = large_files.get(session_id)
    if old is not None and old[1].path != path:
        _unlink_quietly(old[1].path)
    large_files[session_id] = (
        datetime.now(),
        LargeFileEntry(
            path=path,
            preview_df=preview_df.copy(deep=True),
            total_rows=total_rows,
            encoding=encoding,
        ),
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
    )


def discard_large_session(session_id: str) -> None:
    """Remove a large-file entry (and its temp file) without raising."""
    entry: Optional[Tuple[datetime, LargeFileEntry]] = large_files.pop(session_id, None)
    if entry is not None:
        _unlink_quietly(entry[1].path)
