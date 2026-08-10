"""
Transport and abuse protections (§99).

Each test here corresponds to a specific way the platform was unsafe the moment
it stopped being a localhost toy, and two of them cover bugs found by running
the thing rather than reading it.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient
from throughline_api import security


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def fresh_limiter(monkeypatch):
    """Each test gets its own counters, so ordering cannot couple them."""
    monkeypatch.setattr(security, "_limiter", security.RateLimiter())


def test_secure_cookie_is_on_unless_the_deployment_says_local(monkeypatch):
    """
    The flag was hardcoded False, which is right on localhost and silently wrong
    anywhere else — the session token would travel in clear text with nothing in
    the interface saying so.
    """
    monkeypatch.setenv("THROUGHLINE_DEPLOYMENT", "hosted")
    assert security.session_cookie_kwargs()["secure"] is True

    monkeypatch.setenv("THROUGHLINE_DEPLOYMENT", "local")
    assert security.session_cookie_kwargs()["secure"] is False

    # Absent configuration must not silently mean "hosted with no TLS".
    monkeypatch.delenv("THROUGHLINE_DEPLOYMENT", raising=False)
    assert security.session_cookie_kwargs()["secure"] is False
    assert security.session_cookie_kwargs()["httponly"] is True
    assert security.session_cookie_kwargs()["samesite"] == "strict"


def test_login_is_throttled_before_a_password_can_be_guessed():
    limiter = security.RateLimiter()
    route = "/api/auth/login"
    limit = security.LIMITS[route]

    for _ in range(limit.requests):
        allowed, _ = limiter.check(key="1.2.3.4", route=route)
        assert allowed

    allowed, retry_after = limiter.check(key="1.2.3.4", route=route)
    assert not allowed
    assert retry_after > 0


def test_throttling_is_per_client_not_global():
    """One noisy client must not lock everyone else out."""
    limiter = security.RateLimiter()
    route = "/api/auth/login"
    for _ in range(security.LIMITS[route].requests + 1):
        limiter.check(key="attacker", route=route)

    allowed, _ = limiter.check(key="researcher", route=route)
    assert allowed


def test_throttling_is_per_route():
    """Exhausting login must not block reading a project."""
    limiter = security.RateLimiter()
    for _ in range(security.LIMITS["/api/auth/login"].requests + 1):
        limiter.check(key="same", route="/api/auth/login")

    allowed, _ = limiter.check(key="same", route="/api/projects")
    assert allowed


def test_a_forwarded_header_is_ignored_unless_a_proxy_is_declared(monkeypatch):
    """
    Trusting X-Forwarded-For unconditionally would let a caller pick their own
    bucket and rotate past the limiter entirely.
    """
    class FakeClient:
        host = "10.0.0.1"

    class FakeRequest:
        headers = {"x-forwarded-for": "9.9.9.9"}
        client = FakeClient()

    monkeypatch.delenv("THROUGHLINE_TRUST_PROXY", raising=False)
    assert security.client_key(FakeRequest()) == "10.0.0.1"

    monkeypatch.setenv("THROUGHLINE_TRUST_PROXY", "true")
    assert security.client_key(FakeRequest()) == "9.9.9.9"


def test_security_headers_are_applied():
    from fastapi.responses import JSONResponse

    response = JSONResponse(content={})
    security._apply_headers(response)

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert "default-src 'self'" in response.headers["Content-Security-Policy"]


def test_hsts_is_not_sent_from_a_local_install(monkeypatch):
    """
    HSTS from a plain-HTTP local install would pin the browser to a scheme that
    is not served, locking the researcher out of their own machine.
    """
    from fastapi.responses import JSONResponse

    monkeypatch.setenv("THROUGHLINE_DEPLOYMENT", "local")
    response = JSONResponse(content={})
    security._apply_headers(response)
    assert "Strict-Transport-Security" not in response.headers

    monkeypatch.setenv("THROUGHLINE_DEPLOYMENT", "hosted")
    hosted = JSONResponse(content={})
    security._apply_headers(hosted)
    assert "max-age=" in hosted.headers["Strict-Transport-Security"]


def test_a_throttled_request_answers_429_not_500(client, monkeypatch):
    """
    Found by running it. Raising HTTPException inside BaseHTTPMiddleware never
    reaches FastAPI's handlers, so the caller saw 500 — which reads as a server
    fault, so a client retries immediately instead of backing off.
    """
    # Enabled explicitly: it is off under pytest so that the rest of the suite
    # is not throttled by shared process-global counters.
    monkeypatch.setenv("THROUGHLINE_RATE_LIMIT", "on")

    codes = []
    for _ in range(security.LIMITS["/api/auth/login"].requests + 2):
        response = client.post("/api/auth/login",
                               json={"email": "x@y.z", "password": "wrong"})
        codes.append(response.status_code)

    assert 429 in codes
    assert 500 not in codes
    throttled = next(c for c in codes if c == 429)
    assert throttled == 429


def test_rate_limiting_is_off_under_pytest_by_default(monkeypatch):
    """
    The suite must not be throttled by its own traffic.

    Introducing the limiter broke ten unrelated tests for exactly this reason:
    process-global counters plus hundreds of calls from one host.
    """
    monkeypatch.delenv("THROUGHLINE_RATE_LIMIT", raising=False)
    assert security.rate_limiting_enabled() is False

    monkeypatch.setenv("THROUGHLINE_RATE_LIMIT", "on")
    assert security.rate_limiting_enabled() is True
