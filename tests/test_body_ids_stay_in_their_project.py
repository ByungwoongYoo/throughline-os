"""
An id in a request body belongs to the project in the path, or it is refused.

T161 closed the routes that checked the caller could see `project_id` and then
read an object *named in the path* by id alone. The same shape lives in request
bodies, where it is easier to miss: the route scopes the project, then hands a
`source_id`, `finding_id` or `enquiry_id` from the JSON to a domain function
that looks it up by id. Pair your own project with another project's id and
it went through (T162).

Every test here sends the caller's *own* project with *another account's*
object id — the case an isolation table built from another account's project
ids cannot reach. Each refusal is a 404, the same as an id that does not
exist, so the difference cannot confirm another project's ids; and each is
checked before anything is written or sent anywhere.

Not here: `POST /cohorts` with another project's cohort as `parent_id`. A
parent must share the child's dataset version, and the route already requires
that version to be the caller's, so the product cannot produce that pair.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection
from throughline_domain.ids import new_id
from throughline_workers.runner import Worker

CSV = b"""country,consumption,resistance,gdp
IND,32.1,41.2,2100
USA,24.5,30.1,65000
GBR,18.2,22.4,42000
FRA,26.7,33.8,40000
DEU,15.4,19.1,46000
BRA,29.3,37.5,8700
JPN,14.1,17.6,39000
ZAF,27.8,35.2,6000
"""

THEIR_TITLE = "Their unpublished paper on carriage"
THEIR_RESULT = "Carriage fell by a third in the treated wards."


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")


@pytest.fixture()
def theirs():
    """Another account's project, with a paper, a finding and an enquiry."""
    from throughline_domain import enquiry

    user_id, project_id = new_id("usr"), new_id("prj")
    ids = {"project": project_id}
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
            "VALUES (%s, %s, 'Other', 'x', 'y')", (user_id, f"{user_id}@test.local"))
        cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Theirs')",
                    (project_id, user_id))
        for key in ("source", "second_source"):
            ids[key] = new_id("src")
            cur.execute(
                "INSERT INTO sources(id, project_id, source_type, title) "
                "VALUES (%s, %s, 'paper', %s)", (ids[key], project_id, THEIR_TITLE))
            # A verified reading, so synthesis has something of theirs to serve.
            # Without it the matrix refuses "not read yet" and the test would
            # pass without the leak ever being possible.
            cur.execute(
                "INSERT INTO paper_extractions(id, project_id, source_id, fields, "
                "model, prompt_name, prompt_version) VALUES (%s, %s, %s, %s, "
                "'test', 'extract', 1)",
                (new_id("pex"), project_id, ids[key],
                 '{"results": {"quote": "%s", "locator": "p. 3"}}' % THEIR_RESULT))
        ids["finding"] = new_id("fnd")
        cur.execute(
            "INSERT INTO findings(id, project_id, title, finding_type) "
            "VALUES (%s, %s, 'Their unpublished result', 'statistical')",
            (ids["finding"], project_id))
        ids["enquiry"] = enquiry.open_new(cur, project_id=project_id)["id"]
    return ids


def _signed_in_project(client) -> str:
    """
    The caller's account and project. Made directly and then signed in, because
    first-run setup closes once any account exists — and the other account
    usually exists by now.
    """
    from throughline_domain import auth

    status = client.get("/api/auth/status").json()
    if status["needs_setup"]:
        signed_in = client.post("/api/auth/setup", json={
            "email": "mine@lab.local", "display_name": "Mine",
            "password": "correct-horse-battery"})
    else:
        with connection() as conn, conn.cursor() as cur:
            auth.create_user(cur, email="mine@lab.local", display_name="Mine",
                             password="correct-horse-battery")
        signed_in = client.post("/api/auth/login", json={
            "email": "mine@lab.local", "password": "correct-horse-battery"})
    assert signed_in.status_code == 200, signed_in.text
    return client.post("/api/projects", json={"name": "Mine"}).json()["id"]


def _count(sql: str, *params) -> int:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return int(cur.fetchone()["n"])


def test_another_projects_finding_cannot_be_exported_to_your_library(
        client, theirs, monkeypatch):
    """
    The export beside the preview T161 closed. It read the finding by id alone
    and sent the note to the Zotero library named in the request — the
    caller's — so another account's finding left the system entirely.
    """
    from throughline_connectors.more_sources import Zotero

    sent: list[str] = []
    monkeypatch.setattr(Zotero, "push_note",
                        lambda self, **kw: sent.append(kw["html"]) or {"ok": True})
    mine = _signed_in_project(client)

    response = client.post(
        f"/api/projects/{mine}/findings/{theirs['finding']}/library-note",
        json={"item_key": "ABC", "library": "123", "api_key": "k"})

    assert response.status_code == 404, response.text
    assert sent == [], "another account's finding was sent to a library"


def test_an_export_cannot_read_another_projects_enquiry(client, theirs, monkeypatch):
    from throughline_connectors.more_sources import Zotero

    sent: list[str] = []
    monkeypatch.setattr(Zotero, "push_note",
                        lambda self, **kw: sent.append(kw["html"]) or {"ok": True})
    mine = _signed_in_project(client)
    own = client.post(f"/api/projects/{mine}/findings", json={
        "title": "Mine", "finding_type": "statistical"}).json()["finding_id"]

    response = client.post(
        f"/api/projects/{mine}/findings/{own}/library-note",
        json={"item_key": "ABC", "library": "123", "api_key": "k",
              "enquiry_id": theirs["enquiry"]})

    assert response.status_code == 404, response.text
    assert sent == []


