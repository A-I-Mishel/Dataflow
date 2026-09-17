from typing import Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig

# Above this estimated output size, one-hot is refused instead of risking
# an OOM. 10M bool cells peak well under 100MB transient even at 3x during
# get_dummies construction; the 25k-row x 25k-ID case (~640M cells) that
# motivated this trips it by ~64x.
ONE_HOT_MAX_CELLS: int = 10_000_000

# NOTE: sklearn is intentionally NOT imported at module top. It costs
# ~100MB+ RSS on import, and this backend runs on a 512MB instance where
# most requests never touch label encoding. Imported lazily in the branch
# below; first label-encode pays a one-time ~1-2s import cost.


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
        # Guard against the classic one-hot memory bomb: an ID-like column
        # with U unique values explodes into U dummy columns (rows × U
        # cells). Refuse with a clear message instead of OOM-killing the
        # server; label encoding or dropping is almost always what high-
        # cardinality columns want.
        uniques: Dict[str, int] = {}
        for col in target:
            try:
                uniques[col] = int(df[col].nunique(dropna=True))
            except Exception:
                uniques[col] = 0
        new_cols: int = sum(uniques.values())
        kept_cols: int = max(len(df.columns) - len(target), 0)
        est_cells: int = int(df.shape[0]) * (kept_cols + new_cols)
        if est_cells > ONE_HOT_MAX_CELLS:
            worst: str = max(uniques, key=lambda c: uniques[c])
            raise HTTPException(
                status_code=400,
                detail=(
                    f"encode-categorical: one-hot would create ~{new_cols} dummy "
                    f"columns (~{est_cells} cells; '{worst}' alone has "
                    f"{uniques[worst]} unique values). Refusing to protect "
                    "server memory — use label encoding for high-cardinality "
                    "columns like IDs, or drop the column."
                ),
            )
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
        from sklearn.preprocessing import LabelEncoder

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
