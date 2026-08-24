"""
Choosing a hosted model over the API (§98, §111).

Two properties, and both are the kind that fail silently.

**The key is write-only.** Nothing the API returns may contain it. A credential
that leaks into one JSON response is a credential in a browser cache, a proxy
log and a bug report, and no test after the fact can put it back.

**A selection that cannot work does not stick.** The existing rule for Ollama
is that a model which is not installed is refused, because accepting it makes a
system that looks configured and fails at the moment of use. A hosted provider
with a rejected key is the same failure wearing a different hat.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection

# Shaped like a real credential so masking is exercised; not one.
SAMPLE = "sk-ant-api03-000000000000000000000000000000000000EXAMPLE"


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean():
    yield
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        cur.execute("DELETE FROM installation_secrets")


def _account(client) -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    client.post(endpoint, json={"email": "lead@lab.local",
                                "display_name": "Lead",
                                "password": "correct-horse-battery"})


def test_the_hosted_option_is_described_before_a_key_exists(client):
    """
    It was already built and reachable only through an environment variable —
    the one choice with a privacy consequence was the one the interface would
    not discuss.
    """
    _account(client)
    hosted = client.get("/api/system/models").json()["hosted"]

    assert hosted["local"] is False
    assert hosted["key_saved"] is False
    assert hosted["key_hint"] is None
    # The misunderstanding worth pre-empting: this is API billing, and a
    # subscription cannot be spent by an application.
    assert "subscription" in hosted["billed"].lower()
    assert "sent to" in hosted["warning"].lower()


def test_saving_a_key_never_returns_it(client):
    _account(client)
    response = client.put("/api/system/model-key", json={"api_key": SAMPLE})

    assert response.status_code == 200
    assert SAMPLE not in response.text
    body = response.json()
    assert body["key_saved"] is True
    assert body["key_hint"] == "…MPLE"


def test_no_response_anywhere_carries_the_key(client):
    """
    Checked against the whole payload rather than the field that was meant to
    hold it — a leak is only interesting when it appears somewhere nobody
    thought to look.
    """
    _account(client)
    client.put("/api/system/model-key", json={"api_key": SAMPLE})

    for path in ("/api/system/models", "/api/system/capabilities"):
        response = client.get(path)
        assert SAMPLE not in response.text, path


def test_saving_a_key_does_not_move_the_model(client):
    """
    Having a credential is not a decision to send unpublished research off the
    machine. If saving one selected the hosted model, that decision would be
    made as a side effect of a different action.
    """
    _account(client)
    before = client.get("/api/system/models").json()["selection"]["provider"]
    client.put("/api/system/model-key", json={"api_key": SAMPLE})
    after = client.get("/api/system/models").json()["selection"]["provider"]

    assert after == before


def test_a_blank_key_is_refused(client):
    _account(client)
    assert client.put("/api/system/model-key",
                      json={"api_key": "   "}).status_code == 400


def test_the_hosted_model_cannot_be_selected_without_a_key(client, monkeypatch):
    """
    Otherwise the system reports a model it has no way of reaching, which is
    exactly the fake capability the Ollama branch already refuses.
    """
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    _account(client)
    response = client.put("/api/system/models",
                          json={"provider": "anthropic", "model": "claude-opus-5"})

    assert response.status_code == 400
    assert "key" in response.text.lower()


def test_a_key_that_does_not_work_leaves_the_selection_alone(client):
    """
    The important half. A wrong key is not a configuration error the researcher
    can see — it is an authentication failure that happens later, inside a
    feature, having already moved the system off the local model.
    """
    _account(client)
    client.put("/api/system/model-key", json={"api_key": SAMPLE})

    before = client.get("/api/system/models").json()["selection"]
    response = client.put("/api/system/models",
                          json={"provider": "anthropic", "model": "claude-opus-5"})
    after = client.get("/api/system/models").json()["selection"]

    assert response.status_code == 400
    assert after["provider"] == before["provider"]
    assert SAMPLE not in response.text


def test_removing_a_key_removes_it(client):
    _account(client)
    client.put("/api/system/model-key", json={"api_key": SAMPLE})
    response = client.delete("/api/system/model-key")

    assert response.status_code == 200
    assert response.json()["key_saved"] is False
    assert client.get("/api/system/models").json()["hosted"]["key_saved"] is False


def test_removing_a_key_needs_an_account(client):
    """
    An unauthenticated caller must not be able to delete the installation's
    credential — a denial of service on every feature that needs a model.
    """
    assert client.delete("/api/system/model-key").status_code == 401
    assert client.put("/api/system/model-key",
                      json={"api_key": SAMPLE}).status_code == 401
