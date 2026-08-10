"""
Phase 5 — communication and citation integrity (§58, §79, §80, §133).

These tests exist to substantiate a specific claim, and the claim is narrow:
numerical fidelity and citation resolvability are *structural*. Not "we check
carefully" — there is no representable state in which a communication artifact
holds a transcribed statistic or a reference to a source nobody ingested.

So most of what follows is negative. A guarantee is only worth the attempts made
to violate it, and a test suite that only shows the happy path would be evidence
of nothing.
"""

from __future__ import annotations

import io

import pytest
from throughline_domain import authoring, citations, communication, render_artifact
from throughline_domain.ids import new_id


# ---------------------------------------------------------------------------
# Fixtures built directly, so the tests do not depend on a full pipeline run
# ---------------------------------------------------------------------------

@pytest.fixture()
def completed_run(cur, project):
    """A completed analysis run with a realistic result."""
    spec_id = new_id("aspec")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, research_question, "
        "method, variables, content_hash, created_by) "
        "VALUES (%s, %s, %s, %s, %s, '{}'::jsonb, %s, 'test')",
        (spec_id, project, "correlation", "does x relate to y", "pearson_correlation",
         "0" * 64),
    )
    run_id = new_id("arun")
    cur.execute(
        "INSERT INTO analysis_runs(id, project_id, spec_id, status, result) "
        "VALUES (%s, %s, %s, 'completed', %s)",
        (run_id, project, spec_id, __import__("json").dumps({
            "method": "pearson_correlation",
            "estimate": 0.9025253041275638,
            "estimate_name": "pearson_r",
            "sample_size": 180,
            "p_value": 4.919e-67,
            "evidence_quality": "weak",
            "practical_significance": "large",
            "interpretation": "A strong positive association.",
            "limitations": ["Correlation is association, not causation."],
        })),
    )
    return run_id


@pytest.fixture()
def artifact(cur, project):
    return communication.create_artifact(
        cur, project_id=project, artifact_type="report", title="Test report")


# ---------------------------------------------------------------------------
# Numerical fidelity is structural
# ---------------------------------------------------------------------------

def test_a_literal_statistic_cannot_be_written_into_a_block(cur, artifact):
    """
    The core guarantee. If a statistic can be typed, every downstream promise
    about numerical fidelity is a matter of diligence rather than structure.
    """
    for template in [
        "The association is r = 0.9025.",
        "We observed n = 180 participants.",
        "Resistance rose by 31.2%.",
        "The corrected q was 5.17e-66.",
        "The coefficient estimate: 2.542 after adjustment.",
    ]:
        with pytest.raises(communication.LiteralNumberRejected):
            communication.add_block(cur, artifact_id=artifact, sequence=1,
                                    block_type="paragraph", template=template)


def test_ordinary_prose_numbers_are_still_allowed(cur, artifact):
    """
    The rule targets statistics, not digits. A ban on every numeral would make
    the system unusable and would be quietly worked around, which is worse than
    a narrower rule that holds.
    """
    communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="paragraph",
        template="Three studies published in 2019 examined this in 4 countries.")


def test_a_reference_to_a_missing_run_refuses_to_resolve(cur, artifact):
    communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="paragraph",
        template="The estimate was {{ref:e}}.",
        value_refs={"e": {"analysis_run_id": "arun_does_not_exist", "path": "estimate"}},
    )
    with pytest.raises(communication.UnresolvedReference):
        communication.load_artifact(cur, artifact, resolve=True)


def test_a_reference_to_an_incomplete_run_refuses_to_resolve(cur, project, artifact):
    """A number may not be shown before it has been computed (LAW 2)."""
    spec_id = new_id("aspec")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, research_question, "
        "method, variables, content_hash, created_by) VALUES (%s, %s, 'correlation', "
        "'q', 'pearson_correlation', '{}'::jsonb, %s, 'test')",
        (spec_id, project, "1" * 64))
    run_id = new_id("arun")
    cur.execute(
        "INSERT INTO analysis_runs(id, project_id, spec_id, status) "
        "VALUES (%s, %s, %s, 'running')", (run_id, project, spec_id))

    communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="paragraph",
        template="The estimate was {{ref:e}}.",
        value_refs={"e": {"analysis_run_id": run_id, "path": "estimate"}},
    )
    with pytest.raises(communication.UnresolvedReference) as exc:
        communication.load_artifact(cur, artifact, resolve=True)
    assert "running" in str(exc.value)


def test_a_resolved_value_equals_the_recorded_value(cur, artifact, completed_run):
    communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="paragraph",
        template="The estimate was {{ref:e}} across {{ref:n}} observations.",
        value_refs={
            "e": {"analysis_run_id": completed_run, "path": "estimate", "format": "dp4"},
            "n": {"analysis_run_id": completed_run, "path": "sample_size"},
        },
    )
    loaded = communication.load_artifact(cur, artifact, resolve=True)
    block = loaded["blocks"][0]
    assert block["resolved"]["e"] == 0.9025253041275638
    assert "0.9025" in block["text"]
    assert "180" in block["text"]
    # Nothing was left unsubstituted.
    assert "{{ref:" not in block["text"]


