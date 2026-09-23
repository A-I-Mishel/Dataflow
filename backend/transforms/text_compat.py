"""FILE: backend/transforms/text_compat.py
PURPOSE: 'text-compat' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["text-compat"] -> apply_text_compat(df, config) -> (new_df, code_line).
CONFIG: config.columns only. Pandas: df.pandas op(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
"""Canonical scalar→string rule shared by string-building transforms.

Sieve parses CSV into strings/numbers while pandas infers dtypes, so the
same cell can be `25` (JS number), `25` (int64) or `25.0` (float64) on the
two sides. Whole floats stringify WITH '.0' in pandas (`str(25.0)`) but
bare in JS (`String(25)`), which would silently fork merge/extract output.
Both twins therefore stringify through this rule:

- missing (None/NaN) → None (skipped by callers, never stringified)
- whole floats → int form ('25', matching int64 columns on both sides)
- everything else → str(value)

Known edge: JS booleans stringify lowercase ('true') vs pandas ('True').
Boolean cells are unreachable through CSV parsing (they arrive as strings),
so this is documented, not handled.
"""

import math
from typing import Any, Optional

import pandas as pd
from fastapi import HTTPException


def canonical_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value):
            return None
        if value.is_integer():
            return str(int(value))
        return str(value)
    return str(value)


def canonical_text_series(series: pd.Series) -> pd.Series:
    """Map a column through canonical_text, preserving missing as None."""
    return series.apply(canonical_text)


def coerce_numeric(df: pd.DataFrame, column: str, op: str) -> pd.Series:
    """Strict numerics for math ops: '' stays missing, anything else that
    does not parse (currency strings included) is a loud 400 — mirroring
    the Sieve twin's strict Number(), so both engines refuse the same
    inputs. Shared by create-column, clip-values and log-transform."""
    series = df[column]
    coerced = pd.to_numeric(series, errors="coerce")
    bad = coerced.isna() & series.notna() & (series.astype(object) != "")
    if bool(bad.any()):
        sample = series[bad].iloc[0]
        raise HTTPException(
            status_code=400,
            detail=f'{op}: column "{column}" has non-numeric values (e.g. {sample!r})',
        )
    return coerced
