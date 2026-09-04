"""
The routes that make versioning reachable at all.

`update_object` and `new_version` were correct and called by nothing outside
the tests, so a researcher could not edit a research object and the mechanism
that keeps an edit safe when other work cites it was written by no production
path. These are the three operations that change that: edit, read the chain,
go back.
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
        "email": f"ver-{uuid.uuid4().hex[:8]}@lab.local",
        "display_name": "Lead", "password": "correct-horse-battery",
    }).status_code == 200


def _project(client) -> str:
    return client.post("/api/projects", json={"name": "Versions"}).json()["id"]


def _object(client, project_id, title="First", derived_from=None) -> str:
    body = {"object_type": "finding", "title": title, "description": "First body"}
    if derived_from:
        body["derived_from"] = derived_from
    response = client.post(f"/api/projects/{project_id}/objects", json=body)
    assert response.status_code == 201, response.text
    return response.json()["object_id"]


def test_an_object_can_be_edited(client):
    _account(client)
    project_id = _project(client)
    object_id = _object(client, project_id)

    response = client.patch(f"/api/projects/{project_id}/objects/{object_id}",
                            json={"title": "Second"})

    assert response.status_code == 200, response.text
    assert response.json()["versioned"] is False


def test_an_edit_to_something_other_work_cites_makes_a_version(client):
    _account(client)
    project_id = _project(client)
    parent = _object(client, project_id)
    _object(client, project_id, title="Downstream", derived_from=[parent])

    body = client.patch(f"/api/projects/{project_id}/objects/{parent}",
                        json={"title": "Second"}).json()

    assert body["versioned"] is True
    assert body["object_id"] != parent
    assert "still stands where it was cited" in body["note"]


def test_the_versions_can_be_read(client):
    _account(client)
    project_id = _project(client)
    parent = _object(client, project_id)
    _object(client, project_id, title="Downstream", derived_from=[parent])
    client.patch(f"/api/projects/{project_id}/objects/{parent}",
                 json={"title": "Second"})

    body = client.get(
        f"/api/projects/{project_id}/objects/{parent}/versions").json()

    assert [v["title"] for v in body["versions"]] == ["First", "Second"]
    assert body["current"] == body["versions"][-1]["id"]


def test_an_earlier_version_can_be_restored(client):
    _account(client)
    project_id = _project(client)
    parent = _object(client, project_id)
    _object(client, project_id, title="Downstream", derived_from=[parent])
    client.patch(f"/api/projects/{project_id}/objects/{parent}",
                 json={"title": "Second"})

    response = client.post(f"/api/projects/{project_id}/objects/{parent}/restore",
                           json={"version_id": parent})

    assert response.status_code == 201, response.text
    assert "Nothing was deleted" in response.json()["note"]
    titles = [v["title"] for v in client.get(
        f"/api/projects/{project_id}/objects/{parent}/versions").json()["versions"]]
    assert titles == ["First", "Second", "First"]


def test_restoring_the_current_version_is_a_422_with_a_reason(client):
    _account(client)
    project_id = _project(client)
    object_id = _object(client, project_id)

    response = client.post(
        f"/api/projects/{project_id}/objects/{object_id}/restore",
        json={"version_id": object_id})

    assert response.status_code == 422
    assert "already the current version" in response.json()["detail"]


def test_a_version_from_another_object_is_a_422(client):
    _account(client)
    project_id = _project(client)
    mine = _object(client, project_id)
    other = _object(client, project_id, title="Unrelated")

    response = client.post(f"/api/projects/{project_id}/objects/{mine}/restore",
                           json={"version_id": other})

    assert response.status_code == 422
    assert "does not belong" in response.json()["detail"]


def test_another_projects_object_is_not_found(client):
    _account(client)
    project_id = _project(client)

    assert client.get(
        f"/api/projects/{project_id}/objects/obj_elsewhere/versions"
    ).status_code == 404
    assert client.patch(
        f"/api/projects/{project_id}/objects/obj_elsewhere", json={"title": "x"}
    ).status_code == 404


def test_editing_needs_an_account(client):
    _account(client)
    project_id = _project(client)
    object_id = _object(client, project_id)
    client.post("/api/auth/logout")

    assert client.patch(f"/api/projects/{project_id}/objects/{object_id}",
                        json={"title": "x"}).status_code == 401


def test_the_edit_and_the_restore_reach_the_activity_record(client):
    """
    §43's Activity screen is the reader for this. An edit nobody can see in
    the history is the defect this whole area exists to close.
    """
    _account(client)
    project_id = _project(client)
    parent = _object(client, project_id)
    _object(client, project_id, title="Downstream", derived_from=[parent])
    client.patch(f"/api/projects/{project_id}/objects/{parent}",
                 json={"title": "Second"})
    client.post(f"/api/projects/{project_id}/objects/{parent}/restore",
                json={"version_id": parent})

    actions = {entry["action"] for entry in client.get(
        f"/api/projects/{project_id}/activity").json()["entries"]}

    assert {"edited", "restored"} <= actions
