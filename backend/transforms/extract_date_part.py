"""FILE: backend/transforms/extract_date_part.py
PURPOSE: 'extract-date-part' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["extract-date-part"] -> apply_extract_date_part(df, config) -> (new_df, code_line).
CONFIG: config.columns, config.output, config.part. Pandas: df.copy(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.parse_date import parse_column

PARTS = ("year", "month", "day", "weekday", "quarter", "week")


def apply_extract_date_part(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols or len(cols) != 1:
        raise HTTPException(
            status_code=400, detail="extract-date-part: select exactly one date column"
        )
    col: str = cols[0]
    if col not in df.columns:
        raise HTTPException(status_code=400, detail=f"extract-date-part: unknown column '{col}'")
    part: str = (config.part or "year").lower()
    if part not in PARTS:
        raise HTTPException(
            status_code=400, detail="extract-date-part: part must be year, month, day, weekday, quarter or week"
        )
    output: Optional[str] = config.output
    if not output or not str(output).strip():
        raise HTTPException(status_code=400, detail="extract-date-part: name the output column")
    output = str(output).strip()
    if output in df.columns:
        raise HTTPException(
            status_code=400, detail=f'extract-date-part: column "{output}" already exists'
        )
    parsed = parse_column(df[col], "auto")
    result: pd.DataFrame = df.copy(deep=True)
    if part == "year":
        result[output] = parsed.dt.year
        expr: str = "_k.dt.year"
    elif part == "month":
        result[output] = parsed.dt.month
        expr = "_k.dt.month"
    elif part == "day":
        result[output] = parsed.dt.day
        expr = "_k.dt.day"
    elif part == "weekday":
        result[output] = parsed.dt.strftime("%A")
        expr = "_k.dt.strftime('%A')"
    elif part == "quarter":
        # 'Q3', never 'Q3.0': quarter arrives float when dates are missing.
        result[output] = parsed.dt.quarter.map(
            lambda q: f"Q{int(q)}" if pd.notna(q) else None
        )
        expr = "_k.dt.quarter.map(lambda q: f'Q{int(q)}' if pd.notna(q) else None)"
    else:  # ISO week number.
        result[output] = parsed.dt.isocalendar().week.astype("Int64")
        expr = "_k.dt.isocalendar().week.astype('Int64')"
    code: str = (
        f"try:\n"
        f"    _k = pd.to_datetime(df[{col!r}], format=\"mixed\", errors=\"coerce\")\n"
        f"except (TypeError, ValueError):\n"
        f"    _k = pd.to_datetime(df[{col!r}], errors=\"coerce\")\n"
        f"df[{output!r}] = {expr}"
    )
    return result, code
