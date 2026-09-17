from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_drop_duplicates(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if cols:
        missing: List[str] = [c for c in cols if c not in df.columns]
        if missing:
            raise HTTPException(
                status_code=400, detail=f"drop-duplicates: unknown columns {missing}"
            )
        result: pd.DataFrame = df.drop_duplicates(subset=list(cols))
        return result, f"df = df.drop_duplicates(subset={list(cols)!r})"
    result = df.drop_duplicates()
    return result, "df = df.drop_duplicates()"
