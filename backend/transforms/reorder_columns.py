"""FILE: backend/transforms/reorder_columns.py
PURPOSE: 'reorder-columns' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["reorder-columns"] -> apply_reorder_columns(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_reorder_columns(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        raise HTTPException(
            status_code=400, detail="reorder-columns: provide the full new column order"
        )
    # Exact set match: a missing or extra entry would silently drop data.
    if sorted(cols) != sorted(str(c) for c in df.columns.tolist()):
        raise HTTPException(
            status_code=400,
            detail="reorder-columns: columns must match the dataset columns exactly (no additions, no omissions)",
        )
    result: pd.DataFrame = df[list(cols)].copy(deep=True)
    return result, f"df = df[{list(cols)!r}]"
