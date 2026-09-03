"""
A researcher's own finding must be able to advance.

`transition` refuses to move a finding past CANDIDATE with no linked evidence,
and counts that evidence through `finding_claims`. In the whole product, the
only writer of `finding_claims` was the worked example's handler, tagged
"system:example". Every other path — a researcher recording a finding from
their own connections — left the table empty.

So the lifecycle was closed to real work. The finding screen showed
"0 supporting · 0 contradicting" forever, "Claims and their evidence" was
permanently empty, and the error told the researcher to "Attach supporting or
contradicting evidence first" — an action the product offered no way to take.

The existing tests all pass because each one attaches its claims by hand,
with SQL written in the test file. They prove the gate holds. None of them
proved anybody could get through it.
"""

from __future__ import annotations

import pytest
from throughline_domain import analysis, findings, objects
from throughline_domain.analysis import RUN_COMPLETED
from throughline_domain.ids import new_id
from throughline_schemas.enums import (
    FindingLifecycle,
    FindingType,
    ObjectType,
)

RESULT = {
    "method": "pearson_correlation", "estimate": 0.62,
    "estimate_name": "r", "p_value": 0.001, "sample_size": 120,
}


def _succeeded_run(cur, project) -> str:
    """An analysis that really finished, with an object to point evidence at."""
    spec_id = new_id("aspec")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "variables, research_question, content_hash, created_by) "
        "VALUES (%s, %s, 'confirmatory', 'pearson_correlation', %s, %s, %s, "
        "'researcher')",
        (spec_id, project, {"x": "consumption", "y": "resistance"},
         "Does consumption track resistance?", new_id("hash")),
    )
    run_id = analysis.create_run(cur, project_id=project, spec_id=spec_id)
    object_id = objects.create_object(
        cur, project_id=project, object_type=ObjectType.ANALYSIS,
        title="Consumption vs resistance", actor="researcher")
    cur.execute(
        "UPDATE analysis_runs SET status = %s, result = %s, "
        "object_id = %s WHERE id = %s", (RUN_COMPLETED, RESULT, object_id,
                                        run_id))
    return run_id


def _connection(cur, project, run_id) -> str:
    connection_id = new_id("con")
    cur.execute(
        "INSERT INTO connections (id, project_id, analysis_run_id, "
        "left_variable, right_variable, method) "
        "VALUES (%s, %s, %s, 'consumption', 'resistance', "
        "'pearson_correlation')",
        (connection_id, project, run_id))
    return connection_id


def _finding_from_own_work(cur, project) -> str:
    connection = _connection(cur, project, _succeeded_run(cur, project))
    return findings.create_finding(
        cur, project_id=project,
        title="Consumption associates with resistance",
        finding_type=FindingType.STATISTICAL,
        from_connections=[connection], actor="researcher")


class TestTheJourneyIsWalkable:
    def test_the_analysis_behind_it_counts_as_evidence(self, cur, project):
        """
        The evidence for a finding drawn from a researcher's own analysis is
        that analysis. The system already knows the chain — it walks
        connections to analysis runs to record the finding's lineage — so
        having it record nothing as evidence was an omission, not a judgement.
        """
        finding_id = _finding_from_own_work(cur, project)
        summary = findings.evidence_summary(cur, finding_id)
        assert summary["total"] > 0, (
            "a finding built from a completed analysis has no evidence, "
            "so it can never leave CANDIDATE")

    def test_it_can_be_promoted_to_exploratory(self, cur, project):
        """The transition a researcher actually needs, end to end."""
        finding_id = _finding_from_own_work(cur, project)
        findings.transition(
            cur, finding_id=finding_id,
            to_status=FindingLifecycle.EXPLORATORY,
            reason="The analysis holds", actor="researcher")
        cur.execute("SELECT lifecycle_status FROM findings WHERE id = %s",
                    (finding_id,))
        assert cur.fetchone()["lifecycle_status"] == "exploratory"

    def test_a_finding_written_from_nothing_still_cannot_advance(
            self, cur, project):
        """
        The gate stays shut where it should. A finding a researcher typed with
        no analysis behind it is a hypothesis, and  still requires evidence
        before it becomes a claim about the world.
        """
        finding_id = findings.create_finding(
            cur, project_id=project, title="A hunch",
            finding_type=FindingType.STATISTICAL, actor="researcher")
        with pytest.raises(findings.EvidenceRequired):
            findings.transition(
                cur, finding_id=finding_id,
                to_status=FindingLifecycle.EXPLORATORY,
                reason="no", actor="researcher")

    def test_a_connection_whose_run_never_finished_is_not_evidence(
            self, cur, project):
        """An analysis that did not produce a result has shown nothing."""
        spec_id = new_id("aspec")
        cur.execute(
            "INSERT INTO analysis_specs(id, project_id, analysis_type, "
            "method, variables, research_question, content_hash, created_by) "
            "VALUES (%s, %s, 'confirmatory', 'pearson_correlation', %s, %s, "
            "%s, 'researcher')",
            (spec_id, project, {"x": "a", "y": "b"}, "?", new_id("hash")))
        run_id = analysis.create_run(cur, project_id=project, spec_id=spec_id)
        connection = _connection(cur, project, run_id)
        finding_id = findings.create_finding(
            cur, project_id=project, title="Premature",
            finding_type=FindingType.STATISTICAL,
            from_connections=[connection], actor="researcher")
        assert findings.evidence_summary(cur, finding_id)["total"] == 0
