"""Research objects, sources and the immutability rule.

Raw source artifacts are never overwritten. ``update_object`` refuses to mutate
an object that other artifacts were derived from; it creates a new version and
links it with ``TRANSFORMED_FROM`` so the old evidence keeps pointing at the
state it actually described.
"""

from __future__ import annotations

from typing import Any, Sequence

from throughline_schemas.enums import (
    IngestionStatus,
    INGESTION_PROGRESSION,
    LineageType,
    ObjectType,
    SourceType,
    TrustLevel,
)

from .events import audit, emit
from .ids import new_id
from .lineage import add_edge, record_derivation


class ObjectError(RuntimeError):
    pass


class ImmutableArtifact(ObjectError):
    """ — raw sources and artifacts with descendants are append-only."""


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------


def create_source(
    cur,
    *,
    project_id: str,
    source_type: SourceType,
    title: str,
    actor: str,
    original_uri: str | None = None,
    external_identifier: str | None = None,
    connector_id: str | None = None,
    file_id: str | None = None,
    content_hash: str | None = None,
    metadata: dict[str, Any] | None = None,
    trust_level: TrustLevel = TrustLevel.UNTRUSTED,
) -> str:
    source_id = new_id("src")
    cur.execute(
        """
        INSERT INTO sources
            (id, project_id, source_type, title, original_uri, external_identifier,
             connector_id, file_id, content_hash, metadata, ingestion_status, trust_level)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            source_id,
            project_id,
            str(source_type),
            title,
            original_uri,
            external_identifier,
            connector_id,
            file_id,
            content_hash,
            metadata or {},
            str(IngestionStatus.UPLOADED),
            str(trust_level),
        ),
    )
    emit(cur, project_id=project_id, event_type="SourceCreated",
         payload={"source_id": source_id, "title": title})
    audit(cur, project_id=project_id, actor=actor, action="create",
          object_type="source", object_id=source_id)
    return source_id


def find_source_by_content_hash(
    cur,
    *,
    project_id: str,
    content_hash: str,
    source_type: SourceType = SourceType.UPLOAD,
) -> dict[str, Any] | None:
    """The source already holding these bytes in this project, if there is one.

    Scoped to a source type on purpose. `files` is unique on
    (project_id, content_hash) but `sources` deliberately is not: the same bytes
    can legitimately arrive twice by different routes — an upload and a connector
    import — and those are two sources with different provenance, not one. Only
    two uploads of the same bytes are the same act.

    Oldest first, so a duplicate resolves to the source that has had the most
    time to finish ingesting rather than to an arbitrary one.
    """
    cur.execute(
        """
        SELECT s.id, s.title, s.ingestion_status, s.ingestion_detail, s.created_at,
               (SELECT r.id FROM workflow_runs r
                 WHERE r.workflow_name = 'ingest.source'
                   AND r.input->>'source_id' = s.id
                 ORDER BY r.created_at ASC
                 LIMIT 1) AS ingest_run_id
        FROM sources s
        WHERE s.project_id = %s AND s.content_hash = %s AND s.source_type = %s
        ORDER BY s.created_at ASC
        LIMIT 1
        """,
        (project_id, content_hash, str(source_type)),
    )
    return cur.fetchone()


def advance_ingestion(
    cur,
    *,
    source_id: str,
    to_status: IngestionStatus,
    detail: str = "",
) -> dict[str, Any]:
    """Move a source along the  state machine.

    Only forward moves and FAILED are legal. A retry that rewound a source from
    READY back to PARSING would strand every artifact already derived from it.
    """
    cur.execute(
        "SELECT id, project_id, ingestion_status FROM sources WHERE id = %s FOR UPDATE",
        (source_id,),
    )
    row = cur.fetchone()
    if not row:
        raise ObjectError(f"Unknown source: {source_id}")
    current = IngestionStatus(row["ingestion_status"])

    if to_status is not IngestionStatus.FAILED:
        if current is IngestionStatus.FAILED:
            # Recovery restarts the pipeline deliberately, from the beginning.
            if to_status is not INGESTION_PROGRESSION[0]:
                raise ObjectError(
                    f"A failed source must restart at {INGESTION_PROGRESSION[0]}, not {to_status}"
                )
        else:
            if INGESTION_PROGRESSION.index(to_status) <= INGESTION_PROGRESSION.index(current):
                raise ObjectError(
                    f"Ingestion cannot move backwards: {current} -> {to_status}"
                )

    cur.execute(
        "UPDATE sources SET ingestion_status = %s, ingestion_detail = %s, updated_at = now() "
        "WHERE id = %s",
        (str(to_status), detail, source_id),
    )
    emit(
        cur,
        project_id=row["project_id"],
        event_type="SourceIngestionAdvanced",
        payload={"source_id": source_id, "status": str(to_status), "detail": detail},
    )
    return {"source_id": source_id, "from": str(current), "to": str(to_status)}


# ---------------------------------------------------------------------------
# Research objects
# ---------------------------------------------------------------------------


def create_object(
    cur,
    *,
    project_id: str,
    object_type: ObjectType,
    title: str,
    actor: str,
    description: str = "",
    source_id: str | None = None,
    source_type: SourceType | None = None,
    parent_object_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    content_hash: str | None = None,
    derived_from: Sequence[str] = (),
    lineage_type: LineageType = LineageType.DERIVED_FROM,
) -> str:
    """Create a research object and, when derived, its lineage in one transaction.

    ``derived_from`` is not optional bookkeeping. If an object is produced from
    other artifacts, passing them here is the only way it gets created, because
    this rule does not permit a derived artifact to exist without its inputs.
    """
    object_id = new_id("obj")
    cur.execute(
        """
        INSERT INTO research_objects
            (id, project_id, object_type, title, description, source_type, source_id,
             parent_object_id, metadata, content_hash, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            object_id,
            project_id,
            str(object_type),
            title,
            description,
            str(source_type) if source_type else None,
            source_id,
            parent_object_id,
            metadata or {},
            content_hash,
            actor,
        ),
    )
    if derived_from:
        record_derivation(
            cur,
            project_id=project_id,
            target_artifact_id=object_id,
            inputs=list(derived_from),
            lineage_type=lineage_type,
        )
    emit(cur, project_id=project_id, event_type="ResearchObjectCreated",
         payload={"object_id": object_id, "object_type": str(object_type)})
    audit(cur, project_id=project_id, actor=actor, action="create",
          object_type="research_object", object_id=object_id)
    return object_id


