"""FILE: backend/transforms/standardize_categories.py
PURPOSE: 'standardize-categories' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["standardize-categories"] -> apply_standardize_categories(df, config) -> (new_df, code_line).
CONFIG: config.columns, config.mapping, config.method. Pandas: df.copy(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
import re
from typing import Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig

CASES = ("keep", "lower", "upper", "title")


def apply_case(value: str, case: str) -> str:
    if case == "lower":
        return value.lower()
    if case == "upper":
        return value.upper()
    if case == "title":
        # Whitespace-token title-casing (NOT str.title: apostrophes differ —
        # "o'brien" must come out identically on both engines).
        return re.sub(r"\S+", lambda m: m.group(0)[:1].upper() + m.group(0)[1:].lower(), value)
    return value


def apply_standardize_categories(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        raise HTTPException(
            status_code=400, detail="standardize-categories: tick at least one column"
        )
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"standardize-categories: unknown columns {missing}"
        )
    case: str = (config.method or "lower").lower()
    if case not in CASES:
        raise HTTPException(
            status_code=400, detail="standardize-categories: case must be keep, lower, upper or title"
        )
    mapping: Dict[str, str] = dict(config.mapping or {})
    result: pd.DataFrame = df.copy(deep=True)
    for col in cols:
        series = df[col]
        out = series.where(
            series.isna(),
            series.astype(object).apply(
                lambda v: apply_case(str(v).strip(), case) if isinstance(v, str) else v
            ),
        )
        if mapping:
            out = out.replace(mapping)
        result[col] = out
    case_code: str = {
        "keep": "df[cols]  # unchanged case",
        "lower": "df[cols] = df[cols].str.lower()",
        "upper": "df[cols] = df[cols].str.upper()",
        "title": 'df[cols] = df[cols].str.replace(r"\\S+", lambda m: m.group(0)[:1].upper() + m.group(0)[1:].lower(), regex=True)',
    }[case]
    lines: List[str] = [
        f"cols = {list(cols)!r}",
        "# trim + case first, custom mappings second (missing untouched)",
        "df[cols] = df[cols].apply(lambda s: s.str.strip() if s.dtype == object else s)",
        case_code,
    ]
    if mapping:
        lines.append(f"df[cols] = df[cols].replace({mapping!r})")
    return result, "\n".join(lines)
