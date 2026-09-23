"""FILE: backend/quality.py
PURPOSE: Data-quality score 0-100, bit-identical to frontend engine.js.
HOW IT FITS: Backend /profile + frontend preview both call same logic (twin contract).
WHERE TO EDIT: If changing score: change BOTH here and frontend engine.js qualityOf() or parity test fails.
"""
"""Dataset quality score (0-100), twinned cell-for-cell with the Sieve engine.

Contract (both sides implement this exact text — any change here must be
mirrored in engine.js qualityScore, and vice versa):

- Five subscores, each a ratio in [0, 1], combined as
      total = 30*C + 15*U + 25*V + 15*K + 15*T   (weights sum to 100)
  computed PLAIN-SEQUENTIALLY in that component order (no numpy
  reductions: pairwise summation can differ in the last ulp from a
  sequential loop, which would fork the final integer).
- Final score = floor(total + 0.5), clamped to [0, 100]. floor(x+0.5) is
  used instead of round() because CPython rounds half-to-even while JS
  rounds half-up — they disagree on exact .5 values.
- All counts are integers; every float below derives from the same
  operations in the same order on both sides, so results are bit-identical.

Component definitions (missing := None/NaN/'' on both sides):

- completeness (30): 1 - missing_cells / total_cells.
- uniqueness (15): unique_rows / total_rows, rows keyed canonically:
  missing -> NUL+M marker; bool -> 'b:True'/'b:False'; int -> 'n:<int>';
  whole float -> 'n:<int>'; other float -> shortest round-trip;
  numeric-looking string -> number form too, so '25', 25 and 25.0 key
  alike (CSV columns arrive typed on each side independently); other
  string -> 's:<value>'. The only known edge is booleans, unreachable
  via CSV parsing where they arrive as strings.
- validity (25): 1 - whitespace_only_cells / non_missing_cells, where
  whitespace-only means a string with non-zero length that strips empty.
- consistency (15): 1 - minority_cells / non_missing_cells. Each column
  with present values takes a majority class (num iff numlike fraction
  >= .85 else text); cells disagreeing with it are inconsistent.
  numlike := matches ^[+-]?(\\d+(\\.\\d+)?|\\.\\d+)([eE][+-]?\\d+)?$
  after trimming (identical regex both sides; dates fold into text).
- type_correctness (15): columns with a determinate type (fraction of
  EITHER class >= .85, i.e. not genuinely 50/50 mixed) over all columns.
  A column whose values split with no clear majority has no correct type.

Empty inputs are vacuously perfect: any zero denominator yields 1.0 for
that component (an empty frame scores 100 — there is nothing wrong in it).
"""

import math
import re
from typing import Any, Dict, List

_NUM_RE = re.compile(r"[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?\Z")


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return value == ""


def _is_numlike(value: Any) -> bool:
    # Numbers count (NaN is missing and never reaches here, but guard anyway);
    # strings must match the strict shared pattern; booleans never do.
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return not (isinstance(value, float) and math.isnan(value))
    if isinstance(value, str):
        return _NUM_RE.match(value.strip()) is not None
    return False


def _dup_key(value: Any) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "\0M"
    if isinstance(value, bool):
        return "b:" + str(value)
    if isinstance(value, int):
        return "n:" + str(value)
    if isinstance(value, float):
        return "n:" + (str(int(value)) if value.is_integer() else str(value))
    if isinstance(value, str):
        # Numeric-looking text canonicalizes to number form, so '25', 25
        # and 25.0 key identically on both engines (CSV columns arrive
        # typed on each side independently). Non-finite parses fall back
        # to plain strings on both sides.
        text: str = value.strip()
        if _NUM_RE.match(text) is not None:
            as_float: float = float(text)
            if math.isfinite(as_float):
                return "n:" + (str(int(as_float)) if as_float.is_integer() else str(as_float))
        return "s:" + value
    return "j:" + str(value)


def quality_score(columns: List[str], rows: List[List[Any]]) -> Dict[str, Any]:
    ncols: int = len(columns)
    nrows: int = len(rows)
    total_cells: int = nrows * ncols

    missing: int = 0
    seen_keys = set()
    dup_rows: int = 0
    for row in rows:
        key = "|".join(_dup_key(v) for v in row)
        if key in seen_keys:
            dup_rows += 1
        else:
            seen_keys.add(key)
        for v in row:
            if _is_missing(v):
                missing += 1

    non_missing: int = total_cells - missing
    ws_only: int = 0
    col_stats = []
    for ci in range(ncols):
        present = 0
        numlike = 0
        for row in rows:
            v = row[ci]
            if _is_missing(v):
                continue
            present += 1
            if isinstance(v, str) and v != "" and v.strip() == "":
                ws_only += 1
            if _is_numlike(v):
                numlike += 1
        col_stats.append((present, numlike))

    minority: int = 0
    undetermined: int = 0
    for present, numlike in col_stats:
        if present == 0:
            continue
        frac: float = numlike / present
        majority_num: bool = frac >= 0.85
        if frac < 0.85 and frac > 0.15:
            # Neither class reaches .85: no determinate type. (Boundary is
            # strict on both sides: exactly .85 counts as determined.)
            undetermined += 1
        minority += (present - numlike) if majority_num else numlike

    if total_cells == 0:
        completeness = 1.0
    else:
        completeness = 1.0 - missing / total_cells
    if nrows == 0:
        uniqueness = 1.0
    else:
        uniqueness = 1.0 - dup_rows / nrows
    if non_missing == 0:
        validity = 1.0
        consistency = 1.0
    else:
        validity = 1.0 - ws_only / non_missing
        consistency = 1.0 - minority / non_missing
    if ncols == 0:
        type_correctness = 1.0
    else:
        type_correctness = 1.0 - undetermined / ncols

    total: float = 0.0
    total += 30.0 * completeness
    total += 15.0 * uniqueness
    total += 25.0 * validity
    total += 15.0 * consistency
    total += 15.0 * type_correctness
    score: int = int(math.floor(total + 0.5))
    if score < 0:
        score = 0
    if score > 100:
        score = 100

    def _pct(x: float) -> int:
        return int(math.floor(x * 100.0 + 0.5))

    return {
        "score": score,
        "parts": {
            "completeness": _pct(completeness),
            "uniqueness": _pct(uniqueness),
            "validity": _pct(validity),
            "consistency": _pct(consistency),
            "type_correctness": _pct(type_correctness),
        },
        "counts": {
            "rows": nrows,
            "columns": ncols,
            "missing": missing,
            "duplicate_rows": dup_rows,
        },
    }
