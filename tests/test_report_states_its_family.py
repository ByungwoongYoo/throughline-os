"""
A drafted report says how much looking stands behind the number it quotes.

`resolve_block` already argues the point in its own docstring: a corrected
q-value "is a property of that test within its multiple-testing family, and the
same run in a family of five and a family of five hundred yields different q."
The ledger argues it too — "a researcher reading `family_size: 23` has to
already know what it implies."

Both were right, and the drafted report quoted q and said nothing about the
family. A reviewer reading it could not tell a first look from a two-hundredth,
which leaves the most important number in the document resting on trust — in a
product whose whole argument is that nothing should.

These also cover `draft_from_connection` at all, which had no direct test: only
the API route called it, so the one function that produces the artefact a
researcher hands to somebody else was exercised solely in passing.
"""

from __future__ import annotations

import json

import pytest
from throughline_domain import authoring, communication, exploration
from throughline_domain.ids import new_id


@pytest.fixture()
def completed_run(cur, project):
    """A completed analysis run, so the report has numbers to reference.

    A local copy of `test_communication`'s fixture rather than a shared one:
    the values matter to what that file asserts, and a fixture two files depend
    on for different reasons is one that cannot be changed for either.
    """
    spec_id = new_id("aspec")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, "
        "research_question, method, variables, content_hash, created_by) "
        "VALUES (%s, %s, %s, %s, %s, '{}'::jsonb, %s, 'test')",
        (spec_id, project, "correlation", "does x relate to y",
         "pearson_correlation", "0" * 64))
    run_id = new_id("arun")
    cur.execute(
        "INSERT INTO analysis_runs(id, project_id, spec_id, status, result) "
        "VALUES (%s, %s, %s, 'completed', %s)",
        (run_id, project, spec_id, json.dumps({
            "method": "pearson_correlation",
            "estimate": 0.9025253041275638,
            "estimate_name": "pearson_r",
            "sample_size": 180,
            "p_value": 4.919e-67,
            "evidence_quality": "weak",
            "practical_significance": "large",
            "interpretation": "A strong positive association.",
            "limitations": ["Correlation is association, not causation."],
        })))
    return run_id


def _sweep_with(cur, project: str, *, looks: int, enquiry: str | None) -> str:
    """A discovery run belonging to `enquiry`, having taken `looks` looks."""
    obj, source, dataset = new_id("obj"), new_id("src"), new_id("dst")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "created_by) VALUES (%s, %s, 'dataset', 'sweep data', 'test')",
        (obj, project))
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', 'sweep data', 'ready')", (source, project))
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, object_id, name, format) "
        "VALUES (%s, %s, %s, %s, 'sweep data', 'csv')",
        (dataset, project, source, obj))
    version = new_id("dsv")
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash) VALUES (%s, %s, 1, 180, 2, %s)",
        (version, dataset, new_id("h")[:64]))
    run = new_id("drun")
    cur.execute(
        "INSERT INTO discovery_runs(id, project_id, dataset_version_id, status, "
        "enquiry_id) VALUES (%s, %s, %s, 'complete', %s)",
        (run, project, version, enquiry))
    if enquiry:
        for i in range(looks):
            exploration.record(
                cur, enquiry_id=enquiry, project_id=project, verb="discovery",
                description=f"pair {i}", p_value=0.5)
    return run


def _connection(cur, project: str, run: str | None, analysis_run: str) -> str:
    connection = new_id("conn")
    cur.execute(
        "INSERT INTO connections(id, project_id, discovery_run_id, analysis_run_id, "
        "left_variable, right_variable, method, estimate, q_value, "
        "lifecycle_status) "
        "VALUES (%s, %s, %s, %s, 'consumption', 'resistance', "
        "'pearson_correlation', 0.9, 0.0084, 'candidate')",
        (connection, project, run, analysis_run))
    return connection


def _drafted(cur, project: str, connection: str) -> list[str]:
    artifact = authoring.draft_from_connection(
        cur, project_id=project, connection_id=connection)
    loaded = communication.load_artifact(cur, artifact, resolve=False)
    return [b.get("template") or "" for b in loaded["blocks"]]


def test_the_report_states_the_family_its_q_was_corrected_in(
        cur, project, completed_run, make_enquiry_for):
    """The sentence a reviewer needs in order to weigh the q above it."""
    enquiry = make_enquiry_for(project)
    run = _sweep_with(cur, project, looks=200, enquiry=enquiry)
    connection = _connection(cur, project, run, completed_run)

    templates = _drafted(cur, project, connection)
    family = [t for t in templates if "correction was applied across" in t]

    assert family, "the report quotes a corrected q and never says what family"
    assert "{{ref:family}}" in family[0]
    assert "{{ref:surviving}}" in family[0]