def test_a_quotation_must_be_verbatim(cur, project, artifact, completed_run):
    """
    `quoted_from` is the one way a literal statistic may appear, and it is
    verified rather than trusted. An edited quotation is authored prose again.
    """
    # A validation report must belong to a connection or a finding — the schema
    # refuses one that floats free.
    connection_id = new_id("conn")
    cur.execute(
        "INSERT INTO connections(id, project_id, left_variable, right_variable, method) "
        "VALUES (%s, %s, 'x', 'y', 'pearson_correlation')", (connection_id, project))
    cur.execute(
        "INSERT INTO validation_reports(id, project_id, connection_id, status, summary) "
        "VALUES (%s, %s, %s, 'complete', %s) RETURNING id",
        (new_id("vrep"), project, connection_id, "x"))
    report_id = cur.fetchone()["id"]
    check_id = new_id("vchk")
    cur.execute(
        "INSERT INTO validation_checks(id, report_id, name, outcome, detail) "
        "VALUES (%s, %s, 'confounder_adjustment', 'passed', %s)",
        (check_id, report_id, "The coefficient is 2.542 after adjustment."),
    )

    # Verbatim: accepted.
    communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="quote",
        template="The coefficient is 2.542 after adjustment.",
        quoted_from={"field": "validation_checks.detail", "id": check_id},
    )

    # Edited by one digit: refused.
    with pytest.raises(communication.LiteralNumberRejected):
        communication.add_block(
            cur, artifact_id=artifact, sequence=2, block_type="quote",
            template="The coefficient is 9.999 after adjustment.",
            quoted_from={"field": "validation_checks.detail", "id": check_id},
        )


def test_an_arbitrary_table_cannot_be_nominated_as_quotable(cur, artifact):
    with pytest.raises(communication.CommunicationError):
        communication.add_block(
            cur, artifact_id=artifact, sequence=1, block_type="quote",
            template="The value is 1.234.",
            quoted_from={"field": "projects.name", "id": "anything"},
        )


# ---------------------------------------------------------------------------
# Citation resolvability is structural
# ---------------------------------------------------------------------------

def test_a_citation_to_a_source_that_was_never_ingested_cannot_be_created(cur, project):
    """The hallucinated-reference failure mode, closed at the schema level."""
    with pytest.raises(citations.CitationError):
        citations.create_citation(cur, project_id=project, source_id="src_invented")
    with pytest.raises(citations.CitationError):
        citations.create_citation(cur, project_id=project, passage_id="psg_invented")
    with pytest.raises(citations.CitationError):
        citations.create_citation(cur, project_id=project, analysis_run_id="arun_invented")


def test_a_citation_needs_exactly_one_target(cur, project, completed_run):
    with pytest.raises(citations.CitationError):
        citations.create_citation(cur, project_id=project)
    with pytest.raises(citations.CitationError):
        citations.create_citation(cur, project_id=project, source_id="a",
                                  analysis_run_id=completed_run)


def test_a_citation_cannot_reach_another_project(cur, project, completed_run):
    other = new_id("prj")
    cur.execute("SELECT owner_user_id FROM projects WHERE id = %s", (project,))
    owner = cur.fetchone()["owner_user_id"]
    cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Other')",
                (other, owner))
    with pytest.raises(citations.CitationError):
        citations.create_citation(cur, project_id=other, analysis_run_id=completed_run)


def test_verify_project_reports_resolvability_without_claiming_entailment(
        cur, project, completed_run):
    citations.create_citation(cur, project_id=project, analysis_run_id=completed_run)
    report = citations.verify_project(cur, project)
    assert report["total"] == 1
    assert report["resolved"] == 1
    assert report["dangling"] == []
    # An unchecked citation is `unverified`, never `supported`.
    assert report["by_entailment"] == {"unverified": 1}


# ---------------------------------------------------------------------------
# Entailment: honest about what it can decide
# ---------------------------------------------------------------------------

def test_a_number_absent_from_the_cited_run_is_unsupported(cur, project, completed_run):
    citation = citations.create_citation(cur, project_id=project,
                                         analysis_run_id=completed_run)
    result = citations.check_entailment(cur, citation, "The estimate was 0.42.")
    assert result["entailment"] == citations.UNSUPPORTED


def test_a_number_present_in_the_cited_run_is_supported(cur, project, completed_run):
    citation = citations.create_citation(cur, project_id=project,
                                         analysis_run_id=completed_run)
    result = citations.check_entailment(cur, citation, "There were 180 observations.")
    assert result["entailment"] == citations.SUPPORTED


def test_a_percentage_matches_the_same_quantity_stored_as_a_proportion(
        cur, project, completed_run):
    """
    The runtime writes "100.0%" for a stored 1.0. A checker that called that
    unsupported would be switched off within a day, and a checker nobody runs
    guarantees nothing.
    """
    cur.execute(
        "SELECT result FROM analysis_runs WHERE id = %s", (completed_run,))
    citation = citations.create_citation(cur, project_id=project,
                                         analysis_run_id=completed_run)
    # sample_size 180 is stored; 18000% is 180 as a proportion-style percentage.
    result = citations.check_entailment(cur, citation, "18000% of the reference value.")
    assert result["entailment"] == citations.SUPPORTED

    # Without the % marker the same digits are a different claim.
    other = citations.create_citation(cur, project_id=project,
                                      analysis_run_id=completed_run)
    assert citations.check_entailment(
        cur, other, "There were 18000 observations.")["entailment"] == citations.UNSUPPORTED


