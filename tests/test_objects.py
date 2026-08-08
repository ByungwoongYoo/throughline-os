"""§12 immutability, §24 ingestion states, §101 deletion impact."""

from __future__ import annotations

import pytest
from throughline_domain import lineage, objects
from throughline_schemas.enums import (
    IngestionStatus,
    LineageType,
    ObjectType,
    SourceType,
)


def test_ingestion_cannot_move_backwards(cur, project):
    """A retry that rewound a READY source would strand its derived artifacts."""
    source_id = objects.create_source(
        cur, project_id=project, source_type=SourceType.UPLOAD,
        title="paper.pdf", actor="test",
    )
    for status in (IngestionStatus.VALIDATED, IngestionStatus.SCANNED,
                   IngestionStatus.EXTRACTING, IngestionStatus.PARSING):
        objects.advance_ingestion(cur, source_id=source_id, to_status=status)

    with pytest.raises(objects.ObjectError):
        objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.SCANNED)


def test_failure_preserves_completed_work_and_restarts_cleanly(cur, project):
    """§24 — a failed source keeps its history and restarts from the beginning."""
    source_id = objects.create_source(
        cur, project_id=project, source_type=SourceType.UPLOAD,
        title="paper.pdf", actor="test",
    )
    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.VALIDATED)
    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.FAILED,
                              detail="No readable text")

    with pytest.raises(objects.ObjectError):
        objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.PARSING)
    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.UPLOADED)


def test_external_content_is_untrusted_by_default(cur, project):
    """§35 — a source arrives as data, never as instructions."""
    source_id = objects.create_source(
        cur, project_id=project, source_type=SourceType.CONNECTOR,
        title="Retrieved paper", actor="test",
    )
    cur.execute("SELECT trust_level FROM sources WHERE id = %s", (source_id,))
    assert cur.fetchone()["trust_level"] == "untrusted"


def test_editing_a_depended_on_artifact_creates_a_version(cur, project):
    """§12 — evidence that cited v1 must keep resolving to what v1 said."""
    dataset = objects.create_object(cur, project_id=project, object_type=ObjectType.DATASET,
                                    title="raw counts", actor="test")
    objects.create_object(cur, project_id=project, object_type=ObjectType.ANALYSIS,
                          title="regression", actor="test", derived_from=[dataset],
                          lineage_type=LineageType.CALCULATED_FROM)

    new_id_ = objects.update_object(cur, object_id=dataset, actor="test",
                                    title="raw counts (units fixed)")
    assert new_id_ != dataset

    cur.execute("SELECT title, status, version FROM research_objects WHERE id = %s", (dataset,))
    original = cur.fetchone()
    assert original["title"] == "raw counts"
    assert original["status"] == "superseded"

    cur.execute("SELECT title, version FROM research_objects WHERE id = %s", (new_id_,))
    updated = cur.fetchone()
    assert updated["title"] == "raw counts (units fixed)" and updated["version"] == 2

    ancestors = {row["artifact_id"] for row in lineage.ancestors(cur, new_id_)}
    assert dataset in ancestors


def test_editing_an_unused_artifact_stays_in_place(cur, project):
    obj = objects.create_object(cur, project_id=project, object_type=ObjectType.DATASET,
                                title="scratch", actor="test")
    assert objects.update_object(cur, object_id=obj, actor="test", title="scratch v2") == obj


def test_deletion_impact_counts_the_blast_radius(cur, project):
    """§101 — the researcher is told what a deletion would destroy."""
    dataset = objects.create_object(cur, project_id=project, object_type=ObjectType.DATASET,
                                    title="dataset", actor="test")
    analysis = objects.create_object(cur, project_id=project, object_type=ObjectType.ANALYSIS,
                                     title="analysis", actor="test", derived_from=[dataset],
                                     lineage_type=LineageType.CALCULATED_FROM)
    objects.create_object(cur, project_id=project, object_type=ObjectType.VISUALIZATION,
                          title="figure", actor="test", derived_from=[analysis],
                          lineage_type=LineageType.VISUALIZES)

    impact = objects.deletion_impact(cur, dataset)
    assert impact["dependent_artifacts"] == 2
    assert impact["by_type"] == {"analysis": 1, "visualization": 1}


def test_every_creation_is_audited(cur, project):
    """§99 — the audit trail exists from Phase 0, not bolted on later."""
    obj = objects.create_object(cur, project_id=project, object_type=ObjectType.PAPER,
                                title="paper", actor="researcher-1")
    cur.execute(
        "SELECT actor, action, object_id FROM audit_log WHERE object_id = %s", (obj,)
    )
    row = cur.fetchone()
    assert row["actor"] == "researcher-1" and row["action"] == "create"
