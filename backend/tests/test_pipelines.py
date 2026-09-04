import os
import sys
from typing import Dict, List
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from database import SessionLocal
from main import app
from models_db import ExecutionLog, SessionMeta

client = TestClient(app)


def _unique_name(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:8]}"


def _db_session() -> Session:
    return SessionLocal()


def test_pipeline_crud_round_trip() -> None:
    name: str = _unique_name("e2e-pipe")
    nodes: List[Dict[str, object]] = [
        {
            "id": "n1",
            "type": "drop-na",
            "position": {"x": 100, "y": 100},
            "data": {"label": "Drop Missing", "config": {}},
        }
    ]
    edges: List[Dict[str, str]] = []

    saved = client.post("/pipelines/save", json={"name": name, "nodes": nodes, "edges": edges})
    assert saved.status_code == 200, saved.text
    pipeline_id: str = saved.json()["id"]
    assert saved.json()["name"] == name

    try:
        listed = client.get("/pipelines")
        assert listed.status_code == 200
        assert any(item["id"] == pipeline_id for item in listed.json())

        fetched = client.get(f"/pipelines/{pipeline_id}")
        assert fetched.status_code == 200, fetched.text
        assert fetched.json()["nodes"] == nodes
        assert fetched.json()["edges"] == edges
    finally:
        deleted = client.delete(f"/pipelines/{pipeline_id}")
        assert deleted.status_code == 200

    assert client.get(f"/pipelines/{pipeline_id}").status_code == 404
    assert all(item["id"] != pipeline_id for item in client.get("/pipelines").json())


def test_duplicate_pipeline_name_rejected() -> None:
    name: str = _unique_name("dup-pipe")
    body: Dict[str, object] = {"name": name, "nodes": [], "edges": []}
    first = client.post("/pipelines/save", json=body)
    assert first.status_code == 200
    try:
        second = client.post("/pipelines/save", json=body)
        assert second.status_code == 400, second.text
        assert client.post("/pipelines/save", json={"name": "  ", "nodes": [], "edges": []}).status_code == 400
    finally:
        client.delete(f"/pipelines/{first.json()['id']}")


def test_upload_and_execute_are_logged() -> None:
    upload = client.post(
        "/upload", files={"file": ("logged.csv", "A,B\n1,x\n2,y\n", "text/csv")}
    )
    assert upload.status_code == 200
    session_id: str = upload.json()["session_id"]

    db: Session = _db_session()
    try:
        meta = db.query(SessionMeta).filter(SessionMeta.id == session_id).first()
        assert meta is not None
        assert meta.row_count == 2
    finally:
        db.close()

    executed = client.post(
        "/execute", json={"session_id": session_id, "nodes": [], "edges": []}
    )
    assert executed.status_code == 200

    db2: Session = _db_session()
    try:
        logs = (
            db2.query(ExecutionLog)
            .filter(ExecutionLog.session_id == session_id)
            .all()
        )
        assert len(logs) >= 1
        assert logs[-1].result_rows == 2
    finally:
        db2.close()
