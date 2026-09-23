"""FILE: backend/transforms/replace_values.py
PURPOSE: 'replace-values' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["replace-values"] -> apply_replace_values(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_replace_values(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    find = config.find
    if find is None:
        raise HTTPException(
            status_code=400, detail="replace-values: specify the value to find"
        )
    # None replacement means null (the spec's N/A -> null case).
    replacement = np.nan if config.replacement is None else config.replacement
    case_sensitive: bool = True if config.case_sensitive is None else bool(config.case_sensitive)
    cols: Optional[List[str]] = config.columns
    if cols:
        missing: List[str] = [c for c in cols if c not in df.columns]
        if missing:
            raise HTTPException(
                status_code=400, detail=f"replace-values: unknown columns {missing}"
            )
        target: List[str] = list(cols)
        auto: bool = False
    else:
        target = df.select_dtypes(include=["object", "str", "category"]).columns.tolist()
        auto = True
    if not target:
        return df.copy(deep=True), "# no text columns to search; df unchanged"
    result: pd.DataFrame = df.copy(deep=True)
    if case_sensitive:
        result[target] = df[target].replace(find, replacement)
    else:
        # Case lives only in strings: compare lower-cased, leave everything
        # else (including missing) untouched. Mirrors the Sieve twin exactly.
        needle: str = str(find).lower()
        for col in target:
            series = df[col]
            result[col] = series.where(
                series.isna(),
                series.apply(
                    lambda v: replacement
                    if isinstance(v, str) and v.lower() == needle
                    else v
                ),
            )
    if auto:
        scope = "cols = df.select_dtypes(include=['object', 'str', 'category']).columns.tolist()"
    else:
        scope = f"cols = {target!r}"
    # repr(nan) is a bare `nan` (NameError for users) — emit float("nan").
    rep_code: str = (
        'float("nan")'
        if isinstance(replacement, float) and np.isnan(replacement)
        else repr(replacement)
    )
    if case_sensitive:
        code: str = f"{scope}\ndf[cols] = df[cols].replace({find!r}, {rep_code})"
    else:
        code = (
            f"{scope}\n"
            f"for col in cols:\n"
            f"    df[col] = df[col].where(df[col].isna(), df[col].apply(\n"
            f"        lambda v: {rep_code} if isinstance(v, str) and v.lower() == {str(find).lower()!r} else v))"
        )
    return result, code
