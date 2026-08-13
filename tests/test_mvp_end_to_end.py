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

    connections = client.get(f"/api/projects/{project_id}/connections",
                             params={"status": "validated"}).json()
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
    finding_id = client.post(f"/api/projects/{project_id}/findings", json={
        "title": "Antibiotic consumption is associated with resistance",
        "finding_type": "statistical",
        "statement": "Higher national consumption tracks higher resistance.",
    }).json()["finding_id"]

    # Promotion without evidence is refused.
    assert client.post(f"/api/findings/{finding_id}/transition", json={
        "to_status": "exploratory", "reason": "the analysis supports it",
    }).status_code == 409

    # Attach the computed result as evidence, and link the finding to the
    # connection so the evidence graph can reach the analysis behind it.
    with connection() as conn, conn.cursor() as cur:
        from throughline_domain import findings as findings_domain
        from throughline_domain import lineage, objects
        from throughline_domain.ids import new_id
        from throughline_schemas.enums import (
            ClaimType, EvidenceDirection, EvidenceType, LineageType, ObjectType,
        )

        cur.execute("SELECT object_id, analysis_run_id FROM connections WHERE id = %s",
                    (target["id"],))
        conn_row = cur.fetchone()
        cur.execute("SELECT result, object_id FROM analysis_runs WHERE id = %s",
                    (conn_row["analysis_run_id"],))
        analysis_row = cur.fetchone()
        result = analysis_row["result"]

        claim_id = new_id("clm")
        cur.execute(
            "INSERT INTO claims(id, project_id, statement, claim_type, created_by) "
            "VALUES (%s, %s, %s, %s, %s)",
            (claim_id, project_id,
             f"{result['estimate_name']} = {result['estimate']:.4f} "
             f"(p = {result['p_value']:.3g}, n = {result['sample_size']})",
             str(ClaimType.CALCULATED_RESULT), "test"),
        )
        cur.execute(
            "INSERT INTO evidence(id, project_id, claim_id, source_object_id, "
            "evidence_type, location, direction, strength) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (new_id("evd"), project_id, claim_id, analysis_row["object_id"],
             str(EvidenceType.ANALYSIS_RESULT),
             {"analysis_run_id": conn_row["analysis_run_id"]},
             str(EvidenceDirection.SUPPORTS), 0.9),
        )
        findings_domain.attach_claim(cur, finding_id=finding_id, claim_id=claim_id)

        finding_object = objects.create_object(
            cur, project_id=project_id, object_type=ObjectType.FINDING,
            title="Consumption ↔ resistance", actor="test",
            derived_from=[analysis_row["object_id"]],
        )
        cur.execute("UPDATE findings SET object_id = %s WHERE id = %s",
                    (finding_object, finding_id))

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
