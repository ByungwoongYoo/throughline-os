"""
Transport and abuse protections (§99).

Everything here is about the gap between "runs on my laptop" and "reachable by
anything else". Locally most of it is unnecessary; the moment the API binds to
anything but loopback, each of these is the difference between a research
corpus that is private and one that is not.

The design rule throughout: **secure by default, relaxed only by an explicit
opt-out.** The previous cookie code hardcoded `secure=False`, which is correct
on `http://localhost` and silently wrong everywhere else — and nothing in the
interface would have told the researcher. Defaults that are safe in the
dangerous case and merely inconvenient in the safe one are the right way round.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


def deployment_is_local() -> bool:
    """
    Is this installation only reachable from this machine?

    Read from an explicit environment variable rather than inferred from the
    bind address, because inference fails in exactly the case that matters — a
    reverse proxy in front of a loopback bind looks local and is not.
    """
    return os.environ.get("THROUGHLINE_DEPLOYMENT", "local").lower() == "local"


def session_cookie_kwargs() -> dict[str, object]:
    """
    Cookie flags appropriate to the deployment.

    `secure` is on unless the deployment declares itself local. A session cookie
    without it travels in clear text over any plain-HTTP hop, and the researcher
    has no way to observe that happening.
    """
    return {
        "httponly": True,
        "samesite": "strict",
        "secure": not deployment_is_local(),
        "path": "/",
    }


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Limit:
    requests: int
    window_seconds: int


# Login is the one endpoint where an attacker gets unlimited free guesses, and
# PBKDF2 at 600k rounds makes each attempt expensive for the *server* too — so
# an unthrottled login is both a credential risk and a denial-of-service one.
#
# The analysis limits are lower because each starts a sandboxed subprocess; a
# loop over that endpoint would exhaust the machine rather than merely annoy it.
LIMITS: dict[str, Limit] = {
    "/api/auth/login": Limit(10, 300),
    "/api/auth/setup": Limit(5, 3600),
    "/api/projects/{project_id}/discoveries": Limit(20, 3600),
    "/api/projects/{project_id}/analyses": Limit(60, 3600),
    "__default__": Limit(600, 60),
}


class RateLimiter:
    """
    A fixed-window counter held in memory.

    In-memory is correct for a single-node deployment and wrong for several, so
    this is deliberately simple rather than pretending to be distributed. A
    multi-node deployment needs Redis, and a limiter that silently failed to
    coordinate would be worse than none — it would read as protection while
    allowing N times the traffic.
    """

    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    def check(self, *, key: str, route: str) -> tuple[bool, int]:
        limit = LIMITS.get(route, LIMITS["__default__"])
        now = time.monotonic()
        bucket = self._hits[(key, route)]

        cutoff = now - limit.window_seconds
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        if len(bucket) >= limit.requests:
            retry_after = int(bucket[0] + limit.window_seconds - now) + 1
            return False, max(retry_after, 1)

        bucket.append(now)
        return True, 0


_limiter = RateLimiter()


def client_key(request: Request) -> str:
    """
    Who to count against.

    `X-Forwarded-For` is trusted only when the deployment declares itself to be
    behind a proxy. Trusting it unconditionally would let any caller set their
    own bucket and bypass the limiter entirely by rotating the header.
    """
    if os.environ.get("THROUGHLINE_TRUST_PROXY", "").lower() in ("1", "true", "yes"):
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class SecurityMiddleware(BaseHTTPMiddleware):
    """Rate limiting plus the response headers a browser needs (§99)."""

    async def dispatch(self, request: Request, call_next):  # noqa: ANN001
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)

        allowed, retry_after = _limiter.check(
            key=client_key(request), route=route_path)
        if not allowed:
            # 429 with Retry-After, so a well-behaved client backs off rather
            # than retrying immediately and making the situation worse.
            raise HTTPException(
                429,
                f"Too many requests to {route_path}. Try again in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )

        response: Response = await call_next(request)
        _apply_headers(response)
        return response


def _apply_headers(response: Response) -> None:
    """
    Response headers that close browser-side attack surface.

    The CSP is restrictive because this application needs nothing from another
    origin: the web client is same-origin, figures are rendered server-side, and
    there is no third-party analytics. A permissive policy would buy nothing and
    would leave an XSS able to exfiltrate a research corpus.
    """
    headers = response.headers
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("X-Frame-Options", "DENY")
    headers.setdefault("Referrer-Policy", "no-referrer")
    headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    headers.setdefault(
        "Permissions-Policy",
        "geolocation=(), microphone=(), camera=(), payment=(), usb=()")
    headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; "
        # Next's development build needs inline and eval; production does not,
        # so the policy tightens automatically rather than staying loose.
        + ("script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
           if os.environ.get("NODE_ENV") != "production" else "script-src 'self'; ")
        + "style-src 'self' 'unsafe-inline'; "
          "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; "
          "form-action 'self'")

    if not deployment_is_local():
        # Only meaningful over HTTPS, and actively harmful to send from a plain
        # local install where it would pin a browser to a scheme that is not served.
        headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains")


__all__ = ["LIMITS", "Limit", "RateLimiter", "SecurityMiddleware",
           "client_key", "deployment_is_local", "session_cookie_kwargs"]
