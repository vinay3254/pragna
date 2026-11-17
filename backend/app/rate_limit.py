import time
from collections import defaultdict, deque

import jwt
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

WINDOW_SECONDS = 60
DEFAULT_LIMIT = 60
AUTH_LIMIT = 10
DESIGN_LIMIT = 240
DESIGN_AI_LIMIT = 20
AUTH_PREFIX = "/api/auth"
EXEMPT_PATHS = {"/api/health"}


def _client_key(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer "):]
        try:
            secret = request.app.state.settings.jwt_secret
            payload = jwt.decode(token, secret, algorithms=["HS256"])
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except jwt.PyJWTError:
            pass
    client = request.client
    return f"ip:{client.host if client else 'unknown'}"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory sliding-window limiter, one bucket store per app instance.

    Resets on process restart and isn't shared across worker processes --
    fine for a single-process deployment, but won't enforce a global limit
    if scaled to multiple workers.
    """

    def __init__(self, app):
        super().__init__(app)
        self._hits: dict[str, deque] = defaultdict(deque)

    def _check(self, key: str, limit: int) -> tuple[bool, int]:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and hits[0] <= now - WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= limit:
            retry_after = int(WINDOW_SECONDS - (now - hits[0])) + 1
            return False, retry_after
        hits.append(now)
        return True, 0

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method == "OPTIONS" or path in EXEMPT_PATHS or not path.startswith("/api"):
            return await call_next(request)

        is_auth_path = path.startswith(AUTH_PREFIX)
        limit = AUTH_LIMIT if is_auth_path else DEFAULT_LIMIT
        bucket = "auth" if is_auth_path else "api"
        # Canvas saves, collaboration polls and imports create more requests than chat.
        # Give model calls a separate smaller bucket; preserve the other app limits.
        if path.startswith('/api/design/'):
            ai = request.method == 'POST' and path.rsplit('/',1)[-1] in {'generate','edit','regenerate','assistant'}
            limit = DESIGN_AI_LIMIT if ai else DESIGN_LIMIT
            bucket = 'design-ai' if ai else 'design'
        key = f"{bucket}:{_client_key(request)}"

        allowed, retry_after = self._check(key, limit)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please slow down."},
                headers={"Retry-After": str(retry_after)},
            )
        return await call_next(request)
