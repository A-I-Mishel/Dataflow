from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_drop_na(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    how: str = (config.how or "any").lower()
    if how not in ("any", "all"):
        raise HTTPException(
            status_code=400, detail="drop-na: how must be 'any' or 'all'"
        )
    cols: Optional[List[str]] = config.columns
    if cols:
        missing: List[str] = [c for c in cols if c not in df.columns]
        if missing:
            raise HTTPException(
                status_code=400, detail=f"drop-na: unknown columns {missing}"
            )
        result: pd.DataFrame = df.dropna(subset=cols, how=how)
        return result, f"df = df.dropna(subset={cols!r}, how={how!r})"
    result = df.dropna(how=how)
    return result, f"df = df.dropna(how={how!r})"
