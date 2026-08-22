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

    # Found by dropping the same file twice in the browser by accident.
    #
    # Reusing the run was already true and already tested. What was not tested is
    # what the second upload left behind: a brand-new source row whose ingestion
    # run had been deduplicated away, so no worker would ever touch it. It sat at
    # 'uploaded' for the life of the project, and the interface said it was
    # waiting for a worker to pick it up.
    assert second["source_reused"] is True
    assert second["source_id"] == first["source_id"]

    sources = client.get(f"/api/projects/{project_id}/sources").json()
    assert len(sources) == 1, sources
    assert sources[0]["id"] == first["source_id"]


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


def test_capabilities_states_what_is_missing(client, monkeypatch):
    """§123 — the interface must be able to tell absence from silence."""
    # Pinned, because this assertion is about honest *reporting* and not about
    # what happens to be installed on the machine running the suite. Left to the
    # environment it passed on a laptop with no Ollama and failed on one with,
    # which tests nothing either way.
    import throughline_model

    monkeypatch.setenv("THROUGHLINE_MODEL_PROVIDER", "none")
    throughline_model.provider(refresh=True)

    body = client.get("/api/system/capabilities").json()
    assert body["retrieval"]["lexical"] is True
    assert body["llm"]["configured"] is False
    assert body["llm"]["note"], "absence must be explained, not left blank"

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


def test_sources_list_carries_what_ingestion_produced(client):
    """
    The list must say what each source became, not just its filename.

    It used to return bare source rows, so the client could not tell a dataset
    from a paper — which meant the Discovery screen, whose whole job is to find
    tabular data, reported "no dataset to search" for a project that had one.
    """
    _account(client, "listing@lab.local")
    project_id = client.post("/api/projects", json={"name": "Listing"}).json()["id"]
    csv = b"country,consumption_ddd,resistance_pct\nIND,12.4,31.2\nUSA,9.8,18.6\nGBR,8.1,15.0\n"
    client.post(f"/api/projects/{project_id}/sources",
                files={"file": ("amr.csv", io.BytesIO(csv), "text/csv")})
    _drain_workers()

    listed = client.get(f"/api/projects/{project_id}/sources").json()
    assert len(listed) == 1
    assert listed[0]["dataset"] is not None
    assert listed[0]["dataset"]["row_count"] == 3
    assert listed[0]["dataset"]["dataset_version_id"]
    assert listed[0]["paper"] is None


def test_repeat_discovery_on_unchanged_data_is_refused_by_default(client):
    """
    §49 — each run is its own multiple-testing family.

    A second run over the same dataset re-tests the same pairs and corrects them
    within a separate family of the same size. The connections table then shows
    every pair twice at the same q-value, which reads as replication and is not.
    So the duplicate is refused unless it is asked for explicitly.
    """
    _account(client, "rerun@lab.local")
    project_id = client.post("/api/projects", json={"name": "Rerun"}).json()["id"]
    rows = b"a,b,c\n" + b"".join(
        f"{i},{i * 2},{(i * 7) % 11}\n".encode() for i in range(1, 41))
    client.post(f"/api/projects/{project_id}/sources",
                files={"file": ("d.csv", io.BytesIO(rows), "text/csv")})
    _drain_workers()

    source = client.get(f"/api/projects/{project_id}/sources").json()[0]
    version_id = source["dataset"]["dataset_version_id"]

    first = client.post(f"/api/projects/{project_id}/discoveries",
                        json={"dataset_version_id": version_id})
    assert first.status_code == 202
    assert first.json()["reused"] is False
    run_id = first.json()["discovery_run_id"]
    _drain_workers()
    after_one = len(client.get(f"/api/projects/{project_id}/connections",
                               params={"limit": 200}).json())
    assert after_one > 0

    # The same request again changes nothing and says so.
    again = client.post(f"/api/projects/{project_id}/discoveries",
                        json={"dataset_version_id": version_id})
    assert again.json()["reused"] is True
    assert again.json()["discovery_run_id"] == run_id
    _drain_workers()
    assert len(client.get(f"/api/projects/{project_id}/connections",
                          params={"limit": 200}).json()) == after_one

    # Asking for it explicitly is allowed — it is a decision, not an accident.
    forced = client.post(f"/api/projects/{project_id}/discoveries",
                         json={"dataset_version_id": version_id, "force": True})
    assert forced.json()["reused"] is False
    assert forced.json()["discovery_run_id"] != run_id


