"""
A researcher can get their citations out.

`bibliography.py` produces a `.bib` file with stable keys, missing fields
omitted rather than guessed, and — since a scraped title with one unmatched
brace was found to swallow the rest of the file — braces escaped. It is
careful work with its own test file, and nothing called it: no route, no
control. A researcher who had done the reading could not export a
bibliography to the thing they write in.

Found by asking which functions only their own tests use, after the same
question on the web side turned up an unreachable undo.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from throughline_domain import auth, citations
from throughline_domain.db import connection, transaction
from throughline_domain.ids import new_id


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
    response = client.post(endpoint, json={
        "email": f"cite-{uuid.uuid4().hex[:8]}@lab.local",
        "display_name": "Lead", "password": "correct-horse-battery",
    })
    assert response.status_code == 200, response.text


def _cited_paper(project_id: str, title: str) -> None:
    """A paper this project cites, the way ingestion would leave one."""
    with transaction() as cur:
        source = new_id("src")
        cur.execute(
            "INSERT INTO sources(id, project_id, source_type, title, "
            "ingestion_status) VALUES (%s, %s, 'upload', %s, 'ready')",
            (source, project_id, title))
        cur.execute(
            "INSERT INTO papers(id, project_id, source_id, title, authors, "
            "journal, publication_date, doi) "
            "VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s)",
            (new_id("pap"), project_id, source, title,
             '["Ada Lovelace"]', "Journal of Method", "2024-03-01",
             "10.1000/xyz"))
        citations.create_citation(
            cur, project_id=project_id, source_id=source,
            locator="p. 1", quoted_text="A sentence.")


class TestItIsReachable:
    def test_a_project_can_be_asked_for_its_bibliography(self, client):
        _account(client)
        project_id = client.post("/api/projects",
                                 json={"name": "Citing"}).json()["id"]
        _cited_paper(project_id, "Attention and the Analyst")

        response = client.get(f"/api/projects/{project_id}/bibliography")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["entries"] == 1
        assert "@article{" in body["bibtex"]
        assert "Attention and the Analyst" in body["bibtex"]

    def test_a_project_that_cited_nothing_says_so(self, client):
        """
        An empty file is indistinguishable from a failed export once it is on
        somebody's disk, which is why the module writes a comment instead.
        """
        _account(client)
        project_id = client.post("/api/projects",
                                 json={"name": "Quiet"}).json()["id"]

        body = client.get(f"/api/projects/{project_id}/bibliography").json()
        assert body["entries"] == 0
        assert body["bibtex"].strip().startswith("%")

    def test_it_belongs_to_the_project_that_asked(self, client):
        """Somebody else's citations are not in this file."""
        _account(client)
        mine = client.post("/api/projects", json={"name": "Mine"}).json()["id"]
        theirs = client.post("/api/projects",
                             json={"name": "Theirs"}).json()["id"]
        _cited_paper(theirs, "Not My Paper")

        body = client.get(f"/api/projects/{mine}/bibliography").json()
        assert "Not My Paper" not in body["bibtex"]
        assert body["entries"] == 0

    def test_the_escaping_survives_the_trip(self, client):
        """
        The brace fix reached the researcher, not just the unit test: one
        scraped title with an unmatched brace used to swallow every entry
        after it.
        """
        _account(client)
        project_id = client.post("/api/projects",
                                 json={"name": "Messy"}).json()["id"]
        _cited_paper(project_id, "An open { brace")
        _cited_paper(project_id, "Perfectly Ordinary Title")

        text = client.get(
            f"/api/projects/{project_id}/bibliography").json()["bibtex"]
        assert "Perfectly Ordinary Title" in text
        depth = 0
        index = 0
        while index < len(text):
            if text[index] == "\\" and index + 1 < len(text) \
                    and text[index + 1] in "{}":
                index += 2
                continue
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
            index += 1
        assert depth == 0, "the exported file does not parse"
