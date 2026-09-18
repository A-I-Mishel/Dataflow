import re
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.text_compat import canonical_text_series

MODES = ("prefix", "suffix", "substring", "before", "after", "between", "regex")


def _source(df: pd.DataFrame, config: NodeConfig) -> Tuple[str, pd.Series]:
    cols: Optional[List[str]] = config.columns
    if not cols or len(cols) != 1:
        raise HTTPException(
            status_code=400, detail="extract-text: select exactly one source column"
        )
    col: str = cols[0]
    if col not in df.columns:
        raise HTTPException(status_code=400, detail=f"extract-text: unknown column '{col}'")
    # Canonical strings first (see text_compat): numbers stringify identically
    # on both engines, missing stays missing through every mode below.
    return col, canonical_text_series(df[col])


def _require_output(df: pd.DataFrame, config: NodeConfig) -> str:
    output: Optional[str] = config.output
    if not output or not str(output).strip():
        raise HTTPException(status_code=400, detail="extract-text: name the output column")
    output = str(output).strip()
    if output in df.columns:
        raise HTTPException(
            status_code=400, detail=f'extract-text: column "{output}" already exists'
        )
    return output


def _canon_block(col: str, output: str) -> str:
    return (
        f"def _sieve_t(x):\n"
        f"    if x is None or (isinstance(x, float) and pd.isna(x)): return None\n"
        f"    if isinstance(x, bool): return str(x)\n"
        f"    if isinstance(x, float) and x.is_integer(): return str(int(x))\n"
        f"    return str(x)\n"
        f"df[{output!r}] = df[{col!r}].map(_sieve_t)"
    )


def _blank_line(col: str, output: str) -> str:
    # '' is present-but-empty (not missing): keep it '' even when the
    # operation itself yields no match there (after/between delimiters).
    return f"df[{output!r}] = df[{output!r}].mask(df[{col!r}] == '', '')"


def apply_extract_text(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    col, series = _source(df, config)
    output: str = _require_output(df, config)
    mode: str = (config.method or "after").lower()
    if mode not in MODES:
        raise HTTPException(
            status_code=400, detail=f"extract-text: unknown mode '{config.method}'"
        )
    was_blank = series == ""
    result: pd.DataFrame = df.copy(deep=True)

    def _finish(out: pd.Series, code_tail: str) -> Tuple[pd.DataFrame, str]:
        result[output] = out.mask(was_blank, "")
        code: str = _canon_block(col, output) + "\n" + code_tail + "\n" + _blank_line(col, output)
        return result, code

    if mode == "prefix":
        if config.length is None:
            raise HTTPException(status_code=400, detail="extract-text: length is required")
        if not isinstance(config.length, int) or isinstance(config.length, bool) or config.length < 1:
            raise HTTPException(status_code=400, detail="extract-text: length must be ≥ 1")
        return _finish(series.str[: config.length], f"df[{output!r}] = df[{output!r}].str[:{config.length}]")
    if mode == "suffix":
        if config.length is None:
            raise HTTPException(status_code=400, detail="extract-text: length is required")
        if not isinstance(config.length, int) or isinstance(config.length, bool) or config.length < 1:
            raise HTTPException(status_code=400, detail="extract-text: length must be ≥ 1")
        return _finish(series.str[-config.length :], f"df[{output!r}] = df[{output!r}].str[-{config.length}:]")
    if mode == "substring":
        if config.start is None:
            raise HTTPException(status_code=400, detail="extract-text: start is required")
        if not isinstance(config.start, int) or isinstance(config.start, bool) or config.start < 0:
            raise HTTPException(status_code=400, detail="extract-text: start must be ≥ 0")
        end: Optional[int] = config.end
        if end is not None:
            if not isinstance(end, int) or isinstance(end, bool) or end < config.start:
                raise HTTPException(status_code=400, detail="extract-text: end must be ≥ start")
        end_code: str = "" if end is None else str(end)
        return _finish(series.str[config.start : end], f"df[{output!r}] = df[{output!r}].str[{config.start}:{end_code}]")
    if mode in ("before", "after"):
        delim: Optional[str] = config.delimiter
        if not delim:
            raise HTTPException(status_code=400, detail="extract-text: type a delimiter")
        idx: int = 0 if mode == "before" else 1
        return _finish(
            series.str.split(delim, n=1).str[idx],
            f"df[{output!r}] = df[{output!r}].str.split({delim!r}, n=1).str[{idx}]",
        )
    if mode == "between":
        d1: Optional[str] = config.delimiter
        d2: Optional[str] = config.delimiter2
        if not d1 or not d2:
            raise HTTPException(status_code=400, detail="extract-text: type both delimiters")

        def _between(value: object) -> Optional[str]:
            if not isinstance(value, str):
                return None
            i1: int = value.find(d1)
            if i1 < 0:
                return None
            i2: int = value.find(d2, i1 + len(d1))
            if i2 < 0:
                return None
            return value[i1 + len(d1) : i2]

        out = series.apply(lambda v: _between(v) if isinstance(v, str) else None)
        code: str = (
            f"def _between_{_safe(output)}(s, d1={d1!r}, d2={d2!r}):\n"
            f"    if not isinstance(s, str): return None\n"
            f"    i1 = s.find(d1)\n    if i1 < 0: return None\n"
            f"    i2 = s.find(d2, i1 + len(d1))\n    if i2 < 0: return None\n"
            f"    return s[i1 + len(d1):i2]\n"
            f"df[{output!r}] = df[{output!r}].apply(_between_{_safe(output)})"
        )
        return _finish(out, code)
    # regex: first match wins, no match stays missing. The outer group pins
    # column 0 to the whole match even when the pattern has its own groups
    # (extract demands at least one group, so a non-capturing wrap fails).
    pattern: Optional[str] = config.pattern
    if not pattern:
        raise HTTPException(status_code=400, detail="extract-text: type a pattern")
    if len(pattern) > 200:
        raise HTTPException(status_code=400, detail="extract-text: pattern accepts at most 200 characters")
    try:
        re.compile(pattern)
    except re.error as exc:
        raise HTTPException(status_code=400, detail=f"extract-text: invalid pattern: {exc}") from exc
    return _finish(
        series.str.extract(f"({pattern})", expand=True)[0],
        f"df[{output!r}] = df[{output!r}].str.extract({'(' + pattern + ')'!r}, expand=True)[0]",
    )


def _safe(name: str) -> str:
    return re.sub(r"\W+", "_", name).strip("_") or "col"
