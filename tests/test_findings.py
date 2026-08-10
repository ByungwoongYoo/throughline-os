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
