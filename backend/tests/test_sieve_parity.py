"""Cell-for-cell parity between the Sieve local engine and this backend.

Same CSV in, equivalent pipelines, normalized values out. Any mismatch is a
real semantic divergence (not formatting): investigate, then either fix or
document as an intended semantic difference.

KNOWN DIFFERENCE (documented, not a failure): sorting a column of
currency-formatted strings (e.g. Salary '$100,002.33'). The backend sorts raw
values (lexical for object columns: '$...' first ascending); Sieve coerces
numeric-like strings (strips $, resolves commas) and sorts numerically.
Changing the backend would reorder existing users' pipelines, so both
behaviors stand and the parity pipelines below use Age instead.
"""

import json
import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from typing import Any, Dict, List

import pandas as pd
import pytest

from engine import execute_pipeline_with_intermediates
from models import NodeConfig, PipelineNode

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
CSV_PATH = os.path.join(REPO_ROOT, "test-materials", "messy_employees_25k.csv")
PARITY_RUN = os.path.join(REPO_ROOT, "frontend-sieve", "tests", "parity-run.mjs")


def norm(value: Any) -> str:
    """Canonical cell form across engines: missing collapses, and numeric
    strings canonicalize like backend floats (Sieve '31.0' == backend 31.0
    == 31). Non-numeric strings pass through untouched."""
    if value is None:
        return "∅"
    if isinstance(value, float) and math.isnan(value):
        return "∅"
    if value == "":
        return "∅"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, str):
        try:
            as_float = float(value)
        except ValueError:
            return value
        if math.isnan(as_float):
            return value
        return str(int(as_float)) if as_float.is_integer() else str(as_float)
    return str(value)


def sieve_run(spec: List[Dict[str, Any]]) -> Dict[str, Any]:
    proc = subprocess.run(
        ["node", PARITY_RUN, CSV_PATH, json.dumps(spec)],
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert proc.returncode == 0, f"sieve engine failed: {proc.stderr}"
    return json.loads(proc.stdout)


def backend_run(nodes: List[PipelineNode]) -> pd.DataFrame:
    df: pd.DataFrame = pd.read_csv(CSV_PATH)
    df.columns = [str(c) for c in df.columns]
    edges = [
        {"source": nodes[i].id, "target": nodes[i + 1].id} for i in range(len(nodes) - 1)
    ]
    final, _ = execute_pipeline_with_intermediates(df, nodes, edges)
    return final


def frames_equal(sieve: Dict[str, Any], backend: pd.DataFrame) -> List[str]:
    diffs: List[str] = []
    bcols: List[str] = [str(c) for c in backend.columns.tolist()]
    if sieve["columns"] != bcols:
        diffs.append(f"columns differ:\n  sieve={sieve['columns']}\n  backend={bcols}")
        return diffs
    brows: List[List[str]] = [
        [norm(v) for v in row] for row in backend.values.tolist()
    ]
    srows: List[List[str]] = [[norm(v) for v in row] for row in sieve["rows"]]
    if len(srows) != len(brows):
        return [f"row count differs: sieve={len(srows)} backend={len(brows)}"]
    for i, (a, b) in enumerate(zip(srows, brows)):
        if a != b:
            diffs.append(f"row {i} differs:\n  sieve={a}\n  backend={b}")
            if len(diffs) >= 5:
                diffs.append("... (truncated)")
                break
    return diffs


def _node(node_id: str, node_type: str, **config: Any) -> PipelineNode:
    return PipelineNode(id=node_id, type=node_type, config=NodeConfig(**config))  # type: ignore[arg-type]


def test_parse_agreement() -> None:
    """Precondition: both parsers must agree on columns/row count, or every
    transform comparison below is meaningless."""
    sieve = sieve_run([])
    backend: pd.DataFrame = pd.read_csv(CSV_PATH)
    assert sieve["columns"] == [str(c) for c in backend.columns.tolist()]
    assert len(sieve["rows"]) == len(backend)


def test_parity_clean_sort() -> None:
    sieve = sieve_run(
        [
            {"type": "fill-missing", "params": {"column": "Age", "method": "median", "value": ""}},
            {"type": "drop-duplicates", "params": {"keep": "first"}},
            {"type": "sort-rows", "params": {"column": "Age", "dir": "desc"}},
        ]
    )
    backend = backend_run(
        [
            _node("n1", "fill-na", columns=["Age"], strategy="median"),
            _node("n2", "drop-duplicates"),
            _node("n3", "sort", by=["Age"], ascending=False),
        ]
    )
    assert frames_equal(sieve, backend) == []


def test_parity_sort_asc() -> None:
    # Regression: sort-rows run() once ignored `dir` entirely (always
    # ascending). Ascending case guards the shared comparator path.
    sieve = sieve_run([{"type": "sort-rows", "params": {"column": "Age", "dir": "asc"}}])
    backend = backend_run([_node("n1", "sort", by=["Age"], ascending=True)])
    assert frames_equal(sieve, backend) == []


def test_parity_filter_project_rename() -> None:
    sieve = sieve_run(
        [
            {"type": "filter-rows", "params": {"column": "Age", "op": ">", "value": "30"}},
            {"type": "drop-columns", "params": {"columns": ["City"]}},
            {"type": "rename-columns", "params": {"map": {"Name": "FullName"}}},
        ]
    )
    backend = backend_run(
        [
            _node(
                "n1",
                "filter-rows",
                conditions=[{"column": "Age", "operator": ">", "value": 30}],
            ),
            _node("n2", "drop-column", columns=["City"]),
            _node("n3", "rename-column", mapping={"Name": "FullName"}),
        ]
    )
    assert frames_equal(sieve, backend) == []


def test_parity_wave1_ops() -> None:
    """Wave-1 additions, cell-for-cell: reorder, directional fill, round,
    replace, drop-empty (no-op here — the corpus has no all-empty column,
    which is itself the parity assertion), drop, rename, sort."""
    full_order = [
        "Active",
        "PerformanceScore",
        "City",
        "HireDate",
        "Email",
        "Department",
        "Salary",
        "Age",
        "Name",
        "EmployeeID",
    ]
    sieve = sieve_run(
        [
            {"type": "reorder-columns", "params": {"order": full_order}},
            {"type": "fill-missing", "params": {"column": "Age", "method": "ffill", "value": "", "limit": ""}},
            {"type": "round-values", "params": {"columns": ["PerformanceScore"], "decimals": "1"}},
            {"type": "replace-values", "params": {"columns": ["Department"], "find": "Sales", "replacement": "Retail", "case": True}},
            {"type": "drop-columns", "params": {"columns": ["City"]}},
            {"type": "drop-empty-columns", "params": {}},
            {"type": "rename-columns", "params": {"map": {"Name": "FullName"}}},
            {"type": "sort-rows", "params": {"column": "Age", "dir": "desc"}},
        ]
    )
    backend = backend_run(
        [
            _node("n1", "reorder-columns", columns=full_order),
            _node("n2", "fill-na", columns=["Age"], strategy="ffill"),
            _node("n3", "round-values", columns=["PerformanceScore"], decimals=1),
            _node(
                "n4",
                "replace-values",
                columns=["Department"],
                find="Sales",
                replacement="Retail",
                case_sensitive=True,
            ),
            _node("n5", "drop-column", columns=["City"]),
            _node("n6", "drop-empty-columns"),
            _node("n7", "rename-column", mapping={"Name": "FullName"}),
            _node("n8", "sort", by=["Age"], ascending=False),
        ]
    )
    assert frames_equal(sieve, backend) == []
