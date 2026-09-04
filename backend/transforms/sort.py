from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_sort(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    by: Optional[List[str]] = config.by
    ascending: bool = True if config.ascending is None else bool(config.ascending)
    if not by:
        return df.copy(deep=True), "# no sort columns specified; df unchanged"
    missing: List[str] = [c for c in by if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"sort: unknown columns {missing}")
    result: pd.DataFrame = df.sort_values(by=by, ascending=ascending)
    return result, f"df = df.sort_values(by={by!r}, ascending={ascending})"
