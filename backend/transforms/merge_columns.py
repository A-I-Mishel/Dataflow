"""FILE: backend/transforms/merge_columns.py
PURPOSE: 'merge-columns' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["merge-columns"] -> apply_merge_columns(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.text_compat import canonical_text


def apply_merge_columns(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols or len(cols) < 2:
        raise HTTPException(
            status_code=400, detail="merge-columns: tick at least two source columns"
        )
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"merge-columns: unknown columns {missing}")
    output: Optional[str] = config.output
    if not output or not str(output).strip():
        raise HTTPException(status_code=400, detail="merge-columns: name the output column")
    output = str(output).strip()
    if output in df.columns:
        raise HTTPException(
            status_code=400, detail=f'merge-columns: column "{output}" already exists'
        )
    sep: str = " " if config.separator is None else str(config.separator)
    keep: bool = True if config.keep_original is None else bool(config.keep_original)

    def _join(row: pd.Series) -> Optional[str]:
        bits: List[str] = []
        for value in row.tolist():
            text: Optional[str] = canonical_text(value)
            # Missing (None/NaN) and '' contribute nothing — Sieve's MISS.
            if text is None or text == "":
                continue
            bits.append(text)
        if not bits:
            return None
        return sep.join(bits)

    result: pd.DataFrame = df.copy(deep=True)
    result[output] = df[list(cols)].apply(_join, axis=1)
    if not keep:
        result = result.drop(columns=list(cols))
    lines: List[str] = [
        "def _sieve_j(x):",
        '    if x is None or (isinstance(x, float) and pd.isna(x)): return None',
        "    if isinstance(x, bool): return str(x)",
        "    if isinstance(x, float) and x.is_integer(): return str(int(x))",
        "    return str(x)",
        f"df[{output!r}] = df[{list(cols)!r}].apply(",
        f"    lambda r: {sep!r}.join([t for t in (_sieve_j(x) for x in r) if t]) or None, axis=1)",
    ]
    if not keep:
        lines.append(f"df = df.drop(columns={list(cols)!r})")
    return result, "\n".join(lines)
