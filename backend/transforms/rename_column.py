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
