from typing import Any, Dict, List

import numpy as np
import pandas as pd


# Any is unavoidable below: cell values from user CSVs are arbitrary JSON.
def sanitize_value(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        f: float = float(value)
        return None if np.isnan(f) else f
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, float) and np.isnan(value):
        return None
    return value


def sanitize_records(df: pd.DataFrame, limit: int = 5) -> List[Dict[str, Any]]:
    preview_df: pd.DataFrame = df.head(limit)
    records: List[Dict[str, Any]] = preview_df.to_dict(orient="records")
    sanitized: List[Dict[str, Any]] = []
    for row in records:
        clean: Dict[str, Any] = {str(k): sanitize_value(v) for k, v in row.items()}
        sanitized.append(clean)
    return sanitized


def dtypes_dict(df: pd.DataFrame) -> Dict[str, str]:
    return {str(col): str(dtype) for col, dtype in df.dtypes.items()}


def missing_dict(df: pd.DataFrame) -> Dict[str, int]:
    return {str(col): int(df[col].isna().sum()) for col in df.columns}
