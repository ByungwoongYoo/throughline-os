"""
The Sources list can say where an imported dataset came from (D211).

`POST /api/projects/{id}/datasets/import` records the provenance of every
dataset it brings in — the repository on `connector_id`, the address on
`original_uri`, and the repository and licence again inside `metadata`, with a
comment beside them saying it is "kept on the source itself so the Sources list
can say so". The route's own reply promises the researcher as much: "It will
appear in Sources, with <repository> and its licence recorded as where it came
from."

`GET /api/projects/{id}/sources` selected none of the three. So the product
*stored* the provenance and no screen could read it, and an imported dataset
was indistinguishable in the list from a file somebody dragged off a desktop —
this repository's named recurring defect, a record written by one half of the
system and read by none.

The failures each test guards:

  * a field dropped from the SELECT again, silently, because nothing asked for
    it — one test per field, so a partial revert names which one;
  * `repository` or `licence` left buried inside `metadata`, where the list
    would have to unpack a blob the importer uses for its own bookkeeping;
  * a *missing* licence arriving as something other than null, which would let
    "not stated" render as though it were a licence;
  * the eight fields the list already returned being lost while the new ones
    were added, which would break every screen reading it today.

Nothing here touches the network: the import route reads its fetcher at call
time and this replaces it, exactly as `test_a_found_dataset_can_be_brought_in`
does.
"""

from __future__ import annotations

import io
import uuid

import pytest
from fastapi.testclient import TestClient
from throughline_domain import dataset_import
from throughline_domain.db import connection

A_CSV = b"country,ddd,resistance\nBE,21.3,0.14\nNL,9.8,0.06\n"

ZENODO = "https://zenodo.org/records/7654321/files/panel.csv"

#: What the list returned before the provenance was added. Named rather than
#: implied: adding fields to a payload is exactly when the existing ones get
#: lost, and every screen reading Sources today depends on these.
ALREADY_PROMISED = ("id", "title", "source_type", "ingestion_status",
                    "ingestion_detail", "trust_level", "content_hash",
                    "created_at")


class _Fake:
    """A fetcher that answers from a script and records what it was asked."""

    def __init__(self, **by_url: dataset_import.Fetched) -> None:
        self.script = by_url
        self.asked: list[str] = []

    def __call__(self, url: str) -> dataset_import.Fetched:
        self.asked.append(url)
        if url not in self.script:
            raise AssertionError(f"the fetcher was asked for {url}")
        return self.script[url]


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_users():
    """The HTTP tests commit real rows; the transaction fixtures do not apply."""
    yield
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        conn.commit()


@pytest.fixture()
def serving(monkeypatch):
    """The network, replaced for the route as well as for the module."""
    fake = _Fake(**{ZENODO: dataset_import.Fetched(
        status=200, headers={"Content-Type": "text/csv"}, body=A_CSV)})
    monkeypatch.setattr(dataset_import, "DEFAULT_FETCHER", fake)
    return fake


def _account(client) -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": f"prov-{uuid.uuid4().hex[:8]}@lab.local",
        "display_name": "Lead", "password": "correct-horse-battery",
    }).status_code == 200


def _project(client) -> str:
    return client.post("/api/projects",
                       json={"name": "Where it came from"}).json()["id"]


def _import(client, project_id: str, **overrides) -> dict:
    body = {"url": ZENODO, "title": "National surveillance panel",
            "repository": "zenodo", "licence": "CC-BY-4.0"} | overrides
    response = client.post(f"/api/projects/{project_id}/datasets/import",
                           json=body)
    assert response.status_code == 202, response.text
    return response.json()


def _upload(client, project_id: str) -> dict:
    response = client.post(
        f"/api/projects/{project_id}/sources",
        files={"file": ("hand_collected.csv", io.BytesIO(A_CSV), "text/csv")})
    assert response.status_code == 202, response.text
    return response.json()


