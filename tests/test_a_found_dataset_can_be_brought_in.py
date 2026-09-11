"""
A dataset the search found can be brought into the project — and only that.

Find data searches four repositories, leads with licence, formats and embargo,
dims the records it cannot use with the blocker named — and then offers a
usable one nothing but a link out to the repository. The capability inventory
records it as a dead end: "**Has no import/add control at all** — the only
write is `api.post` to `/api/datasets/search`"
(`docs/audit/capability-inventory-2026-09-05.md`, §2, Find data). D202. The
rail entry directly beside it imports a paper in a click.

`POST /api/projects/{id}/datasets/import` closes that, and it is a server
fetching an address a browser chose — so most of this file is about what it
refuses. The four refusals each guard a specific way this goes wrong:

  * a host that is not a repository this installation searches, which is the
    difference between an import button and an open proxy on the server's
    network position;
  * the same check applied again after a redirect, because a permitted host
    that 302s to somewhere else is how a one-time guard is bypassed;
  * a file that is not tabular, which would queue and then fail in the worker
    with the same information a refusal could have given in place;
  * a file over the cap, refused on the declared length before it is
    downloaded and again on what actually arrived.

Nothing here touches the network. The fetcher is one injectable callable and
every test passes a fake, so a refusal is proved by the fake never being called
rather than by a request that happens not to resolve.

The success path is exercised over HTTP rather than against the domain module,
because the thing worth proving is that the bytes go through the *same door* an
upload uses: one `files` row, one source, one queued `ingest.source` run, and
the same content-hash deduplication — not a second pipeline that looks like it.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from throughline_domain import dataset_import
from throughline_domain.db import connection

A_CSV = b"country,ddd,resistance\nBE,21.3,0.14\nNL,9.8,0.06\n"


def _reply(body: bytes = A_CSV, *, status: int = 200,
           headers: dict[str, str] | None = None) -> dataset_import.Fetched:
    return dataset_import.Fetched(
        status=status,
        headers={"Content-Type": "text/csv"} | (headers or {}),
        body=body)


class _Fake:
    """A fetcher that answers from a script and records what it was asked.

    Anything not in the script is a failure rather than a default: a test that
    silently answers an address it did not expect would pass while the guard it
    is about was walked straight past.
    """

    def __init__(self, **by_url: dataset_import.Fetched) -> None:
        self.script = by_url
        self.asked: list[str] = []

    def __call__(self, url: str) -> dataset_import.Fetched:
        self.asked.append(url)
        if url not in self.script:
            raise AssertionError(f"the fetcher was asked for {url}")
        return self.script[url]


ZENODO = "https://zenodo.org/records/7654321/files/panel.csv"


class TestOnlyTheRepositoriesThisInstallationSearches:
    def test_the_allowlist_is_derived_from_the_search_connectors(self):
        """The list is read off the connectors, not typed beside them.

        A hand-written copy drifts in both directions — a repository the
        product offers to search and refuses to import from, or a host still
        permitted after the connector justifying it was deleted — and both are
        silent. `throughline_connectors.datasets.TABULAR` already drifted this
        way once and needed a test of its own to hold it.
        """
        from throughline_connectors.datasets import DATASET_CONNECTORS

        domains = dataset_import.searched_repository_domains()

        assert {"zenodo.org", "datadryad.org", "figshare.com"} <= domains, (
            f"a repository the search queries cannot be imported from: {domains}")
        # Derived, so every connector contributes: a name in the registry with
        # no domain in the set would be a repository nobody can import from.
        assert len(domains) >= len(DATASET_CONNECTORS)

    def test_a_host_nobody_searches_is_refused_by_name(self):
        """The SSRF guard, and the sentence that makes it readable.

        Refused before any request: the fetcher is never called, so this is
        not "the address failed to resolve" passing for a check.
        """
        fake = _Fake()

        with pytest.raises(dataset_import.DatasetImportRefused) as refusal:
            dataset_import.fetch_dataset(
                "https://evil.example.com/data.csv", fetch=fake)

        assert "evil.example.com" in str(refusal.value)
        assert ("is not one of the repositories this installation searches"
                in str(refusal.value))
        assert fake.asked == [], "a refused address was still fetched"

    def test_the_metadata_service_is_not_a_repository(self):
        """169.254.169.254 by name, because it is the address this is about.

        The host check refuses it before the private-address guard in the
        fetcher ever sees it, which is the arrangement: the allowlist is the
        outer wall and resolution the inner one.
        """
        fake = _Fake()

        with pytest.raises(dataset_import.DatasetImportRefused):
            dataset_import.fetch_dataset(
                "http://169.254.169.254/latest/meta-data/", fetch=fake)

        assert fake.asked == []

    def test_a_file_server_beside_the_search_api_is_allowed(self):
        """Figshare searches `api.figshare.com` and serves from `figshare.com`.

        An allowlist of exactly the hosts the search calls would refuse every
        real download while looking correct, so the check is on the domain.
        """
        url = "https://figshare.com/ndownloader/files/12345/panel.csv"
        fake = _Fake(**{url: _reply()})

        assert dataset_import.fetch_dataset(url, fetch=fake).content == A_CSV


class TestARedirectIsCheckedAgain:
    def test_a_redirect_off_the_allowlist_is_refused(self):
        """The bypass this guard exists for.

        A permitted host answering 302 to somewhere else is the standard way a
        check applied once is walked around. The second host is named, and it
        is never fetched.
        """
        fake = _Fake(**{ZENODO: _reply(
            b"", status=302,
            headers={"Location": "https://evil.example.com/x.csv"})})

        with pytest.raises(dataset_import.DatasetImportRefused) as refusal:
            dataset_import.fetch_dataset(ZENODO, fetch=fake)

        assert "evil.example.com" in str(refusal.value)
        assert fake.asked == [ZENODO], "the redirect was followed off the list"

    def test_a_redirect_within_the_allowlist_is_followed(self):
        """The landing-page → file-server hop every repository actually uses.

        The opposite failure to the one above, and the reason this is not a
        rule that refuses redirects outright.
        """
        landing = "https://zenodo.org/records/7654321"
        served = "https://files.zenodo.org/panel.csv"
        fake = _Fake(**{
            landing: _reply(b"", status=302, headers={"Location": served}),
            served: _reply()})

        fetched = dataset_import.fetch_dataset(landing, fetch=fake)

        assert fetched.content == A_CSV
        # Recorded as where the bytes came from, which is not where the
        # researcher was sent from.
        assert fetched.url == served

    def test_a_redirect_loop_ends(self):
        loop = "https://zenodo.org/loop.csv"
        fake = _Fake(**{loop: _reply(b"", status=302,
                                     headers={"Location": loop})})

        with pytest.raises(dataset_import.DatasetImportRefused) as refusal:
            dataset_import.fetch_dataset(loop, fetch=fake)

        assert "loop" in str(refusal.value)
        assert len(fake.asked) <= dataset_import.MAX_REDIRECTS + 1


class TestOnlyTabularData:
    def test_a_pdf_from_a_permitted_repository_is_refused_by_name(self):
        """Zenodo's "dataset" type is self-declared, so this is the common case.

        A PDF supplement registered as a dataset would queue and then fail in
        the ingestion worker with "This file type is not supported" — the same
        information, an hour later, attached to a source the researcher now has
        to delete.
        """
        url = "https://zenodo.org/records/1/files/supplement.pdf"
        fake = _Fake(**{url: _reply(b"%PDF-1.7",
                                    headers={"Content-Type": "application/pdf"})})

        with pytest.raises(dataset_import.DatasetImportRefused) as refusal:
            dataset_import.fetch_dataset(url, fetch=fake)

        assert "supplement.pdf" in str(refusal.value)
        for suffix in dataset_import.TABULAR_SUFFIXES:
            assert suffix in str(refusal.value), "the refusal names what it does take"

    def test_a_name_with_a_suffix_outranks_a_content_type(self):
        """A repository serving a PDF as `text/csv` is a mislabelled PDF.

        Believing the header here would let any file in behind a name the
        researcher can read and a header they cannot.
        """
        url = "https://zenodo.org/records/1/files/supplement.pdf"
        fake = _Fake(**{url: _reply(b"%PDF-1.7",
                                    headers={"Content-Type": "text/csv"})})

        with pytest.raises(dataset_import.DatasetImportRefused):
            dataset_import.fetch_dataset(url, fetch=fake)

    def test_an_opaque_download_url_is_named_from_its_headers(self):
        """Dataverse serves `/api/access/datafile/123` with the name in a header.

        Without this the file would be registered with no suffix, and the
        ingestion worker dispatches on the suffix of `files.filename` — so it
        would be queued and permanently failed for having no format.
        """
        url = "https://dataverse.harvard.edu/api/access/datafile/4217459"
        fake = _Fake(**{url: _reply(headers={
            "Content-Disposition": 'attachment; filename="surveillance.tsv"',
            "Content-Type": "text/tab-separated-values"})})

        fetched = dataset_import.fetch_dataset(url, fetch=fake)

        assert fetched.filename == "surveillance.tsv"

    def test_a_download_url_with_no_name_at_all_falls_back_to_its_type(self):
        """The content type is the only statement about the format there is."""
        url = "https://dataverse.harvard.edu/api/access/datafile/4217459"
        fake = _Fake(**{url: _reply(headers={"Content-Type": "text/csv"})})

        fetched = dataset_import.fetch_dataset(url, fetch=fake)

        assert fetched.filename.endswith(".csv"), (
            "a file registered without a suffix cannot be ingested")

    def test_a_name_the_repository_chose_cannot_climb_out_of_itself(self):
        """A header is not a promise.

        `filename="../../etc/passwd.csv"` is a thing a server can send, and
        this name is written to a row and shown on the Sources list. Stored
        bytes are content-addressed and the name never reaches the filesystem;
        this keeps it from reaching anything else either.
        """
        url = "https://zenodo.org/records/1/files/panel.csv"
        fake = _Fake(**{url: _reply(headers={
            "Content-Disposition": 'attachment; filename="../../etc/passwd.csv"'})})

        fetched = dataset_import.fetch_dataset(url, fetch=fake)

        assert fetched.filename == "passwd.csv"

    def test_an_empty_file_is_refused_rather_than_profiled(self):
        url = "https://zenodo.org/records/1/files/empty.csv"
        fake = _Fake(**{url: _reply(b"")})

        with pytest.raises(dataset_import.DatasetImportRefused) as refusal:
            dataset_import.fetch_dataset(url, fetch=fake)

        assert "empty" in str(refusal.value)


class TestTheCapIsNamed:
    def test_the_declared_length_is_refused_before_the_download(self):
        """A cap whose point is not downloading the file it refuses.

        The refusal names the cap: "too large" without a number tells a
        researcher nothing about whether a smaller file would be accepted.
        """
        url = "https://zenodo.org/records/1/files/images.csv"
        fake = _Fake(**{url: _reply(
            A_CSV, headers={"Content-Length": str(400 * 1024 * 1024)})})

        with pytest.raises(dataset_import.DatasetImportRefused) as refusal:
            dataset_import.fetch_dataset(url, fetch=fake)

        assert "200 MB" in str(refusal.value), "the cap is not named"
        assert "400 MB" in str(refusal.value), "the file's own size is not named"

    def test_a_body_over_the_cap_is_refused_whatever_the_header_claimed(
            self, monkeypatch):
        """Content-Length is a claim, and plenty of servers omit it entirely.

        The cap is lowered rather than a 200 MB body built, and the sentence is
        checked against whatever the cap now is — a test asserting the literal
        "200 MB" here would pass with the second check deleted.
        """
        monkeypatch.setattr(dataset_import, "MAX_BYTES", 16)
        url = "https://zenodo.org/records/1/files/panel.csv"
        fake = _Fake(**{url: _reply(A_CSV)})

        with pytest.raises(dataset_import.DatasetImportRefused) as refusal:
            dataset_import.fetch_dataset(url, fetch=fake)

        assert dataset_import._human(16) in str(refusal.value)

    def test_the_cap_this_installation_names_is_the_one_in_the_contract(self):
        """The sentence the screen shows says 200 MB, and means it."""
        assert dataset_import.MAX_BYTES == 200 * 1024 * 1024
        assert dataset_import._human(dataset_import.MAX_BYTES) == "200 MB"


# ---------------------------------------------------------------------------
# Through the route, and through the same door an upload uses
# ---------------------------------------------------------------------------


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


def _account(client) -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": f"data-{uuid.uuid4().hex[:8]}@lab.local",
        "display_name": "Lead", "password": "correct-horse-battery",
    }).status_code == 200


def _project(client) -> str:
    return client.post("/api/projects",
                       json={"name": "Imported data"}).json()["id"]


def _import(client, project_id: str, **overrides) -> Any:
    body = {"url": ZENODO, "title": "National surveillance panel",
            "repository": "zenodo", "licence": "CC0-1.0"} | overrides
    return client.post(f"/api/projects/{project_id}/datasets/import", json=body)


def _another_researchers_project() -> str:
    """A project belonging to an account this client never signs in as.

    Committed rather than made through the API: the installation has one
    account by the time these tests run, and the point is a project the signed
    in researcher does not own.
    """
    from throughline_domain.ids import new_id

    owner, project_id = new_id("usr"), new_id("prj")
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, "
            "password_salt) VALUES (%s, %s, 'Other Researcher', 'x', 'y')",
            (owner, f"{owner}@test.local"))
        cur.execute(
            "INSERT INTO projects(id, owner_user_id, name, research_question) "
            "VALUES (%s, %s, 'Other project', 'does it leak?')",
            (project_id, owner))
    return project_id


@pytest.fixture()
def serving(monkeypatch):
    """The network, replaced for the route as well as for the module.

    `fetch_dataset` reads `DEFAULT_FETCHER` at call time precisely so this
    works without the route having to take a fetcher it would never be passed
    in production.
    """
    fake = _Fake(**{ZENODO: _reply()})
    monkeypatch.setattr(dataset_import, "DEFAULT_FETCHER", fake)
    return fake


class TestTheSameDoorAnUploadUses:
    def test_a_record_becomes_a_source_with_ingestion_queued(
            self, client, serving):
        """The contract the Find data screen was built against.

        202 and not 200: the bytes are on disk and the work is durably queued,
        and nothing has been parsed — the distinction `upload_source` makes for
        the same reason.
        """
        _account(client)
        project_id = _project(client)

        response = _import(client, project_id)

        assert response.status_code == 202, response.text
        body = response.json()
        assert body["ingestion_status"] == "uploaded"
        assert body["source_id"] and body["workflow_run_id"]

        with connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT title, source_type, connector_id, original_uri, "
                "metadata, content_hash FROM sources WHERE id = %s",
                (body["source_id"],))
            source = cur.fetchone()
            cur.execute(
                "SELECT workflow_name, input FROM workflow_runs WHERE id = %s",
                (body["workflow_run_id"],))
            run = cur.fetchone()

        assert source["title"] == "National surveillance panel"
        # Where it came from, on the source itself, so the Sources list can say
        # so rather than showing a file with no history.
        assert source["connector_id"] == "zenodo"
        assert source["original_uri"] == ZENODO
        assert source["metadata"]["licence"] == "CC0-1.0"
        # Queued through the ordinary ingestion, keyed to this source.
        assert run["workflow_name"] == "ingest.source"
        assert run["input"]["source_id"] == body["source_id"]

    def test_the_stored_file_carries_a_suffix_the_worker_can_read(
            self, client, serving):
        """`ingest_source` dispatches on the suffix of `files.filename`.

        Stored files are content-addressed and have no extension on disk, so a
        filename without one leaves the worker with nothing to dispatch on and
        the source permanently failed.
        """
        _account(client)
        project_id = _project(client)

        body = _import(client, project_id).json()

        with connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT f.filename, f.media_type FROM files f "
                        "JOIN sources s ON s.file_id = f.id WHERE s.id = %s",
                        (body["source_id"],))
            stored = cur.fetchone()

        assert stored["filename"].endswith(".csv")
        assert stored["media_type"] == "text/csv"

    def test_the_same_record_imported_twice_is_one_source(
            self, client, serving):
        """Deduplication by content hash, the upload route's own arrangement.

        Two imports of the same record are one act done twice. A second source
        row would double-count the dataset in everything downstream, and — as
        `upload_source` records at length — would be handed the first run's id,
        leaving a row no worker will ever move out of `uploaded`.
        """
        _account(client)
        project_id = _project(client)

        first = _import(client, project_id).json()
        second = _import(client, project_id)

        assert second.status_code == 202, second.text
        again = second.json()
        assert again["source_id"] == first["source_id"]
        assert again["source_reused"] is True
        assert "already in this project" in again["note"]

        with connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM sources "
                        "WHERE project_id = %s", (project_id,))
            assert cur.fetchone()["n"] == 1, "a second source row was created"

    def test_a_refused_address_is_a_422_with_the_reason_in_it(
            self, client, serving):
        """The refusal reaches the screen as a sentence, not as a status code.

        Proved through the route rather than against the module, because the
        thing that breaks is the mapping: an `HTTPException` with a code and no
        detail is a control that fails silently (§104).
        """
        _account(client)
        project_id = _project(client)

        response = _import(client, project_id,
                           url="https://evil.example.com/data.csv")

        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert "evil.example.com" in detail
        assert "is not one of the repositories this installation searches" in detail
        assert serving.asked == [], "a refused address was fetched anyway"

    def test_a_project_that_is_not_yours_cannot_be_imported_into(
            self, client, serving):
        """Cross-project leakage, this repository's named recurring defect.

        404 rather than 403 by the rule `scoped_project` states: an account
        should not learn that someone else's project id exists. And nothing is
        downloaded on the way to finding that out — a route that fetched first
        and checked afterwards would be usable by anyone with an account.
        """
        _account(client)
        somebody_elses = _another_researchers_project()

        response = _import(client, somebody_elses)

        assert response.status_code == 404, response.text
        assert serving.asked == [], "someone else's project still fetched"
