"""FILE: backend/transforms/drop_na.py
PURPOSE: 'drop-na' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["drop-na"] -> apply_drop_na(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_drop_na(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    how: str = (config.how or "any").lower()
    if how not in ("any", "all"):
        raise HTTPException(
            status_code=400, detail="drop-na: how must be 'any' or 'all'"
        )
    cols: Optional[List[str]] = config.columns
    if cols:
        missing: List[str] = [c for c in cols if c not in df.columns]
        if missing:
            raise HTTPException(
                status_code=400, detail=f"drop-na: unknown columns {missing}"
            )
        result: pd.DataFrame = df.dropna(subset=cols, how=how)
        return result, f"df = df.dropna(subset={cols!r}, how={how!r})"
    result = df.dropna(how=how)
    return result, f"df = df.dropna(how={how!r})"
