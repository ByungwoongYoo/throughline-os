"""
A finding cannot claim a check the system watched fail.

`transition` into VALIDATED requires all six REQUIRED_VALIDATION_CHECKS, and
reads them from whatever the caller sends. The rule it enforces is "a check
that was not run is not a check that passed" — absence is caught.

Contradiction was not. `validation.validate_connection` runs all six checks as
real analyses in the sandbox and records each outcome in `validation_checks`,
under exactly the names the promotion demands. Nothing compared the two. A
researcher could tick "robustness: passed" on a connection whose recorded
robustness check came back `violated`, and the finding became VALIDATED — the
strongest word this product has — against its own evidence.

The answers stay the researcher's. Only a *contradiction* is refused: a check
recorded `violated` cannot be reported as passed. `not_tested` and `noted` are
left alone, because a researcher may well have done that work outside this
system, and refusing them would make the product claim more than it knows.
"""

from __future__ import annotations

import pytest
from throughline_domain import analysis, findings, objects, validation
from throughline_domain.analysis import RUN_COMPLETED
from throughline_domain.ids import new_id
from throughline_schemas.enums import FindingLifecycle, FindingType, ObjectType

ALL_PASSED = {name: True for name in findings.REQUIRED_VALIDATION_CHECKS}
RESULT = {"method": "pearson_correlation", "estimate": 0.62,
          "estimate_name": "r", "p_value": 0.001, "sample_size": 120}


def _run(cur, project) -> str:
    spec_id = new_id("aspec")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "variables, research_question, content_hash, created_by) "
        "VALUES (%s, %s, 'confirmatory', 'pearson_correlation', %s, %s, %s, "
        "'researcher')",
        (spec_id, project, {"x": "a", "y": "b"}, "?", new_id("hash")))
    run_id = analysis.create_run(cur, project_id=project, spec_id=spec_id)
    object_id = objects.create_object(
        cur, project_id=project, object_type=ObjectType.ANALYSIS,
        title="a vs b", actor="researcher")
    cur.execute("UPDATE analysis_runs SET status = %s, result = %s, "
                "object_id = %s WHERE id = %s",
                (RUN_COMPLETED, RESULT, object_id, run_id))
    return run_id


def _connection(cur, project, run_id) -> str:
    connection_id = new_id("con")
    cur.execute(
        "INSERT INTO connections (id, project_id, analysis_run_id, "
        "left_variable, right_variable, method) VALUES (%s, %s, %s, 'a', 'b', "
        "'pearson_correlation')", (connection_id, project, run_id))
    return connection_id


def _report(cur, project, connection_id, outcomes: dict[str, str]) -> str:
    report_id = new_id("vrep")
    cur.execute(
        "INSERT INTO validation_reports(id, project_id, connection_id, status) "
        "VALUES (%s, %s, %s, 'complete')", (report_id, project, connection_id))
    for name, outcome in outcomes.items():
        validation.record_check(
            cur, report_id=report_id, name=name, outcome=outcome,
            detail=f"recorded {outcome}")
    return report_id


def _exploratory(cur, project, outcomes: dict[str, str]) -> str:
    connection_id = _connection(cur, project, _run(cur, project))
    _report(cur, project, connection_id, outcomes)
    finding_id = findings.create_finding(
        cur, project_id=project, title="a tracks b",
        finding_type=FindingType.STATISTICAL,
        from_connections=[connection_id], actor="researcher")
    findings.transition(cur, finding_id=finding_id,
                        to_status=FindingLifecycle.EXPLORATORY,
                        reason="worth pursuing", actor="researcher")
    return finding_id


class TestTheRecordIsNotOverruled:
    def test_a_violated_check_cannot_be_reported_as_passed(self, cur, project):
        finding_id = _exploratory(cur, project, {"robustness": "violated"})
        with pytest.raises(findings.ChecksContradicted) as raised:
            findings.transition(
                cur, finding_id=finding_id,
                to_status=FindingLifecycle.VALIDATED,
                reason="it holds", actor="researcher", checks=ALL_PASSED)
        assert "robustness" in str(raised.value)

    def test_the_finding_stays_where_it_was(self, cur, project):
        finding_id = _exploratory(cur, project, {"sensitivity": "violated"})
        with pytest.raises(findings.ChecksContradicted):
            findings.transition(
                cur, finding_id=finding_id,
                to_status=FindingLifecycle.VALIDATED,
                reason="it holds", actor="researcher", checks=ALL_PASSED)
        cur.execute("SELECT lifecycle_status FROM findings WHERE id = %s",
                    (finding_id,))
        assert cur.fetchone()["lifecycle_status"] == "exploratory"

    def test_a_recorded_pass_is_no_obstacle(self, cur, project):
        finding_id = _exploratory(
            cur, project,
            {name: "passed" for name in findings.REQUIRED_VALIDATION_CHECKS})
        findings.transition(
            cur, finding_id=finding_id, to_status=FindingLifecycle.VALIDATED,
            reason="it holds", actor="researcher", checks=ALL_PASSED)
        cur.execute("SELECT lifecycle_status FROM findings WHERE id = %s",
                    (finding_id,))
        assert cur.fetchone()["lifecycle_status"] == "validated"

    def test_a_check_the_system_never_tested_is_left_to_the_researcher(
            self, cur, project):
        """
        `not_tested` is not a failure. Confounder adjustment is recorded that
        way whenever no confounders were named, and a researcher who adjusted
        for them by other means is entitled to say so.
        """
        finding_id = _exploratory(
            cur, project, {"confounder_adjustment": "not_tested",
                           "outliers": "noted"})
        findings.transition(
            cur, finding_id=finding_id, to_status=FindingLifecycle.VALIDATED,
            reason="checked by hand", actor="researcher", checks=ALL_PASSED)
        cur.execute("SELECT lifecycle_status FROM findings WHERE id = %s",
                    (finding_id,))
        assert cur.fetchone()["lifecycle_status"] == "validated"

    def test_reporting_the_failure_honestly_is_not_blocked_here(
            self, cur, project):
        """
        Saying "robustness: failed" contradicts nothing. It is refused for
        being a missing pass, by the rule that was already there — a different
        error, with different words for the researcher.
        """
        finding_id = _exploratory(cur, project, {"robustness": "violated"})
        honest = dict(ALL_PASSED, robustness=False)
        with pytest.raises(findings.ValidationIncomplete):
            findings.transition(
                cur, finding_id=finding_id,
                to_status=FindingLifecycle.VALIDATED,
                reason="reporting it straight", actor="researcher",
                checks=honest)
