"""
§75 — the reproducibility record, as text a reviewer can read.

`provenance_chain` answers "what did this come from" for a screen. A methods
section asks something narrower and harder: what would somebody have to do to
get this number again. §44 requires all of it to be recorded and it is, in
`analysis_runs` — nothing ever wrote it out.

The rule the whole file turns on: an absent value is *stated*, never omitted.
A line that is missing and a line saying "not recorded" read identically to a
machine and very differently to a reviewer, and this document is written for
reviewers.
"""

from __future__ import annotations

import pytest
from throughline_domain import analysis, findings, objects, provenance_log
from throughline_domain.analysis import RUN_COMPLETED
from throughline_domain.ids import new_id
from throughline_schemas.enums import FindingType, ObjectType

RESULT = {"method": "pearson_correlation", "estimate": 0.62,
          "estimate_name": "r", "p_value": 0.001, "sample_size": 120}


def _run(cur, project, **over):
    spec_id = new_id("aspec")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "variables, research_question, method_rationale, content_hash, "
        "created_by) VALUES (%s, %s, 'confirmatory', 'pearson_correlation', "
        "%s, %s, %s, %s, 'researcher')",
        (spec_id, project, {"x": "consumption", "y": "resistance"},
         "Does consumption track resistance?",
         "Both variables are continuous.", new_id("hash")))
    run_id = analysis.create_run(cur, project_id=project, spec_id=spec_id)
    object_id = objects.create_object(
        cur, project_id=project, object_type=ObjectType.ANALYSIS,
        title="a vs b", actor="researcher")
    cur.execute(
        "UPDATE analysis_runs SET status=%s, result=%s, object_id=%s, "
        "runtime=%s, random_seed=%s, dependency_versions=%s, input_hashes=%s "
        "WHERE id=%s",
        (RUN_COMPLETED, RESULT, object_id,
         over.get("runtime", "3.12.1"), over.get("seed", 7),
         over.get("versions", {"pandas": "2.2.0"}),
         over.get("hashes", {"dataset_content_hash": "abc123"}), run_id))
    return run_id


def _connection(cur, project, run_id):
    connection_id = new_id("con")
    cur.execute(
        "INSERT INTO connections (id, project_id, analysis_run_id, "
        "left_variable, right_variable, method) VALUES (%s, %s, %s, "
        "'consumption', 'resistance', 'pearson_correlation')",
        (connection_id, project, run_id))
    return connection_id


def _finding(cur, project, **over):
    run_id = _run(cur, project, **over)
    return findings.create_finding(
        cur, project_id=project, title="Consumption tracks resistance",
        finding_type=FindingType.STATISTICAL,
        statement="Higher consumption, higher resistance.",
        from_connections=[_connection(cur, project, run_id)],
        actor="researcher")


class TestItSaysHowToGetTheNumberAgain:
    def test_it_names_the_finding_and_its_state(self, cur, project):
        text = provenance_log.for_finding(cur, _finding(cur, project))
        assert "Consumption tracks resistance" in text
        assert "candidate" in text

    def test_it_carries_what_section_44_asks_a_run_to_record(self, cur, project):
        text = provenance_log.for_finding(cur, _finding(cur, project))
        assert "3.12.1" in text          # runtime
        assert "Random seed: 7" in text
        assert "pandas 2.2.0" in text    # dependency versions
        assert "abc123" in text          # input hash

    def test_it_says_why_the_method_was_chosen(self, cur, project):
        """Recorded at specification time, which is what stops p-hacking."""
        text = provenance_log.for_finding(cur, _finding(cur, project))
        assert "Both variables are continuous." in text

    def test_it_reads_in_order(self, cur, project):
        text = provenance_log.for_finding(cur, _finding(cur, project))
        assert text.index("# Provenance") < text.index("## Analyses behind it")


class TestAbsenceIsStated:
    def test_a_run_with_no_seed_says_so_rather_than_printing_zero(
            self, cur, project):
        """
        A seed of 0 is a real seed somebody chose. Printing it where none was
        recorded is the difference between a reproducible run and one that
        looks reproducible.
        """
        finding_id = _finding(cur, project, versions={}, hashes={})
        text = provenance_log.for_finding(cur, finding_id)
        assert "Library versions: not recorded" in text
        assert "Input hashes: not recorded" in text

    def test_a_finding_with_no_analysis_says_that_plainly(self, cur, project):
        """
        A log that simply stopped after the heading reads like an export that
        failed. This one says the finding was written down rather than
        computed.
        """
        finding_id = findings.create_finding(
            cur, project_id=project, title="A hunch",
            finding_type=FindingType.STATISTICAL, actor="researcher")
        text = provenance_log.for_finding(cur, finding_id)
        assert "No analysis is recorded" in text
        assert "nothing here to reproduce" in text

    def test_an_unknown_finding_is_refused_rather_than_empty(self, cur):
        with pytest.raises(LookupError):
            provenance_log.for_finding(cur, "fnd_nope")


class TestItIsStable:
    def test_several_analyses_appear_in_the_order_they_ran(self, cur, project):
        """
        A finding usually rests on more than one run, and this file had only
        ever tested one — so the ordering clause was unproven, and a mutation
        of it failed for being invalid SQL rather than for reordering
        anything. Two runs, with recorded start times, in the order the work
        happened.
        """
        first = _run(cur, project)
        second = _run(cur, project)
        cur.execute("UPDATE analysis_runs SET started_at = %s WHERE id = %s",
                    ("2026-01-01T09:00:00Z", first))
        cur.execute("UPDATE analysis_runs SET started_at = %s WHERE id = %s",
                    ("2026-01-02T09:00:00Z", second))
        finding_id = findings.create_finding(
            cur, project_id=project, title="Two analyses",
            finding_type=FindingType.STATISTICAL,
            from_connections=[_connection(cur, project, first),
                              _connection(cur, project, second)],
            actor="researcher")

        text = provenance_log.for_finding(cur, finding_id)
        assert text.index(first) < text.index(second), (
            "the analyses are not in the order they ran")
        assert "### 1." in text and "### 2." in text

    def test_two_exports_of_one_finding_are_identical(self, cur, project):
        finding_id = _finding(cur, project)
        assert provenance_log.for_finding(cur, finding_id) \
            == provenance_log.for_finding(cur, finding_id)

    def test_it_ends_with_exactly_one_newline(self, cur, project):
        """A file, not a fragment."""
        text = provenance_log.for_finding(cur, _finding(cur, project))
        assert text.endswith("\n") and not text.endswith("\n\n")
