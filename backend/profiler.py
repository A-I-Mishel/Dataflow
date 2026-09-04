import logging
from typing import Any, Dict, List

import numpy as np
import pandas as pd
import pandas.api.types as ptypes

logger = logging.getLogger(__name__)


# Any is used for JSON-serializable profile payloads whose value types vary by column.
def profile_dataframe(df: pd.DataFrame) -> Dict[str, Any]:
    row_count: int = int(df.shape[0])
    col_count: int = int(df.shape[1])
    try:
        mem_bytes: int = int(df.memory_usage(index=True, deep=True).sum())
    except Exception:
        mem_bytes = int(df.memory_usage(index=True).sum())
    memory_usage_mb: float = round(mem_bytes / (1024**2), 4)
    total_missing: int = int(df.isna().sum().sum())

    columns: Dict[str, Dict[str, Any]] = {}
    for col in df.columns:
        series: pd.Series = df[col]
        dtype_str: str = str(series.dtype)
        null_count: int = int(series.isna().sum())
        null_pct: float = round((null_count / row_count * 100.0) if row_count else 0.0, 2)
        unique_count: int = int(series.nunique(dropna=True))

        entry: Dict[str, Any] = {
            "dtype": dtype_str,
            "null_count": null_count,
            "null_pct": null_pct,
            "unique_count": unique_count,
            "min": None,
            "max": None,
            "mean": None,
            "median": None,
            "std": None,
            "histogram": None,
            "top_values": None,
            "date_min": None,
            "date_max": None,
            "date_histogram": None,
        }

        try:
            if ptypes.is_datetime64_any_dtype(series):
                non_null: pd.Series = series.dropna()
                if not non_null.empty:
                    entry["date_min"] = non_null.min().isoformat()
                    entry["date_max"] = non_null.max().isoformat()
                    daily: pd.Series = non_null.dt.floor("D")
                    counts: pd.Series = daily.value_counts().sort_index()
                    hist: List[Dict[str, Any]] = [
                        {"date": ts.strftime("%Y-%m-%d"), "count": int(cnt)}
                        for ts, cnt in counts.items()
                    ]
                    entry["date_histogram"] = hist
                else:
                    entry["date_histogram"] = []
            elif ptypes.is_bool_dtype(series):
                vc: pd.Series = series.value_counts(dropna=True).head(5)
                entry["top_values"] = [
                    {"value": str(idx), "count": int(cnt)} for idx, cnt in vc.items()
                ]
            elif ptypes.is_numeric_dtype(series):
                non_null_num: pd.Series = series.dropna()
                if not non_null_num.empty:
                    entry["min"] = float(non_null_num.min())
                    entry["max"] = float(non_null_num.max())
                    entry["mean"] = float(non_null_num.mean())
                    entry["median"] = float(non_null_num.median())
                    std_val: float = float(non_null_num.std())
                    entry["std"] = std_val
                    try:
                        values: np.ndarray = non_null_num.to_numpy(dtype=float)
                        values = values[np.isfinite(values)]
                        if values.size:
                            counts_np, edges = np.histogram(values, bins=20)
                            entry["histogram"] = [
                                {"bin_start": float(edges[i]), "count": int(counts_np[i])}
                                for i in range(len(counts_np))
                            ]
                        else:
                            entry["histogram"] = []
                    except Exception:
                        entry["histogram"] = []
                else:
                    entry["histogram"] = []
            else:
                vc2: pd.Series = series.value_counts(dropna=True).head(5)
                entry["top_values"] = [
                    {"value": str(idx), "count": int(cnt)} for idx, cnt in vc2.items()
                ]
        except Exception as exc:
            logger.warning("Profiling column '%s' failed: %s", col, exc)

        columns[str(col)] = entry

    return {
        "shape": [row_count, col_count],
        "memory_usage_mb": memory_usage_mb,
        "total_missing": total_missing,
        "columns": columns,
    }
