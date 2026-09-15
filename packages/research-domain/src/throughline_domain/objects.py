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
    # A link written before this evidence existed now finds it. Only a note
    # arriving used to close that loop, so planning notes stayed unresolved
    # after the upload they were waiting for (T155). Imported here rather than
    # at the top: `notebook` is a reader of objects, not a dependency of them.
    from .notebook import adopt_orphans_for_object
    adopt_orphans_for_object(cur, project_id=project_id, object_id=object_id,
                             title=title)
    emit(cur, project_id=project_id, event_type="ResearchObjectCreated",
         payload={"object_id": object_id, "object_type": str(object_type)})
    audit(cur, project_id=project_id, actor=actor, action="create",
          object_type="research_object", object_id=object_id)
    return object_id


#: The domain rows that stand for a research object, and the query that gets
#: from one to the other. Keyed by the word the caller uses.
#:
#: Every one of these is a join the *writers* already make — `create_finding`
#: sets `findings.object_id`, `analysis.record_result` sets
#: `analysis_runs.object_id`, `corpus.store_paper` and `corpus.store_dataset`
#: write `object_id` onto the paper and the dataset — so this reads the link
#: that exists rather than inferring one from titles or timestamps.
#:
#: Each query is scoped **twice**, on the domain row's project and again on the
#: object's, and both matter. The first stops a finding id from another project
#: resolving at all; the second is the belt to that brace, because the id this
#: returns is handed straight back to `/objects/{id}/journal`, which will show
#: whatever object it is given inside the project that asked. Leaking across
#: projects is this repository's named recurring defect and the cost here is a
#: researcher reading somebody else's notes.
_OBJECT_FOR = {
    "finding": """
        SELECT o.id, o.object_type
          FROM findings f
          JOIN research_objects o ON o.id = f.object_id
         WHERE f.id = %(ref_id)s
           AND f.project_id = %(project_id)s
           AND o.project_id = %(project_id)s
    """,
    "analysis_run": """
        SELECT o.id, o.object_type
          FROM analysis_runs r
          JOIN research_objects o ON o.id = r.object_id
         WHERE r.id = %(ref_id)s
           AND r.project_id = %(project_id)s
           AND o.project_id = %(project_id)s
    """,
    # A source can hold both a paper and a dataset — one PDF with a table
    # profiled out of it — so the two are asked for in one query and ordered.
    # The paper wins, because the paper *is* the source read as a document:
    # `store_paper` titles its object from the document and hangs the passages
    # off it, while `store_dataset` names its object after the extracted table.
    # `list_sources` puts them in the same order for the same reason.
    "source": """
        SELECT o.id, o.object_type, 0 AS rank
          FROM papers p
          JOIN research_objects o ON o.id = p.object_id
         WHERE p.source_id = %(ref_id)s
           AND p.project_id = %(project_id)s
           AND o.project_id = %(project_id)s
        UNION ALL
        SELECT o.id, o.object_type, 1 AS rank
          FROM datasets d
          JOIN research_objects o ON o.id = d.object_id
         WHERE d.source_id = %(ref_id)s
           AND d.project_id = %(project_id)s
           AND o.project_id = %(project_id)s
         ORDER BY rank
         LIMIT 1
    """,
}


