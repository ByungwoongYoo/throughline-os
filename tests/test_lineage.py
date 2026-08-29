"""LAW 1 — no result without provenance (§11, §93)."""

from __future__ import annotations

import pytest
from throughline_domain import lineage, objects
from throughline_schemas.enums import LineageType, ObjectType, SourceType


def _obj(cur, project_id, title, object_type=ObjectType.PAPER, **kw):
    return objects.create_object(
        cur, project_id=project_id, object_type=object_type,
        title=title, actor="test", **kw,
    )


def test_derived_artifact_requires_inputs(cur, project):
    """A derivation with no antecedent is a provenance hole, not a shortcut."""
    with pytest.raises(lineage.LineageError):
        lineage.record_derivation(
            cur, project_id=project, target_artifact_id=_obj(cur, project, "orphan"), inputs=[]
        )


def test_artifact_cannot_derive_from_itself(cur, project):
    node = _obj(cur, project, "self")
    with pytest.raises(lineage.LineageError):
        lineage.add_edge(
            cur, project_id=project, source_artifact_id=node,
            target_artifact_id=node, lineage_type=LineageType.DERIVED_FROM,
        )


def test_full_chain_is_traversable_end_to_end(cur, project):
    """§11's canonical chain: dataset → analysis → finding → visual → slide."""
    dataset = _obj(cur, project, "AMR dataset", ObjectType.DATASET)
    analysis = _obj(cur, project, "Correlation", ObjectType.ANALYSIS,
                    derived_from=[dataset], lineage_type=LineageType.CALCULATED_FROM)
    finding = _obj(cur, project, "Finding 04", ObjectType.FINDING,
                   derived_from=[analysis], lineage_type=LineageType.DERIVED_FROM)
    visual = _obj(cur, project, "Scatter", ObjectType.VISUALIZATION,
                  derived_from=[finding], lineage_type=LineageType.VISUALIZES)
    slide = _obj(cur, project, "Slide 3", ObjectType.PRESENTATION,
                 derived_from=[visual], lineage_type=LineageType.COMMUNICATES)

    # LAW 5 — the slide can still name the dataset it ultimately came from.
    chain = {row["artifact_id"] for row in lineage.ancestors(cur, slide)}
    assert chain == {visual, finding, analysis, dataset}

    depths = {row["artifact_id"]: row["depth"] for row in lineage.ancestors(cur, slide)}
    assert depths[visual] == 1 and depths[dataset] == 4

    # And the dataset knows everything that would break if it changed (§102).
    blast = {row["artifact_id"] for row in lineage.descendants(cur, dataset)}
    assert blast == {analysis, finding, visual, slide}


def test_lineage_edges_are_idempotent_under_retry(cur, project):
    """§38 — a retried workflow must not double-write provenance."""
    a = _obj(cur, project, "a")
    b = _obj(cur, project, "b")
    for _ in range(3):
        lineage.add_edge(cur, project_id=project, source_artifact_id=a,
                         target_artifact_id=b, lineage_type=LineageType.DERIVED_FROM)
    cur.execute(
        "SELECT COUNT(*) n FROM artifact_lineage_edges "
        "WHERE source_artifact_id = %s AND target_artifact_id = %s", (a, b),
    )
    assert cur.fetchone()["n"] == 1


def test_traversal_terminates_on_a_cycle(cur, project):
    """A cycle must degrade to a truncated answer, never an infinite walk.

    The queried artifact is not reported as its own ancestor even when a cycle
    technically makes it one — that is noise, not provenance.
    """
    a = _obj(cur, project, "a")
    b = _obj(cur, project, "b")
    lineage.add_edge(cur, project_id=project, source_artifact_id=a,
                     target_artifact_id=b, lineage_type=LineageType.DERIVED_FROM)
    lineage.add_edge(cur, project_id=project, source_artifact_id=b,
                     target_artifact_id=a, lineage_type=LineageType.DERIVED_FROM)
    assert {row["artifact_id"] for row in lineage.ancestors(cur, a)} == {b}
    assert {row["artifact_id"] for row in lineage.descendants(cur, a)} == {b}


def test_provenance_chain_answers_how_was_this_made(cur, project):
    dataset = _obj(cur, project, "dataset", ObjectType.DATASET)
    analysis = _obj(cur, project, "analysis", ObjectType.ANALYSIS,
                    derived_from=[dataset], lineage_type=LineageType.CALCULATED_FROM)
    chain = lineage.provenance_chain(cur, analysis)
    assert chain["artifact"]["id"] == analysis
    assert chain["direct_inputs"][0]["source_artifact_id"] == dataset
    assert chain["direct_inputs"][0]["lineage_type"] == "calculated_from"


# ---------------------------------------------------------------------------
# An empty chain is not one thing
# ---------------------------------------------------------------------------
#
# The screen that reads a chain said "This is a source artifact — nothing was
# derived to make it" whenever the ancestor list came back empty. An analysis
# whose lineage edges were never written looks identical from there, so the
# sentence reported the record as *complete* rather than *missing* — a
# provenance claim with nothing behind it, in the flattering direction, on the
# one screen whose whole job is not to flatter.
#
# The distinction is made here because the vocabulary lives here. An interface
# deciding it needs its own copy of which object types enter a project from
# outside, and the copy that drifts is the one that starts calling a finding a
# source.


def test_a_chain_with_ancestors_is_derived():
    assert lineage.origin_of("analysis", 2) == "derived"


def test_a_paper_with_no_ancestors_is_where_the_chain_starts():
    # It came in from outside. Nothing made it inside the project, and saying
    # so is a fact rather than an absence.
    assert lineage.origin_of("paper", 0) == "uploaded"
    assert lineage.origin_of("dataset", 0) == "uploaded"


def test_a_derived_type_with_no_ancestors_is_unrecorded_not_a_source():
    """
    The defect this exists to end. An analysis is made from a dataset by
    construction, so an empty chain under one means the derivation was never
    written down — the opposite of "nothing was derived to make it".
    """
    assert lineage.origin_of("analysis", 0) == "unrecorded"
    assert lineage.origin_of("finding", 0) == "unrecorded"
    assert lineage.origin_of("visualization", 0) == "unrecorded"


def test_an_unknown_type_is_not_assumed_to_be_a_source():
    """
    A type nobody has classified is not evidence that a chain is complete.
    Defaulting the other way would recreate the original claim for every type
    added later.
    """
    assert lineage.origin_of("something_new", 0) == "unrecorded"


def test_the_provenance_payload_says_which_of_the_three_it_is(cur, project):
    dataset = _obj(cur, project, "amr.csv", ObjectType.DATASET)
    analysis = _obj(cur, project, "correlation", ObjectType.ANALYSIS,
                    derived_from=[dataset], lineage_type=LineageType.CALCULATED_FROM)
    orphan = _obj(cur, project, "an analysis nobody explained", ObjectType.ANALYSIS)

    assert lineage.provenance_chain(cur, analysis)["origin"] == "derived"
    assert lineage.provenance_chain(cur, dataset)["origin"] == "uploaded"
    assert lineage.provenance_chain(cur, orphan)["origin"] == "unrecorded"


def test_the_root_types_are_the_ones_that_enter_from_outside():
    """
    Pinned so that adding a type to this set is a deliberate act. Every member
    is a claim that an artifact of that kind needs no explanation, and a wrong
    member is a permanently unnoticed provenance hole.
    """
    assert {str(t) for t in lineage.ROOT_TYPES} == {"paper", "dataset"}
