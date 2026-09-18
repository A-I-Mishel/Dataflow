import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi import FastAPI
from fastapi.testclient import TestClient

import ratelimit
from ratelimit import FixedWindow, RateLimitMiddleware, bucket_for, limit_for


def test_window_allows_then_denies_then_resets() -> None:
    window = FixedWindow()
    assert window.allowed("k", 2, 60.0, now=0.0) == (True, 0.0)
    assert window.allowed("k", 2, 60.0, now=1.0) == (True, 0.0)
    ok, retry = window.allowed("k", 2, 60.0, now=2.0)
    assert ok is False
    assert retry > 0
    # New window resets the count; other keys unaffected.
    assert window.allowed("k", 2, 60.0, now=61.0) == (True, 0.0)
    assert window.allowed("other", 2, 60.0, now=2.0) == (True, 0.0)


def test_bucket_selection() -> None:
    assert bucket_for("/upload") == "/upload"
    assert bucket_for("/download/abc") == "default"
    assert bucket_for("/execute") == "/execute"
    assert bucket_for("/health") == "default"
    assert limit_for("/upload") == (30, 60)
    assert limit_for("/execute") == (60, 60)
    assert limit_for("/pipelines") == (300, 60)


def _mini_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware)

    @app.post("/upload")
    def upload() -> dict:
        return {"ok": True}

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


def test_middleware_429_with_retry_after(monkeypatch) -> None:
    monkeypatch.setattr(ratelimit, "RULES", [("/upload", 2, 60)])
    client = TestClient(_mini_app())
    assert client.post("/upload").status_code == 200
    assert client.post("/upload").status_code == 200
    denied = client.post("/upload")
    assert denied.status_code == 429
    assert "Retry-After" in denied.headers
    assert "Rate limit" in denied.json()["detail"]
    # Exempt paths never throttle.
    assert client.get("/health").status_code == 200
