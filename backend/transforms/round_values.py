"""FILE: backend/transforms/round_values.py
PURPOSE: 'round-values' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["round-values"] -> apply_round_values(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig

DEFAULT_DECIMALS: int = 2


def apply_round_values(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    decimals: int = DEFAULT_DECIMALS if config.decimals is None else config.decimals
    if not isinstance(decimals, int) or isinstance(decimals, bool) or decimals < 0:
        raise HTTPException(
            status_code=400,
            detail="round-values: decimals must be a non-negative integer",
        )
    cols: Optional[List[str]] = config.columns
    if cols:
        missing: List[str] = [c for c in cols if c not in df.columns]
        if missing:
            raise HTTPException(
                status_code=400, detail=f"round-values: unknown columns {missing}"
            )
        target: List[str] = list(cols)
        auto: bool = False
    else:
        target = df.select_dtypes(include="number").columns.tolist()
        auto = True
    if not target:
        return df.copy(deep=True), "# no numeric columns to round; df unchanged"
    result: pd.DataFrame = df.copy(deep=True)
    result[target] = df[target].round(decimals)
    if auto:
        code: str = (
            "cols = df.select_dtypes(include='number').columns.tolist()\n"
            f"df[cols] = df[cols].round({decimals})"
        )
    else:
        code = f"df[{target!r}] = df[{target!r}].round({decimals})"
    return result, code
