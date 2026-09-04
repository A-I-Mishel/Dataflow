from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_drop_column(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        return df.copy(deep=True), "# no columns specified; df unchanged"
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"drop-column: unknown columns {missing}")
    result: pd.DataFrame = df.drop(columns=cols)
    return result, f"df = df.drop(columns={cols!r})"
