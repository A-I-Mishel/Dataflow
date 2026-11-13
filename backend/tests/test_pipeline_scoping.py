"""Saved pipelines are namespaced per account: one account can neither see
nor delete another's pipelines (reads probe as 404, never 403). Names are
unique per account, so the same template name may exist in both."""

import os
import sys
from typing import Any, Dict, List, Optional
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi.testclient import TestClient

from database import SessionLocal
from main import app
from models_db import AuthSession, SavedPipeline, User

client = TestClient(app)

PASSWORD = "Sieve-pass-123"


def _unique(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:8]}"


def _signup(prefix: str) -> Dict[str, Any]:
    email = f"{prefix}-{uuid4().hex[:10]}@example.test"
    res = client.post(
        "/auth/signup", json={"email": email, "password": PASSWORD}
    )
    assert res.status_code == 201, res.text
    body = res.json()
    body["email"] = email
    return body


def _cleanup(*users: Dict[str, Any]) -> None:
    with SessionLocal() as db:
        for entry in users:
            user_id = entry["user"]["id"]
            db.query(AuthSession).filter(AuthSession.user_id == user_id).delete()
            db.query(SavedPipeline).filter(
                SavedPipeline.owner == f"user:{user_id}"
            ).delete()
            db.query(User).filter(User.id == user_id).delete()
        db.commit()


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _save(name: str, token: str) -> Dict[str, Any]:
    res = client.post(
        "/pipelines/save",
        json={"name": name, "nodes": [{"id": "n1"}], "edges": []},
        headers=_auth(token),
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_accounts_cannot_see_each_other() -> None:
    a = _signup("scope-a")
    b = _signup("scope-b")
    try:
        name = _unique("scoped")
        saved = _save(name, a["token"])
        mine = client.get("/pipelines", headers=_auth(a["token"])).json()
        assert name in _names(mine)
        other = client.get("/pipelines", headers=_auth(b["token"])).json()
        assert all(p["id"] != saved["id"] for p in other)
    finally:
        _cleanup(a, b)


def test_cross_account_read_is_404_not_403() -> None:
    a = _signup("read-a")
    b = _signup("read-b")
    try:
        saved = _save(_unique("probed"), a["token"])
        assert (
            client.get(
                f"/pipelines/{saved['id']}", headers=_auth(a["token"])
            ).status_code
            == 200
        )
        assert (
            client.get(
                f"/pipelines/{saved['id']}", headers=_auth(b["token"])
            ).status_code
            == 404
        )
    finally:
        _cleanup(a, b)


def test_cross_account_delete_is_404_and_owner_delete_works() -> None:
    a = _signup("del-a")
    b = _signup("del-b")
    try:
        saved = _save(_unique("doomed"), a["token"])
        assert (
            client.delete(
                f"/pipelines/{saved['id']}", headers=_auth(b["token"])
            ).status_code
            == 404
        )
        assert (
            client.delete(
                f"/pipelines/{saved['id']}", headers=_auth(a["token"])
            ).status_code
            == 200
        )
        assert (
            client.get(
                f"/pipelines/{saved['id']}", headers=_auth(a["token"])
            ).status_code
            == 404
        )
    finally:
        _cleanup(a, b)


def test_duplicate_name_allowed_across_accounts() -> None:
    a = _signup("name-a")
    b = _signup("name-b")
    try:
        # Composite (owner, name) uniqueness replaced the old global name
        # constraint, so two students can both save "clean sales".
        name = _unique("shared")
        first = _save(name, a["token"])
        second = _save(name, b["token"])
        assert first["id"] != second["id"]
        assert name in _names(
            client.get("/pipelines", headers=_auth(a["token"])).json()
        )
        assert name in _names(
            client.get("/pipelines", headers=_auth(b["token"])).json()
        )
    finally:
        _cleanup(a, b)


def _names(pipelines: List[Dict[str, Any]]) -> List[str]:
    return [p["name"] for p in pipelines]
