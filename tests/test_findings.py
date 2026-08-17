"""LAW 3 and §13 — a pattern is not a finding, and promotion is earned."""

from __future__ import annotations

import pytest
from throughline_domain import findings, objects
from throughline_schemas.enums import (
    ClaimType,
    EvidenceDirection,
    EvidenceType,
    FindingLifecycle,
    FindingType,
    ObjectType,
)
from throughline_domain.ids import new_id

PASSING_CHECKS = {name: True for name in findings.REQUIRED_VALIDATION_CHECKS}


def _finding(cur, project, **kw) -> str:
    return findings.create_finding(
        cur, project_id=project, title="Consumption associates with resistance",
        finding_type=FindingType.STATISTICAL, actor="test", **kw,
    )


def _claim_with_evidence(cur, project, finding_id, direction=EvidenceDirection.SUPPORTS):
    claim_id = new_id("clm")
    cur.execute(
        "INSERT INTO claims(id, project_id, statement, claim_type, created_by) "
        "VALUES (%s, %s, %s, %s, %s)",
        (claim_id, project, "r = 0.62", str(ClaimType.CALCULATED_RESULT), "test"),
    )
    source_object = objects.create_object(
        cur, project_id=project, object_type=ObjectType.PAPER,
        title="Source paper", actor="test",
    )
    cur.execute(
        "INSERT INTO evidence(id, project_id, claim_id, source_object_id, evidence_type, "
        "location, direction) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            new_id("evd"), project, claim_id, source_object, str(EvidenceType.SOURCE_SPAN),
            {"page": 4, "char_start": 120, "char_end": 190, "verbatim_text": "…"},
            str(direction),
        ),
    )
    findings.attach_claim(cur, finding_id=finding_id, claim_id=claim_id)
    return claim_id


def test_finding_starts_as_candidate(cur, project):
    fid = _finding(cur, project)
    cur.execute("SELECT lifecycle_status FROM findings WHERE id = %s", (fid,))
    assert cur.fetchone()["lifecycle_status"] == "candidate"


def test_candidate_cannot_jump_to_validated(cur, project):
    """§13 — the interesting pattern must survive EXPLORATORY first."""
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    with pytest.raises(findings.IllegalTransition):
        findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.VALIDATED,
                            reason="looks good", actor="test", checks=PASSING_CHECKS)


def test_promotion_without_evidence_is_refused(cur, project):
    """LAW 3 — no finding without evidence, enforced in code."""
    fid = _finding(cur, project)
    with pytest.raises(findings.EvidenceRequired):
        findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                            reason="promising", actor="test")


def test_validation_requires_every_robustness_check(cur, project):
    """§51 — a check that was not run is not a check that passed."""
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                        reason="initial analysis", actor="test")

    with pytest.raises(findings.ValidationIncomplete) as exc:
        findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.VALIDATED,
                            reason="ship it", actor="test", checks={"robustness": True})
    assert "sensitivity" in str(exc.value)


def test_failed_robustness_check_blocks_validation(cur, project):
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                        reason="initial analysis", actor="test")
    checks = dict(PASSING_CHECKS, confounder_adjustment=False)
    with pytest.raises(findings.ValidationIncomplete) as exc:
        findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.VALIDATED,
                            reason="ship it", actor="test", checks=checks)
    assert "confounder_adjustment" in str(exc.value)


def test_full_legal_promotion_path_is_audited(cur, project):
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                        reason="initial analysis supports it", actor="test")
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.VALIDATED,
                        reason="passed robustness", actor="test", checks=PASSING_CHECKS)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.REPLICATED,
                        reason="second dataset agrees", actor="test")

    history = findings.lifecycle_history(cur, fid)
    assert [h["to_status"] for h in history] == [
        "candidate", "exploratory", "validated", "replicated",
    ]
    # §94 — the record shows what changed and why, not just the end state.
    assert history[2]["reason"] == "passed robustness"
    assert history[2]["checks"]["sensitivity"] is True


def test_contradicting_evidence_can_conflict_a_validated_finding(cur, project):
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                        reason="x", actor="test")
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.VALIDATED,
                        reason="x", actor="test", checks=PASSING_CHECKS)
    _claim_with_evidence(cur, project, fid, direction=EvidenceDirection.CONTRADICTS)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.CONFLICTED,
                        reason="three recent studies disagree", actor="test")

    summary = findings.evidence_summary(cur, fid)
    assert summary["supports"] == 1 and summary["contradicts"] == 1


def test_deprecated_is_terminal(cur, project):
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.DEPRECATED,
                        reason="superseded", actor="test")
    with pytest.raises(findings.IllegalTransition):
        findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                            reason="revive", actor="test")


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client
    from throughline_domain.db import connection

    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")


def test_findings_can_be_listed_for_a_project(client):
    """
    Regression, found by reading the browser's network log.

    The list route did not exist. The interface had been calling it since the
    Findings screen was built and receiving 405 on every load, so the workspace
    reported "0 findings" — an error that renders as absence, which is the worst
    kind this system can have because it is indistinguishable from the truth.
    """
    client.post("/api/auth/setup", json={
        "email": "list@lab.local", "display_name": "Dr List",
        "password": "correct-horse-battery"})
    project_id = client.post("/api/projects", json={
        "name": "Listing", "research_question": "q"}).json()["id"]

    empty = client.get(f"/api/projects/{project_id}/findings")
    assert empty.status_code == 200
    assert empty.json() == []

    created = client.post(f"/api/projects/{project_id}/findings", json={
        "title": "Consumption tracks resistance",
        "finding_type": "statistical",
        "statement": "Higher consumption is associated with higher resistance.",
    })
    assert created.status_code == 201

    listed = client.get(f"/api/projects/{project_id}/findings").json()
    assert len(listed) == 1
    assert listed[0]["title"] == "Consumption tracks resistance"
    # LAW 3 — supporting and contradicting counts travel with the finding.
    assert "evidence" in listed[0]


