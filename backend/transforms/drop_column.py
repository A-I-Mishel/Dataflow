"""FILE: backend/transforms/drop_column.py
PURPOSE: 'drop-column' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["drop-column"] -> apply_drop_column(df, config) -> (new_df, code_line).
CONFIG: config.columns. Pandas: df.copy(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_drop_column(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        return df.copy(deep=True), "# no columns specified; df unchanged"
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"drop-column: unknown columns {missing}")
    result: pd.DataFrame = df.drop(columns=cols)
    return result, f"df = df.drop(columns={cols!r})"
