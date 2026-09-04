import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

logger = logging.getLogger(__name__)

SESSION_TTL_HOURS: int = 2

sessions: Dict[str, Tuple[datetime, pd.DataFrame]] = {}
results: Dict[str, Tuple[datetime, pd.DataFrame]] = {}


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
    if evicted:
        logger.info("Evicted %d expired session entries", evicted)
    return evicted
