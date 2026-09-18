import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
from fastapi.testclient import TestClient

from main import app
from sanitize import neutralize_formula, neutralize_formulas


def test_risky_prefixes_neutralized() -> None:
    for risky in ["=1+1", '=HYPERLINK("http://evil","x")', "+2+3", "-2+3", "@SUM(A1:A2)"]:
        assert neutralize_formula(risky) == "'" + risky


def test_safe_values_untouched() -> None:
    assert neutralize_formula("hello") == "hello"
    assert neutralize_formula("") == ""
    assert neutralize_formula(42) == 42
    assert neutralize_formula(3.14) == 3.14
    assert neutralize_formula(None) is None


def test_frame_neutralizes_only_object_columns() -> None:
    df = pd.DataFrame(
        {
            "name": ["=cmd|evil", "Ada", None],
            "age": [36, 85, 41],
            "note": ["+calc", "fine", "@x"],
        }
    )
    safe = neutralize_formulas(df)
    assert safe["name"].tolist()[:2] == ["'=cmd|evil", "Ada"]
    assert pd.isna(safe["name"].tolist()[2])
    assert safe["age"].tolist() == [36, 85, 41]
    assert safe["note"].tolist() == ["'+calc", "fine", "'@x"]
    # Stored frame never mutated: the download path copies.
    assert df["name"].tolist()[0] == "=cmd|evil"
    assert safe is not df


def test_download_neutralizes_formulas() -> None:
    client = TestClient(app)
    csv = 'name,age\n"=HYPERLINK(""http://evil"",""x"")",36\nAda,85\n'
    up = client.post("/upload", files={"file": ("f.csv", csv, "text/csv")})
    assert up.status_code == 200, up.text
    sid = up.json()["session_id"]
    ex = client.post("/execute", json={"session_id": sid, "nodes": [], "edges": []})
    assert ex.status_code == 200, ex.text
    dl = client.get(f"/download/{sid}")
    assert dl.status_code == 200
    assert "'=HYPERLINK" in dl.text
    assert "\nAda,85" in dl.text