def test_the_family_sentence_carries_no_digits_of_its_own(
        cur, project, completed_run, make_enquiry_for):
    """
    Same rule as every other number in a report: the template holds references,
    and the values arrive from the record at render time. A count typed into
    prose is a count that can go stale without anything noticing.

    The first draft of this sentence ended "survive at a 5% false-discovery
    rate" and `add_block` refused it — `LiteralNumberRejected`, on a literal
    the author had not thought of as a statistic. It was right twice over: the
    rate is a property of the run rather than a constant, so writing it would
    have been an unsourced claim as well as a hardcoded one.
    """
    enquiry = make_enquiry_for(project)
    run = _sweep_with(cur, project, looks=12, enquiry=enquiry)
    connection = _connection(cur, project, run, completed_run)

    sentence = next(t for t in _drafted(cur, project, connection)
                    if "correction was applied across" in t)

    assert not any(ch.isdigit() for ch in sentence), sentence


def test_the_numbers_resolve_to_the_family_that_was_actually_counted(
        cur, project, completed_run, make_enquiry_for):
    """The reference is only worth having if it reaches the real ledger."""
    enquiry = make_enquiry_for(project)
    run = _sweep_with(cur, project, looks=37, enquiry=enquiry)
    connection = _connection(cur, project, run, completed_run)

    artifact = authoring.draft_from_connection(
        cur, project_id=project, connection_id=connection)
    loaded = communication.load_artifact(cur, artifact)
    family = next(b for b in loaded["blocks"]
                  if "correction was applied across" in (b.get("template") or ""))

    assert family["resolved"]["family"] == 37


def test_a_finding_from_no_sweep_still_drafts(cur, project, completed_run):
    """
    The absence has to be quiet *here*, which is the opposite of the usual rule.

    `resolve_block` raises rather than render a blank where a number belongs, so
    writing a family reference for a connection that counted in no family would
    make the whole report unrenderable — a document nobody can produce, to avoid
    a sentence nobody could have written. The block is omitted instead, and the
    report keeps every other thing it says.
    """
    connection = _connection(cur, project, None, completed_run)

    templates = _drafted(cur, project, connection)

    assert templates, "a finding outside any sweep must still produce a report"
    assert not [t for t in templates if "correction was applied across" in t]


def test_a_sweep_outside_any_line_of_enquiry_still_drafts(
        cur, project, completed_run):
    """The second hop can be missing too: a sweep that joined no family."""
    run = _sweep_with(cur, project, looks=0, enquiry=None)
    connection = _connection(cur, project, run, completed_run)

    templates = _drafted(cur, project, connection)

    assert templates
    assert not [t for t in templates if "correction was applied across" in t]


def test_asking_for_a_family_that_does_not_exist_refuses_rather_than_blanks(
        cur, project, completed_run):
    """
    Each hop's absence is a different fact, and the message says which.

    A generic "could not resolve" would send whoever reads it looking in the
    wrong place — the connection exists, the sweep exists, and it is the line of
    enquiry that is missing.
    """
    run = _sweep_with(cur, project, looks=0, enquiry=None)
    connection = _connection(cur, project, run, completed_run)
    artifact = communication.create_artifact(
        cur, project_id=project, artifact_type="report", title="Manual")
    communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="paragraph",
        template="across {{ref:family}} tests",
        value_refs={"family": {"family_of_connection_id": connection,
                               "path": "family_size"}})
    block = communication.load_artifact(cur, artifact, resolve=False)["blocks"][0]

    with pytest.raises(communication.UnresolvedReference, match="line of enquiry"):
        communication.resolve_block(cur, block)


def test_a_reference_may_not_name_two_sources(cur, project, completed_run):
    """The third source must not weaken the rule that exactly one is named."""
    artifact = communication.create_artifact(
        cur, project_id=project, artifact_type="report", title="Manual")
    communication.add_block(
        cur, artifact_id=artifact, sequence=1, block_type="paragraph",
        template="{{ref:x}}",
        value_refs={"x": {"analysis_run_id": completed_run,
                          "family_of_connection_id": "conn_whatever",
                          "path": "family_size"}})
    block = communication.load_artifact(cur, artifact, resolve=False)["blocks"][0]

    with pytest.raises(communication.UnresolvedReference, match="exactly one"):
        communication.resolve_block(cur, block)
