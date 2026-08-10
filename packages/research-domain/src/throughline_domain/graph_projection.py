"""
Neo4j as a derived projection of the research graph (ADR 0002).

PostgreSQL remains the system of record. Nothing here is ever the source of a
fact: this module reads rows out of PostgreSQL, writes them into Neo4j, and
answers the four kinds of question a native graph engine is genuinely better at.

Three rules make that safe, and they are the whole design.

**The projection is never written to by application code.** It is rebuilt from
PostgreSQL. If it is wiped, the worst outcome is that four query types are
unavailable until it is rebuilt — never that a result loses its origin. That is
the property ADR 0001 refused to give up, and a projection is how you keep it
while still having a graph database.

**Staleness is reported, never hidden.** Every answer carries how far behind the
projection is. A centrality ranking computed before the researcher's last five
uploads is a different object from a current one, and a silently stale number is
worse than no number at all.

**Absence is a stated capability, not an error.** With no Neo4j configured the
workspace runs exactly as before, minus four query types, each of which says so.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any, Iterator

log = logging.getLogger("throughline.graph")

#: Queries that belong to the projection. Everything else stays in SQL, and the
#: list is deliberately short — a query is here only because a recursive CTE
#: does it badly, not because a graph database sounds like the right home.
PROJECTION_QUERIES = ("shortest_path", "centrality", "communities", "reachable")


class ProjectionUnavailable(RuntimeError):
    """Neo4j is not configured, not reachable, or not yet built."""


def configured() -> bool:
    return bool(os.environ.get("THROUGHLINE_NEO4J_URI"))


@contextmanager
def _session() -> Iterator[Any]:
    uri = os.environ.get("THROUGHLINE_NEO4J_URI")
    if not uri:
        raise ProjectionUnavailable(
            "No graph projection is configured. Provenance, evidence graphs and "
            "search work exactly as normal; path-finding, influence ranking and "
            "clustering need Neo4j. Set THROUGHLINE_NEO4J_URI to enable them.")
    try:
        from neo4j import GraphDatabase
    except ImportError as exc:  # pragma: no cover - driver is a dependency
        raise ProjectionUnavailable(
            "The Neo4j driver is not installed in this environment.") from exc

    user = os.environ.get("THROUGHLINE_NEO4J_USER", "neo4j")
    password = os.environ.get("THROUGHLINE_NEO4J_PASSWORD", "")
    database = os.environ.get("THROUGHLINE_NEO4J_DATABASE", "neo4j")

    driver = None
    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        with driver.session(database=database) as session:
            yield session
    except ProjectionUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 — any driver failure is unavailability
        raise ProjectionUnavailable(
            f"The graph projection at {uri} could not be reached ({exc}). "
            "Everything on the provenance path is unaffected — it is answered "
            "from PostgreSQL.") from exc
    finally:
        if driver is not None:
            driver.close()


def capability() -> dict[str, Any]:
    """
    What the projection can do right now, and what is unavailable without it.

    Reports unreachable as unavailable rather than as an error, because from the
    interface's point of view a graph database that is down and one that was
    never installed are the same fact: these four queries cannot be answered.
    """
    if not configured():
        return {
            "configured": False, "reachable": False, "queries": [],
            "note": ("Path-finding, influence ranking and clustering are "
                     "unavailable. Everything else — provenance, evidence "
                     "graphs, search, every verdict — is unaffected, because "
                     "PostgreSQL is the system of record."),
        }
    try:
        with _session() as session:
            counts = session.run(
                "MATCH (n:Object) RETURN count(n) AS nodes").single()
            edges = session.run(
                "MATCH ()-[r:RELATES]->() RETURN count(r) AS edges").single()
            watermark = session.run(
                "MATCH (m:ProjectionMeta) RETURN m.built_at AS built_at, "
                "m.source_watermark AS watermark LIMIT 1").single()
    except ProjectionUnavailable as exc:
        return {"configured": True, "reachable": False, "queries": [],
                "note": str(exc)}

    return {
        "configured": True, "reachable": True,
        "queries": list(PROJECTION_QUERIES),
        "nodes": counts["nodes"] if counts else 0,
        "edges": edges["edges"] if edges else 0,
        "built_at": str(watermark["built_at"]) if watermark else None,
        "source_watermark": str(watermark["watermark"]) if watermark else None,
        "note": "A derived projection of the PostgreSQL record. Rebuilt, never "
                "written to directly, and never the source of a fact.",
    }


# ---------------------------------------------------------------------------
# Building the projection
# ---------------------------------------------------------------------------

def rebuild(cur, project_id: str) -> dict[str, Any]:
    """
    Rebuild one project's projection from PostgreSQL.

    Whole-project rather than incremental on purpose. An incremental sync that
    drifts is worse than a slower one that cannot: a projection which is *nearly*
    right invites exactly the trust a derived store must never be given. It is
    cheap to redo and the interface already tolerates staleness.
    """
    cur.execute(
        "SELECT id, object_type, title, created_at, updated_at "
        "FROM research_objects WHERE project_id = %s", (project_id,))
    nodes = [dict(row) for row in cur.fetchall()]

    cur.execute(
        "SELECT source_artifact_id AS source, target_artifact_id AS target, "
        "       lineage_type AS kind, created_at "
        "FROM artifact_lineage_edges WHERE project_id = %s", (project_id,))
    edges = [dict(row) for row in cur.fetchall()]

    cur.execute(
        "SELECT source_object_id AS source, target_object_id AS target, "
        "       relationship_type AS kind, created_at "
        "FROM research_edges WHERE project_id = %s", (project_id,))
    edges += [dict(row) for row in cur.fetchall()]

    watermark = max(
        [n["updated_at"] for n in nodes if n.get("updated_at")]
        + [e["created_at"] for e in edges if e.get("created_at")],
        default=None)

    with _session() as session:
        session.run("MATCH (n:Object {project_id: $p}) DETACH DELETE n",
                    p=project_id)
        if nodes:
            session.run(
                "UNWIND $rows AS row "
                "CREATE (:Object {id: row.id, project_id: $p, "
                "  object_type: row.object_type, title: row.title})",
                rows=[{"id": n["id"], "object_type": n["object_type"],
                       "title": n["title"]} for n in nodes], p=project_id)
            session.run(
                "CREATE INDEX object_id IF NOT EXISTS "
                "FOR (n:Object) ON (n.id)")
        if edges:
            session.run(
                "UNWIND $rows AS row "
                "MATCH (a:Object {id: row.source, project_id: $p}) "
                "MATCH (b:Object {id: row.target, project_id: $p}) "
                "CREATE (a)-[:RELATES {kind: row.kind}]->(b)",
                rows=[{"source": e["source"], "target": e["target"],
                       "kind": e["kind"]} for e in edges], p=project_id)

        session.run(
            "MERGE (m:ProjectionMeta {project_id: $p}) "
            "SET m.built_at = datetime(), m.source_watermark = $w, "
            "    m.node_count = $n, m.edge_count = $e",
            p=project_id, w=str(watermark) if watermark else None,
            n=len(nodes), e=len(edges))

    return {"nodes": len(nodes), "edges": len(edges),
            "source_watermark": str(watermark) if watermark else None}


def _staleness(cur, project_id: str) -> dict[str, Any]:
    """
    How far behind the projection is, in the terms a reader needs.

    Counts are the primary signal, not timestamps. `now()` is transaction-stable
    in PostgreSQL, so anything written in the same transaction as a rebuild
    carries an identical timestamp and would compare as already-projected — the
    check would pass in exactly the case it exists to catch. Counting rows is
    exact, cheap, and immune to clocks.

    The timestamp is still consulted, because counts alone cannot see an
    in-place edit that leaves the totals unchanged. Neither signal is sufficient
    alone; together they miss only an edit made in the same transaction as the
    rebuild, which no derived store could observe anyway.
    """
    cur.execute(
        "SELECT count(*) AS nodes, max(updated_at) AS latest "
        "FROM research_objects WHERE project_id = %s", (project_id,))
    objects = cur.fetchone() or {}

    cur.execute(
        "SELECT (SELECT count(*) FROM artifact_lineage_edges WHERE project_id = %s) "
        "     + (SELECT count(*) FROM research_edges WHERE project_id = %s) AS edges",
        (project_id, project_id))
    edge_count = (cur.fetchone() or {}).get("edges") or 0

    with _session() as session:
        row = session.run(
            "MATCH (m:ProjectionMeta {project_id: $p}) "
            "RETURN m.source_watermark AS watermark, m.built_at AS built_at, "
            "       m.node_count AS nodes, m.edge_count AS edges",
            p=project_id).single()

    if row is None:
        raise ProjectionUnavailable(
            "This project has no projection yet. Rebuild it and these queries "
            "become available.")

    counts_match = (row["nodes"] == objects.get("nodes")
                    and row["edges"] == edge_count)
    watermark = row["watermark"]
    latest = objects.get("latest")
    timestamps_match = (watermark is None or latest is None
                        or str(latest) <= str(watermark))
    current = bool(counts_match and timestamps_match)

    drift = []
    if not counts_match:
        drift.append(
            f"the record now has {objects.get('nodes', 0)} objects and "
            f"{edge_count} relationships; the projection was built from "
            f"{row['nodes']} and {row['edges']}")
    elif not timestamps_match:
        drift.append("an object has changed since the projection was built")

    return {
        "built_at": str(row["built_at"]),
        "source_watermark": watermark,
        "projected_nodes": row["nodes"],
        "projected_edges": row["edges"],
        "current": current,
        # Said plainly, because a ranking computed before the last five uploads
        # is a different object from a current one.
        "note": ("The projection is up to date with the record." if current else
                 "This was computed from a projection that is behind the record: "
                 + "; ".join(drift) + ". Rebuild for a current answer."),
    }


# ---------------------------------------------------------------------------
# The four queries this store is actually better at
# ---------------------------------------------------------------------------

def shortest_path(cur, *, project_id: str, source_id: str, target_id: str,
                  max_depth: int = 8) -> dict[str, Any]:
    """
    How are these two objects connected at all?

    Variable-length and open-ended, which is exactly where a recursive CTE
    explores exponentially and Cypher prunes. Depth is still bounded: an
    unbounded answer nobody can read is not an answer.
    """
    staleness = _staleness(cur, project_id)
    with _session() as session:
        record = session.run(
            "MATCH (a:Object {id: $s, project_id: $p}), "
            "      (b:Object {id: $t, project_id: $p}), "
            "  path = shortestPath((a)-[:RELATES*.." + str(int(max_depth)) + "]-(b)) "
            "RETURN [n IN nodes(path) | {id: n.id, title: n.title, "
            "        object_type: n.object_type}] AS nodes, "
            "       [r IN relationships(path) | r.kind] AS kinds",
            s=source_id, t=target_id, p=project_id).single()

    if record is None:
        return {"connected": False, "path": [], "staleness": staleness,
                "note": (f"No connection within {max_depth} steps. They may be "
                         "unrelated, or related through a longer chain.")}
    return {"connected": True, "path": record["nodes"],
            "relations": record["kinds"], "length": len(record["kinds"]),
            "staleness": staleness, "store": "neo4j"}


def centrality(cur, *, project_id: str, limit: int = 20) -> dict[str, Any]:
    """
    Which objects are most connected to everything else?

    Degree centrality, computed over the whole graph. Reported as a structural
    fact and nothing more: a central object may matter, or may simply be the
    thing everything was derived from, and this cannot tell those apart.
    """
    staleness = _staleness(cur, project_id)
    with _session() as session:
        rows = session.run(
            "MATCH (n:Object {project_id: $p}) "
            "OPTIONAL MATCH (n)-[r:RELATES]-() "
            "WITH n, count(r) AS degree "
            "WHERE degree > 0 "
            "RETURN n.id AS id, n.title AS title, "
            "       n.object_type AS object_type, degree "
            "ORDER BY degree DESC LIMIT $limit",
            p=project_id, limit=limit).data()

    return {
        "ranking": rows, "staleness": staleness, "store": "neo4j",
        "not_a_finding_because": (
            "Centrality counts connections. An object can be central because it "
            "matters, or because everything in the project was derived from it. "
            "This does not distinguish those."),
    }


def communities(cur, *, project_id: str, max_depth: int = 4) -> dict[str, Any]:
    """
    Which objects cluster together?

    Connected components rather than modularity-based detection: it needs no
    plugin, it is exact, and "these things are reachable from each other and
    those are not" is the honest question at this graph's size.
    """
    staleness = _staleness(cur, project_id)
    with _session() as session:
        # No CALL subquery: the `CALL { WITH n ... }` form is deprecated in
        # current Neo4j and the replacement syntax is not available in older
        # ones. An OPTIONAL MATCH with a collect does the same work and runs
        # unchanged across versions.
        rows = session.run(
            "MATCH (n:Object {project_id: $p}) "
            "OPTIONAL MATCH (n)-[:RELATES*0.." + str(int(max_depth)) + "]-"
            "(m:Object) "
            "RETURN n.id AS id, n.title AS title, "
            "       collect(DISTINCT m.id) AS members",
            p=project_id).data()

    seen: set[str] = set()
    groups: list[dict[str, Any]] = []
    for row in sorted(rows, key=lambda r: -len(r["members"])):
        if row["id"] in seen:
            continue
        members = [m for m in row["members"]]
        seen.update(members)
        if len(members) > 1:
            groups.append({"size": len(members), "members": members,
                           "example": row["title"]})

    return {
        "groups": groups, "staleness": staleness, "store": "neo4j",
        "not_a_finding_because": (
            "A cluster here means objects reachable from one another through "
            "recorded relationships. It says nothing about whether they belong "
            "together scientifically."),
    }


def reachable(cur, *, project_id: str, source_id: str,
              max_depth: int = 5) -> dict[str, Any]:
    """Everything derived from, or contributing to, one object at any depth."""
    staleness = _staleness(cur, project_id)
    with _session() as session:
        rows = session.run(
            "MATCH (a:Object {id: $s, project_id: $p}) "
            "MATCH (a)-[:RELATES*1.." + str(int(max_depth)) + "]-(m:Object) "
            "RETURN DISTINCT m.id AS id, m.title AS title, "
            "       m.object_type AS object_type",
            s=source_id, p=project_id).data()

    return {"objects": rows, "count": len(rows), "depth": max_depth,
            "staleness": staleness, "store": "neo4j"}


__all__ = [
    "PROJECTION_QUERIES", "ProjectionUnavailable", "capability", "centrality",
    "communities", "configured", "reachable", "rebuild", "shortest_path",
]
