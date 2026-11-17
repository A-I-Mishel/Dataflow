"""Quality-score twin: unit checks for quality.py plus exact agreement with
the Sieve engine on hand-computed frames and the messy corpus.

The contract (ratios, order, rounding) lives in quality.py's docstring;
any change there must be mirrored in engine.js qualityScore and re-locked
by the hand-computed expectations below.
"""

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd

from quality import quality_score

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
QUALITY_RUN = os.path.join(REPO_ROOT, "frontend-sieve", "tests", "quality-run.mjs")
CSV_PATH = os.path.join(REPO_ROOT, "test-materials", "messy_employees_25k.csv")


def sieve_score(columns, rows):
    proc = subprocess.run(
        ["node", QUALITY_RUN, json.dumps({"columns": columns, "rows": rows})],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, f"sieve quality failed: {proc.stderr}"
    return json.loads(proc.stdout)


def sieve_score_csv(csv_path):
    """Score through each engine's OWN csv parsing: pandas floats/NaN on
    this side, Sieve strings/blanks there. Agreement here is the whole
    point of the canonical dup-key and missing rules."""
    proc = subprocess.run(
        ["node", QUALITY_RUN, csv_path],
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert proc.returncode == 0, f"sieve quality failed: {proc.stderr}"
    return json.loads(proc.stdout)


def test_perfect_frame_scores_100() -> None:
    columns = ["a", "b"]
    rows = [[1, "x"], [2, "y"]]
    expected = {
        "score": 100,
        "parts": {
            "completeness": 100,
            "uniqueness": 100,
            "validity": 100,
            "consistency": 100,
            "type_correctness": 100,
        },
        "counts": {"rows": 2, "columns": 2, "missing": 0, "duplicate_rows": 0},
    }
    assert quality_score(columns, rows) == expected
    assert sieve_score(columns, rows) == expected


def test_empty_frame_scores_100() -> None:
    assert quality_score([], [])["score"] == 100
    assert quality_score(["a"], [])["score"] == 100


def test_hand_computed_dirty_frame() -> None:
    # Exercises every component: a duplicate row, whitespace-only dirt, a
    # missing cell, and two genuinely mixed columns (both undetermined).
    columns = ["n", "t"]
    rows = [[1, "a"], [1, "a"], [2, "  "], [None, "b"], ["x", 3]]
    expected = {
        "score": 70,
        "parts": {
            "completeness": 90,
            "uniqueness": 80,
            "validity": 89,
            "consistency": 56,
            "type_correctness": 0,
        },
        "counts": {"rows": 5, "columns": 2, "missing": 1, "duplicate_rows": 1},
    }
    assert quality_score(columns, rows) == expected
    assert sieve_score(columns, rows) == expected


def test_messy_corpus_agrees() -> None:
    df = pd.read_csv(CSV_PATH)
    df.columns = [str(c) for c in df.columns]
    columns = df.columns.tolist()
    rows = df.values.tolist()
    mine = quality_score(columns, rows)
    theirs = sieve_score_csv(CSV_PATH)
    assert mine == theirs
    assert 0 <= mine["score"] <= 100