def test_section_markers_are_not_treated_as_claims(cur, project, completed_run):
    citation = citations.create_citation(cur, project_id=project,
                                         analysis_run_id=completed_run)
    result = citations.check_entailment(
        cur, citation, "Correlation is association, not causation (§52).")
    # No quantity is claimed, so this is a semantic judgement, not a failure.
    assert result["entailment"] == citations.NOT_CHECKABLE


def test_a_claim_with_no_numbers_is_never_reported_as_supported(cur, project, completed_run):
    citation = citations.create_citation(cur, project_id=project,
                                         analysis_run_id=completed_run)
    result = citations.check_entailment(cur, citation, "This matters for policy.")
    assert result["entailment"] == citations.NOT_CHECKABLE
    assert result["entailment"] != citations.SUPPORTED


def test_entailment_is_recorded_per_claim_not_per_citation(cur, project, artifact,
                                                           completed_run):
    """
    The same source can support one sentence and not another. Storing a single
    verdict on the citation let the last sentence checked overwrite the rest.
    """
    citation = citations.create_citation(cur, project_id=project,
                                         analysis_run_id=completed_run)
    good = communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="paragraph",
        template="There were {{ref:n}} observations.",
        value_refs={"n": {"analysis_run_id": completed_run, "path": "sample_size"}},
        citation_ids=[citation])
    bad = communication.add_block(
        cur, artifact_id=artifact, sequence=2, block_type="paragraph",
        template="The trial enrolled 4321 people.",
        citation_ids=[citation])

    citations.check_artifact(cur, artifact)

    cur.execute("SELECT block_id, entailment FROM block_citations WHERE citation_id = %s",
                (citation,))
    verdicts = {r["block_id"]: r["entailment"] for r in cur.fetchall()}
    assert verdicts[bad] == citations.UNSUPPORTED
    # The good block's number came through a reference, so it is guaranteed
    # rather than merely entailed.
    assert verdicts[good] == citations.NOT_CHECKABLE


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def test_rendering_is_refused_when_integrity_fails(cur, project, artifact, completed_run):
    citation = citations.create_citation(cur, project_id=project,
                                         analysis_run_id=completed_run)
    communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="paragraph",
        template="The trial enrolled 4321 people.", citation_ids=[citation])
    citations.check_artifact(cur, artifact)

    with pytest.raises(render_artifact.RenderError):
        render_artifact.render(cur, artifact_id=artifact, fmt="markdown")


def test_every_format_renders_from_one_resolved_artifact(cur, project, artifact,
                                                         completed_run):
    communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="heading",
        template="What was found")
    communication.add_block(
        cur, artifact_id=artifact, sequence=2, block_type="paragraph",
        template="The estimate was {{ref:e}} across {{ref:n}} observations.",
        value_refs={
            "e": {"analysis_run_id": completed_run, "path": "estimate", "format": "dp4"},
            "n": {"analysis_run_id": completed_run, "path": "sample_size"},
        },
        citation_ids=[citations.create_citation(
            cur, project_id=project, analysis_run_id=completed_run)],
    )

    for fmt in render_artifact.FORMATS:
        result = render_artifact.render(cur, artifact_id=artifact, fmt=fmt)
        assert result["byte_size"] > 0, fmt

    # The same value appears in every format, because none of them recomputed it.
    from throughline_domain.storage import storage_root
    text = (storage_root() / result["storage_key"]).parent
    markdown = (text / f"{artifact}.md").read_text()
    assert "0.9025" in markdown
    assert "180" in markdown
    # The provenance trail names where each number came from.
    assert completed_run in markdown


def test_an_unsupported_format_is_refused_by_name(cur, artifact):
    with pytest.raises(render_artifact.RenderError) as exc:
        render_artifact.render(cur, artifact_id=artifact, fmt="tiff")
    assert "markdown" in str(exc.value)


# ---------------------------------------------------------------------------
# §80 — one finding, many outputs, still one source of truth
# ---------------------------------------------------------------------------

def test_a_presentation_references_the_same_runs_as_its_report(cur, project, artifact,
                                                               completed_run):
    communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="paragraph",
        template="The estimate was {{ref:e}}.",
        value_refs={"e": {"analysis_run_id": completed_run, "path": "estimate"}},
    )
    deck = authoring.draft_presentation_from_report(
        cur, project_id=project, report_id=artifact)

    cur.execute("SELECT value_refs FROM artifact_blocks WHERE artifact_id = %s", (deck,))
    refs = cur.fetchone()["value_refs"]
    # Re-referenced, not copied: both artifacts read the same recorded row, so
    # they cannot come to disagree.
    assert refs["e"]["analysis_run_id"] == completed_run
