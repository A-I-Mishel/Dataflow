from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException
from sklearn.preprocessing import LabelEncoder

from models import NodeConfig


def apply_encode_categorical(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    method: str = (config.method or "one-hot").lower()
    cols: Optional[List[str]] = config.columns

    if not cols:
        target: List[str] = df.select_dtypes(include=["object", "category"]).columns.tolist()
        auto: bool = True
    else:
        target = list(cols)
        auto = False

    if not target:
        return df.copy(deep=True), "# no categorical columns to encode; df unchanged"

    missing: List[str] = [c for c in target if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"encode-categorical: unknown columns {missing}")

    if method == "one-hot":
        result: pd.DataFrame = pd.get_dummies(df, columns=target)
        if auto:
            code: str = (
                "cols = df.select_dtypes(include=['object', 'category']).columns.tolist()\n"
                "df = pd.get_dummies(df, columns=cols)"
            )
        else:
            code = f"df = pd.get_dummies(df, columns={target!r})"
        return result, code

    if method == "label":
        result = df.copy(deep=True)
        for col in target:
            encoder: LabelEncoder = LabelEncoder()
            try:
                result[col] = encoder.fit_transform(result[col].astype(str))
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"encode-categorical label: failed on column '{col}': {exc}",
                ) from exc
        if auto:
            code = (
                "from sklearn.preprocessing import LabelEncoder\n"
                "cols = df.select_dtypes(include=['object', 'category']).columns.tolist()\n"
                "for col in cols:\n"
                "    df[col] = LabelEncoder().fit_transform(df[col].astype(str))"
            )
        else:
            code = (
                "from sklearn.preprocessing import LabelEncoder\n"
                f"for col in {target!r}:\n"
                "    df[col] = LabelEncoder().fit_transform(df[col].astype(str))"
            )
        return result, code

    raise HTTPException(
        status_code=400,
        detail=f"encode-categorical: unknown method '{config.method}'. Allowed: one-hot, label",
    )
