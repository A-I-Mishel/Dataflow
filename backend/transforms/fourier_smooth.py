"""FILE: backend/transforms/fourier_smooth.py
PURPOSE: 'fourier-smooth' step — FFT low-pass smoothing of one numeric column.
HOW IT FITS: engine.py _TRANSFORMS["fourier-smooth"] -> apply_fourier_smooth(df, config) -> (new_df, code_line).
CONFIG: config.columns (exactly one), config.keep (fraction of frequency bins kept, 0-1, default 0.25), config.decimals (default 4). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the numpy lines near the end + the f-string code lines together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
PARITY: the local JS engine mirrors this exactly (engine.js fftCore): zero-pad the
column to the next power of two, keep the lowest k frequency bins, invert. The two
engines sum floats in a different order, so the step rounds its own output to
config.decimals — that makes the parity comparison cell-for-cell deterministic.
Missing/non-numeric values refuse on both sides: run Fill Missing first.
"""
import math
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd
from fastapi import HTTPException

from models import NodeConfig

DEFAULT_KEEP: float = 0.25
DEFAULT_DECIMALS: int = 4
MAX_DECIMALS: int = 12


def apply_fourier_smooth(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        raise HTTPException(status_code=400, detail="fourier-smooth: no column selected")
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"fourier-smooth: unknown columns {missing}"
        )
    col: str = cols[0]

    keep: float = DEFAULT_KEEP
    if config.keep is not None:
        if isinstance(config.keep, bool):
            raise HTTPException(
                status_code=400,
                detail="fourier-smooth: keep must be a positive number between 0 and 1",
            )
        try:
            keep = float(config.keep)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400,
                detail="fourier-smooth: keep must be a positive number between 0 and 1",
            ) from exc
        if not math.isfinite(keep) or keep <= 0:
            raise HTTPException(
                status_code=400,
                detail="fourier-smooth: keep must be a positive number between 0 and 1",
            )

    decimals: int = DEFAULT_DECIMALS
    if config.decimals is not None:
        if (
            not isinstance(config.decimals, int)
            or isinstance(config.decimals, bool)
            or config.decimals < 0
            or config.decimals > MAX_DECIMALS
        ):
            raise HTTPException(
                status_code=400,
                detail=f"fourier-smooth: decimals must be a whole number between 0 and {MAX_DECIMALS}",
            )
        decimals = config.decimals

    # Same refusal the local engine enforces with strictNum(): pandas
    # to_numeric() coerces to NaN exactly what strictNum() rejects.
    coerced: pd.Series = pd.to_numeric(df[col], errors="coerce")
    if coerced.isna().any():
        raise HTTPException(
            status_code=400,
            detail=(
                f'fourier-smooth: column "{col}" has missing or non-numeric values '
                "— run Fill Missing first"
            ),
        )
    vals: np.ndarray = coerced.to_numpy(dtype=float)
    if not np.isfinite(vals).all():
        raise HTTPException(
            status_code=400,
            detail=f'fourier-smooth: column "{col}" has non-finite values',
        )

    n: int = len(vals)
    if n < 4:
        raise HTTPException(
            status_code=400, detail="fourier-smooth: needs at least 4 numeric rows"
        )

    # Zero-pad to the next power of two (np.fft.rfft pads to n=_m itself) so
    # the radix-2 JS FFT computes the identical transform.
    m: int = 1 << max(2, (n - 1).bit_length())
    half_bins: int = m // 2 + 1
    # Half-up bin count, identical formula on both sides (never Python's
    # banker's round(), which rounds X.5 to even while JS rounds X.5 up).
    k: int = max(2, min(half_bins, int(keep * half_bins + 0.5)))

    spectrum: np.ndarray = np.fft.rfft(vals, n=m)
    spectrum[k:] = 0
    smoothed: np.ndarray = np.fft.irfft(spectrum, n=m)[:n]

    result: pd.DataFrame = df.copy(deep=True)
    result[col] = np.round(smoothed, decimals)
    code: str = (
        f"_v = df[{col!r}].to_numpy(dtype=float)\n"
        "_n = len(_v)\n"
        "_m = 1 << max(2, (_n - 1).bit_length())\n"
        "_half = _m // 2 + 1\n"
        f"_k = max(2, min(_half, int({keep!r} * _half + 0.5)))\n"
        "_s = np.fft.rfft(_v, n=_m)\n"
        "_s[_k:] = 0\n"
        f"df[{col!r}] = np.round(np.fft.irfft(_s, n=_m)[:_n], {decimals})"
    )
    return result, code
