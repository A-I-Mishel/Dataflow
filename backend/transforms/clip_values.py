"""FILE: backend/transforms/clip_values.py
PURPOSE: 'clip-values' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["clip-values"] -> apply_clip_values(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.text_compat import coerce_numeric


def apply_clip_values(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        raise HTTPException(
            status_code=400, detail="clip-values: tick at least one column"
        )
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"clip-values: unknown columns {missing}")
    if config.min_value is None and config.max_value is None:
        raise HTTPException(
            status_code=400, detail="clip-values: set a minimum, a maximum, or both"
        )
    try:
        lower = None if config.min_value is None else float(config.min_value)
        upper = None if config.max_value is None else float(config.max_value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail="clip-values: bounds must be numeric"
        ) from exc
    if lower is not None and upper is not None and lower > upper:
        raise HTTPException(
            status_code=400, detail="clip-values: minimum exceeds maximum"
        )
    coerced = {c: coerce_numeric(df, c, "clip-values") for c in cols}
    result: pd.DataFrame = df.copy(deep=True)
    for col in cols:
        result[col] = coerced[col].clip(lower=lower, upper=upper)
    args: List[str] = []
    if lower is not None:
        args.append(f"lower={lower!r}")
    if upper is not None:
        args.append(f"upper={upper!r}")
    return result, f"df[{list(cols)!r}] = df[{list(cols)!r}].clip({', '.join(args)})"
