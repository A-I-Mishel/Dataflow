"""FILE: backend/transforms/drop_empty_columns.py
PURPOSE: 'drop-empty-columns' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["drop-empty-columns"] -> apply_drop_empty_columns(df, config) -> (new_df, code_line).
CONFIG: config.columns only. Pandas: df.isna(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Tuple

import pandas as pd

from models import NodeConfig


def _empty_mask(df: pd.DataFrame) -> pd.DataFrame:
    """True where a cell carries no information.

    Mirrors the Sieve engine's MISS (null/NaN or exactly ''): numeric
    columns can only be NA, while object columns may also hold ''.
    Whitespace-only strings are NOT empty here — trimming them is
    clean-text's job, and treating them as empty would diverge from Sieve.
    """
    na = df.isna()
    blank = pd.DataFrame(False, index=df.index, columns=df.columns)
    for col in df.columns.tolist():
        series = df[col]
        # pandas 3 infers `str` dtype for text columns (object in pandas 2).
        if series.dtype == object or str(series.dtype) in ("string", "str"):
            blank[col] = series.apply(
                lambda v: isinstance(v, str) and v == ""
            )
    return na | blank


def apply_drop_empty_columns(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    del config  # no parameters: drops every all-empty column.
    # all() over zero rows is vacuously true — never drop from an empty frame.
    if len(df) == 0:
        return df.copy(deep=True), "# empty dataset; df unchanged"
    mask = _empty_mask(df)
    empty: List[str] = [str(c) for c in df.columns.tolist() if bool(mask[c].all())]
    if not empty:
        return df.copy(deep=True), "# no all-empty columns to drop; df unchanged"
    result: pd.DataFrame = df.drop(columns=empty)
    return result, (
        "# drop columns where every value is missing or ''\n"
        "empty = [c for c in df.columns if df[c].isna().all() or "
        "(str(df[c].dtype) in ('object', 'string', 'str') and bool((df[c] == '').all()))]\n"
        "df = df.drop(columns=empty)"
    )
