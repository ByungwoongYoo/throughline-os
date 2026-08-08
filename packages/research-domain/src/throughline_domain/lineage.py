"""Artifact lineage (§11) — the system that answers "How was this made?".

LAW 1 says no result without provenance. In practice that means: an artifact is
created *together with* the edges that explain it, in one transaction. A helper
that writes the object and lets the caller remember the edge afterwards would
make provenance optional, so ``record_derivation`` is the only creation path for
derived objects.
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from throughline_schemas.enums import LineageType

from .ids import new_id


class LineageError(RuntimeError):
    pass


def add_edge(
    cur,
    *,
    project_id: str,
    source_artifact_id: str,
    target_artifact_id: str,
    lineage_type: LineageType,
    metadata: dict[str, Any] | None = None,
) -> str:
    """Record that ``target`` was produced from ``source``.

    Idempotent on (source, target, type) so a workflow retry cannot duplicate
    lineage (§38).
    """
    if source_artifact_id == target_artifact_id:
        raise LineageError("An artifact cannot derive from itself")
    edge_id = new_id("lin")
    cur.execute(
        """
        INSERT INTO artifact_lineage_edges
            (id, project_id, source_artifact_id, target_artifact_id, lineage_type, metadata)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (source_artifact_id, target_artifact_id, lineage_type)
        DO UPDATE SET metadata = artifact_lineage_edges.metadata || EXCLUDED.metadata
        RETURNING id
        """,
        (
            edge_id,
            project_id,
            source_artifact_id,
            target_artifact_id,
            str(lineage_type),
            metadata or {},
        ),
    )
    return cur.fetchone()["id"]


def record_derivation(
    cur,
    *,
    project_id: str,
    target_artifact_id: str,
    inputs: Sequence[str],
    lineage_type: LineageType = LineageType.DERIVED_FROM,
    metadata: dict[str, Any] | None = None,
) -> list[str]:
    """Attach every input that contributed to a derived artifact."""
    if not inputs:
        raise LineageError(
            "A derived artifact must record at least one input (LAW 1). "
            "If it genuinely has no antecedent it is a source, not a derivation."
        )
    return [
        add_edge(
            cur,
            project_id=project_id,
            source_artifact_id=source_id,
            target_artifact_id=target_artifact_id,
            lineage_type=lineage_type,
            metadata=metadata,
        )
        for source_id in dict.fromkeys(inputs)
    ]


def ancestors(cur, artifact_id: str, *, max_depth: int = 32) -> list[dict[str, Any]]:
    """Everything this artifact was made from, breadth-first, with depth.

    Uses a recursive CTE with a visited path so a cycle introduced by a future
    bug degrades to a truncated answer rather than an infinite loop.
    """
    cur.execute(
        """
        WITH RECURSIVE walk(artifact_id, depth, path) AS (
            SELECT %s::text, 0, ARRAY[%s::text]
          UNION ALL
            SELECT e.source_artifact_id, w.depth + 1, w.path || e.source_artifact_id
            FROM artifact_lineage_edges e
            JOIN walk w ON e.target_artifact_id = w.artifact_id
            WHERE w.depth < %s
              AND NOT e.source_artifact_id = ANY(w.path)
        )
        SELECT w.artifact_id, MIN(w.depth) AS depth,
               o.object_type, o.title, o.created_at
        FROM walk w
        JOIN research_objects o ON o.id = w.artifact_id
        WHERE w.depth > 0
        GROUP BY w.artifact_id, o.object_type, o.title, o.created_at
        ORDER BY depth, o.created_at
        """,
        (artifact_id, artifact_id, max_depth),
    )
    return list(cur.fetchall())


def descendants(cur, artifact_id: str, *, max_depth: int = 32) -> list[dict[str, Any]]:
    """Everything made from this artifact — the blast radius for §101 and §102."""
    cur.execute(
        """
        WITH RECURSIVE walk(artifact_id, depth, path) AS (
            SELECT %s::text, 0, ARRAY[%s::text]
          UNION ALL
            SELECT e.target_artifact_id, w.depth + 1, w.path || e.target_artifact_id
            FROM artifact_lineage_edges e
            JOIN walk w ON e.source_artifact_id = w.artifact_id
            WHERE w.depth < %s
              AND NOT e.target_artifact_id = ANY(w.path)
        )
        SELECT w.artifact_id, MIN(w.depth) AS depth,
               o.object_type, o.title, o.created_at
        FROM walk w
        JOIN research_objects o ON o.id = w.artifact_id
        WHERE w.depth > 0
        GROUP BY w.artifact_id, o.object_type, o.title, o.created_at
        ORDER BY depth, o.created_at
        """,
        (artifact_id, artifact_id, max_depth),
    )
    return list(cur.fetchall())


def provenance_chain(cur, artifact_id: str) -> dict[str, Any]:
    """The §93 traceability payload for one artifact."""
    cur.execute(
        "SELECT id, project_id, object_type, title, created_at, version "
        "FROM research_objects WHERE id = %s",
        (artifact_id,),
    )
    node = cur.fetchone()
    if not node:
        raise LineageError(f"Unknown artifact: {artifact_id}")
    cur.execute(
        """
        SELECT e.source_artifact_id, e.target_artifact_id, e.lineage_type, e.metadata
        FROM artifact_lineage_edges e
        WHERE e.target_artifact_id = %s
        ORDER BY e.created_at
        """,
        (artifact_id,),
    )
    return {
        "artifact": node,
        "direct_inputs": list(cur.fetchall()),
        "ancestors": ancestors(cur, artifact_id),
    }
