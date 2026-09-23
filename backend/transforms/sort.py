"""FILE: backend/transforms/sort.py
PURPOSE: 'sort' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["sort"] -> apply_sort(df, config) -> (new_df, code_line).
CONFIG: config.ascending, config.by. Pandas: df.copy(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_sort(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    by: Optional[List[str]] = config.by
    ascending: bool = True if config.ascending is None else bool(config.ascending)
    if not by:
        return df.copy(deep=True), "# no sort columns specified; df unchanged"
    missing: List[str] = [c for c in by if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"sort: unknown columns {missing}")
    # kind="stable": tied rows keep their input order (matches the Sieve
    # engine's stable sort and the exported script below). Quicksort ties
    # would come out in an arbitrary, run-dependent order instead.
    result: pd.DataFrame = df.sort_values(by=by, ascending=ascending, kind="stable")
    return result, f"df = df.sort_values(by={by!r}, ascending={ascending}, kind='stable')"
