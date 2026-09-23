"""FILE: backend/transforms/conditional_column.py
PURPOSE: 'conditional-column' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["conditional-column"] -> apply_conditional_column(df, config) -> (new_df, code_line).
CONFIG: config.default, config.output, config.rules. Pandas: df.copy(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import Any, Dict, List, Optional, Tuple

import math

import numpy as np
import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.filter_expr import ALLOWED_OPERATORS, condition_to_code, single_mask


def _lit(value: Any) -> str:
    # repr(nan) is a bare `nan` (NameError for users) — emit float("nan").
    if isinstance(value, float) and math.isnan(value):
        return 'float("nan")'
    return repr(value)
# Sieve-facing operators mapped onto the shared filter vocabulary.
OPERATOR_MAP: Dict[str, str] = {
    "=": "==",
    "≠": "!=",
    ">": ">",
    "<": "<",
    "≥": ">=",
    "≤": "<=",
    "contains": "contains",
}


def apply_conditional_column(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    rules: Optional[List[Dict[str, Any]]] = config.rules
    if not rules:
        raise HTTPException(
            status_code=400, detail="conditional-column: add at least one rule"
        )
    output: Optional[str] = config.output
    if not output or not str(output).strip():
        raise HTTPException(status_code=400, detail="conditional-column: name the output column")
    output = str(output).strip()
    if output in df.columns:
        raise HTTPException(
            status_code=400, detail=f'conditional-column: column "{output}" already exists'
        )
    masks: List[pd.Series] = []
    choices: List[Any] = []
    code_masks: List[str] = []
    # NOTE: rows matching no rule — including rows with missing values, whose
    # masks are all False exactly like filter-rows — take `default`. A blank
    # default is the escape hatch for missing→null. The Sieve twin shares
    # this rule, so both engines agree cell-for-cell.
    for idx, rule in enumerate(rules):
        try:
            column = rule.get("column")
            operator = rule.get("operator")
            value = rule.get("value")
            choice = rule.get("result")
        except AttributeError as exc:
            raise HTTPException(
                status_code=400, detail=f"conditional-column: rule {idx} must be an object"
            ) from exc
        if not isinstance(column, str) or not column:
            raise HTTPException(
                status_code=400, detail=f"conditional-column: rule {idx} has invalid column"
            )
        if column not in df.columns:
            raise HTTPException(
                status_code=400, detail=f"conditional-column: unknown column '{column}'"
            )
        mapped: Optional[str] = OPERATOR_MAP.get(str(operator), None)
        if mapped is None or mapped not in ALLOWED_OPERATORS:
            raise HTTPException(
                status_code=400, detail=f"conditional-column: unsupported operator '{operator}'"
            )
        mask: pd.Series = single_mask(df, column, mapped, value)
        try:
            mask = mask.fillna(False).astype(bool)
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"conditional-column: invalid mask for rule {idx}: {exc}"
            ) from exc
        masks.append(mask)
        choices.append(choice)
        code_masks.append(f"_m{idx + 1} = {condition_to_code(column, mapped, value)}")
    # First matching rule wins — np.select's documented semantics.
    result: pd.DataFrame = df.copy(deep=True)
    result[output] = np.select(masks, choices, default=config.default)
    code: str = (
        "\n".join(code_masks)
        + f"\ndf[{output!r}] = np.select("
        + f"[{', '.join(f'_m{i + 1}' for i in range(len(masks)))}], "
        + f"[{', '.join(_lit(c) for c in choices)}], "
        + f"default={_lit(config.default)})"
    )
    return result, code
