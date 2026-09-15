"""
A password that can be set can be used to sign in (T169).

The request models disagreed about how long a password may be: setting one —
registering, being added by the administrator, changing your own — allowed 1024
characters, while signing in (and first-run setup) allowed 400. A long
generated passphrase between the two was accepted when it was set and then
refused at sign-in as `string_too_long` before it was ever checked, which
locks the account out for good. One limit now, read by every model that takes
a password, and a test that every one of them uses it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection

SHORT = "correct-horse-battery"
LONG = "a long generated passphrase " * 20  # 560 characters


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")


def test_a_long_password_set_by_changing_it_still_signs_in(client):
    assert 400 < len(LONG) <= 1024
    assert client.post("/api/auth/setup", json={
        "email": "long@lab.local", "display_name": "Long", "password": SHORT}).status_code == 200

    changed = client.post("/api/auth/password", json={
        "current_password": SHORT, "new_password": LONG})
    assert changed.status_code == 200, changed.text

    client.post("/api/auth/logout")
    back = client.post("/api/auth/login", json={"email": "long@lab.local", "password": LONG})
    assert back.status_code == 200, back.text


def test_first_run_setup_accepts_the_same_length(client):
    made = client.post("/api/auth/setup", json={
        "email": "long@lab.local", "display_name": "Long", "password": LONG})
    assert made.status_code == 200, made.text


def test_every_request_that_takes_a_password_agrees_on_its_length():
    """So the next model written cannot reopen this by choosing its own number."""
    import importlib

    # By module name: `from throughline_api import app` is the FastAPI object.
    app_module = importlib.import_module("throughline_api.app")

    limits = {}
    for model in (app_module.SetupRequest, app_module.LoginRequest, app_module.RegisterRequest,
                  app_module.NewAccount, app_module.PasswordChange):
        for name, field in model.model_fields.items():
            if "password" in name:
                longest = [m.max_length for m in field.metadata if hasattr(m, "max_length")]
                limits[f"{model.__name__}.{name}"] = longest[0] if longest else None
    assert len(set(limits.values())) == 1, limits
