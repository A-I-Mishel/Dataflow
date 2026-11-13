"""Accounts: signup/login/logout/me + mandatory auth + per-user ownership.

Tests run against the suite's temporary SQLite database (see conftest.py),
so every account is removed in a finally block to keep repeated runs clean.
"""

import os
import sys
from typing import Any, Dict, Optional
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi.testclient import TestClient

from database import SessionLocal
from main import app
from models_db import AuthSession, SavedPipeline, User

client = TestClient(app)

PASSWORD = "Sieve-pass-123"


def _unique_email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid4().hex[:10]}@example.test"


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _signup(email: Optional[str] = None, password: str = PASSWORD) -> Dict[str, Any]:
    res = client.post(
        "/auth/signup",
        json={"email": email or _unique_email(), "password": password},
    )
    assert res.status_code == 201, res.text
    return res.json()


def _cleanup(email: str) -> None:
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            return
        db.query(AuthSession).filter(AuthSession.user_id == user.id).delete()
        db.query(SavedPipeline).filter(SavedPipeline.owner == f"user:{user.id}").delete()
        db.delete(user)
        db.commit()


def test_signup_login_me_logout_flow() -> None:
    email = _unique_email("flow")
    try:
        created = _signup(email)
        assert created["user"]["email"] == email
        token = created["token"]

        me = client.get("/auth/me", headers=_auth(token))
        assert me.status_code == 200, me.text
        assert me.json()["user"]["email"] == email

        out = client.post("/auth/logout", headers=_auth(token))
        assert out.status_code == 200
        assert client.get("/auth/me", headers=_auth(token)).status_code == 401

        logged_in = client.post(
            "/auth/login", json={"email": email.upper(), "password": PASSWORD}
        )
        assert logged_in.status_code == 200, logged_in.text
        assert logged_in.json()["user"]["email"] == email
        assert logged_in.json()["token"] != token
    finally:
        _cleanup(email)


def test_signup_validation_and_duplicate_email() -> None:
    email = _unique_email("dupe")
    try:
        _signup(email)
        duplicate = client.post(
            "/auth/signup", json={"email": email, "password": PASSWORD}
        )
        assert duplicate.status_code == 409, duplicate.text

        assert client.post(
            "/auth/signup", json={"email": "not-an-email", "password": PASSWORD}
        ).status_code == 400
        assert client.post(
            "/auth/signup", json={"email": _unique_email(), "password": "short"}
        ).status_code == 400
    finally:
        _cleanup(email)


def test_login_rejects_wrong_password_and_unknown_email() -> None:
    email = _unique_email("wrong")
    try:
        _signup(email)
        bad = client.post(
            "/auth/login", json={"email": email, "password": "not-the-password"}
        )
        assert bad.status_code == 401, bad.text
        assert bad.json()["detail"] == "Invalid email or password"

        missing = client.post(
            "/auth/login",
            json={"email": _unique_email("missing"), "password": PASSWORD},
        )
        assert missing.status_code == 401
    finally:
        _cleanup(email)


def test_invalid_bearer_token_is_401_not_anonymous() -> None:
    res = client.get("/pipelines", headers={"Authorization": "Bearer nope"})
    assert res.status_code == 401, res.text


def test_anonymous_data_requests_are_rejected(real_auth_gate) -> None:
    # real_auth_gate removes the suite's compatibility override, so these
    # are exactly the requests an unauthenticated browser would make.
    for method, path, kwargs in (
        ("get", "/pipelines", {}),
        ("post", "/pipelines/save", {"json": {"name": "x", "nodes": [], "edges": []}}),
        ("get", "/auth/me", {}),
        ("post", "/upload", {"files": {"file": ("t.csv", "A\n1\n", "text/csv")}}),
        ("post", "/execute", {"json": {"session_id": "x", "nodes": [], "edges": []}}),
        ("post", "/generate", {"json": {"session_id": "x", "nodes": [], "edges": []}}),
        ("get", "/download/x", {}),
    ):
        res = getattr(client, method)(path, **kwargs)
        assert res.status_code == 401, f"{method.upper()} {path}: {res.text}"
        assert res.headers.get("www-authenticate") == "Bearer"


def test_saved_pipelines_are_private_per_account() -> None:
    email_a = _unique_email("alice")
    email_b = _unique_email("bob")
    name = f"private-{uuid4().hex[:8]}"
    try:
        a = _signup(email_a)
        b = _signup(email_b)
        saved = client.post(
            "/pipelines/save",
            json={"name": name, "nodes": [{"id": "n1"}], "edges": []},
            headers=_auth(a["token"]),
        )
        assert saved.status_code == 200, saved.text
        pipeline_id = saved.json()["id"]

        mine = client.get("/pipelines", headers=_auth(a["token"])).json()
        assert any(p["id"] == pipeline_id for p in mine)
        theirs = client.get("/pipelines", headers=_auth(b["token"])).json()
        assert all(p["id"] != pipeline_id for p in theirs)

        assert (
            client.get(f"/pipelines/{pipeline_id}", headers=_auth(b["token"])).status_code
            == 404
        )
        assert (
            client.delete(f"/pipelines/{pipeline_id}", headers=_auth(b["token"])).status_code
            == 404
        )
        assert (
            client.delete(f"/pipelines/{pipeline_id}", headers=_auth(a["token"])).status_code
            == 200
        )
    finally:
        _cleanup(email_a)
        _cleanup(email_b)