# ---------------------------------------------------------------------------
# D018 — the edge that makes "why do we believe this?" answerable
# ---------------------------------------------------------------------------

def _analysed_connection(cur, project):
    """A connection with a completed analysis run that has its own object."""
    dataset_object = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, created_by) "
        "VALUES (%s, %s, 'dataset', 'panel', 'test')", (dataset_object, project))

    spec_id = new_id("asp")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "content_hash, created_by, research_question, dataset_version_ids) "
        "VALUES (%s, %s, 'correlation', 'pearson', %s, 'test', 'q', '[]'::jsonb)",
        (spec_id, project, new_id("h")[:64]))

    run_object = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, created_by) "
        "VALUES (%s, %s, 'analysis', 'run', 'test')", (run_object, project))
    run_id = new_id("arun")
    cur.execute(
        "INSERT INTO analysis_runs(id, project_id, spec_id, status, object_id, result) "
        "VALUES (%s, %s, %s, 'completed', %s, '{}'::jsonb)",
        (run_id, project, spec_id, run_object))

    connection_id = new_id("conn")
    cur.execute(
        "INSERT INTO connections(id, project_id, analysis_run_id, left_variable, "
        "right_variable, method) VALUES (%s, %s, %s, 'ddd', 'res_pct', 'pearson')",
        (connection_id, project, run_id))
    return {"connection": connection_id, "run_object": run_object, "run": run_id,
            "dataset_object": dataset_object}


def test_a_finding_from_a_connection_is_attached_to_the_graph(cur, project):
    """
    `findings.object_id` was never set by any caller, so it was null for every
    finding ever created — and `graphs.evidence_graph` gates its whole
    analyses-and-connections branch on that column. The chain existed in the
    database and joined up nowhere.
    """
    parts = _analysed_connection(cur, project)
    finding_id = findings.create_finding(
        cur, project_id=project, title="ddd tracks res_pct",
        finding_type=FindingType.STATISTICAL,
        from_connections=[parts["connection"]], actor="test")

    cur.execute("SELECT object_id FROM findings WHERE id = %s", (finding_id,))
    assert cur.fetchone()["object_id"] is not None


def test_the_evidence_graph_reaches_the_analysis_behind_a_finding(cur, project):
    """
    Asserted through `evidence_graph` — the query behind "why do we believe
    this?" — rather than through the lineage table. Checking the edge alone
    would leave the thing a researcher actually opens unproven, which is how
    this went unnoticed in the first place.
    """
    from throughline_domain import graphs

    parts = _analysed_connection(cur, project)
    finding_id = findings.create_finding(
        cur, project_id=project, title="ddd tracks res_pct",
        finding_type=FindingType.STATISTICAL,
        from_connections=[parts["connection"]], actor="test")

    graph = graphs.evidence_graph(cur, finding_id=finding_id)
    assert [a["id"] for a in graph["analyses"]] == [parts["run"]]


def test_a_finding_recorded_by_hand_is_still_allowed(cur, project):
    """
    A researcher may write a finding down before anything computes one.
    Refusing that would be worse than a finding with a short chain — their
    result is not contingent on this system's bookkeeping.
    """
    finding_id = findings.create_finding(
        cur, project_id=project, title="Written by hand",
        finding_type=FindingType.STATISTICAL, actor="test")

    cur.execute("SELECT object_id FROM findings WHERE id = %s", (finding_id,))
    assert cur.fetchone()["object_id"] is None


def test_a_connection_whose_run_never_finished_does_not_break_recording(cur, project):
    """
    `create_object` refuses a derived artifact with no inputs, so a connection
    with no completed run would raise on the way in. Losing the finding to
    that would put this system's bookkeeping ahead of the researcher's result.
    """
    connection_id = new_id("conn")
    cur.execute(
        "INSERT INTO connections(id, project_id, left_variable, right_variable, "
        "method) VALUES (%s, %s, 'a', 'b', 'pearson')", (connection_id, project))

    finding_id = findings.create_finding(
        cur, project_id=project, title="Unfinished", finding_type=FindingType.STATISTICAL,
        from_connections=[connection_id], actor="test")

    cur.execute("SELECT object_id FROM findings WHERE id = %s", (finding_id,))
    assert cur.fetchone()["object_id"] is None


def test_another_projects_connection_cannot_attach_a_finding(cur, project):
    """The lookup is scoped, so a finding cannot be joined to someone else's analysis."""
    parts = _analysed_connection(cur, project)

    other = new_id("prj")
    cur.execute("SELECT owner_user_id FROM projects WHERE id = %s", (project,))
    owner = cur.fetchone()["owner_user_id"]
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Other', 'q')", (other, owner))

    finding_id = findings.create_finding(
        cur, project_id=other, title="Borrowed", finding_type=FindingType.STATISTICAL,
        from_connections=[parts["connection"]], actor="test")

    cur.execute("SELECT object_id FROM findings WHERE id = %s", (finding_id,))
    assert cur.fetchone()["object_id"] is None