def object_for(cur, *, project_id: str, kind: str,
               ref_id: str) -> dict[str, Any] | None:
    """The research object standing for a finding, an analysis run or a source.

    **The screens that hold a domain id cannot use the routes that take an
    object id (D213).** Object history — the journal and the version chain —
    hangs off `/api/projects/{id}/objects/{obj_...}/...`, and the finding,
    source and analysis detail screens each hold `fnd_…`, `src_…` and `arun_…`
    instead. Nothing joined the two, so the history was mounted on the board's
    card detail alone and mounting it anywhere else would have 404ed.

    Returns `{"object_id": ..., "object_type": ...}`, or `None` when the row
    exists and has no object — which is a real and ordinary state, not a bug:
    a finding recorded by hand before anything computed one has a null
    `object_id` (see `findings.create_finding`), a run that failed or has not
    finished never gets one, and a source whose ingestion is still queued has
    produced neither a paper nor a dataset. `None` is also what an unknown id
    and another project's id give, deliberately: a caller cannot tell "no such
    finding" from "not yours", which is the same answer `scoped_project` gives
    for a project id.

    A source that produced both a paper and a dataset resolves to the **paper**
    — see the note on the query — and never to the `citation` object
    `corpus._source_object` creates, which stands for the raw bytes rather than
    for anything read out of them.

    Raises `ObjectError` for a kind it does not know, rather than returning
    `None`: a typo'd kind is a caller bug and answering it with "no object"
    would hide it behind an ordinary miss.
    """
    query = _OBJECT_FOR.get(kind)
    if query is None:
        raise ObjectError(
            f"{kind!r} is not something that stands for a research object. "
            f"Known kinds: {', '.join(sorted(_OBJECT_FOR))}.")
    cur.execute(query, {"ref_id": ref_id, "project_id": project_id})
    row = cur.fetchone()
    if row is None:
        return None
    return {"object_id": row["id"], "object_type": row["object_type"]}


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


def versions_of(cur, *, object_id: str) -> list[dict[str, Any]]:
    """Every version in this object's chain, oldest first.

    **Written by every edit and, until now, read by nothing.** `new_version`
    has kept a full chain since it was written — the old row untouched, linked
    as an ancestor, marked superseded — and no route or component ever asked
    for it. A record kept by one part of the system and read by none is this
    repository's named recurring defect, and here it had a second cost: §43's
    "restore to a previous state" was not missing a mechanism, it was missing
    the two operations that would let anybody see or use the one already there.

    Walks the lineage edges rather than trusting the `version` integer,
    because the integer says where a row sits in *a* chain and the edges say
    which chain — two objects can each be at version 3.
    """
    cur.execute(
        """
        WITH RECURSIVE back AS (
            SELECT id, parent_object_id FROM research_objects WHERE id = %s
            UNION
            SELECT o.id, o.parent_object_id
              FROM research_objects o
              JOIN artifact_lineage_edges e ON e.source_artifact_id = o.id
              JOIN back b ON e.target_artifact_id = b.id
             WHERE e.lineage_type = 'transformed_from'
        ),
        forward AS (
            SELECT id FROM back
            UNION
            SELECT o.id
              FROM research_objects o
              JOIN artifact_lineage_edges e ON e.target_artifact_id = o.id
              JOIN forward f ON e.source_artifact_id = f.id
             WHERE e.lineage_type = 'transformed_from'
        )
        SELECT o.id, o.title, o.description, o.status, o.version, o.metadata,
               o.created_by, o.created_at
          FROM research_objects o
          JOIN forward f ON f.id = o.id
         ORDER BY o.version, o.created_at
        """,
        (object_id,),
    )
    return [dict(row) for row in cur.fetchall()]


def restore_version(cur, *, object_id: str, version_id: str, actor: str,
                    reason: str = "") -> str:
    """Bring an earlier version's content back, as a *new* version.

    **Nothing is rewritten and nothing is deleted.** Restoring by editing the
    row back would make the record say the intervening versions never
    happened, and what a researcher believed at each point is evidence about
    how they reached a conclusion — the journal already refuses to offer an
    edit endpoint for exactly this reason. So a restore is an ordinary forward
    step whose content happens to be an old one's, and the chain shows that
    somebody went back.

    Refuses a version from another chain. Restoring the content of an
    unrelated object would look, ever afterwards, like this object had once
    said something it never said.
    """
    chain = versions_of(cur, object_id=object_id)
    by_id = {row["id"]: row for row in chain}
    if version_id not in by_id:
        raise ObjectError(
            "That version does not belong to this object's history.")

    latest = chain[-1]
    if version_id == latest["id"]:
        # Not an error worth a traceback, but not a silent success either: a
        # no-op version would sit in the history saying a change was made.
        raise ObjectError(
            "That is already the current version, so there is nothing to "
            "restore.")

    target = by_id[version_id]
    return new_version(
        cur,
        object_id=latest["id"],
        actor=actor,
        title=target["title"],
        description=target["description"],
        metadata=target["metadata"],
        reason=reason or f"Restored the state of version {target['version']}",
    )


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
