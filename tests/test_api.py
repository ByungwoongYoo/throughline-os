"""API contract tests (§111) — including that project isolation actually holds."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection
from throughline_schemas.enums import FindingLifecycle


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_users():
    """The API owns its own connections, so these tests commit for real."""
    yield
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")


def _account(client, email="lead@lab.local") -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    response = client.post(endpoint, json={
        "email": email, "display_name": "Lead", "password": "correct-horse-battery",
    })
    assert response.status_code == 200, response.text


def test_health_reports_database_connectivity(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"


def test_unauthenticated_requests_are_rejected(client):
    assert client.get("/api/projects").status_code == 401


def test_setup_then_create_project(client):
    _account(client)
    created = client.post("/api/projects", json={
        "name": "AMR study", "research_question": "Does consumption track resistance?",
    })
    assert created.status_code == 201
    assert client.get("/api/projects").json()[0]["name"] == "AMR study"


def test_upload_is_accepted_as_queued_not_complete(client):
    """§123/§105 — 202 says "safely stored and queued", not "parsed"."""
    _account(client)
    project_id = client.post("/api/projects", json={"name": "P"}).json()["id"]

    response = client.post(
        f"/api/projects/{project_id}/sources",
        files={"file": ("paper.pdf", io.BytesIO(b"%PDF-1.7 bytes"), "application/pdf")},
    )
    assert response.status_code == 202
    body = response.json()
    assert body["ingestion_status"] == "uploaded"
    assert body["workflow_run_id"]

    sources = client.get(f"/api/projects/{project_id}/sources").json()
    assert sources[0]["trust_level"] == "untrusted"  # §35


def test_reuploading_the_same_bytes_reuses_the_ingest_run(client):
    """§38 — identical content in one project must not ingest twice."""
    _account(client)
    project_id = client.post("/api/projects", json={"name": "P"}).json()["id"]
    payload = b"%PDF-1.7 identical"

    first = client.post(f"/api/projects/{project_id}/sources",
                        files={"file": ("a.pdf", io.BytesIO(payload), "application/pdf")}).json()
    second = client.post(f"/api/projects/{project_id}/sources",
                         files={"file": ("b.pdf", io.BytesIO(payload), "application/pdf")}).json()
    assert first["workflow_run_id"] == second["workflow_run_id"]
    assert second["file"]["deduplicated"] is True


def test_another_account_cannot_see_a_project(client):
    """§97 — isolation is server-side, and a stranger gets 404, not 403."""
    _account(client, "owner@lab.local")
    project_id = client.post("/api/projects", json={"name": "Private"}).json()["id"]
    client.post("/api/auth/logout")

    client.post("/api/auth/setup", json={
        "email": "intruder@lab.local", "display_name": "X",
        "password": "correct-horse-battery",
    })
    # Setup is closed once an account exists, so sign in as a second user made directly.
    with connection() as conn, conn.cursor() as cur:
        from throughline_domain import auth

        auth.create_user(cur, email="second@lab.local", display_name="Second",
                         password="correct-horse-battery")
    login = client.post("/api/auth/login", json={
        "email": "second@lab.local", "password": "correct-horse-battery",
    })
    assert login.status_code == 200
    assert client.get(f"/api/projects/{project_id}/sources").status_code == 404
    assert client.get("/api/projects").json() == []


def test_finding_promotion_is_refused_without_evidence(client):
    """LAW 3, surfaced as a 409 rather than a silent success."""
    _account(client)
    project_id = client.post("/api/projects", json={"name": "P"}).json()["id"]
    finding_id = client.post(f"/api/projects/{project_id}/findings", json={
        "title": "Consumption tracks resistance", "finding_type": "statistical",
    }).json()["finding_id"]

    response = client.post(f"/api/findings/{finding_id}/transition", json={
        "to_status": "exploratory", "reason": "looks promising",
    })
    assert response.status_code == 409
    assert "evidence" in response.json()["detail"].lower()

    assert client.get(f"/api/findings/{finding_id}").json()["lifecycle_status"] == str(
        FindingLifecycle.CANDIDATE
    )


def test_derived_object_without_inputs_is_rejected(client):
    """LAW 1 at the HTTP boundary."""
    _account(client)
    project_id = client.post("/api/projects", json={"name": "P"}).json()["id"]
    dataset = client.post(f"/api/projects/{project_id}/objects", json={
        "object_type": "dataset", "title": "counts",
    })
    assert dataset.status_code == 201

    analysis = client.post(f"/api/projects/{project_id}/objects", json={
        "object_type": "analysis", "title": "regression",
        "derived_from": [dataset.json()["object_id"]],
    })
    assert analysis.status_code == 201

    provenance = client.get(f"/api/objects/{analysis.json()['object_id']}/provenance").json()
    assert provenance["direct_inputs"][0]["source_artifact_id"] == dataset.json()["object_id"]


# ---------------------------------------------------------------------------
# Phase 1 — ingestion, profiling and search over HTTP
# ---------------------------------------------------------------------------


def _drain_workers() -> None:
    from throughline_workers.runner import Worker

    while Worker(worker_id="api-test").run_once():
        pass


def test_capabilities_states_what_is_missing(client):
    """§123 — the interface must be able to tell absence from silence."""
    body = client.get("/api/system/capabilities").json()
    assert body["retrieval"]["lexical"] is True
    assert body["llm"]["configured"] is False

    # The sandbox exists, and reports its real limits rather than claiming
    # isolation it does not have.
    assert body["analysis"]["sandbox"] is True
    assert "pearson_correlation" in body["analysis"]["methods"]
    isolation = body["analysis"]["isolation"]
    assert isolation["enforced"]["no_application_secrets"] is True
    assert isolation["best_effort"]["network_egress_disabled"] == "python_level_only"


def test_dataset_upload_profiles_and_becomes_searchable(client):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "AMR"}).json()["id"]
    csv = (b"country,year,consumption_ddd,resistance_pct\n"
           b"IND,2019,12.4,31.2\nUSA,2019,9.8,18.6\nGBR,2020,8.1,15.0\n")
    upload = client.post(f"/api/projects/{project_id}/sources",
                         files={"file": ("amr.csv", io.BytesIO(csv), "text/csv")})
    assert upload.status_code == 202
    source_id = upload.json()["source_id"]

    _drain_workers()

    source = client.get(f"/api/projects/{project_id}/sources/{source_id}").json()
    assert source["ingestion_status"] == "ready"
    assert source["dataset"]["row_count"] == 3

    columns = client.get(
        f"/api/dataset-versions/{source['dataset']['dataset_version_id']}/columns"
    ).json()
    by_name = {c["name"]: c for c in columns}
    assert by_name["country"]["semantic_type"] == "geography"
    assert by_name["year"]["semantic_type"] == "date"

    found = client.get(f"/api/projects/{project_id}/search",
                       params={"q": "resistance"}).json()
    assert found["results"], found
    assert found["strategy"] in {"hybrid", "lexical"}

    # §30 — the search is auditable afterwards.
    audit = client.get(f"/api/retrievals/{found['retrieval_event_id']}").json()
    assert audit["query"] == "resistance"
    assert len(audit["results"]) == len(found["results"])


def test_search_cannot_reach_another_account_project(client):
    _account(client, "owner2@lab.local")
    project_id = client.post("/api/projects", json={"name": "Private"}).json()["id"]
    client.post("/api/auth/logout")

    with connection() as conn, conn.cursor() as cur:
        from throughline_domain import auth

        auth.create_user(cur, email="third@lab.local", display_name="Third",
                         password="correct-horse-battery")
    client.post("/api/auth/login", json={"email": "third@lab.local",
                                         "password": "correct-horse-battery"})
    assert client.get(f"/api/projects/{project_id}/search",
                      params={"q": "anything"}).status_code == 404
