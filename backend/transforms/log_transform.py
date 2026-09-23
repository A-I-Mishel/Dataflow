"""FILE: backend/transforms/log_transform.py
PURPOSE: 'log-transform' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["log-transform"] -> apply_log_transform(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.text_compat import coerce_numeric

BASES: Dict[str, Callable[[pd.Series], pd.Series]] = {
    "ln": np.log,
    "log10": np.log10,
    "log2": np.log2,
}


def apply_log_transform(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        raise HTTPException(
            status_code=400, detail="log-transform: tick at least one column"
        )
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"log-transform: unknown columns {missing}")
    base: str = (config.method or "ln").lower()
    if base not in BASES:
        raise HTTPException(
            status_code=400, detail="log-transform: base must be ln, log10 or log2"
        )
    on_invalid: str = (config.on_invalid or "null").lower()
    if on_invalid not in ("null", "error"):
        raise HTTPException(
            status_code=400, detail="log-transform: invalid handling must be null or error"
        )
    coerced = {c: coerce_numeric(df, c, "log-transform") for c in cols}
    result: pd.DataFrame = df.copy(deep=True)
    for col in cols:
        series = coerced[col]
        bad = series.notna() & (series <= 0)
        if on_invalid == "error" and bool(bad.any()):
            sample = series[bad].iloc[0]
            raise HTTPException(
                status_code=400,
                detail=f'log-transform: column "{col}" has non-positive values (e.g. {sample!r})',
            )
        with np.errstate(divide="ignore", invalid="ignore"):
            logged = BASES[base](series)
        # Missing stays missing; non-positive become null (log undefined).
        result[col] = logged.where(~bad, np.nan)
    fn: str = {"ln": "np.log", "log10": "np.log10", "log2": "np.log2"}[base]
    lines: List[str] = []
    if on_invalid == "error":
        lines.append(
            f"_bad = [c for c in {list(cols)!r} "
            f"if ((pd.to_numeric(df[c], errors=\"coerce\").notna()) & (pd.to_numeric(df[c], errors=\"coerce\") <= 0)).any()]"
        )
        lines.append(f"assert not _bad, f\"log-transform: non-positive values in {{_bad}}\"")
    lines.append(f"_v = df[{list(cols)!r}].apply(pd.to_numeric, errors=\"coerce\")")
    lines.append(f"with np.errstate(divide=\"ignore\", invalid=\"ignore\"):")
    lines.append(f"    _v = {fn}(_v)")
    lines.append(f"df[{list(cols)!r}] = _v.mask(~np.isfinite(_v), np.nan)")
    return result, "\n".join(lines)
