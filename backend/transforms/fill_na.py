from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def apply_fill_na(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    strategy: str = (config.strategy or "mean").lower()
    cols: Optional[List[str]] = config.columns
    result: pd.DataFrame = df.copy(deep=True)

    if strategy == "mean":
        fill_values: pd.Series = df.mean(numeric_only=True)
        if cols:
            missing: List[str] = [c for c in cols if c not in df.columns]
            if missing:
                raise HTTPException(status_code=400, detail=f"fill-na mean: unknown columns {missing}")
            numeric_cols: List[str] = [c for c in cols if c in fill_values.index]
            if numeric_cols:
                result[numeric_cols] = result[numeric_cols].fillna(fill_values[numeric_cols])
            return result, f"df[{cols!r}] = df[{cols!r}].fillna(df[{cols!r}].mean(numeric_only=True))"
        result = result.fillna(fill_values)
        return result, "df = df.fillna(df.mean(numeric_only=True))"

    if strategy == "median":
        fill_values = df.median(numeric_only=True)
        if cols:
            missing = [c for c in cols if c not in df.columns]
            if missing:
                raise HTTPException(status_code=400, detail=f"fill-na median: unknown columns {missing}")
            numeric_cols = [c for c in cols if c in fill_values.index]
            if numeric_cols:
                result[numeric_cols] = result[numeric_cols].fillna(fill_values[numeric_cols])
            return result, f"df[{cols!r}] = df[{cols!r}].fillna(df[{cols!r}].median(numeric_only=True))"
        result = result.fillna(fill_values)
        return result, "df = df.fillna(df.median(numeric_only=True))"

    if strategy == "mode":
        if df.empty:
            return result, "df = df.fillna(df.mode().iloc[0])"
        mode_df: pd.DataFrame = df.mode()
        if mode_df.empty:
            return result, "df = df.fillna(df.mode().iloc[0])"
        mode_row: pd.Series = mode_df.iloc[0]
        if cols:
            missing = [c for c in cols if c not in df.columns]
            if missing:
                raise HTTPException(status_code=400, detail=f"fill-na mode: unknown columns {missing}")
            for col in cols:
                if col in mode_row.index:
                    result[col] = result[col].fillna(mode_row[col])
            return result, f"df[{cols!r}] = df[{cols!r}].fillna(df.mode().iloc[0][{cols!r}])"
        result = result.fillna(mode_row)
        return result, "df = df.fillna(df.mode().iloc[0])"

    if strategy == "constant":
        value = config.value
        if cols:
            missing = [c for c in cols if c not in df.columns]
            if missing:
                raise HTTPException(status_code=400, detail=f"fill-na constant: unknown columns {missing}")
            result[cols] = result[cols].fillna(value)
            return result, f"df[{cols!r}] = df[{cols!r}].fillna({value!r})"
        result = result.fillna(value)
        return result, f"df = df.fillna({value!r})"

    raise HTTPException(
        status_code=400,
        detail=f"fill-na: unknown strategy '{config.strategy}'. Allowed: mean, median, mode, constant",
    )
