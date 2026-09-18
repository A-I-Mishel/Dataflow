"""HTTP-level contracts the frontend relies on: linear-chain parity between the
run gate and the API, structural payload caps, and upload/download edge cases."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient

import main
from main import app
from models import MAX_EDGES, MAX_LIST_ITEMS, MAX_NODES

client = TestClient(app)

CSV_TEXT: str = "A,B\n1,x\n2,y\n"


def _upload() -> str:
    up = client.post("/upload", files={"file": ("t.csv", CSV_TEXT, "text/csv")})
    assert up.status_code == 200, up.text
    return up.json()["session_id"]


def _node(node_id: str, node_type: str = "drop-na") -> Dict[str, Any]:
    return {"id": node_id, "type": node_type, "config": {}}


def test_execute_rejects_fork() -> None:
    sid = _upload()
    res = client.post(
        "/execute",
        json={
            "session_id": sid,
            "nodes": [_node("a"), _node("b"), _node("c")],
            "edges": [
                {"source": "a", "target": "b"},
                {"source": "a", "target": "c"},
            ],
        },
    )
    assert res.status_code == 400, res.text
    assert "splits into multiple branches" in res.json()["detail"]


def test_execute_rejects_multiple_roots() -> None:
    sid = _upload()
    res = client.post(
        "/execute",
        json={"session_id": sid, "nodes": [_node("a"), _node("b")], "edges": []},
    )
    assert res.status_code == 400, res.text
    assert "starting nodes" in res.json()["detail"]


def test_generate_rejects_fork() -> None:
    res = client.post(
        "/generate",
        json={
            "session_id": "does-not-matter",
            "nodes": [_node("a"), _node("b"), _node("c")],
            "edges": [
                {"source": "a", "target": "b"},
                {"source": "a", "target": "c"},
            ],
        },
    )
    assert res.status_code == 400, res.text
    assert "splits into multiple branches" in res.json()["detail"]


def test_linear_pipeline_still_runs() -> None:
    sid = _upload()
    res = client.post(
        "/execute",
        json={
            "session_id": sid,
            "nodes": [_node("a"), _node("b")],
            "edges": [{"source": "a", "target": "b"}],
        },
    )
    assert res.status_code == 200, res.text


def test_too_many_nodes_rejected_before_compute() -> None:
    sid = _upload()
    nodes: List[Dict[str, Any]] = [_node(f"n{i}") for i in range(MAX_NODES + 1)]
    res = client.post("/execute", json={"session_id": sid, "nodes": nodes, "edges": []})
    assert res.status_code == 422, res.text


def test_too_many_conditions_rejected_before_compute() -> None:
    sid = _upload()
    conditions = [{"column": "A", "operator": ">", "value": 0}] * (MAX_LIST_ITEMS + 1)
    res = client.post(
        "/execute",
        json={
            "session_id": sid,
            "nodes": [{"id": "a", "type": "filter-rows", "config": {"conditions": conditions}}],
            "edges": [],
        },
    )
    assert res.status_code == 422, res.text


def test_save_rejects_oversized_pipeline() -> None:
    nodes: List[Dict[str, Any]] = [{"id": f"n{i}"} for i in range(MAX_NODES + 1)]
    res = client.post("/pipelines/save", json={"name": "too big", "nodes": nodes, "edges": []})
    assert res.status_code == 422, res.text


def test_upload_empty_file_rejected() -> None:
    res = client.post("/upload", files={"file": ("empty.csv", "", "text/csv")})
    assert res.status_code == 400, res.text


def test_download_without_execute_is_404() -> None:
    sid = _upload()
    res = client.get(f"/download/{sid}")
    assert res.status_code == 404, res.text


def test_max_edges_constant_sane() -> None:
    assert MAX_EDGES > MAX_NODES


def test_health_reports_db() -> None:
    res = client.get("/health")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "ok"
    assert res.json()["db"] == "ok"


def test_cors_preflight_tight_methods_and_headers() -> None:
    # Mechanics are testable locally: localhost is a dev origin here, while
    # the production origin itself was verified live against Render.
    res = client.options(
        "/upload",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Session-Id",
        },
    )
    assert res.status_code == 200, res.text
    assert res.headers["access-control-allow-origin"] == "http://localhost:3000"
    methods: str = res.headers["access-control-allow-methods"]
    assert "POST" in methods and "DELETE" in methods
    assert "PUT" not in methods.split(",")
    assert "PATCH" not in methods.split(",")


def test_cors_rejects_unknown_origin() -> None:
    res = client.options(
        "/upload",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert res.status_code == 400
    assert "access-control-allow-origin" not in res.headers


def test_download_bom_opt_in() -> None:
    sid = _upload()
    ex = client.post("/execute", json={"session_id": sid, "nodes": [], "edges": []})
    assert ex.status_code == 200, ex.text
    plain = client.get(f"/download/{sid}")
    assert plain.status_code == 200, plain.text
    assert not plain.content.startswith(b"\xef\xbb\xbf")
    bom = client.get(f"/download/{sid}?bom=1")
    assert bom.status_code == 200, bom.text
    assert bom.content.startswith(b"\xef\xbb\xbf")


def test_json_body_cap_rejects_huge_execute() -> None:
    # The middleware reads only the header, so no 11MB body is sent.
    res = client.post(
        "/execute",
        content=b"{}",
        headers={"content-length": str(11 * 1024 * 1024)},
    )
    assert res.status_code == 413
    assert "too large" in res.json()["detail"]


def test_upload_path_exempt_from_json_cap() -> None:
    # /upload streams multipart under its own 200MB cap: a declared large
    # length must not trip the JSON guard (the real size check runs later).
    res = client.post(
        "/upload",
        files={"file": ("t.csv", CSV_TEXT, "text/csv")},
        headers={"content-length": str(11 * 1024 * 1024)},
    )
    assert res.status_code != 413


def test_tsv_upload_sniffs_tabs() -> None:
    # The picker accepts TSV: tab-split columns, never one mangled column.
    up = client.post(
        "/upload", files={"file": ("t.tsv", "A\tB\n1\tx\n2\ty\n", "text/tab-separated-values")}
    )
    assert up.status_code == 200, up.text
    assert up.json()["columns"] == ["A", "B"]


def test_utf16_upload_decodes() -> None:
    body: bytes = "A,B\n1,x\n".encode("utf-16")
    up = client.post("/upload", files={"file": ("u.csv", body, "text/csv")})
    assert up.status_code == 200, up.text
    assert up.json()["columns"] == ["A", "B"]


def test_estimated_flag_marks_large_uploads(monkeypatch: pytest.MonkeyPatch) -> None:
    small = client.post("/upload", files={"file": ("t.csv", CSV_TEXT, "text/csv")})
    assert small.json()["estimated"] is False
    monkeypatch.setattr(main, "LARGE_FILE_THRESHOLD_BYTES", 10)
    big = client.post("/upload", files={"file": ("t.csv", CSV_TEXT, "text/csv")})
    assert big.json()["large"] is True
    assert big.json()["estimated"] is True
