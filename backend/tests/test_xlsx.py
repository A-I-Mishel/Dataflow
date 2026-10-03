"""XLSX input/output contracts: first-sheet upload, xlsx download, xlsx codegen."""

import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
from fastapi.testclient import TestClient

from generator import generate_script
from main import app
from models import NodeConfig, PipelineNode

client = TestClient(app)


def _xlsx_bytes(df: pd.DataFrame, sheets: dict | None = None) -> bytes:
    buf = io.BytesIO()
    if sheets:
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            for name, frame in sheets.items():
                frame.to_excel(writer, sheet_name=name, index=False)
    else:
        df.to_excel(buf, index=False)
    return buf.getvalue()


def test_xlsx_upload_first_sheet() -> None:
    payload = _xlsx_bytes(
        pd.DataFrame({"A": [1]}),
        sheets={"First": pd.DataFrame({"A": [1], "B": ["x"]}), "Second": pd.DataFrame({"Z": [9]})},
    )
    up = client.post(
        "/upload",
        files={
            "file": (
                "t.xlsx",
                payload,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert up.status_code == 200, up.text
    body = up.json()
    assert body["file_kind"] == "xlsx"
    assert body["columns"] == ["A", "B"]
    assert body["sheet"] == "First"
    assert body["sheet_count"] == 2
    assert body["row_count"] == 1


def test_xlsx_download_roundtrip() -> None:
    payload = _xlsx_bytes(pd.DataFrame({"X": [1, 2], "Y": ["a", "b"]}))
    up = client.post("/upload", files={"file": ("d.xlsx", payload, "application/octet-stream")})
    assert up.status_code == 200, up.text
    sid = up.json()["session_id"]
    ex = client.post("/execute", json={"session_id": sid, "nodes": [], "edges": []})
    assert ex.status_code == 200, ex.text
    dl = client.get(f"/download/{sid}?format=xlsx")
    assert dl.status_code == 200, dl.text[:200] if hasattr(dl, "text") else ""
    assert "spreadsheetml.sheet" in dl.headers.get("content-type", "")
    assert "cleaned_data.xlsx" in dl.headers.get("content-disposition", "")
    back = pd.read_excel(io.BytesIO(dl.content), engine="openpyxl")
    assert list(back.columns) == ["X", "Y"]
    assert len(back) == 2


def test_generate_xlsx_codegen() -> None:
    nodes = [PipelineNode(id="d1", type="drop-na", config=NodeConfig())]
    script = generate_script(nodes, [], filename="data.xlsx")
    assert 'pd.read_excel("data.xlsx"' in script
    assert 'to_excel("cleaned_data.xlsx"' in script
    res = client.post(
        "/generate",
        json={"session_id": "does-not-matter", "nodes": [], "edges": [], "filename": "data.xlsx"},
    )
    assert res.status_code == 200, res.text
    assert "read_excel" in res.json()["code"]