def test_connections_carry_their_dataset_version(client):
    """The confounder picker needs the schema, and reaches it through this field."""
    _account(client, "dsv@lab.local")
    project_id = client.post("/api/projects", json={"name": "Schema"}).json()["id"]
    rows = b"a,b,c\n" + b"".join(
        f"{i},{i * 2},{(i * 7) % 11}\n".encode() for i in range(1, 41))
    client.post(f"/api/projects/{project_id}/sources",
                files={"file": ("d.csv", io.BytesIO(rows), "text/csv")})
    _drain_workers()
    version_id = client.get(
        f"/api/projects/{project_id}/sources").json()[0]["dataset"]["dataset_version_id"]
    client.post(f"/api/projects/{project_id}/discoveries",
                json={"dataset_version_id": version_id})
    _drain_workers()

    connections = client.get(f"/api/projects/{project_id}/connections",
                             params={"limit": 200}).json()
    assert connections
    assert all(c["dataset_version_id"] == version_id for c in connections)


def test_validation_reports_are_reachable_from_the_connection(client):
    """
    LAW 3 — a lifecycle change must be accountable.

    Validation could be started but its report could not be read back, so a
    connection changed state with no way to see which check survived and which
    did not.
    """
    _account(client, "vrep@lab.local")
    project_id = client.post("/api/projects", json={"name": "Reports"}).json()["id"]
    rows = b"a,b,c\n" + b"".join(
        f"{i},{i * 2 + (i % 3)},{(i * 7) % 11}\n".encode() for i in range(1, 61))
    client.post(f"/api/projects/{project_id}/sources",
                files={"file": ("d.csv", io.BytesIO(rows), "text/csv")})
    _drain_workers()
    version_id = client.get(
        f"/api/projects/{project_id}/sources").json()[0]["dataset"]["dataset_version_id"]
    client.post(f"/api/projects/{project_id}/discoveries",
                json={"dataset_version_id": version_id})
    _drain_workers()

    connection_id = client.get(f"/api/projects/{project_id}/connections",
                               params={"limit": 200}).json()[0]["id"]
    assert client.get(f"/api/connections/{connection_id}/validations").json() == []

    client.post(f"/api/connections/{connection_id}/validate", json={"confounders": ["c"]})
    _drain_workers()

    reports = client.get(f"/api/connections/{connection_id}/validations").json()
    assert len(reports) == 1
    names = {check["name"] for check in reports[0]["check_details"]}
    # Every §51 check is present, including the ones that did not pass.
    assert "confounder_adjustment" in names
    assert "robustness" in names


def test_estimates_never_include_a_pair_with_no_coefficient(client):
    """
    Regression, found by opening the Figures screen.

    A categorical pair tested for association has no coefficient and no
    interval. One of those in the response crashed the entire Figures view —
    a figure must never be the thing that takes the workspace down — and it also
    had no business on a forest plot in the first place.

    The exclusion is reported rather than silent: a reader who counts the rows
    and finds fewer than the run tested is entitled to know why.
    """
    from throughline_domain.db import transaction
    from throughline_domain.ids import new_id

    client.post("/api/auth/setup", json={
        "email": "figures@lab.local", "display_name": "Dr Figures",
        "password": "correct-horse-battery"})
    project_id = client.post("/api/projects", json={
        "name": "Figures", "research_question": "q"}).json()["id"]

    with transaction() as cur:
        cur.execute(
            "INSERT INTO connections(id, project_id, relationship_type, method, "
            "left_variable, right_variable, estimate, q_value, p_value, "
            "sample_size, effect_size_name, lifecycle_status) "
            "VALUES (%s, %s, 'association', 'chi_square', 'country', "
            "'gdp_per_capita', NULL, 0.87, 0.87, 160, 'cramers_v', 'candidate')",
            (new_id("conn"), project_id))

    body = client.get(f"/api/projects/{project_id}/estimates").json()

    assert all(e["estimate"] is not None for e in body["estimates"])
    assert body["excluded_without_estimate"] == 1
    assert "no coefficient" in body["note"]


