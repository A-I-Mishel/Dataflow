from typing import List, Optional, Tuple

import pandas as pd

from models import NodeConfig


def apply_drop_na(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if cols:
        result: pd.DataFrame = df.dropna(subset=cols)
        return result, f"df = df.dropna(subset={cols!r})"
    result = df.dropna()
    return result, "df = df.dropna()"