def has_descendants(cur, object_id: str) -> bool:
    cur.execute(
        "SELECT 1 FROM artifact_lineage_edges WHERE source_artifact_id = %s LIMIT 1",
        (object_id,),
    )
    return cur.fetchone() is not None


def new_version(
    cur,
    *,
    object_id: str,
    actor: str,
    title: str | None = None,
    description: str | None = None,
    metadata: dict[str, Any] | None = None,
    content_hash: str | None = None,
    reason: str = "",
) -> str:
    """Supersede an object with a new version.

    The previous version is left untouched and linked as the new version's
    ancestor, so evidence that cited it still resolves to what it described.
    """
    cur.execute("SELECT * FROM research_objects WHERE id = %s FOR UPDATE", (object_id,))
    current = cur.fetchone()
    if not current:
        raise ObjectError(f"Unknown object: {object_id}")

    version_id = new_id("obj")
    cur.execute(
        """
        INSERT INTO research_objects
            (id, project_id, object_type, title, description, status, source_type,
             source_id, parent_object_id, metadata, content_hash, created_by, version)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            version_id,
            current["project_id"],
            current["object_type"],
            title if title is not None else current["title"],
            description if description is not None else current["description"],
            current["status"],
            current["source_type"],
            current["source_id"],
            current["parent_object_id"],
            metadata if metadata is not None else current["metadata"],
            content_hash if content_hash is not None else current["content_hash"],
            actor,
            int(current["version"]) + 1,
        ),
    )
    add_edge(
        cur,
        project_id=current["project_id"],
        source_artifact_id=object_id,
        target_artifact_id=version_id,
        lineage_type=LineageType.TRANSFORMED_FROM,
        metadata={"reason": reason} if reason else None,
    )
    cur.execute(
        "UPDATE research_objects SET status = 'superseded', updated_at = now() WHERE id = %s",
        (object_id,),
    )
    emit(
        cur,
        project_id=current["project_id"],
        event_type="ResearchObjectVersioned",
        payload={"from": object_id, "to": version_id, "reason": reason},
    )
    audit(cur, project_id=current["project_id"], actor=actor, action="version",
          object_type="research_object", object_id=version_id,
          detail={"supersedes": object_id, "reason": reason})
    return version_id


def update_object(
    cur,
    *,
    object_id: str,
    actor: str,
    title: str | None = None,
    description: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    """Edit an object in place, or version it if anything was derived from it.

    Returns the id that now holds the edited state — the same id when the edit
    was safe, a new version id when it was not.
    """
    if has_descendants(cur, object_id):
        return new_version(
            cur,
            object_id=object_id,
            actor=actor,
            title=title,
            description=description,
            metadata=metadata,
            reason="Edited an artifact that other work depends on",
        )
    sets, params = [], []
    if title is not None:
        sets.append("title = %s")
        params.append(title)
    if description is not None:
        sets.append("description = %s")
        params.append(description)
    if metadata is not None:
        sets.append("metadata = %s")
        params.append(metadata)
    if not sets:
        return object_id
    sets.append("updated_at = now()")
    params.append(object_id)
    cur.execute(f"UPDATE research_objects SET {', '.join(sets)} WHERE id = %s", params)
    return object_id


def deletion_impact(cur, object_id: str) -> dict[str, Any]:
    """ — what breaks if this goes away."""
    from .lineage import descendants

    rows = descendants(cur, object_id)
    by_type: dict[str, int] = {}
    for row in rows:
        by_type[row["object_type"]] = by_type.get(row["object_type"], 0) + 1
    cur.execute(
        """
        SELECT COUNT(DISTINCT f.id) AS n
        FROM findings f
        JOIN finding_claims fc ON fc.finding_id = f.id
        JOIN evidence e ON e.claim_id = fc.claim_id
        WHERE e.source_object_id = %s
        """,
        (object_id,),
    )
    findings_at_risk = int(cur.fetchone()["n"])
    return {
        "object_id": object_id,
        "dependent_artifacts": len(rows),
        "by_type": by_type,
        "findings_losing_evidence": findings_at_risk,
        "artifacts": rows,
    }
