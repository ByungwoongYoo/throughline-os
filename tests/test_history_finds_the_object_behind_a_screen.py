"""
The finding, source and analysis screens can find their research object (D213).

Object history — the journal and the version chain — is addressed by research
object id: `/api/projects/{id}/objects/{obj_…}/journal` and `/versions`, and
`_object_in_project` 404s on anything that is not one. The finding detail holds
`fnd_…`, the source detail holds `src_…`, the analysis detail holds `arun_…`.
Nothing joined the two, so §4.6.2's history was mounted on the board's card
detail alone; mounting it on the other three would have 404ed on every request,
which is why T136 left it out rather than shipping something broken.

`GET /api/projects/{id}/objects/lookup?kind=…&id=…` is that join, and the
failures below are the ones worth guarding:

  * a kind that stops resolving, one test each, because each is a different
    join written by a different module — `findings.create_finding` sets
    `findings.object_id`, `analysis.record_result` sets `analysis_runs.
    object_id`, `corpus.store_paper` and `store_dataset` set `object_id` on
    the paper and the dataset;
  * **a lookup answering with another project's object**, which is this
    repository's named recurring defect and here would put one researcher's
    journal on another's screen. Checked at the domain function *and* through
    the route, because the two fail differently: the query could drop its
    scope while `scoped_project` still guards the project in the path;
  * a miss reported as something other than a 404 carrying a sentence — the
    ordinary case of a finding recorded before findings had objects, or a
    source still being ingested, and a screen has to be able to say so;
  * an unknown kind answered as a 404, which would let a screen asking for the
    wrong thing look like a screen asking about something that does not exist;
  * a source that produced both a paper and a dataset resolving to whichever
    the database happened to return first — the answer has to be stable or the
    history opens on a different object between two page loads.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from throughline_domain import analysis, corpus, findings, objects
from throughline_domain.db import connection, transaction
from throughline_domain.ids import new_id
from throughline_schemas.enums import FindingType, ObjectType, SourceType

ACTOR = "usr_lookup_test"


# ---------------------------------------------------------------------------
# Rows, written by the code that actually writes them in production
# ---------------------------------------------------------------------------


def _finding(cur, project_id: str, *, with_an_object: bool = True) -> str:
    """A finding, with or without the research object a finding may lack.

    Without is not a broken state: `create_finding` documents that a researcher
    may record a finding by hand before anything computes one, and every
    finding made before findings had objects at all has a null `object_id`.
    """
    object_id = None
    if with_an_object:
        object_id = objects.create_object(
            cur, project_id=project_id, object_type=ObjectType.FINDING,
            title="Resistance tracks consumption", actor=ACTOR)
    return findings.create_finding(
        cur, project_id=project_id, title="Resistance tracks consumption",
        finding_type=FindingType.STATISTICAL, object_id=object_id, actor=ACTOR)


def _run(cur, project_id: str, *, completed: bool = True) -> str:
    """An analysis run, recorded through `record_result` as production does.

    The spec row is inserted rather than specified through `create_spec`,
    which validates variables against a dataset version — this is about the
    run's object, and a real dataset would be scenery. The *run* goes through
    the writer that creates the object, because that link is the thing being
    looked up.
    """
    spec_id = new_id("asp")
    cur.execute(
        "INSERT INTO analysis_specs (id, project_id, analysis_type, method, "
        "research_question, content_hash, created_by) "
        "VALUES (%s, %s, 'statistical', 'pearson_correlation', "
        "'Does consumption predict resistance?', %s, %s)",
        (spec_id, project_id, f"hash-{spec_id}", ACTOR))
    run_id = analysis.create_run(cur, project_id=project_id, spec_id=spec_id)
    analysis.record_result(
        cur, run_id=run_id, actor=ACTOR,
        spec_row=analysis.load_spec(cur, spec_id),
        sandbox=SimpleNamespace(
            ok=completed, policy={}, stderr="" if completed else "it died",
            duration_ms=7,
            payload=({"result": {"estimate_name": "r", "estimate": 0.62},
                      "runtime": {"python": "3.12"}} if completed
                     else {"error": "it died"})))
    return run_id


def _source(cur, project_id: str, *, title: str = "panel.csv") -> str:
    return objects.create_source(
        cur, project_id=project_id, source_type=SourceType.UPLOAD,
        title=title, actor=ACTOR)


def _paper_on(cur, project_id: str, source_id: str) -> str:
    parsed = SimpleNamespace(
        title="Antibiotic consumption and resistance in European hospitals",
        page_count=8, metadata={"parser": "pymupdf"})
    return corpus.store_paper(cur, project_id=project_id, source_id=source_id,
                              parsed=parsed, actor=ACTOR)["object_id"]


def _dataset_on(cur, project_id: str, source_id: str) -> str:
    profile = SimpleNamespace(format="csv", row_count=2, column_count=3,
                              quality_report={}, columns=[])
    return corpus.store_dataset(
        cur, project_id=project_id, source_id=source_id, name="panel",
        profile=profile, content_hash=f"ch-{source_id}", storage_key=None,
        actor=ACTOR)["object_id"]


def _project_row(cur, *, owner: str) -> str:
    """A project written straight in, for the cross-project checks.

    The domain function is being asked about a project it is not scoped to;
    going through the API to make one would prove the API's scoping, which is
    a different test in a different file.
    """
    project_id = new_id("prj")
    cur.execute(
        "INSERT INTO projects (id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Elsewhere', 'does it leak?')",
        (project_id, owner))
    return project_id


def _user_row(cur) -> str:
    user_id = new_id("usr")
    cur.execute(
        "INSERT INTO users (id, email, display_name, password_hash, "
        "password_salt) VALUES (%s, %s, 'Other Researcher', 'x', 'y')",
        (user_id, f"{user_id}@test.local"))
    return user_id


# ---------------------------------------------------------------------------
# The domain function
# ---------------------------------------------------------------------------


class TestTheLookupResolvesEachKind:
    def test_a_finding_resolves_to_its_object(self, cur, project):
        finding_id = _finding(cur, project)

        found = objects.object_for(cur, project_id=project, kind="finding",
                                   ref_id=finding_id)

        cur.execute("SELECT object_id FROM findings WHERE id = %s", (finding_id,))
        assert found == {"object_id": cur.fetchone()["object_id"],
                         "object_type": "finding"}

    def test_an_analysis_run_resolves_to_its_object(self, cur, project):
        run_id = _run(cur, project)

        found = objects.object_for(cur, project_id=project,
                                   kind="analysis_run", ref_id=run_id)

        cur.execute("SELECT object_id FROM analysis_runs WHERE id = %s", (run_id,))
        assert found == {"object_id": cur.fetchone()["object_id"],
                         "object_type": "analysis"}

    def test_a_source_resolves_to_the_paper_ingestion_made_of_it(
            self, cur, project):
        source_id = _source(cur, project, title="hospitals.pdf")
        paper_object = _paper_on(cur, project, source_id)

        found = objects.object_for(cur, project_id=project, kind="source",
                                   ref_id=source_id)

        assert found == {"object_id": paper_object, "object_type": "paper"}

    def test_a_source_resolves_to_the_dataset_when_that_is_what_it_made(
            self, cur, project):
        source_id = _source(cur, project)
        dataset_object = _dataset_on(cur, project, source_id)

        found = objects.object_for(cur, project_id=project, kind="source",
                                   ref_id=source_id)

        assert found == {"object_id": dataset_object, "object_type": "dataset"}

    def test_a_source_that_made_both_resolves_to_the_paper_every_time(
            self, cur, project):
        """One document, profiled as a table as well — the answer must be fixed.

        Without an order this is whichever row the union happens to return, so
        the history could open on the paper once and the dataset the next time.
        The paper wins because it is the source read *as* a document: it is
        titled from the document and the passages hang off it, while the
        dataset object is named after the extracted table.
        """
        source_id = _source(cur, project, title="hospitals.pdf")
        paper_object = _paper_on(cur, project, source_id)
        _dataset_on(cur, project, source_id)

        for _ in range(3):
            assert objects.object_for(cur, project_id=project, kind="source",
                                      ref_id=source_id) == {
                "object_id": paper_object, "object_type": "paper"}

    def test_the_citation_object_standing_for_the_raw_bytes_is_not_the_answer(
            self, cur, project):
        """`corpus._source_object` makes one too, and it is not the history.

        It stands for the file as it arrived rather than for anything read out
        of it, and a lookup that matched on `research_objects.source_id` alone
        would return it — for a source that has a paper as well, and for a
        source whose ingestion produced nothing else at all.
        """
        source_id = _source(cur, project, title="hospitals.pdf")
        paper_object = _paper_on(cur, project, source_id)

        cur.execute(
            "SELECT id FROM research_objects WHERE source_id = %s "
            "AND object_type = 'citation'", (source_id,))
        citation = cur.fetchone()
        assert citation is not None, "the fixture no longer makes one"

        found = objects.object_for(cur, project_id=project, kind="source",
                                   ref_id=source_id)
        assert found["object_id"] == paper_object != citation["id"]


class TestAMissIsAnOrdinaryAnswer:
    def test_a_finding_recorded_with_no_object_has_none(self, cur, project):
        finding_id = _finding(cur, project, with_an_object=False)

        assert objects.object_for(cur, project_id=project, kind="finding",
                                  ref_id=finding_id) is None

    def test_a_failed_run_has_none(self, cur, project):
        """`record_result` only makes an object when the sandbox succeeded."""
        run_id = _run(cur, project, completed=False)

        assert objects.object_for(cur, project_id=project, kind="analysis_run",
                                  ref_id=run_id) is None

    def test_a_source_still_being_ingested_has_none(self, cur, project):
        source_id = _source(cur, project)

        assert objects.object_for(cur, project_id=project, kind="source",
                                  ref_id=source_id) is None

    def test_an_id_that_names_nothing_has_none(self, cur, project):
        assert objects.object_for(cur, project_id=project, kind="finding",
                                  ref_id="fnd_nothing") is None

    @pytest.mark.parametrize("kind", ["findings", "analysis", "run", "object", ""])
    def test_a_kind_it_does_not_know_is_refused_rather_than_missed(
            self, cur, project, kind):
        """A typo'd kind is a caller's bug, and `None` would hide it.

        Reported as a miss, a screen asking for `kind=findings` would render
        "there is no history for this" forever, and the mistake would look
        like an absence of data.
        """
        with pytest.raises(objects.ObjectError) as refusal:
            objects.object_for(cur, project_id=project, kind=kind,
                               ref_id="fnd_1")

        assert "finding" in str(refusal.value), "the known kinds are not named"


class TestNothingResolvesAcrossAProject:
    """The named recurring defect, at the one function whose whole job is to
    hand back an id that another route will then trust."""

    def test_another_projects_finding_is_a_miss(self, cur, project):
        elsewhere = _project_row(cur, owner=_user_row(cur))
        finding_id = _finding(cur, elsewhere)

        assert objects.object_for(cur, project_id=project, kind="finding",
                                  ref_id=finding_id) is None
        # And the row really does resolve when asked in its own project, so
        # the miss above is the scoping rather than a broken fixture.
        assert objects.object_for(cur, project_id=elsewhere, kind="finding",
                                  ref_id=finding_id) is not None

    def test_another_projects_run_is_a_miss(self, cur, project):
        elsewhere = _project_row(cur, owner=_user_row(cur))
        run_id = _run(cur, elsewhere)

        assert objects.object_for(cur, project_id=project, kind="analysis_run",
                                  ref_id=run_id) is None
        assert objects.object_for(cur, project_id=elsewhere,
                                  kind="analysis_run", ref_id=run_id) is not None

    def test_another_projects_source_is_a_miss(self, cur, project):
        elsewhere = _project_row(cur, owner=_user_row(cur))
        source_id = _source(cur, elsewhere, title="hospitals.pdf")
        _paper_on(cur, elsewhere, source_id)

        assert objects.object_for(cur, project_id=project, kind="source",
                                  ref_id=source_id) is None
        assert objects.object_for(cur, project_id=elsewhere, kind="source",
                                  ref_id=source_id) is not None


# ---------------------------------------------------------------------------
# The route
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
        "email": f"hist-{uuid.uuid4().hex[:8]}@lab.local",
        "display_name": "Lead", "password": "correct-horse-battery",
    }).status_code == 200


def _signed_in_project(client, name: str = "History") -> str:
    _account(client)
    return client.post("/api/projects", json={"name": name}).json()["id"]


def _lookup(client, project_id: str, kind: str, ref_id: str):
    return client.get(f"/api/projects/{project_id}/objects/lookup",
                      params={"kind": kind, "id": ref_id})


class TestTheRouteTheScreensCall:
    def test_a_finding_id_answers_with_the_object_id(self, client):
        project_id = _signed_in_project(client)
        with transaction() as cur:
            finding_id = _finding(cur, project_id)

        response = _lookup(client, project_id, "finding", finding_id)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["object_id"].startswith("obj_")
        assert body["object_type"] == "finding"

    def test_the_object_it_returns_opens_the_history(self, client):
        """The point of the route, checked end to end.

        Resolving to an id the journal route then refuses would be a lookup
        that answers and a screen that still cannot mount its history.
        """
        project_id = _signed_in_project(client)
        with transaction() as cur:
            finding_id = _finding(cur, project_id)

        object_id = _lookup(client, project_id, "finding",
                            finding_id).json()["object_id"]
        journal = client.get(
            f"/api/projects/{project_id}/objects/{object_id}/journal")
        versions = client.get(
            f"/api/projects/{project_id}/objects/{object_id}/versions")

        assert journal.status_code == 200, journal.text
        assert versions.status_code == 200, versions.text

    def test_a_run_id_answers_with_the_object_id(self, client):
        project_id = _signed_in_project(client)
        with transaction() as cur:
            run_id = _run(cur, project_id)

        response = _lookup(client, project_id, "analysis_run", run_id)

        assert response.status_code == 200, response.text
        assert response.json()["object_type"] == "analysis"

    def test_a_source_id_answers_with_the_object_id(self, client):
        project_id = _signed_in_project(client)
        with transaction() as cur:
            source_id = _source(cur, project_id, title="hospitals.pdf")
            _paper_on(cur, project_id, source_id)

        response = _lookup(client, project_id, "source", source_id)

        assert response.status_code == 200, response.text
        assert response.json()["object_type"] == "paper"

    def test_nothing_to_show_is_a_404_with_a_sentence(self, client):
        """Not an empty 200, and not a bare "Not Found".

        The screen has to say *why* there is no history, and "a finding
        recorded before findings had objects" is a sentence a researcher can
        act on where a status code is not.
        """
        project_id = _signed_in_project(client)
        with transaction() as cur:
            finding_id = _finding(cur, project_id, with_an_object=False)

        response = _lookup(client, project_id, "finding", finding_id)

        assert response.status_code == 404
        detail = response.json()["detail"]
        assert detail.endswith("."), f"not a sentence: {detail!r}"
        assert "finding" in detail.lower(), detail
        assert len(detail.split()) > 6, f"nothing a screen can show: {detail!r}"

    @pytest.mark.parametrize("kind, word", [("analysis_run", "run"),
                                            ("source", "source")])
    def test_every_kind_has_its_own_sentence(self, client, kind, word):
        """One message for all three would explain none of them.

        A run has no object because it failed or has not finished; a source has
        none because ingestion has not produced a paper or a dataset yet. Those
        are different things to tell a researcher.
        """
        project_id = _signed_in_project(client)

        response = _lookup(client, project_id, kind, f"{kind}_nothing")

        assert response.status_code == 404
        assert word in response.json()["detail"].lower()

    @pytest.mark.parametrize("kind", ["findings", "paper", "obj", ""])
    def test_a_kind_the_route_does_not_serve_is_422_not_404(self, client, kind):
        """A caller's mistake, answered as one.

        404 would tell a screen asking for the wrong kind that the thing it
        asked about does not exist, which is the wrong repair for the wrong
        bug.
        """
        project_id = _signed_in_project(client)

        response = _lookup(client, project_id, kind, "fnd_1")

        assert response.status_code == 422, response.text

    def test_the_id_is_required(self, client):
        project_id = _signed_in_project(client)

        response = client.get(f"/api/projects/{project_id}/objects/lookup",
                              params={"kind": "finding"})

        assert response.status_code == 422, response.text

    def test_it_does_not_answer_about_a_project_the_caller_does_not_own(
            self, client):
        """Another researcher's finding, asked for under their project id.

        404 rather than 403, which is what `scoped_project` gives everywhere:
        an account must not learn that someone else's project id exists.
        """
        project_id = _signed_in_project(client)
        with connection() as conn, conn.cursor() as cur:
            elsewhere = _project_row(cur, owner=_user_row(cur))
            finding_id = _finding(cur, elsewhere)
            conn.commit()

        response = _lookup(client, elsewhere, "finding", finding_id)

        assert response.status_code == 404
        assert response.json()["detail"] == "Project not found."
        # The same finding, asked for under a project the caller *does* own,
        # is also a miss — the scope is on the row, not only on the path.
        assert _lookup(client, project_id, "finding",
                       finding_id).status_code == 404
