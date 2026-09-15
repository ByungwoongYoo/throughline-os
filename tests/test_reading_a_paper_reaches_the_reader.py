"""
`POST /api/sources/{id}/claims` answered 500 to every call for a month.

The route took a `force` query parameter and handed it to
`claim_test.locate_claims`, which has never had one — so the call raised
`TypeError` before reaching any of the function's own logic, and the researcher
who chose a paper got an error envelope where its claims should have been. It
was also redundant: reading the record and re-reading the paper are separate
acts on separate routes, and a POST here *is* the re-read.

Nothing caught it, and the reasons are worth writing down because they are the
same reasons the next one will survive.

Every test of this area calls `claim_test.locate_claims` directly, so the
mismatch between the route and the function it calls was invisible to all of
them. The interface's own tests mock the API. The route-reachability guard asks
whether a path is served, and this path is served — it just cannot be called.
And the parameter was passed by nobody, so no test ever set it.

It was found by opening the running app and choosing a paper, which is the only
thing that was ever going to find it.

So the guard here is the one call none of those make: the route itself, over
HTTP, against a real database. It uses a source with no indexed passages
because that path returns before any model is consulted — the failure being
guarded lives in the call, not in the reading, so the cheapest input that
exercises the call is the right one.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection


@pytest.fixture()
def client():
    """A signed-in client that leaves the database as it found it.

    The teardown is not tidiness. One database is shared by the whole backend
    suite and these HTTP tests commit real rows (D338), so a file that leaves an
    account behind turns `needs_setup` false for every file after it — and the
    files after it sign in with `POST /auth/login` for an account they expect to
    have just created, which then answers 401. Leaving this file's user in place
    did exactly that to `test_registered_analysis`, whose own fixture clears
    users for the same reason.
    """
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        conn.commit()


@pytest.fixture(autouse=True)
def serving():
    """The HTTP tests commit real rows; the transaction fixtures do not apply."""
    yield


def _account(client) -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status.get("needs_setup") else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": "reader@lab.local",
        "password": "a-long-enough-passphrase",
        "display_name": "Reader",
    }).status_code in (200, 201)


def _project(client) -> str:
    return client.post("/api/projects",
                       json={"name": "Reading", "research_question": "Can it be read?"}
                       ).json()["id"]


def _paper_without_passages(project_id: str) -> str:
    source_id = f"src_{uuid.uuid4().hex[:16]}"
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sources(id, project_id, title, source_type, "
            "ingestion_status, trust_level) "
            "VALUES (%s, %s, %s, 'paper', 'parsing', 'untrusted')",
            (source_id, project_id, "still_being_read.pdf"))
        conn.commit()
    return source_id


def test_reading_a_paper_does_not_fail_inside_the_route(client, serving):
    """A 500 here is the interface's fault, not the paper's.

    The distinction matters to the researcher: 400 means *this paper has no
    readable text yet*, which they can act on, and 500 means the product is
    broken, which they cannot. Before the fix every call was the second.
    """
    _account(client)
    project_id = _project(client)
    source_id = _paper_without_passages(project_id)

    response = client.post(
        f"/api/sources/{source_id}/claims?project_id={project_id}", json={})

    assert response.status_code != 500, (
        "reading a paper failed inside the route: " + response.text[:400])
    assert response.status_code == 400, response.text
    assert "passages" in response.text


def test_the_route_refuses_a_source_from_another_project(client, serving):
    """The scoping check still runs, which is what reaching the function means.

    Asserted beside the test above because the two failures look alike from
    outside and are not: this one proves the call arrived and the function's own
    guards ran, rather than the request dying on the way in.
    """
    _account(client)
    mine = _project(client)
    theirs = _project(client)
    source_id = _paper_without_passages(theirs)

    response = client.post(
        f"/api/sources/{source_id}/claims?project_id={mine}", json={})

    assert response.status_code == 400, response.text
    assert "different project" in response.text
