from typing import Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig

_ALLOWED_OPERATORS: set[str] = {">", "<", ">=", "<=", "==", "!=", "contains", "startswith", "endswith"}


def _single_mask(df: pd.DataFrame, column: str, operator: str, value: object) -> pd.Series:
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


def _condition_to_code(column: str, operator: str, value: object) -> str:
    col_ref: str = f"df[{column!r}]"
    if operator in (">", "<", ">=", "<=", "==", "!="):
        return f"({col_ref} {operator} {value!r})"
    if operator == "contains":
        return f"({col_ref}.astype(str).str.contains({str(value)!r}, na=False, regex=False))"
    if operator == "startswith":
        return f"({col_ref}.astype(str).str.startswith({str(value)!r}, na=False))"
    if operator == "endswith":
        return f"({col_ref}.astype(str).str.endswith({str(value)!r}, na=False))"
    raise HTTPException(status_code=400, detail=f"filter-rows: unsupported operator '{operator}'")


def apply_filter_rows(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    conditions = config.conditions
    if not conditions:
        return df.copy(deep=True), "# no filter conditions specified; df unchanged"

    masks: list[pd.Series] = []
    logics: list[str] = []
    code_parts: list[str] = []

    for idx, cond in enumerate(conditions):
        try:
            column = cond.get("column")
            operator = cond.get("operator")
            value = cond.get("value")
            logic = cond.get("logic")
        except AttributeError as exc:
            raise HTTPException(
                status_code=400, detail=f"filter-rows: condition {idx} must be an object"
            ) from exc

        if not isinstance(column, str) or not column:
            raise HTTPException(
                status_code=400, detail=f"filter-rows: condition {idx} has invalid column"
            )
        if column not in df.columns:
            raise HTTPException(
                status_code=400, detail=f"filter-rows: unknown column '{column}'"
            )
        if operator not in _ALLOWED_OPERATORS:
            raise HTTPException(
                status_code=400,
                detail=f"filter-rows: unsupported operator '{operator}'. Allowed: {sorted(_ALLOWED_OPERATORS)}",
            )
        if idx == 0:
            logics.append("")
        else:
            if logic is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"filter-rows: condition {idx} logic must be 'AND' or 'OR'",
                )
            logic_up: str = str(logic).upper()
            if logic_up not in ("AND", "OR"):
                raise HTTPException(
                    status_code=400,
                    detail=f"filter-rows: condition {idx} logic must be 'AND' or 'OR'",
                )
            logics.append(logic_up)

        mask: pd.Series = _single_mask(df, column, str(operator), value)
        try:
            mask = mask.fillna(False).astype(bool)
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"filter-rows: invalid mask for condition {idx}: {exc}"
            ) from exc
        masks.append(mask)
        code_parts.append(_condition_to_code(column, str(operator), value))

    combined: pd.Series = masks[0]
    combined_code: str = code_parts[0]
    for i in range(1, len(masks)):
        if logics[i] == "AND":
            combined = combined & masks[i]
            combined_code = f"{combined_code} & {code_parts[i]}"
        else:
            combined = combined | masks[i]
            combined_code = f"{combined_code} | {code_parts[i]}"

    filtered: pd.DataFrame = df.loc[combined].copy(deep=True)
    code: str = f"df = df[{combined_code}]"
    return filtered, code
