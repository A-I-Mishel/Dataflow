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


# Cells starting with these characters are evaluated as formulas when the
# downloaded CSV is opened in Excel/Sheets — a classic exfil vector
# (=HYPERLINK(...), @SUM(...), ...). Neutralize with a leading apostrophe,
# which spreadsheets hide while displaying the original text.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def neutralize_formula(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def neutralize_formulas(df: pd.DataFrame) -> pd.DataFrame:
    """Return a copy with formula-risky string cells neutralized.

    Only string-like columns are scanned (numerics cannot be formulas).
    Kind-based, not name-based: pandas 3 infers `str` dtype where pandas 2
    used `object`, so an equality check on the dtype name misses columns.
    Previews and API JSON are untouched — this applies to the downloaded
    CSV only, at serialization time.
    """
    from pandas.api.types import is_object_dtype, is_string_dtype

    safe: pd.DataFrame = df.copy(deep=False)
    for col in safe.columns:
        series = safe[col]
        if not (is_object_dtype(series.dtype) or is_string_dtype(series.dtype)):
            continue
        mask = series.map(lambda v: isinstance(v, str) and v.startswith(_FORMULA_PREFIXES))
        if bool(mask.any()):
            safe[col] = series.mask(mask, series[mask].map(lambda v: "'" + v))
    return safe


def missing_dict(df: pd.DataFrame) -> Dict[str, int]:
    return {str(col): int(df[col].isna().sum()) for col in df.columns}