@pytest.mark.parametrize("path", ["synthesis", "synthesis/key-points"])
def test_another_projects_papers_cannot_be_synthesised(client, theirs, path):
    """`synthesis.matrix` loaded each source's title and extraction by id alone."""
    mine = _signed_in_project(client)

    response = client.post(f"/api/projects/{mine}/{path}", json={
        "source_ids": [theirs["source"], theirs["second_source"]]})

    assert response.status_code == 404, response.text
    assert THEIR_TITLE not in response.text
    assert THEIR_RESULT not in response.text


def test_a_mark_cannot_be_kept_on_another_projects_paper(client, theirs):
    mine = _signed_in_project(client)

    response = client.post(f"/api/projects/{mine}/marks", json={
        "source_id": theirs["source"], "page": 1, "kind": "highlight",
        "points": [{"x": 0.1, "y": 0.1}, {"x": 0.2, "y": 0.2}]})

    assert response.status_code == 404, response.text
    assert _count("SELECT count(*) AS n FROM paper_marks WHERE source_id = %s",
                  theirs["source"]) == 0


def test_an_excerpt_cannot_be_kept_from_another_projects_paper(client, theirs):
    """Kept, the excerpt listing then showed the other paper's title."""
    mine = _signed_in_project(client)

    response = client.post(f"/api/projects/{mine}/excerpts", json={
        "source_id": theirs["source"], "page": 1,
        "region": {"x": 72, "y": 144, "width": 240, "height": 96},
        "citation": "Quoted from their paper."})

    assert response.status_code == 404, response.text
    assert _count("SELECT count(*) AS n FROM paper_excerpts WHERE source_id = %s",
                  theirs["source"]) == 0


def test_a_discovery_cannot_join_another_projects_enquiry(client, theirs):
    """
    Accepted with another project's enquiry, the sweep ran in full and only
    failed when the worker came to record its looks — since T161 refuses that.
    Refused at the request instead, before a run exists to fail.
    """
    mine = _signed_in_project(client)
    assert client.post(f"/api/projects/{mine}/sources",
                       files={"file": ("amr.csv", CSV, "text/csv")}).status_code == 202
    while Worker(worker_id="body-ids-test").run_once():
        pass
    version = client.get(f"/api/projects/{mine}/sources").json()[0]["dataset"]["dataset_version_id"]

    response = client.post(f"/api/projects/{mine}/discoveries", json={
        "dataset_version_id": version, "enquiry_id": theirs["enquiry"]})

    assert response.status_code == 404, response.text
    assert _count("SELECT count(*) AS n FROM discovery_runs WHERE project_id = %s",
                  mine) == 0


def test_your_own_papers_and_enquiry_still_answer(client):
    """The checks refuse other projects' ids, not the caller's own."""
    mine = _signed_in_project(client)
    with connection() as conn, conn.cursor() as cur:
        source = new_id("src")
        cur.execute("INSERT INTO sources(id, project_id, source_type, title) "
                    "VALUES (%s, %s, 'paper', 'Mine')", (source, mine))

    response = client.post(f"/api/projects/{mine}/marks", json={
        "source_id": source, "page": 1, "kind": "highlight",
        "points": [{"x": 0.1, "y": 0.1}, {"x": 0.2, "y": 0.2}]})
    assert response.status_code != 404, response.text


# ---------------------------------------------------------------------------
# Held in the domain as well, so the next caller does not have to remember
# ---------------------------------------------------------------------------

@pytest.fixture()
def my_project(theirs):
    user_id, project_id = new_id("usr"), new_id("prj")
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
            "VALUES (%s, %s, 'Mine', 'x', 'y')", (user_id, f"{user_id}@test.local"))
        cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Mine')",
                    (project_id, user_id))
    yield project_id
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")


def test_synthesis_itself_refuses_another_projects_papers(theirs, my_project):
    from throughline_domain import synthesis

    with connection() as conn, conn.cursor() as cur:
        with pytest.raises(synthesis.SynthesisError, match="not in this project"):
            synthesis.matrix(cur, project_id=my_project,
                             source_ids=[theirs["source"], theirs["second_source"]])


def test_marks_itself_refuses_another_projects_paper(theirs, my_project):
    from throughline_domain import marks

    with connection() as conn, conn.cursor() as cur:
        with pytest.raises(marks.MarkError, match="not in this project"):
            marks.record(cur, project_id=my_project, source_id=theirs["source"],
                         page=1, kind="highlight", actor="test",
                         points=[{"x": 0.1, "y": 0.1}, {"x": 0.2, "y": 0.2}])


def test_excerpts_itself_refuses_another_projects_paper(theirs, my_project):
    from throughline_domain import excerpts

    with connection() as conn, conn.cursor() as cur:
        with pytest.raises(excerpts.ExcerptError, match="not in this project"):
            excerpts.record(cur, project_id=my_project, source_id=theirs["source"],
                            page=1, actor="test", citation="Theirs.",
                            region={"x": 72, "y": 144, "width": 240, "height": 96})


def test_a_discovery_run_itself_refuses_another_projects_enquiry(theirs, my_project):
    from throughline_domain import discovery

    with connection() as conn, conn.cursor() as cur:
        with pytest.raises(ValueError, match="does not belong to this project"):
            discovery.create_run(cur, project_id=my_project,
                                 dataset_version_id="dsv_unused",
                                 enquiry_id=theirs["enquiry"])
