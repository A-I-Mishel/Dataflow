"""FILE: backend/transforms/drop_duplicates.py
PURPOSE: 'drop-duplicates' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["drop-duplicates"] -> apply_drop_duplicates(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_drop_duplicates(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if cols:
        missing: List[str] = [c for c in cols if c not in df.columns]
        if missing:
            raise HTTPException(
                status_code=400, detail=f"drop-duplicates: unknown columns {missing}"
            )
        result: pd.DataFrame = df.drop_duplicates(subset=list(cols))
        return result, f"df = df.drop_duplicates(subset={list(cols)!r})"
    result = df.drop_duplicates()
    return result, "df = df.drop_duplicates()"
