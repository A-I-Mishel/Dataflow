"""FILE: backend/transforms/find_invalid.py
PURPOSE: 'find-invalid' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["find-invalid"] -> apply_find_invalid(df, config) -> (new_df, code_line).
CONFIG: config.columns, config.expect, config.max_value, config.min_value. Pandas: df.copy(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.validate_column import present_mask

logger = logging.getLogger(__name__)

EXPECTS = ("number", "text", "date")


def _collect(series: pd.Series, mask: pd.Series, reason: str) -> List[Tuple[Any, int, str]]:
    """Top-10 (value, count, reason) for logging; never raises."""
    out: List[Tuple[Any, int, str]] = []
    try:
        counts = series[mask.fillna(False)].value_counts()
    except Exception:
        return out
    for value, count in list(counts.items())[:10]:
        out.append((value, int(count), reason))
    return out


def _parse_bound(raw: Any, name: str) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"find-invalid: {name} must be numeric") from exc


def apply_find_invalid(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols or len(cols) != 1:
        raise HTTPException(
            status_code=400, detail="find-invalid: select exactly one column"
        )
    column: str = cols[0]
    if column not in df.columns:
        raise HTTPException(status_code=400, detail=f"find-invalid: unknown column '{column}'")
    expect: str = (config.expect or "number").lower()
    if expect not in EXPECTS:
        raise HTTPException(
            status_code=400, detail="find-invalid: expect must be number, text or date"
        )
    series = df[column]
    present = present_mask(series)
    findings: List[Tuple[Any, int, str]] = []
    code_lines: List[str] = [
        f"# find-invalid {column}: lists values that look wrong (data unchanged)"
    ]
    if expect == "number":
        lo: Optional[float] = _parse_bound(config.min_value, "min")
        hi: Optional[float] = _parse_bound(config.max_value, "max")
        num = pd.to_numeric(series, errors="coerce")
        findings += _collect(series, present & num.isna(), "not a number")
        code_lines.append(f"_num = pd.to_numeric(df[{column!r}], errors=\"coerce\")")
        code_lines.append(
            f"_present = df[{column!r}].notna() & (df[{column!r}].astype(object) != '')"
        )
        code_lines.append(f"_bad = _present & _num.isna()")
        if lo is not None:
            findings += _collect(series, present & num.notna() & (num < lo), f"below minimum ({lo:g})")
            code_lines.append(f"_bad = _bad | (_present & _num.notna() & (_num < {lo!r}))")
        if hi is not None:
            findings += _collect(series, present & num.notna() & (num > hi), f"above maximum ({hi:g})")
            code_lines.append(f"_bad = _bad | (_present & _num.notna() & (_num > {hi!r}))")
    elif expect == "date":
        ok = pd.to_datetime(series, format="mixed", errors="coerce").notna()
        findings += _collect(series, present & ~ok, "not a date")
        code_lines.append(f"_ok = pd.to_datetime(df[{column!r}], format=\"mixed\", errors=\"coerce\").notna()")
        code_lines.append(
            f"_bad = df[{column!r}].notna() & (df[{column!r}].astype(object) != '') & ~_ok"
        )
    else:  # text accepts anything present — the report is empty by construction.
        code_lines.append(f"_bad = pd.Series(False, index=df.index)")
    total: int = sum(count for _, count, _ in findings)
    if total:
        shown: str = "; ".join(f"{value!r} ×{count} ({reason})" for value, count, reason in findings[:5])
        logger.warning("find-invalid '%s': %d suspicious value(s): %s", column, total, shown)
    result: pd.DataFrame = df.copy(deep=True)
    return result, "\n".join(code_lines)
