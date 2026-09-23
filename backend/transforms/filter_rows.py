"""FILE: backend/transforms/filter_rows.py
PURPOSE: 'filter-rows' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["filter-rows"] -> apply_filter_rows(df, config) -> (new_df, code_line).
CONFIG: config.conditions. Pandas: df.copy(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.filter_expr import (
    ALLOWED_OPERATORS,
    condition_to_code,
    single_mask,
)


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
        if operator not in ALLOWED_OPERATORS:
            raise HTTPException(
                status_code=400,
                detail=f"filter-rows: unsupported operator '{operator}'. Allowed: {sorted(ALLOWED_OPERATORS)}",
            )
        if idx == 0:
            logics.append("")
        else:
            if logic is None:
                raise HTTPException(
                    status_code=400, detail=f"filter-rows: condition {idx} logic must be 'AND' or 'OR'",
                )
            logic_up: str = str(logic).upper()
            if logic_up not in ("AND", "OR"):
                raise HTTPException(
                    status_code=400, detail=f"filter-rows: condition {idx} logic must be 'AND' or 'OR'",
                )
            logics.append(logic_up)

        mask: pd.Series = single_mask(df, column, str(operator), value)
        try:
            mask = mask.fillna(False).astype(bool)
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"filter-rows: invalid mask for condition {idx}: {exc}"
            ) from exc
        masks.append(mask)
        code_parts.append(condition_to_code(column, str(operator), value))

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
