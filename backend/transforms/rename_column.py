"""FILE: backend/transforms/rename_column.py
PURPOSE: 'rename-column' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["rename-column"] -> apply_rename_column(df, config) -> (new_df, code_line).
CONFIG: config.mapping. Pandas: df.copy(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_rename_column(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    mapping: Optional[Dict[str, str]] = config.mapping
    if not mapping:
        return df.copy(deep=True), "# no mapping specified; df unchanged"
    missing: List[str] = [c for c in mapping.keys() if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"rename-column: unknown columns {missing}")
    result: pd.DataFrame = df.rename(columns=mapping)
    return result, f"df = df.rename(columns={mapping!r})"
