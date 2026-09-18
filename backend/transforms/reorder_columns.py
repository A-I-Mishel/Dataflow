from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_reorder_columns(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        raise HTTPException(
            status_code=400, detail="reorder-columns: provide the full new column order"
        )
    # Exact set match: a missing or extra entry would silently drop data.
    if sorted(cols) != sorted(str(c) for c in df.columns.tolist()):
        raise HTTPException(
            status_code=400,
            detail="reorder-columns: columns must match the dataset columns exactly (no additions, no omissions)",
        )
    result: pd.DataFrame = df[list(cols)].copy(deep=True)
    return result, f"df = df[{list(cols)!r}]"
