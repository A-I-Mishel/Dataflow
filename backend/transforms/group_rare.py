"""FILE: backend/transforms/group_rare.py
PURPOSE: 'group-rare' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["group-rare"] -> apply_group_rare(df, config) -> (new_df, code_line).
CONFIG: config.columns, config.replacement, config.threshold. Pandas: df.copy(...). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
import math
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig


def _parse_threshold(raw: object, row_count: int) -> int:
    text: str = str(raw).strip() if raw is not None else ""
    if text.endswith("%"):
        try:
            frac: float = float(text[:-1]) / 100.0
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="group-rare: threshold must be a count or a percentage like '5%'"
            ) from exc
        if not math.isfinite(frac) or frac < 0:
            raise HTTPException(
                status_code=400, detail="group-rare: threshold must be a count or a percentage like '5%'"
            )
        return math.ceil(frac * row_count)
    try:
        count: int = int(text)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail="group-rare: threshold must be a count or a percentage like '5%'"
        ) from exc
    if count < 0:
        raise HTTPException(
            status_code=400, detail="group-rare: threshold must be a count or a percentage like '5%'"
        )
    return count


def apply_group_rare(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        raise HTTPException(
            status_code=400, detail="group-rare: tick at least one column"
        )
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"group-rare: unknown columns {missing}")
    label = config.replacement if config.replacement is not None else "Other"
    if not isinstance(label, str) or label == "":
        raise HTTPException(
            status_code=400, detail="group-rare: replacement label must be non-blank text"
        )
    threshold: int = _parse_threshold(
        "10" if config.threshold is None else config.threshold, len(df)
    )
    result: pd.DataFrame = df.copy(deep=True)
    for col in cols:
        # '' counts as missing (left untouched), exactly like the Sieve twin:
        # only real values vote in the frequency table.
        series = df[col]
        is_missing = series.isna() | (series == "")
        freq = series[~is_missing].value_counts()
        keep = freq[freq >= threshold].index
        result[col] = series.where(is_missing | series.isin(keep), label)
    raw: str = "10" if config.threshold is None else str(config.threshold).strip()
    if raw.endswith("%"):
        thr_code: str = f"import math\n_thr = math.ceil(len(df) * {float(raw[:-1]) / 100.0!r})"
    else:
        thr_code = f"_thr = {threshold}"
    code: str = (
        f"for _c in {list(cols)!r}:\n"
        f"    _vc = df[_c].replace('', pd.NA).value_counts()\n"
        f"    {thr_code}\n"
        f"    _keep = _vc[_vc >= _thr].index\n"
        f"    _miss = df[_c].isna() | (df[_c] == '')\n"
        f"    df[_c] = df[_c].where(_miss | df[_c].isin(_keep), {label!r})"
    )
    return result, code
