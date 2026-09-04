import io
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import pytest
from fastapi.testclient import TestClient

import main
import session_store
from main import app

client = TestClient(app)

CSV_TEXT: str = "A,B,C\n1,x,10.5\n2,,20.0\n3,z,\n4,y,40.0\n"


def _force_large_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "LARGE_FILE_THRESHOLD_BYTES", 10)


def test_large_upload_execute_profile_generate_download(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_large_path(monkeypatch)
    up = client.post("/upload", files={"file": ("big.csv", CSV_TEXT, "text/csv")})
    assert up.status_code == 200, up.text
    body = up.json()
    assert body["row_count"] == 4
    assert body["columns"] == ["A", "B", "C"]
    assert body["missing_values"] == {"A": 0, "B": 1, "C": 1}
    sid: str = body["session_id"]
    assert f"default:{sid}" in session_store.large_files

    ex = client.post(
        "/execute",
        json={
            "session_id": sid,
            "nodes": [{"id": "n1", "type": "drop-na", "config": {}}],
            "edges": [],
        },
    )
    assert ex.status_code == 200, ex.text
    assert ex.json()["shape"] == [2, 3]

    pr = client.post("/profile", json={"session_id": sid})
    assert pr.status_code == 200, pr.text
    assert pr.json()["shape"] == [4, 3]

    gn = client.post("/generate", json={"session_id": sid, "nodes": [], "edges": []})
    assert gn.status_code == 200, gn.text

    dl = client.get(f"/download/{sid}")
    assert dl.status_code == 200
    assert "text/csv" in dl.headers["content-type"]
    parsed: pd.DataFrame = pd.read_csv(io.StringIO(dl.text))
    assert parsed.shape == (2, 3)


def test_large_session_eviction_unlinks_temp_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_large_path(monkeypatch)
    up = client.post("/upload", files={"file": ("big.csv", CSV_TEXT, "text/csv")})
    assert up.status_code == 200
    key: str = f"default:{up.json()['session_id']}"
    _stored_at, entry = session_store.large_files[key]
    assert os.path.exists(entry.path)
    session_store.large_files[key] = (datetime(2000, 1, 1), entry)
    evicted: int = session_store.evict_old_sessions()
    assert evicted >= 1
    assert not os.path.exists(entry.path)
    assert key not in session_store.large_files
