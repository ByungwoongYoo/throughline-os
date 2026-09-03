"""
The one next step the project suggests must be true of the project.

`_recommend` reads the project's actual state and names a single concrete
action, which is the best thing on the overview screen: a researcher who does
not know what to do next is told, in their own project's terms.

One rung of that ladder stopped being true. It reads a CANDIDATE finding as
one that "still needs evidence before promotion" — which was right when
nothing in the product could attach evidence to a researcher's finding, so a
candidate was, in practice, always an empty one. Now that a finding recorded
from its connections carries the analyses behind it, a candidate is the
ordinary state of a finding that has evidence and simply has not been promoted
yet, and the advice tells a researcher to go and find something they already
have.

Advice that is wrong is worse than no advice, because it sends someone looking
for a problem that does not exist.
"""

from __future__ import annotations

import pytest
from throughline_domain import analysis, findings, graphs, objects
from throughline_domain.analysis import RUN_COMPLETED
from throughline_domain.ids import new_id
from throughline_schemas.enums import FindingType, ObjectType

RESULT = {"method": "pearson_correlation", "estimate": 0.62,
          "estimate_name": "r", "p_value": 0.001, "sample_size": 120}


def _source_and_dataset(cur, project) -> None:
    """The earlier rungs of the ladder, satisfied.

    Without these the recommendation stops at "Add sources" and every
    assertion about the findings rungs passes without reaching them — which is
    exactly how this test file first went green while proving nothing.
    """
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'dataset', 'Panel', 'ready')",
        (source_id, project))
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, name, format) "
        "VALUES (%s, %s, %s, 'Panel', 'csv')",
        (new_id("dst"), project, source_id))


def _connection(cur, project) -> str:
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
    connection_id = new_id("con")
    cur.execute(
        "INSERT INTO connections (id, project_id, analysis_run_id, "
        "left_variable, right_variable, method, lifecycle_status) "
        "VALUES (%s, %s, %s, 'a', 'b', 'pearson_correlation', 'validated')",
        (connection_id, project, run_id))
    return connection_id


def _advice(cur, project) -> str:
    return graphs.discovery_map(cur, project_id=project)["recommended_next_action"]


class TestItDoesNotInventWork:
    def test_a_candidate_with_evidence_is_not_told_to_find_evidence(
            self, cur, project):
        _source_and_dataset(cur, project)
        findings.create_finding(
            cur, project_id=project, title="a tracks b",
            finding_type=FindingType.STATISTICAL,
            from_connections=[_connection(cur, project)], actor="researcher")

        advice = _advice(cur, project)
        assert "need evidence" not in advice, (
            f"the project has a finding with evidence and is told: {advice!r}")

    def test_and_says_what_to_actually_do_with_it(self, cur, project):
        _source_and_dataset(cur, project)
        findings.create_finding(
            cur, project_id=project, title="a tracks b",
            finding_type=FindingType.STATISTICAL,
            from_connections=[_connection(cur, project)], actor="researcher")

        advice = _advice(cur, project)
        assert "promot" in advice.lower() or "explorator" in advice.lower(), (
            f"a finding ready to move is not told how: {advice!r}")


    def test_the_ladder_actually_reaches_the_findings_rungs(
            self, cur, project):
        """Guards this file against passing without getting there at all."""
        _source_and_dataset(cur, project)
        findings.create_finding(
            cur, project_id=project, title="a tracks b",
            finding_type=FindingType.STATISTICAL,
            from_connections=[_connection(cur, project)], actor="researcher")
        assert "Add sources" not in _advice(cur, project)


class TestTheRungThatWasRightStaysRight:
    def test_a_finding_written_from_nothing_is_still_told_to_get_evidence(
            self, cur, project):
        """The original case, which the rule exists for."""
        _source_and_dataset(cur, project)
        _connection(cur, project)  # so the earlier rungs are satisfied
        findings.create_finding(
            cur, project_id=project, title="A hunch",
            finding_type=FindingType.STATISTICAL, actor="researcher")

        assert "evidence" in _advice(cur, project)

    def test_an_empty_project_is_told_to_add_sources(self, cur, project):
        assert "sources" in _advice(cur, project).lower()
