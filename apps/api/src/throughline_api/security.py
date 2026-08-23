"""
Transport and abuse protections.

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

from fastapi.responses import JSONResponse
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


# Whether a limit protects the network or protects this machine is not the same
# question, and only the first kind is pointless on a local install.
#
# Login and setup exist to deny an attacker free password guesses. On an install
# reachable from this keyboard and nowhere else there is no such attacker, and
# the likely event is the researcher mistyping their own long password — so ten
# attempts per five minutes locks them out of their own corpus to prevent
# nothing. Those two relax when the deployment declares itself local.
#
# The discovery and analysis limits deliberately do NOT appear here. They are not
# about credentials: each request starts a sandboxed subprocess, and a loop over
# them exhausts this machine whether or not anyone else can reach it. Relaxing
# those locally would remove the protection exactly where it still applies.
#
# Relaxed is still bounded. A runaway script on this machine should meet a wall
# eventually, because each attempt costs 600k PBKDF2 rounds of real CPU.
LOCAL_LIMITS: dict[str, Limit] = {
    "/api/auth/login": Limit(100, 300),
    "/api/auth/setup": Limit(30, 3600),
}


def limit_for(route: str) -> Limit:
    """
    The limit in force for a route, given the deployment.

    Keyed off :func:`deployment_is_local` rather than the caller's address, for
    the reason that function already documents: a reverse proxy in front of a
    loopback bind makes every request look local, so reading it off the
    connection would relax the credential limits in precisely the deployment
    that needs them kept.
    """
    if deployment_is_local():
        relaxed = LOCAL_LIMITS.get(route)
        if relaxed is not None:
            return relaxed
    return LIMITS.get(route, LIMITS["__default__"])


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
        limit = limit_for(route)
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


def rate_limiting_enabled() -> bool:
    """
    Whether to throttle at all.

    Off by default under pytest. The limiter is process-global by design, so a
    test suite making hundreds of calls from one host trips it and fails tests
    that have nothing to do with rate limiting — which is exactly what happened
    when it was introduced. The dedicated security tests drive the limiter
    directly instead, so coverage does not depend on it being on globally.
    """
    setting = os.environ.get("THROUGHLINE_RATE_LIMIT", "").lower()
    if setting in ("off", "0", "false", "disabled"):
        return False
    if setting in ("on", "1", "true", "enabled"):
        return True
    return "PYTEST_CURRENT_TEST" not in os.environ


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
    """Rate limiting plus the response headers a browser needs."""

    async def dispatch(self, request: Request, call_next):  # noqa: ANN001
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)

        allowed, retry_after = (
            _limiter.check(key=client_key(request), route=route_path)
            if rate_limiting_enabled() else (True, 0))
        if not allowed:
            # Returned, not raised.
            #
            # An HTTPException raised inside BaseHTTPMiddleware never reaches
            # FastAPI's exception handlers — it propagates as an unhandled error
            # and the caller sees 500. A rate limiter that reports a server
            # fault is worse than none: 500 tells a well-behaved client the
            # server is broken, so it retries immediately and makes the load it
            # was being asked to reduce.
            #
            # Retry-After is the whole point of answering 429 at all.
            throttled = JSONResponse(
                status_code=429,
                content={"detail": f"Too many requests to {route_path}. "
                                   f"Try again in {retry_after}s."},
                headers={"Retry-After": str(retry_after)},
            )
            _apply_headers(throttled)
            return throttled

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
        # Next's development build needs inline and eval; a deployment does
        # not, so the policy tightens for one and stays loose for the other.
        #
        # Gated on the deployment, not on NODE_ENV. It read NODE_ENV first,
        # which this process never sets — it is a Python process, and the
        # Next.js process that does set it has its own environment. So the
        # comparison was always `None != "production"`, the branch always took
        # the permissive arm, and every deployment shipped 'unsafe-inline' and
        # 'unsafe-eval' while the comment above it said the policy tightened
        # automatically. A security control that silently never engages is
        # worse than none, because nobody goes looking for it.
        #
        # `deployment_is_local()` reads THROUGHLINE_DEPLOYMENT, which is set
        # and read consistently across this codebase and already decides the
        # cookie's Secure flag and the HSTS header below.
        + ("script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
           if deployment_is_local() else "script-src 'self'; ")
        + "style-src 'self' 'unsafe-inline'; "
          "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; "
          "form-action 'self'")

    if not deployment_is_local():
        # Only meaningful over HTTPS, and actively harmful to send from a plain
        # local install where it would pin a browser to a scheme that is not served.
        headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains")


__all__ = ["LIMITS", "LOCAL_LIMITS", "Limit", "RateLimiter", "SecurityMiddleware",
           "client_key", "deployment_is_local", "limit_for",
           "session_cookie_kwargs"]
