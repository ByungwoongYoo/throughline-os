"""Part B6 — the worked example is a real project, not a demo.

The claim being tested is not "a project appears". It is that everything in the
example was produced by the same pipeline a researcher's own sources go
through: the dataset is profiled, the analysis is computed in the sandbox, and
the finding traces back to a recorded run. A mocked example would satisfy the
first screen and fall apart on the second, and it would break the rule the
product sells itself on.

So these tests assert the provenance, not the pixels.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from throughline_domain import example
from throughline_domain.db import connection
from throughline_workers.runner import Worker


def _drain() -> None:
    while Worker(worker_id="example-test").run_once():
        pass


@pytest.fixture(autouse=True)
def clean_users():
    """`/api/auth/setup` creates the *first* account, so there must not be one.

    Cleaned before as well as after: another test in the session may have left
    a user behind, and setup then returns 401 rather than a session — which
    surfaces as an unauthorised call several lines later, a long way from the
    cause.
    """
    def wipe():
        with connection() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM users")

    wipe()
    yield
    wipe()


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        response = test_client.post("/api/auth/setup", json={
            "email": "example@lab.local", "password": "throughline-demo-local",
            "display_name": "Example Researcher"})
        assert response.status_code < 400, f"could not sign in: {response.text}"
        yield test_client


def test_the_corpus_is_identical_on_every_machine():
    """A worked example whose numbers move cannot be documented or supported."""
    first, second = example.dataset_csv(), example.dataset_csv()
    assert first == second
    header, *rows = first.decode().strip().split("\n")
    assert header == "country,consumption_ddd,resistance_pct,gdp_per_capita"
    assert len(rows) == example.ROWS


def test_the_paper_is_a_real_pdf():
    body = example.paper_pdf_bytes()
    assert body.startswith(b"%PDF")
    assert len(body) > 1000


def test_the_example_assembles_into_a_project_with_real_provenance(client):
    created = client.post("/api/projects/example")
    assert created.status_code == 201, created.text
    project_id = created.json()["id"]
    assert created.json()["created"] is True

    # Everything after this point is the real pipeline doing the work.
    _drain()

    sources = client.get(f"/api/projects/{project_id}/sources").json()
    assert len(sources) == 2, sources
    assert all(s["ingestion_status"] == "ready" for s in sources), sources

    dataset = next(s for s in sources if s.get("dataset"))
    version_id = dataset["dataset"]["dataset_version_id"]
    columns = client.get(f"/api/dataset-versions/{version_id}/columns").json()
    assert {c["name"] for c in columns} == {
        "country", "consumption_ddd", "resistance_pct", "gdp_per_capita"}

    # The paper was parsed to real passages, not stored as an opaque blob.
    # `passage_count` sits on the source rather than inside `paper`.
    paper = next(s for s in sources if s.get("paper"))
    assert paper["passage_count"] > 0, paper
    assert paper["paper"]["page_count"] == len(example.PAPER_PAGES)

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT status, result FROM analysis_runs WHERE project_id = %s",
                    (project_id,))
        runs = list(cur.fetchall())
        cur.execute("SELECT id, title FROM findings WHERE project_id = %s", (project_id,))
        findings = list(cur.fetchall())

    # Discovery ran real analyses rather than recording an assertion.
    assert runs, "the example produced no analysis runs"
    assert all(r["status"] == "completed" for r in runs), \
        [r["status"] for r in runs]
    assert any((r["result"] or {}).get("p_value") is not None for r in runs)

    assert findings, "the example produced no finding to look at"

    # The finding must be reachable *backwards*. A finding with no claim, no
    # evidence and no object is a dead end on screen — which is exactly what
    # measuring the click depth to the underlying rows turned up.
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT object_id FROM findings WHERE project_id = %s",
                    (project_id,))
        finding_object = cur.fetchone()["object_id"]
        cur.execute("SELECT count(*) AS n FROM evidence WHERE project_id = %s",
                    (project_id,))
        evidence_count = cur.fetchone()["n"]
        # One analysis, cited once. `create_finding` now records the analyses
        # behind a finding as its evidence for every finding, so a second
        # example-only path adds the same run twice and the screen reads
        # "2 supporting" for one result.
        cur.execute(
            "SELECT count(*) AS n FROM finding_claims fc "
            "JOIN findings f ON f.id = fc.finding_id WHERE f.project_id = %s",
            (project_id,))
        claim_count = cur.fetchone()["n"]
        # Every research object must be reachable. An object created and then
        # replaced by an UPDATE is an orphan nothing walks to.
        cur.execute(
            "SELECT count(*) AS n FROM research_objects "
            "WHERE project_id = %s AND object_type = 'finding'",
            (project_id,))
        finding_objects = cur.fetchone()["n"]

    assert finding_object, "the finding has no object, so it has no lineage node"
    assert evidence_count, "the finding has no evidence behind it"
    assert claim_count == 1, (
        f"one analysis was cited {claim_count} times")
    assert finding_objects == 1, (
        f"{finding_objects} finding objects exist; the extra ones are orphans")

    chain = client.get(f"/api/objects/{finding_object}/provenance").json()
    assert chain, "the finding's provenance chain is empty"


def test_asking_twice_does_not_produce_two_examples(client):
    first = client.post("/api/projects/example").json()
    second = client.post("/api/projects/example").json()
    assert first["id"] == second["id"]
    assert second["created"] is False

    projects = client.get("/api/projects").json()
    matching = [p for p in projects if p["name"] == example.EXAMPLE_PROJECT_NAME]
    assert len(matching) == 1, matching


def test_the_example_says_association_rather_than_cause(client):
    """The first screen a researcher sees must not teach the wrong lesson.

    The dataset carries a confounder on purpose. An example that presented a
    clean causal story would be misrepresenting both the data and the product.
    """
    project_id = client.post("/api/projects/example").json()["id"]
    _drain()

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT statement, causal_status FROM findings "
                    "WHERE project_id = %s", (project_id,))
        rows = list(cur.fetchall())

    assert rows, "no finding to check"
    assert any("association" in (r["statement"] or "").lower() for r in rows)
    assert all(r["causal_status"] == "association_only" for r in rows), rows


def test_the_example_can_be_deleted_like_any_other_project(client):
    """It is a project, not a fixture — a researcher must be able to remove it."""
    project_id = client.post("/api/projects/example").json()["id"]
    assert client.delete(f"/api/projects/{project_id}").status_code == 200
    assert all(p["id"] != project_id for p in client.get("/api/projects").json())
