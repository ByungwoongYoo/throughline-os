"""
The provenance log is a file, and it belongs to the project that asked.

The domain writes it and `test_the_provenance_log` covers what it says. This
covers the half that made §74 a defect twice: a capability with no route, or a
route with no control, is a capability nobody has.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_users():
    yield
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        conn.commit()


def _account(client) -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": f"prov-{uuid.uuid4().hex[:8]}@lab.local",
        "display_name": "Lead", "password": "correct-horse-battery",
    }).status_code == 200


def _finding_in(client, project_id: str, title: str) -> str:
    return client.post(f"/api/projects/{project_id}/findings", json={
        "title": title, "finding_type": "statistical",
    }).json()["finding_id"]


def test_it_arrives_as_a_file(client):
    _account(client)
    project_id = client.post("/api/projects",
                             json={"name": "Prov"}).json()["id"]
    finding_id = _finding_in(client, project_id, "Consumption and resistance")

    response = client.get(f"/api/findings/{finding_id}/provenance.md")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/markdown")
    assert "attachment" in response.headers["content-disposition"]
    assert finding_id in response.headers["content-disposition"]
    assert "Consumption and resistance" in response.text


def test_a_finding_written_by_hand_says_there_is_nothing_to_reproduce(client):
    """
    Not an empty file. A log that stopped after the heading reads like an
    export that failed, and the honest answer is that this finding was written
    down rather than computed.
    """
    _account(client)
    project_id = client.post("/api/projects",
                             json={"name": "Prov"}).json()["id"]
    finding_id = _finding_in(client, project_id, "A hunch")

    text = client.get(f"/api/findings/{finding_id}/provenance.md").text
    assert "No analysis is recorded" in text


def test_a_finding_that_does_not_exist_is_a_404(client):
    _account(client)
    assert client.get("/api/findings/fnd_nope/provenance.md").status_code == 404


def test_it_is_refused_to_somebody_else(client):
    """
    Scoped like every other project route. A provenance log names variables,
    questions and file hashes, which is exactly what a stranger should not be
    handed.
    """
    _account(client)
    project_id = client.post("/api/projects",
                             json={"name": "Mine"}).json()["id"]
    finding_id = _finding_in(client, project_id, "Private")

    # A real second account, signed in — the same way `test_project_isolation`
    # does it. My first attempt reassigned the project to an invented user id
    # and hit the foreign key, which tested the database rather than the route.
    with connection() as conn, conn.cursor() as cur:
        from throughline_domain import auth
        auth.create_user(cur, email="other@lab.local", display_name="Other",
                         password="correct-horse-battery")
        conn.commit()
    assert client.post("/api/auth/login", json={
        "email": "other@lab.local",
        "password": "correct-horse-battery"}).status_code == 200

    assert client.get(
        f"/api/findings/{finding_id}/provenance.md").status_code in (403, 404)
