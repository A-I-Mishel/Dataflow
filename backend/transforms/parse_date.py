"""FILE: backend/transforms/parse_date.py
PURPOSE: 'parse-date' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["parse-date"] -> apply_parse_date(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig

FORMATS = ("auto", "dmy", "mdy", "ymd")


def parse_column(series: pd.Series, format: str) -> pd.Series:
    """Best-effort datetimes; unparseable stays NaT on every path."""
    if format == "ymd":
        return pd.to_datetime(series, format="%Y-%m-%d", errors="coerce")
    kwargs = {"errors": "coerce"}
    if format == "dmy":
        kwargs["dayfirst"] = True
    elif format == "mdy":
        kwargs["dayfirst"] = False
    try:  # pandas >= 2.0 handles mixed formats (mirrors Sieve codegen below).
        return pd.to_datetime(series, format="mixed", **kwargs)
    except (TypeError, ValueError):
        return pd.to_datetime(series, **kwargs)


def apply_parse_date(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        raise HTTPException(
            status_code=400, detail="parse-date: tick at least one column"
        )
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"parse-date: unknown columns {missing}")
    format: str = (config.format or "auto").lower()
    if format not in FORMATS:
        raise HTTPException(
            status_code=400, detail="parse-date: format must be auto, dmy, mdy or ymd"
        )
    result: pd.DataFrame = df.copy(deep=True)
    # ISO date strings out (not datetimes): identical cells to the Sieve twin
    # and to the exported script, on every pandas version.
    for col in cols:
        result[col] = parse_column(df[col], format).dt.strftime("%Y-%m-%d")
    if format == "ymd":
        parse_code: str = 'pd.to_datetime(df[_c], format="%Y-%m-%d", errors="coerce")'
    elif format == "auto":
        parse_code = (
            'try:  # pandas >= 2.0 handles mixed formats\n'
            '        _k = pd.to_datetime(df[_c], format="mixed", errors="coerce")\n'
            '    except (TypeError, ValueError):\n'
            '        _k = pd.to_datetime(df[_c], errors="coerce")'
        )
    else:
        dayfirst: str = "True" if format == "dmy" else "False"
        parse_code = (
            'try:  # pandas >= 2.0 handles mixed formats\n'
            f'        _k = pd.to_datetime(df[_c], format="mixed", dayfirst={dayfirst}, errors="coerce")\n'
            '    except (TypeError, ValueError):\n'
            f'        _k = pd.to_datetime(df[_c], dayfirst={dayfirst}, errors="coerce")'
        )
    code: str = (
        f"for _c in {list(cols)!r}:\n"
        f"    {parse_code}\n"
        f'    df[_c] = _k.dt.strftime("%Y-%m-%d")'
    )
    return result, code
