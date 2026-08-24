"""
Destroying a corpus is written down.

The audit log recorded creation and not destruction — which for a research
record is exactly the wrong way round. `delete_project` cascades through
sources, datasets, analyses, connections, findings, figures and notes, and wrote
nothing at all. A researcher could erase a year of work and the log that exists
to make the work legible would show only the day it was created.

This was found the hard way: a workspace on this machine went from six analyses
and six connections to none, the audit log held 133 entries and every one of
them said `create`, and there was no way to tell from the record whether
something had been deleted, by whom, or what was in it. The gap is not that the
answer was unwelcome — it is that there was no answer.

**The counts are the record.** "Deleted a project" is a fact about a row.
"Deleted a project holding 3 sources, 6 analyses and 1 finding" is a fact about
research, and it is the second one somebody needs six months later.
"""

from __future__ import annotations

import ast
import pathlib

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection

ROOT = pathlib.Path(__file__).resolve().parent.parent


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


def _account(client) -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": "keeper@lab.local", "display_name": "Keeper",
        "password": "correct-horse-battery"}).status_code == 200


def test_deleting_a_project_is_recorded(client):
    _account(client)
    project_id = client.post("/api/projects", json={
        "name": "Doomed", "research_question": "q"}).json()["id"]

    assert client.delete(f"/api/projects/{project_id}").status_code in (200, 204)

    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT action, object_type, object_id, detail FROM audit_log "
            "WHERE object_id = %s AND action = 'delete'", (project_id,))
        entry = cur.fetchone()

    assert entry is not None, (
        "A project was destroyed and the audit log says nothing. Deletion is "
        "the event a research record most needs to carry.")
    assert entry["object_type"] == "project"
    assert entry["detail"]["name"] == "Doomed"


def test_the_entry_survives_the_thing_it_records(client):
    """
    The audit row cannot reference the project it describes, or it cascades away
    with it — an audit entry that is deleted by the deletion it records is not
    an audit entry.
    """
    _account(client)
    project_id = client.post("/api/projects", json={
        "name": "Doomed", "research_question": "q"}).json()["id"]
    client.delete(f"/api/projects/{project_id}")

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT project_id FROM audit_log WHERE object_id = %s "
                    "AND action = 'delete'", (project_id,))
        row = cur.fetchone()

    assert row is not None
    assert row["project_id"] is None


def test_the_record_says_what_was_destroyed_not_only_that_it_was(client):
    """
    "Deleted a project" is a fact about a row. What was in it is a fact about
    research, and it is the one somebody needs six months later.
    """
    _account(client)
    project_id = client.post("/api/projects", json={
        "name": "Held things", "research_question": "q"}).json()["id"]

    with connection() as conn, conn.cursor() as cur:
        from throughline_domain.ids import new_id
        cur.execute(
            "INSERT INTO sources(id, project_id, source_type, title, "
            "ingestion_status) VALUES (%s, %s, 'upload', 'a paper', 'ready')",
            (new_id("src"), project_id))
        conn.commit()

    client.delete(f"/api/projects/{project_id}")

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT detail FROM audit_log WHERE object_id = %s "
                    "AND action = 'delete'", (project_id,))
        detail = cur.fetchone()["detail"]

    assert detail["destroyed"]["sources"] == 1


def test_an_empty_project_records_nothing_destroyed_rather_than_zeroes(client):
    """
    A row of zeroes reads as a measurement. An absent key reads as "there was
    nothing there", which is what happened.
    """
    _account(client)
    project_id = client.post("/api/projects", json={
        "name": "Empty", "research_question": "q"}).json()["id"]
    client.delete(f"/api/projects/{project_id}")

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT detail FROM audit_log WHERE object_id = %s "
                    "AND action = 'delete'", (project_id,))
        detail = cur.fetchone()["detail"]

    assert detail["destroyed"] == {}


def test_every_destructive_route_writes_an_audit_entry():
    """
    The guard, so the next destructive endpoint cannot quietly skip this.

    Read from the source rather than exercised, because a route that deletes
    something is easy to add and hard to remember to audit — and the failure is
    invisible until somebody asks what happened to their work.
    """
    source = (ROOT / "apps/api/src/throughline_api/app.py").read_text()
    tree = ast.parse(source)

    missing: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        decorators = [d for d in node.decorator_list
                      if isinstance(d, ast.Call)
                      and isinstance(d.func, ast.Attribute)
                      and d.func.attr == "delete"]
        if not decorators:
            continue
        body = ast.dump(node)
        # A route that only refuses, or only detaches a session, destroys no
        # research and needs no entry.
        if "DELETE FROM" not in ast.get_source_segment(source, node):
            continue
        if "audit" not in body:
            missing.append(node.name)

    assert not missing, (
        "These routes delete rows and record nothing in the audit log: "
        f"{missing}. A research record that logs creation but not destruction "
        "cannot answer the only question anybody asks it.")
