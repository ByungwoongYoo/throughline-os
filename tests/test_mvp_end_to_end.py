"""§137 — the MVP differentiator, as one test.

    PAPER + DATASET → CONNECTION → REAL ANALYSIS → VALIDATION → FINDING
    → EVIDENCE → PROVENANCE

§125 describes this workflow and says it "must work before the platform is
considered successful". This test walks it end to end over HTTP, with a real
PDF, a real dataset, real sandboxed computation and real lifecycle gates.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection
from throughline_workers.runner import Worker


def _amr_csv(n: int = 120) -> bytes:
    """Consumption drives resistance; GDP is a plausible-looking confounder."""
    rng = np.random.default_rng(2024)
    consumption = rng.normal(25, 6, n)
    gdp = rng.normal(40000, 12000, n)
    resistance = 0.85 * consumption + rng.normal(0, 2.5, n)
    rows = ["country,consumption_ddd,resistance_pct,gdp_per_capita"]
    codes = ["IND", "USA", "GBR", "FRA", "DEU", "BRA", "JPN", "ZAF"]
    for i in range(n):
        rows.append(f"{codes[i % 8]},{consumption[i]:.3f},{resistance[i]:.3f},{gdp[i]:.1f}")
    return ("\n".join(rows) + "\n").encode()


def _drain() -> None:
    while Worker(worker_id="mvp-test").run_once():
        pass


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


def test_paper_plus_dataset_to_validated_finding_with_full_provenance(
        client, paper_pdf, paper_search_term):
    # --- the researcher signs in and states a question ----------------------
    client.post("/api/auth/setup", json={
        "email": "chen@lab.local", "display_name": "Dr Chen",
        "password": "correct-horse-battery",
    })
    project_id = client.post("/api/projects", json={
        "name": "Antimicrobial resistance",
        "research_question": ("Is antibiotic consumption associated with resistance, "
                              "and does GDP explain the relationship?"),
    }).json()["id"]

    # --- DROP: a real paper and a dataset -----------------------------------
    client.post(f"/api/projects/{project_id}/sources",
                files={"file": (paper_pdf.name, io.BytesIO(paper_pdf.read_bytes()),
                                "application/pdf")})
    dataset_source = client.post(
        f"/api/projects/{project_id}/sources",
        files={"file": ("amr.csv", io.BytesIO(_amr_csv()), "text/csv")},
    ).json()["source_id"]
    _drain()

    sources = client.get(f"/api/projects/{project_id}/sources").json()
    assert {s["ingestion_status"] for s in sources} == {"ready"}, sources

    detail = client.get(f"/api/projects/{project_id}/sources/{dataset_source}").json()
    version_id = detail["dataset"]["dataset_version_id"]

    # The paper is searchable, with exact locators (§27, §29).
    hits = client.get(f"/api/projects/{project_id}/search",
                      params={"q": paper_search_term}).json()
    assert hits["results"] and hits["results"][0]["locator"]

    # --- DISCOVER: candidates, tested and corrected (§48, §49) --------------
    discovery_id = client.post(f"/api/projects/{project_id}/discoveries", json={
        "dataset_version_id": version_id,
    }).json()["discovery_run_id"]
    _drain()

    run = client.get(f"/api/discoveries/{discovery_id}").json()
    assert run["status"] == "complete"
    assert run["tests_run"] >= 3

    exploratory = [c for c in run["connections"] if c["lifecycle_status"] == "exploratory"]
    target = next(c for c in exploratory
                  if {c["left_variable"], c["right_variable"]}
                  == {"consumption_ddd", "resistance_pct"})
    # LAW 2 — the connection carries the computation that produced it.
    assert target["analysis_run_id"] and target["q_value"] <= 0.05

    # The unrelated pair must not have been promoted.
    assert not any({c["left_variable"], c["right_variable"]}
                   == {"gdp_per_capita", "resistance_pct"} for c in exploratory)

    # --- VALIDATE: try to destroy it (§51) ----------------------------------
    client.post(f"/api/connections/{target['id']}/validate",
                json={"confounders": ["gdp_per_capita"]})
    _drain()

    answer = client.get(f"/api/projects/{project_id}/connections",
                        params={"status": "validated"})
    connections = answer.json()
    # The shape first, and the reason it is checked at all: this returned a
    # dict once under the full suite — an error payload rather than a list —
    # and `c["id"]` on a dict's keys raises `TypeError: string indices must be
    # integers`, which fires *inside* the generator before the diagnostic on
    # the next line can be evaluated. The run then reported a TypeError and
    # named neither the status nor the body, which is D048's open complaint
    # about a failure that leaves nothing behind.
    assert isinstance(connections, list), (
        f"connections came back as {type(connections).__name__} "
        f"(HTTP {answer.status_code}): {connections}")
    assert any(c["id"] == target["id"] for c in connections), \
        client.get(f"/api/projects/{project_id}/connections").json()

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM validation_reports WHERE connection_id = %s",
                    (target["id"],))
        report_id = cur.fetchone()["id"]
    report = client.get(f"/api/validations/{report_id}").json()
    assert report["passed"] is True
    # Every check names the analysis that produced it, or explains itself.
    assert {c["name"] for c in report["check_details"]} >= {
        "robustness", "sensitivity", "confounder_adjustment",
        "multiple_comparison_correction", "missingness", "outliers",
    }
    assert any(c["analysis_run_id"] for c in report["check_details"])

    # --- FINDING: evidence first, promotion second (LAW 3, §13) -------------
    #
    # This section used to hand-write the claim, the evidence row and the
    # finding's object in raw SQL, because nothing in the product could do it:
    # `attach_claim` had exactly one caller, the worked example's handler, so a
    # researcher's own finding had no evidence and could never leave CANDIDATE.
    # The test that exists to prove the journey works was performing by hand
    # the one step of it that did not.
    #
    # It is the product's own path now, over HTTP, with no SQL.

    # A finding written from nothing is still a hypothesis, and LAW 3 refuses
    # to promote one.
    hunch_id = client.post(f"/api/projects/{project_id}/findings", json={
        "title": "A hunch nobody has tested",
        "finding_type": "statistical",
    }).json()["finding_id"]
    refused = client.post(f"/api/findings/{hunch_id}/transition", json={
        "to_status": "exploratory", "reason": "it feels right",
    })
    assert refused.status_code == 409
    assert "evidence" in refused.json()["detail"].lower()

    # The real finding, recorded from the connection that was validated. The
    # analysis behind it becomes its evidence, which is what the researcher is
    # citing by choosing that connection.
    finding_id = client.post(f"/api/projects/{project_id}/findings", json={
        "title": "Antibiotic consumption is associated with resistance",
        "finding_type": "statistical",
        "statement": "Higher national consumption tracks higher resistance.",
        "from_connections": [target["id"]],
    }).json()["finding_id"]

    standing = client.get(f"/api/findings/{finding_id}").json()
    assert standing["evidence"]["total"] >= 1, (
        "a finding recorded from a validated connection has no evidence")

    # Now the lifecycle moves, in the order §13 requires.
    assert client.post(f"/api/findings/{finding_id}/transition", json={
        "to_status": "exploratory", "reason": "Validated connection supports it",
    }).status_code == 200

    # Candidate → validated is still refused; the §51 checks must be supplied.
    incomplete = client.post(f"/api/findings/{finding_id}/transition", json={
        "to_status": "validated", "reason": "ship it", "checks": {"robustness": True},
    })
    assert incomplete.status_code == 422

    assert client.post(f"/api/findings/{finding_id}/transition", json={
        "to_status": "validated", "reason": "Passed the §51 suite",
        "checks": report["checks"],
    }).status_code == 200

    # --- EVIDENCE GRAPH: why do we believe this? (§62) ----------------------
    graph = client.get(f"/api/findings/{finding_id}/evidence-graph").json()
    assert graph["finding"]["lifecycle_status"] == "validated"
    assert graph["claims"] and graph["claims"][0]["supporting"]
    assert graph["analyses"], "the evidence graph must reach the computation"
    assert graph["balance"]["supporting"] == 1
    assert graph["note"]  # honest about having no contradicting evidence

    # --- PROVENANCE: the finding traces back to the dataset (LAW 1) ---------
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT object_id FROM findings WHERE id = %s", (finding_id,))
        finding_object = cur.fetchone()["object_id"]
    chain = client.get(f"/api/objects/{finding_object}/provenance").json()
    types = {a["object_type"] for a in chain["ancestors"]}
    assert "analysis" in types and "dataset" in types, chain["ancestors"]

    # --- CHALLENGE: the critic can weaken it (§57) --------------------------
    client.post(f"/api/findings/{finding_id}/challenge",
                json={"confounders": ["gdp_per_capita"]})
    _drain()
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT verdict, summary FROM challenges WHERE finding_id = %s",
                    (finding_id,))
        challenge = cur.fetchone()
    assert challenge["verdict"] in {"holds", "uncertain", "weakens"}

    # --- COMMUNICATE: the work leaves the system (§74) ----------------------
    #
    # The last mile, and the one the ledger has carried as partial: drafting
    # from a connection was wired but never walked, because it needed a
    # genuinely validated connection and no test had one. `draft_from_connection`
    # has already shipped a bug for exactly that reason — it selected a column
    # `projects` does not have, so every call raised before assembling
    # anything, and nothing caught it because nothing called it.
    draft = client.post(f"/api/projects/{project_id}/artifacts/draft", json={
        "connection_id": target["id"], "artifact_type": "report",
        "audience": "researcher",
    })
    assert draft.status_code == 201, draft.text
    artifact_id = draft.json()["artifact_id"]

    document = client.get(f"/api/artifacts/{artifact_id}").json()
    assert document["blocks"], "the drafted report has no content"

    # Every number in the document is a reference to the recorded run, not a
    # literal typed beside it — which is what makes "does this figure match the
    # analysis" a question nobody has to ask.
    resolved = {key: value for block in document["blocks"]
                for key, value in (block.get("resolved") or {}).items()}
    assert resolved, "nothing in the report resolves to a recorded value"

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT result FROM analysis_runs WHERE id = %s",
                    (target["analysis_run_id"],))
        recorded = cur.fetchone()["result"]
    numbers = [v for v in resolved.values() if isinstance(v, (int, float))]
    assert any(abs(value - float(recorded["estimate"])) < 1e-9
               for value in numbers), (
        f"the report's numbers {numbers} do not include the estimate the "
        f"analysis recorded ({recorded['estimate']})")

    # And it becomes a file a researcher can actually submit.
    #
    # Opened, not weighed. Every test of this rendered a document and checked
    # `byte_size > 0` — and the API test justified going no further by saying
    # "the domain tests already prove a docx is a docx", which they do not:
    # they check the byte count too. A corrupt archive, or one that lost the
    # number on the way through, passes a size check and fails in the hands of
    # whoever it was sent to.
    import zipfile

    from throughline_domain.storage import storage_root

    rendered = client.post(f"/api/artifacts/{artifact_id}/render?fmt=docx")
    assert rendered.status_code == 200, rendered.text
    assert rendered.json()["byte_size"] > 0

    path = storage_root() / rendered.json()["storage_key"]
    assert zipfile.is_zipfile(path), "the .docx is not a readable archive"
    with zipfile.ZipFile(path) as archive:
        assert "word/document.xml" in archive.namelist(), (
            "the .docx has no document part, so Word cannot open it")
        text = " ".join(archive.read(name).decode("utf-8", "replace")
                        for name in archive.namelist()
                        if name.endswith(".xml"))

    # The estimate the analysis recorded is in the document a journal receives.
    assert f"{float(recorded['estimate']):.4f}" in text, (
        "the recorded estimate is not in the rendered document")
    # And nothing arrived as an unfilled placeholder.
    assert "{{ref:" not in text, (
        "the document still contains an unresolved reference")

    # --- DISCOVERY MAP: the project knows what to do next (§63) -------------
    overview = client.get(f"/api/projects/{project_id}/discovery-map").json()
    assert overview["counts"]["papers"] >= 1
    assert overview["counts"]["datasets"] == 1
    assert overview["counts"]["analyses"] >= 3
    assert overview["recommended_next_action"]
    assert overview["top_connections"]


def test_knowledge_graph_is_bounded_and_says_when_truncated(client):
    """§61 — never dump the whole graph into the browser."""
    client.post("/api/auth/setup", json={
        "email": "graph@lab.local", "display_name": "G",
        "password": "correct-horse-battery",
    })
    project_id = client.post("/api/projects", json={"name": "Graph"}).json()["id"]
    for i in range(5):
        client.post(f"/api/projects/{project_id}/objects",
                    json={"object_type": "concept", "title": f"concept {i}"})

    graph = client.get(f"/api/projects/{project_id}/knowledge-graph",
                       params={"limit": 3}).json()
    assert len(graph["nodes"]) == 3
    assert graph["truncated"] is True
    assert "Expand from a node" in graph["note"]
