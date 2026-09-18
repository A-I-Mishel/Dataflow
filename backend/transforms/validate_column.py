"""Quality nodes: inspect and report, never modify.

validate-column and find-invalid return the frame UNCHANGED (plus a warning
log when rules fail) so pipeline data always flows through. The value is
diagnostic: counts surface in server logs and in the exported script's
assert block, while the Sieve frontend renders the full per-rule report
from its own twin run. Frame parity between engines is therefore trivially
exact — the contract that matters is rule-semantics parity, locked by tests.
"""

import logging
import math
import re
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig

logger = logging.getLogger(__name__)

CHECK_RULES = ("type", "required", "min", "max", "allowed", "unique", "pattern")
TYPE_EXPECTED = ("integer", "number", "text", "date")


def present_mask(series: pd.Series) -> pd.Series:
    """Values that count as present: true NA excluded, and so is ''.

    Mirrors Sieve's MISS for validation purposes — a blank cell fails
    `required` even though pandas does not call '' null.
    """
    return series.notna() & (series.astype(object) != "")


def _numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def evaluate_rule(df: pd.DataFrame, column: str, check: Dict[str, Any]) -> Tuple[int, List[Any]]:
    """Returns (invalid_count, up-to-5 sample values) for one check dict."""
    try:
        rule = check.get("rule")
    except AttributeError as exc:
        raise HTTPException(status_code=400, detail="validate-column: each check must be an object") from exc
    series = df[column]
    present = present_mask(series)
    if rule == "required":
        bad = series.isna() | (series == "")
        return int(bad.sum()), _samples(series[bad])
    if rule == "type":
        expected = check.get("expected", "text")
        if expected not in TYPE_EXPECTED:
            raise HTTPException(
                status_code=400, detail="validate-column: type must be integer, number, text or date"
            )
        if expected == "text":
            return 0, []
        if expected == "date":
            ok = pd.to_datetime(series, format="mixed", errors="coerce").notna()
        else:
            num = _numeric(series)
            ok = num.notna()
            if expected == "integer":
                ok = ok & (num % 1 == 0)
        bad = present & ~ok
        return int(bad.sum()), _samples(series[bad])
    if rule in ("min", "max"):
        try:
            bound: float = float(check.get("value"))
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400, detail=f"validate-column: {rule} needs a numeric value"
            ) from exc
        num = _numeric(series)
        comparable = num.notna()
        if rule == "min":
            bad = present & (~comparable | (num < bound))
        else:
            bad = present & (~comparable | (num > bound))
        return int(bad.sum()), _samples(series[bad])
    if rule == "allowed":
        values = check.get("values")
        if not isinstance(values, list) or not values:
            raise HTTPException(
                status_code=400, detail="validate-column: allowed needs a non-empty values list"
            )
        if len(values) > 200:
            raise HTTPException(
                status_code=400, detail="validate-column: allowed accepts at most 200 values"
            )
        bad = present & ~series.isin(values)
        return int(bad.sum()), _samples(series[bad])
    if rule == "unique":
        dup = series[present].duplicated(keep=False)
        bad_idx = dup[dup].index
        return int(len(bad_idx)), _samples(series.loc[bad_idx])
    if rule == "pattern":
        pattern = check.get("pattern")
        if not pattern or not isinstance(pattern, str):
            raise HTTPException(
                status_code=400, detail="validate-column: pattern needs a non-blank expression"
            )
        if len(pattern) > 200:
            raise HTTPException(
                status_code=400, detail="validate-column: pattern accepts at most 200 characters"
            )
        try:
            compiled = re.compile(pattern)
        except re.error as exc:
            raise HTTPException(status_code=400, detail=f"validate-column: invalid pattern: {exc}") from exc
        bad = present & ~series.astype(str).str.contains(compiled, na=False, regex=True)
        return int(bad.sum()), _samples(series[bad])
    raise HTTPException(status_code=400, detail=f"validate-column: unknown rule '{rule}'")


