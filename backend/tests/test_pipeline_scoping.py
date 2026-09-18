"""Saved pipelines are namespaced per API key: one key can neither see nor
delete another key's pipelines (reads probe as 404, never 403)."""

import os
import sys
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from typing import Any, Dict, List

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

KEY_A = {"X-API-Key": "scope-a"}
KEY_B = {"X-API-Key": "scope-b"}


def _unique(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:8]}"


def _save(name: str, headers: Dict[str, str]) -> Dict[str, Any]:
    res = client.post(
        "/pipelines/save",
        json={"name": name, "nodes": [{"id": "n1"}], "edges": []},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_keys_cannot_see_each_other() -> None:
    name = _unique("scoped")
    saved = _save(name, KEY_A)
    assert name in _names(client.get("/pipelines", headers=KEY_A).json())
    other = client.get("/pipelines", headers=KEY_B).json()
    assert all(p["id"] != saved["id"] for p in other)


def test_cross_key_read_is_404_not_403() -> None:
    saved = _save(_unique("probed"), KEY_A)
    assert client.get(f"/pipelines/{saved['id']}", headers=KEY_A).status_code == 200
    assert client.get(f"/pipelines/{saved['id']}", headers=KEY_B).status_code == 404


def test_cross_key_delete_is_404_and_owner_delete_works() -> None:
    saved = _save(_unique("doomed"), KEY_A)
    assert client.delete(f"/pipelines/{saved['id']}", headers=KEY_B).status_code == 404
    assert client.delete(f"/pipelines/{saved['id']}", headers=KEY_A).status_code == 200
    assert client.get(f"/pipelines/{saved['id']}", headers=KEY_A).status_code == 404


def test_duplicate_name_across_keys_still_400() -> None:
    # Documented limitation: `name` stays globally unique at the DB level
    # (SQLite cannot drop the constraint without a rebuild), so a second
    # namespace reusing the name gets 400 instead of a silent collision.
    name = _unique("shared")
    _save(name, KEY_A)
    res = client.post(
        "/pipelines/save",
        json={"name": name, "nodes": [], "edges": []},
        headers=KEY_B,
    )
    assert res.status_code == 400, res.text


def test_default_namespace_isolated_from_keyed() -> None:
    saved = _save(_unique("keyed"), KEY_A)
    assert all(
        p["id"] != saved["id"] for p in client.get("/pipelines").json()
    )


def _names(pipelines: List[Dict[str, Any]]) -> List[str]:
    return [p["name"] for p in pipelines]
