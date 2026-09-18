import re
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.text_compat import canonical_text_series


def build_allowed(
    letters: bool, numbers: bool, spaces: bool, custom: Optional[str]
) -> str:
    """Regex character-class body for the keep set (shared with Sieve twin)."""
    parts: List[str] = []
    if letters:
        parts.append("A-Za-z")
    if numbers:
        parts.append("0-9")
    if spaces:
        parts.append(r"\s")
    if custom:
        # Escape class metacharacters so custom text stays literal.
        parts.append(re.escape(custom))
    return "".join(parts)


def apply_remove_special_chars(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols:
        raise HTTPException(
            status_code=400, detail="remove-special-chars: tick at least one column"
        )
    missing: List[str] = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"remove-special-chars: unknown columns {missing}"
        )
    letters: bool = True if config.letters is None else bool(config.letters)
    numbers: bool = True if config.numbers is None else bool(config.numbers)
    spaces: bool = True if config.spaces is None else bool(config.spaces)
    custom: str = "" if config.custom_chars is None else str(config.custom_chars)
    allowed: str = build_allowed(letters, numbers, spaces, custom)
    if not allowed:
        raise HTTPException(
            status_code=400, detail="remove-special-chars: keep at least one character group"
        )
    pattern: str = f"[^{allowed}]"
    try:
        compiled = re.compile(pattern)
    except re.error as exc:  # custom text can still break the class.
        raise HTTPException(
            status_code=400, detail=f"remove-special-chars: bad custom characters: {exc}"
        ) from exc
    result: pd.DataFrame = df.copy(deep=True)
    for col in cols:
        canon = canonical_text_series(df[col])
        result[col] = canon.str.replace(compiled, "", regex=True)
    # {pattern!r} (never an r'' literal): custom characters may contain
    # quotes, and repr() picks quoting that survives them.
    return result, (
        "def _sieve_t(x):\n"
        "    if x is None or (isinstance(x, float) and pd.isna(x)): return None\n"
        "    if isinstance(x, bool): return str(x)\n"
        "    if isinstance(x, float) and x.is_integer(): return str(int(x))\n"
        "    return str(x)\n" + "\n".join(
            f"df[{col!r}] = df[{col!r}].map(_sieve_t).str.replace({pattern!r}, '', regex=True)"
            for col in cols
        )
    )
