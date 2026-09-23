"""FILE: backend/transforms/date_difference.py
PURPOSE: 'date-difference' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["date-difference"] -> apply_date_difference(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.parse_date import parse_column

UNITS = {"days": 86400, "hours": 3600, "minutes": 60, "seconds": 1}


def apply_date_difference(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols or len(cols) != 2:
        raise HTTPException(
            status_code=400, detail="date-difference: select exactly two columns (start, end)"
        )
    start_col, end_col = cols[0], cols[1]
    missing: List[str] = [c for c in (start_col, end_col) if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"date-difference: unknown columns {missing}")
    unit: str = (config.unit or "days").lower()
    if unit not in UNITS:
        raise HTTPException(
            status_code=400, detail="date-difference: unit must be days, hours, minutes or seconds"
        )
    output: Optional[str] = config.output
    if not output or not str(output).strip():
        raise HTTPException(status_code=400, detail="date-difference: name the output column")
    output = str(output).strip()
    if output in df.columns:
        raise HTTPException(
            status_code=400, detail=f'date-difference: column "{output}" already exists'
        )
    start = parse_column(df[start_col], "auto")
    end = parse_column(df[end_col], "auto")
    result: pd.DataFrame = df.copy(deep=True)
    result[output] = (end - start).dt.total_seconds() / UNITS[unit]
    code: str = (
        f"def _parse(s):\n"
        f"    try:  # pandas >= 2.0 handles mixed formats\n"
        f"        return pd.to_datetime(s, format=\"mixed\", errors=\"coerce\")\n"
        f"    except (TypeError, ValueError):\n"
        f"        return pd.to_datetime(s, errors=\"coerce\")\n"
        f"_s = _parse(df[{start_col!r}])\n"
        f"_e = _parse(df[{end_col!r}])\n"
        f"df[{output!r}] = (_e - _s).dt.total_seconds() / {UNITS[unit]}"
    )
    return result, code