def _listed(client, project_id: str, source_id: str) -> dict:
    response = client.get(f"/api/projects/{project_id}/sources")
    assert response.status_code == 200, response.text
    by_id = {row["id"]: row for row in response.json()}
    assert source_id in by_id, f"{source_id} is not in the list at all"
    return by_id[source_id]


@pytest.fixture()
def imported(client, serving):
    """One imported dataset, and the row the Sources list gives back for it."""
    _account(client)
    project_id = _project(client)
    source_id = _import(client, project_id)["source_id"]
    return _listed(client, project_id, source_id)


class TestTheImportedDatasetSaysWhereItCameFrom:
    def test_the_repository_is_named(self, imported):
        """"from Zenodo" — the sentence the list was unable to write."""
        assert imported["repository"] == "zenodo"

    def test_the_licence_is_named(self, imported):
        """The one fact that decides whether the data can be used at all."""
        assert imported["licence"] == "CC-BY-4.0"

    def test_the_connector_that_brought_it_in_is_named(self, imported):
        """`connector_id` is the column; `repository` is what metadata called
        it. Both are asserted because they are written by different lines and
        either could be dropped on its own."""
        assert imported["connector_id"] == "zenodo"

    def test_the_address_it_was_fetched_from_is_returned(self, imported):
        """The record in the repository, so the list can link back to it."""
        assert imported["original_uri"] == ZENODO

    def test_the_two_metadata_fields_are_lifted_to_the_top_level(self, imported):
        """Not handed over as a blob for a screen to rummage through.

        `metadata` also holds the redirect the importer followed and the byte
        count it measured, which are the importer's bookkeeping rather than
        anything a reader of the list should be shown. Returning the whole
        object would invite a screen to render whatever happens to be in it.
        """
        assert "metadata" not in imported, (
            "the list is handing the interface the importer's whole metadata")

    def test_everything_the_list_already_returned_is_still_returned(
            self, imported):
        """Adding fields is when the existing ones get lost."""
        missing = [field for field in ALREADY_PROMISED if field not in imported]
        assert not missing, f"the sources list stopped returning {missing}"
        # `paper` and `dataset` are the other half of the contract: both keys
        # are always present so a caller never has to tell "no dataset" from
        # "this endpoint does not report datasets".
        assert "paper" in imported and "dataset" in imported


class TestAnUploadedSourceStatesNothingItWasNotTold:
    """A file off a desktop has no repository and no licence, and says so.

    Null rather than an empty string, and this is the whole point of the
    distinction: "not stated" and "openly licensed" are different facts, and a
    licence that arrives as `""` reads as a value the interface has to guess
    about. `->>` on a JSONB key that is absent gives SQL NULL, which is the
    honest answer.
    """

    @pytest.fixture()
    def uploaded(self, client):
        _account(client)
        project_id = _project(client)
        source_id = _upload(client, project_id)["source_id"]
        return _listed(client, project_id, source_id)

    def test_it_has_no_repository(self, uploaded):
        assert uploaded["repository"] is None

    def test_it_has_no_licence(self, uploaded):
        assert uploaded["licence"] is None

    def test_it_has_no_connector_and_no_address(self, uploaded):
        assert uploaded["connector_id"] is None
        assert uploaded["original_uri"] is None

    def test_it_is_still_listed_with_everything_else(self, uploaded):
        missing = [field for field in ALREADY_PROMISED if field not in uploaded]
        assert not missing, f"the sources list stopped returning {missing}"


def test_a_repository_that_stated_no_licence_reports_none_rather_than_empty(
        client, serving):
    """An import whose record carried no licence.

    The importer writes `licence: null` into the metadata in that case — its
    comment says "'not stated' is not 'open'" — and a JSON null must reach the
    list as a null, not as the string "None" and not as "".
    """
    _account(client)
    project_id = _project(client)
    source_id = _import(client, project_id, licence=None)["source_id"]

    row = _listed(client, project_id, source_id)

    assert row["licence"] is None
    assert row["repository"] == "zenodo", (
        "a null licence must not take the repository down with it")
