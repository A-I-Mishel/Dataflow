"""FILE: backend/transforms/find_replace_pattern.py
PURPOSE: 'find-replace-pattern' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["find-replace-pattern"] -> apply_find_replace_pattern(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
import re
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.text_compat import canonical_text_series


def apply_find_replace_pattern(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        raise HTTPException(
            status_code=400, detail="find-replace-pattern: tick at least one column"
        )
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"find-replace-pattern: unknown columns {missing}"
        )
    pattern: Optional[str] = config.pattern
    if not pattern:
        raise HTTPException(status_code=400, detail="find-replace-pattern: type a pattern")
    if len(pattern) > 200:
        raise HTTPException(
            status_code=400, detail="find-replace-pattern: pattern accepts at most 200 characters"
        )
    replacement = "" if config.replacement is None else str(config.replacement)
    use_regex: bool = True if config.use_regex is None else bool(config.use_regex)
    case_sensitive: bool = True if config.case_sensitive is None else bool(config.case_sensitive)
    if use_regex:
        try:
            re.compile(pattern)
        except re.error as exc:
            raise HTTPException(
                status_code=400, detail=f"find-replace-pattern: invalid pattern: {exc}"
            ) from exc
    result: pd.DataFrame = df.copy(deep=True)
    for col in cols:
        # Canonical strings first (whole floats take int form on both
        # engines); missing stays missing through the replacement.
        canon = canonical_text_series(df[col])
        if use_regex:
            flags: int = 0 if case_sensitive else re.IGNORECASE
            try:
                replaced = canon.str.replace(pattern, replacement, regex=True, flags=flags)
            except re.error as exc:
                raise HTTPException(
                    status_code=400, detail=f"find-replace-pattern: invalid pattern: {exc}"
                ) from exc
        else:
            if case_sensitive:
                replaced = canon.str.split(pattern).str.join(replacement)
            else:
                escaped: str = re.escape(pattern)
                replaced = canon.str.replace(escaped, replacement, regex=True, flags=re.IGNORECASE)
        # An all-missing column has nothing to rewrite.
        result[col] = replaced.where(canon.notna(), canon)
    if use_regex:
        op: str = f".str.replace({pattern!r}, {replacement!r}, regex=True{'' if case_sensitive else ', flags=re.IGNORECASE'})"
    elif case_sensitive:
        op = f".str.split({pattern!r}).str.join({replacement!r})"
    else:
        op = f".str.replace(re.escape({pattern!r}), {replacement!r}, regex=True, flags=re.IGNORECASE)"
    lines: List[str] = [
        "def _sieve_t(x):",
        "    if x is None or (isinstance(x, float) and pd.isna(x)): return None",
        "    if isinstance(x, bool): return str(x)",
        "    if isinstance(x, float) and x.is_integer(): return str(int(x))",
        "    return str(x)",
    ]
    if "re." in op:
        lines.append("import re")
    for col in cols:
        lines.append(f"df[{col!r}] = df[{col!r}].map(_sieve_t){op}")
    return result, "\n".join(lines)
