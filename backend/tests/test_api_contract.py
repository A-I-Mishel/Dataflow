"""HTTP-level contracts the frontend relies on: linear-chain parity between the
run gate and the API, structural payload caps, and upload/download edge cases."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from typing import Any, Dict, List

from fastapi.testclient import TestClient

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
