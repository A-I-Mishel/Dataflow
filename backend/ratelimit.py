import time
from typing import Callable, Dict, List, Optional, Tuple

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# Fixed-window limits per client IP. Deliberately generous: the suite fires
# ~13 uploads + ~12 executes in seconds, and legit users batch too. This is
# abuse friction for a single free-tier worker, not armor — sustained
# attackers still need edge throttling (Cloudflare/Render) in front.
# Rule = (path prefix, max requests, window seconds).
RULES: List[Tuple[str, int, int]] = [
    ("/upload", 30, 60),
    ("/execute", 60, 60),
]
DEFAULT_LIMIT: Tuple[int, int] = (300, 60)
EXEMPT_PREFIXES: Tuple[str, ...] = ("/health", "/docs", "/openapi.json", "/redoc")


class FixedWindow:
    """Thread-unsafe counter map; safe here because uvicorn runs one worker
    (see render.yaml) and endpoints are sync (threadpool calls are short
    dict ops under the GIL). Migrate to Redis with --workers > 1."""

    def __init__(self) -> None:
        self._hits: Dict[str, Tuple[float, int]] = {}

    def allowed(self, key: str, limit: int, window: float, now: float) -> Tuple[bool, float]:
        """Returns (allowed, retry_after_seconds). Pure function of (key,
        limit, window, now) — deterministic under test with a fake clock."""
        start, count = self._hits.get(key, (now, 0))
        if now - start >= window:
            start, count = now, 0
        if count >= limit:
            return False, (start + window) - now
        self._hits[key] = (start, count + 1)
        if len(self._hits) > 10000:
            expired = [k for k, (s, _) in self._hits.items() if now - s >= window]
            for k in expired:
                del self._hits[k]
        return True, 0.0


def bucket_for(path: str, rules: Optional[List[Tuple[str, int, int]]] = None) -> str:
    for prefix, _, _ in rules if rules is not None else RULES:
        if path == prefix or path.startswith(prefix + "/"):
            return prefix
    return "default"


def limit_for(path: str) -> Tuple[int, int]:
    for prefix, limit, window in RULES:
        if path == prefix or path.startswith(prefix + "/"):
            return limit, window
    return DEFAULT_LIMIT


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Callable, tracker: Optional[FixedWindow] = None) -> None:
        super().__init__(app)
        self._tracker: FixedWindow = tracker or FixedWindow()

    async def dispatch(self, request: Request, call_next: Callable) -> JSONResponse:
        path: str = request.url.path
        if path in EXEMPT_PREFIXES or path.startswith("/docs"):
            return await call_next(request)  # type: ignore[no-any-return]
        limit, window = limit_for(path)
        ip: str = request.client.host if request.client else "unknown"
        ok, retry_after = self._tracker.allowed(
            f"{ip}:{bucket_for(path)}", limit, window, time.monotonic()
        )
        if not ok:
            wait: int = int(retry_after) + 1
            return JSONResponse(
                status_code=429,
                content={"detail": f"Rate limit exceeded, retry in {wait}s"},
                headers={"Retry-After": str(wait)},
            )
        return await call_next(request)  # type: ignore[no-any-return]
