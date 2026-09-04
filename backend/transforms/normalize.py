from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_normalize(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    method: str = (config.method or "min-max").lower()
    cols: Optional[List[str]] = config.columns
    auto: bool = not cols

    if auto:
        target: List[str] = df.select_dtypes(include="number").columns.tolist()
    else:
        assert cols is not None
        missing: List[str] = [c for c in cols if c not in df.columns]
        if missing:
            raise HTTPException(status_code=400, detail=f"normalize: unknown columns {missing}")
        target = list(cols)

    if not target:
        return df.copy(deep=True), "# no numeric columns to normalize; df unchanged"

    result: pd.DataFrame = df.copy(deep=True)

    if method == "min-max":
        col_min = df[target].min()
        col_max = df[target].max()
        denom = col_max - col_min
        denom = denom.replace(0, 1)
        result[target] = (df[target] - col_min) / denom
        if auto:
            code: str = (
                "cols = df.select_dtypes(include='number').columns.tolist()\n"
                "df[cols] = (df[cols] - df[cols].min()) / (df[cols].max() - df[cols].min()).replace(0, 1)"
            )
        else:
            code = (
                f"df[{target!r}] = (df[{target!r}] - df[{target!r}].min()) / "
                f"(df[{target!r}].max() - df[{target!r}].min()).replace(0, 1)"
            )
        return result, code

    if method == "z-score":
        col_mean = df[target].mean()
        col_std = df[target].std()
        col_std = col_std.replace(0, 1).fillna(1)
        result[target] = (df[target] - col_mean) / col_std
        if auto:
            code = (
                "cols = df.select_dtypes(include='number').columns.tolist()\n"
                "df[cols] = (df[cols] - df[cols].mean()) / df[cols].std().replace(0, 1).fillna(1)"
            )
        else:
            code = (
                f"df[{target!r}] = (df[{target!r}] - df[{target!r}].mean()) / "
                f"df[{target!r}].std().replace(0, 1).fillna(1)"
            )
        return result, code

    raise HTTPException(
        status_code=400,
        detail=f"normalize: unknown method '{config.method}'. Allowed: min-max, z-score",
    )
