"""FILE: backend/transforms/filter_expr.py
PURPOSE: 'filter-expr' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["filter-expr"] -> apply_filter_expr(df, config) -> (new_df, code_line).
CONFIG: config.columns only. Pandas: df.pandas op(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
"""Shared row-condition machinery for filter-rows and conditional-column.

Moved verbatim out of filter_rows so both transforms (and their codegen)
evaluate conditions identically. Single source of truth for operator
semantics: any divergence here forks two user-visible code paths.
"""

import pandas as pd
from fastapi import HTTPException

ALLOWED_OPERATORS: set[str] = {">", "<", ">=", "<=", "==", "!=", "contains", "startswith", "endswith"}


def single_mask(df: pd.DataFrame, column: str, operator: str, value: object) -> pd.Series:
    series: pd.Series = df[column]
    try:
        if operator == ">":
            return series > value  # type: ignore[operator]
        if operator == "<":
            return series < value  # type: ignore[operator]
        if operator == ">=":
            return series >= value  # type: ignore[operator]
        if operator == "<=":
            return series <= value  # type: ignore[operator]
        if operator == "==":
            return series == value
        if operator == "!=":
            return series != value
        text: pd.Series = df[column].fillna("").astype(str)
        value_str: str = str(value)
        if operator == "contains":
            return text.str.contains(value_str, na=False, regex=False)
        if operator == "startswith":
            return text.str.startswith(value_str, na=False)
        if operator == "endswith":
            return text.str.endswith(value_str, na=False)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"filter-rows: failed applying {column} {operator} {value!r}: {exc}",
        ) from exc
    raise HTTPException(status_code=400, detail=f"filter-rows: unsupported operator '{operator}'")


def condition_to_code(column: str, operator: str, value: object) -> str:
    col_ref: str = f"df[{column!r}]"
    if operator in (">", "<", ">=", "<=", "==", "!="):
        return f"({col_ref} {operator} {value!r})"
    # Must match single_mask runtime semantics exactly: NaN -> "" before
    # casting, otherwise a generated `contains "nan"` filter would match
    # missing values that the app itself does not match.
    text_ref: str = f"({col_ref}.fillna(\"\").astype(str))"
    if operator == "contains":
        return f"({text_ref}.str.contains({str(value)!r}, na=False, regex=False))"
    if operator == "startswith":
        return f"({text_ref}.str.startswith({str(value)!r}, na=False))"
    if operator == "endswith":
        return f"({text_ref}.str.endswith({str(value)!r}, na=False))"
    raise HTTPException(status_code=400, detail=f"filter-rows: unsupported operator '{operator}'")
