from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig

# Same explosion guard as one-hot's 15-category cap: splitting free text
# (e.g. sentences on spaces) can otherwise mint hundreds of columns.
MAX_PARTS: int = 15


def apply_split_column(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols or len(cols) != 1:
        raise HTTPException(
            status_code=400, detail="split-column: select exactly one source column"
        )
    col: str = cols[0]
    if col not in df.columns:
        raise HTTPException(status_code=400, detail=f"split-column: unknown column '{col}'")
    delim: Optional[str] = config.delimiter
    if not delim:
        raise HTTPException(status_code=400, detail="split-column: type a delimiter")
    max_splits: Optional[int] = config.max_splits
    if max_splits is not None and (
        not isinstance(max_splits, int) or isinstance(max_splits, bool) or max_splits < 0
    ):
        raise HTTPException(
            status_code=400, detail="split-column: max splits must be a non-negative integer or omitted"
        )
    keep: bool = True if config.keep_original is None else bool(config.keep_original)
    # Missing input (NA or '') yields all-null parts on both engines; the
    # mask keeps '' from becoming a one-piece [''] split.
    series = df[col]
    missing = series.isna() | (series == "")
    masked = series.mask(missing)
    if max_splits is None:
        parts = masked.str.split(delim, expand=True)
    else:
        parts = masked.str.split(delim, n=max_splits, expand=True)
    width: int = int(parts.shape[1]) if len(parts.columns) else 0
    if width == 0:
        return df.copy(deep=True), "# nothing to split into; df unchanged"
    if width > MAX_PARTS:
        raise HTTPException(
            status_code=400,
            detail=f"split-column: '{col}' splits into {width} pieces (max {MAX_PARTS}) — use a more specific delimiter",
        )
    names: List[str] = [f"{col}_{i + 1}" for i in range(width)]
    dup: List[str] = [c for c in names if c in df.columns]
    if dup:
        raise HTTPException(
            status_code=400, detail=f"split-column: output would overwrite {dup}"
        )
    parts.columns = names
    result: pd.DataFrame = pd.concat([df, parts], axis=1)
    if not keep:
        result = result.drop(columns=[col])
    n_arg: str = "" if max_splits is None else f", n={max_splits}"
    lines: List[str] = [
        f"_s = df[{col!r}].mask(df[{col!r}].isna() | (df[{col!r}] == ''))",
        f"_parts = _s.str.split({delim!r}{n_arg}, expand=True)",
        f"_parts.columns = {names!r}",
        "df = pd.concat([df, _parts], axis=1)",
    ]
    if not keep:
        lines.append(f"df = df.drop(columns=[{col!r}])")
    return result, "\n".join(lines)