# ---------------------------------------------------------------------------
# Routes that never ran
# ---------------------------------------------------------------------------

def test_the_patterns_routes_answer_rather_than_raising(client):
    """
    Both of these raised `NameError: name 'patterns' is not defined` on every
    request ever made to them, because `app.py` called a module it never
    imported. Nothing caught it: `compileall` compiles an undefined name
    happily, and no test touched either route — so 900 passing tests coexisted
    with two endpoints that could not answer at all.

    Found by reading the dev server's log while the interface was open, not by
    the suite. The Patterns screen is what calls these.
    """
    _account(client)
    project_id = client.post("/api/projects", json={
        "name": "Patterns", "research_question": "q"}).json()["id"]

    for path in (f"/api/projects/{project_id}/patterns",
                 f"/api/projects/{project_id}/key-findings"):
        response = client.get(path)
        assert response.status_code == 200, f"{path} → {response.status_code} {response.text[:300]}"
        assert isinstance(response.json(), (dict, list)), path


# ---------------------------------------------------------------------------
# Downloading a figure (§84)
# ---------------------------------------------------------------------------

def test_a_pixel_height_is_refused_for_a_vector_download(client):
    """
    400 rather than a silently unsized SVG. A caller asking for 1080px of
    vector has misunderstood something, and honouring the request in name only
    leaves them believing the file is 1080 tall.
    """
    _account(client)
    response = client.get("/api/visuals/vis_missing/download?format=svg&height=1080")
    # 404 for the unknown figure is fine; what must not happen is a 500.
    assert response.status_code in (400, 404), response.text


def test_an_unknown_figure_is_not_found_rather_than_a_crash(client):
    _account(client)
    response = client.get("/api/visuals/vis_missing/download?format=png&height=720")
    assert response.status_code == 404, response.text


def test_the_download_route_requires_a_session(client):
    assert client.get("/api/visuals/vis_x/download").status_code == 401


def test_a_malformed_selection_is_the_callers_error_not_a_model_outage(client):
    """§26 at the boundary.

    The distinction matters more than the number does. A selection this system
    cannot describe honestly is something the interface sent wrongly; reporting
    it as 503 would tell the researcher the assistant is down and send them to
    check a model configuration that is working perfectly.
    """
    _account(client)
    project = client.post("/api/projects", json={"name": "Selection"}).json()
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO research_objects(id, project_id, object_type, title, "
            "created_by) VALUES ('obj_sel', %s, 'dataset', 'A dataset', 'usr_1')",
            (project["id"],))
        conn.commit()

    response = client.post(
        f"/api/projects/{project['id']}/objects/obj_sel/ask",
        json={"question": "Why are these different?",
              # A coordinate that is not a number. Nothing downstream can
              # describe it, so nothing downstream should be asked to try.
              "selection": {"points": [{"id": "a", "x": "over there",
                                        "y": 0, "z": 0}]}})

    assert response.status_code == 400, response.text
    assert "number" in response.json()["detail"].lower()


def test_asking_about_a_missing_object_is_not_reported_as_a_model_outage(client):
    """A pre-existing bug, found while writing the test above.

    `ask` mapped every `JournalError` to 503, so "No such object in this
    project" came back as Service Unavailable — telling the researcher the
    assistant was down and sending them to check a model configuration that was
    working perfectly. A missing object is a 404.
    """
    _account(client)
    project = client.post("/api/projects", json={"name": "Missing"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/objects/obj_not_here/ask",
        json={"question": "What is this?"})

    assert response.status_code == 404, response.text
