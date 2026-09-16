"""
A paper added from *Find papers* can be read, not only cited (D410).

`literature/import` records the citation and, by design, never follows the
open-access link on its own: fetching a PDF is a separate, explicit act. That
act did not exist. The source kept its metadata and nothing else — no passages,
no pages, no research object — so locating its claims answered 400, "has no
indexed passages", on every paper that arrived by search. *Read* showed the PDF
in the browser and the text never reached the product.

`POST /api/projects/{id}/sources/{id}/full-text` is that act. It fetches the
address the import recorded — never one the request supplies — through the
same guarded fetcher *Read* uses, attaches the file to the same source, and
queues the ordinary ingestion.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection
from throughline_workers.runner import Worker

from conftest import sign_in

PDF_URL = "https://arxiv.org/pdf/2401.00001"


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")


@pytest.fixture()
def fetched(monkeypatch, paper_pdf):
    """The guarded fetcher, answering with a real PDF and recording what it was asked."""
    from throughline_connectors import papers

    asked: list[str] = []

    def fake(url, **_):
        asked.append(url)
        return paper_pdf.read_bytes()

    monkeypatch.setattr(papers, "fetch_pdf", fake)
    return asked


def _imported(client, **extra) -> tuple[str, str]:
    sign_in(client, email="reader@lab.local")
    project_id = client.post("/api/projects", json={"name": "Papers"}).json()["id"]
    body = {"title": "Consumption and resistance", "authors": ["Chen"], "year": 2024,
            "doi": "10.1/found", "source": "arxiv", "url": "https://arxiv.org/abs/2401.00001",
            "pdf_url": PDF_URL, **extra}
    answer = client.post(f"/api/projects/{project_id}/literature/import", json=body)
    assert answer.status_code == 201, answer.text
    return project_id, answer.json()["source_id"]


def _drain() -> None:
    while Worker(worker_id="full-text-test").run_once():
        pass


def test_the_full_text_is_fetched_read_and_indexed(client, fetched, paper_search_term):
    project_id, source_id = _imported(client)

    answer = client.post(f"/api/projects/{project_id}/sources/{source_id}/full-text")
    assert answer.status_code == 202, answer.text
    assert fetched == [PDF_URL]
    _drain()

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT ingestion_status, file_id FROM sources WHERE id = %s", (source_id,))
        source = cur.fetchone()
        cur.execute("SELECT count(*) AS n FROM passages WHERE source_id = %s", (source_id,))
        passages = cur.fetchone()["n"]
    assert source["file_id"] and source["ingestion_status"] == "ready"
    assert passages > 0
    # The same source, not a second one: the citation and the text are one paper.
    listed = client.get(f"/api/projects/{project_id}/sources").json()
    assert [s["id"] for s in listed if s["title"] == "Consumption and resistance"] == [source_id]
    hits = client.get(f"/api/projects/{project_id}/search",
                      params={"q": paper_search_term}).json()
    assert any(h.get("source_id") == source_id for h in hits.get("results", hits.get("hits", [])))


def test_the_address_is_the_one_the_import_recorded(client, fetched):
    """A body naming another address is not an input: the server fetches its own record."""
    project_id, source_id = _imported(client)
    client.post(f"/api/projects/{project_id}/sources/{source_id}/full-text",
                json={"url": "http://169.254.169.254/latest/meta-data"})
    assert fetched == [PDF_URL]


def test_a_paper_with_no_open_access_copy_is_refused_in_words(client, fetched):
    project_id, source_id = _imported(client, pdf_url="")
    answer = client.post(f"/api/projects/{project_id}/sources/{source_id}/full-text")
    assert answer.status_code == 409
    assert "no open-access copy" in answer.json()["detail"]
    assert fetched == []


def test_a_paper_already_read_is_not_fetched_again(client, fetched):
    project_id, source_id = _imported(client)
    assert client.post(f"/api/projects/{project_id}/sources/{source_id}/full-text").status_code == 202
    again = client.post(f"/api/projects/{project_id}/sources/{source_id}/full-text")
    assert again.status_code == 409
    assert "already" in again.json()["detail"]
    assert fetched == [PDF_URL]


def test_a_refused_fetch_says_why(client, monkeypatch):
    from throughline_connectors import papers

    def refuse(url, **_):
        raise papers.PaperFetchError("That address answered with a login page, not a PDF.")

    monkeypatch.setattr(papers, "fetch_pdf", refuse)
    project_id, source_id = _imported(client)
    answer = client.post(f"/api/projects/{project_id}/sources/{source_id}/full-text")
    assert answer.status_code == 400
    assert "login page" in answer.json()["detail"]


def test_locating_claims_on_a_citation_says_how_to_get_its_text(client, fetched):
    """The dead end this fixes is where a researcher meets it: say the way out there."""
    project_id, source_id = _imported(client)
    answer = client.post(f"/api/sources/{source_id}/claims", params={"project_id": project_id})
    assert answer.status_code == 400
    assert "only its citation" in answer.json()["detail"]
    assert "Add and read the full text" in answer.json()["detail"]

