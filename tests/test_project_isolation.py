"""
One account's project is not reachable from another's session.

Every route that takes a `project_id` has to check that the signed-in user owns
it. The check is one call — `scoped_project` — and forgetting it is invisible:
the route works perfectly for the person who wrote it, because they only ever
try it on their own project.

`POST /artifacts/{id}/presentation` had forgotten it, and answered **201** to a
second account: a report belonging to somebody else was re-cut as a talk, and
the new artifact was created inside their project. The domain looked like it
was guarding the boundary — `draft_presentation_from_report` refuses a report
from a different project — but the route passed it the report's *own*
project_id, so the comparison was against itself and always passed.

So this file asks every project-taking route the same question from a second
account, and reads the answer as a status code rather than by inspecting the
source: a route can be scoped by a dependency, by a helper, or by the domain,
and only the answer settles it.
"""

from __future__ import annotations

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


def _first_account(client) -> str:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": "owner@lab.local", "display_name": "Owner",
        "password": "correct-horse-battery"}).status_code == 200
    return client.post("/api/projects", json={"name": "Mine"}).json()["id"]


def _second_account(client) -> None:
    with connection() as conn, conn.cursor() as cur:
        from throughline_domain import auth
        auth.create_user(cur, email="other@lab.local", display_name="Other",
                         password="correct-horse-battery")
    assert client.post("/api/auth/login", json={
        "email": "other@lab.local",
        "password": "correct-horse-battery"}).status_code == 200


#: Routes that name a project, and a body good enough to get past validation.
#:
#: A 422 would mean the request never reached the ownership check, so each body
#: here is one the route would accept from its owner.
ROUTES = [
    ("get", "/api/projects/{p}/board", None),
    ("get", "/api/projects/{p}/board/available", None),
    ("put", "/api/projects/{p}/board",
     {"object_id": "obj_1", "x": 0, "y": 0, "width": 10, "height": 10}),
    ("post", "/api/projects/{p}/board/obj_1/front", None),
    ("delete", "/api/projects/{p}/board/obj_1", None),
    ("get", "/api/projects/{p}/artifacts", None),
    ("post", "/api/projects/{p}/artifacts/draft",
     {"connection_id": "conn_1", "audience": "journal"}),
    ("get", "/api/projects/{p}/citations/verify", None),
    ("post", "/api/projects/{p}/marks",
     {"source_id": "src_1", "page": 1, "kind": "underline",
      "points": [{"x": 10.0, "y": 20.0}, {"x": 30.0, "y": 20.0}]}),
    ("delete", "/api/projects/{p}/marks/mrk_1", None),
    ("get", "/api/projects/{p}/excerpts", None),
    ("post", "/api/projects/{p}/excerpts",
     {"source_id": "src_1", "page": 1,
      "region": {"x": 10.0, "y": 20.0, "width": 100.0, "height": 40.0},
      "citation": "Karim 2019, p. 3"}),
]


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_another_account_cannot_reach_this_project(client, method, path, body):
    """
    404 rather than 403: whether a project exists is itself something only its
    owner is entitled to know.
    """
    project_id = _first_account(client)
    _second_account(client)

    url = path.format(p=project_id)
    call = getattr(client, method)
    answer = call(url, json=body) if body is not None else call(url)

    assert answer.status_code == 404, (
        f"{method.upper()} {path} answered {answer.status_code} to another "
        f"account: {answer.text[:200]}")


def test_another_account_cannot_recut_someone_elses_report(client):
    """
    The one that was actually open, kept as its own case because the artifact
    routes are keyed by artifact rather than by project — the id in the path
    says nothing about who owns it.
    """
    from throughline_domain import communication

    project_id = _first_account(client)
    with connection() as conn, conn.cursor() as cur:
        report_id = communication.create_artifact(
            cur, project_id=project_id, artifact_type="report",
            title="Mine", audience="journal", purpose="report the finding")

    _second_account(client)
    answer = client.post(f"/api/artifacts/{report_id}/presentation")
    assert answer.status_code == 404, (
        f"another account re-cut this report: {answer.status_code} {answer.text}")
