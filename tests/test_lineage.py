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