def _samples(values: pd.Series, limit: int = 5) -> List[Any]:
    out: List[Any] = []
    for value in values.tolist():
        # Missing sample values (required-rule findings) carry no
        # information — and `pd.NA in list` raises TypeError — so skip them.
        if value is None or value is pd.NA:
            continue
        if isinstance(value, float) and math.isnan(value):
            continue
        try:
            dup: bool = value in out
        except TypeError:
            dup = False
        if dup:
            continue
        out.append(value)
        if len(out) >= limit:
            break
    return out


def _present_expr(column: str) -> str:
    # Present-but-blank counts as present here only for `required` to catch;
    # every other rule evaluates present values and skips the rest.
    return f"(df[{column!r}].notna() & (df[{column!r}].astype(object) != ''))"


def _rule_code(column: str, check: Dict[str, Any], invalid: int) -> str:
    rule = check.get("rule")
    note: str = f"# {invalid} invalid at export" if invalid else "# valid at export"
    c = repr(column)
    present: str = _present_expr(column)
    if rule == "required":
        return f"{note}\nassert df[{c}].notna().all() and (df[{c}] != '').all(), '{column}: required'"
    if rule == "type":
        expected = check.get("expected", "text")
        if expected == "text":
            return f"{note}\n# {column}: text accepts anything present"
        if expected == "date":
            return (
                f"{note}\n_k = pd.to_datetime(df[{c}], format=\"mixed\", errors=\"coerce\")\n"
                f"assert (_k.notna() | ~{present}).all(), '{column}: must be dates'"
            )
        if expected == "integer":
            return (
                f"{note}\n_k = pd.to_numeric(df[{c}], errors=\"coerce\")\n"
                f"assert ((_k.notna() & (_k % 1 == 0)) | ~{present}).all(), '{column}: must be integers'"
            )
        return (
            f"{note}\nassert (pd.to_numeric(df[{c}], errors=\"coerce\").notna() | ~{present}).all(), "
            f"'{column}: must be numeric'"
        )
    if rule in ("min", "max"):
        bound = float(check.get("value"))  # type: ignore[arg-type]
        op: str = ">=" if rule == "min" else "<="
        return (
            f"{note}\n_k = pd.to_numeric(df[{c}], errors=\"coerce\")\n"
            f"assert ((_k {op} {bound}) | ~{present}).all(), '{column}: {rule} {bound}'"
        )
    if rule == "allowed":
        return (
            f"{note}\nassert (df[{c}].isin({check.get('values')!r}) | ~{present}).all(), "
            f"'{column}: unexpected value'"
        )
    if rule == "unique":
        return (
            f"{note}\n_p = df[{c}][{present}]\n"
            f"assert not _p.duplicated().any(), '{column}: must be unique'"
        )
    if rule == "pattern":
        return (
            f"{note}\nassert (df[{c}].astype(str).str.contains({check.get('pattern')!r}, na=False, regex=True) "
            f"| ~{present}).all(), '{column}: pattern mismatch'"
        )
    return f"# unknown rule {rule!r}"


def c_present(column: str) -> str:
    return _present_expr(column)


def apply_validate_column(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    cols: Optional[List[str]] = config.columns
    if not cols or len(cols) != 1:
        raise HTTPException(
            status_code=400, detail="validate-column: select exactly one column"
        )
    column: str = cols[0]
    if column not in df.columns:
        raise HTTPException(status_code=400, detail=f"validate-column: unknown column '{column}'")
    checks: Optional[List[Dict[str, Any]]] = config.checks
    if not checks:
        raise HTTPException(
            status_code=400, detail="validate-column: add at least one check"
        )
    blocks: List[str] = [f"# validate {column} (pass-through: data unchanged)"]
    total_invalid: int = 0
    for check in checks:
        invalid, _ = evaluate_rule(df, column, check)
        total_invalid += invalid
        blocks.append(_rule_code(column, check, invalid))
    if total_invalid:
        logger.warning(
            "validate-column '%s': %d failing value(s) across %d check(s)",
            column,
            total_invalid,
            len(checks),
        )
    return df.copy(deep=True), "\n".join(blocks)
