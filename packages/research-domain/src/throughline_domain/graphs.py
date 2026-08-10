"""Knowledge graph, evidence graph and Discovery Map.

 and  answer different questions and must not be conflated:

* the **knowledge graph** answers *what is connected?*
* the **evidence graph** answers *why do we believe this?*

Both are served from PostgreSQL edges with progressive expansion —  is
explicit that 20,000 nodes must never be dumped into a browser, so every query
here is bounded and expands from a focus node outward.
"""

from __future__ import annotations

from typing import Any, Sequence

#:  — a hard ceiling, not a suggestion.
MAX_NODES = 300


def knowledge_graph(
    cur, *, project_id: str, focus_object_id: str | None = None, depth: int = 1,
    limit: int = MAX_NODES, relationship_types: Sequence[str] | None = None,
    min_confidence: float | None = None,
) -> dict[str, Any]:
    """What is connected, expanded outward from a focus node."""
    limit = max(1, min(limit, MAX_NODES))
    depth = max(1, min(depth, 4))

    clauses = ["e.project_id = %s"]
    params: list[Any] = [project_id]
    if relationship_types:
        clauses.append("e.relationship_type = ANY(%s)")
        params.append(list(relationship_types))
    if min_confidence is not None:
        clauses.append("(e.confidence IS NULL OR e.confidence >= %s)")
        params.append(min_confidence)
    where = " AND ".join(clauses)

    if focus_object_id:
        cur.execute(
            f"""
            WITH RECURSIVE reachable(object_id, depth) AS (
                SELECT %s::text, 0
              UNION
                SELECT CASE WHEN e.source_object_id = r.object_id
                            THEN e.target_object_id ELSE e.source_object_id END,
                       r.depth + 1
                FROM research_edges e
                JOIN reachable r
                  ON r.object_id IN (e.source_object_id, e.target_object_id)
                WHERE {where} AND r.depth < %s
            )
            SELECT object_id, MIN(depth) AS depth FROM reachable
            GROUP BY object_id ORDER BY depth LIMIT %s
            """,
            (focus_object_id, *params, depth, limit),
        )
        ids = [row["object_id"] for row in cur.fetchall()]
    else:
        cur.execute(
            "SELECT id FROM research_objects WHERE project_id = %s "
            "ORDER BY created_at DESC LIMIT %s",
            (project_id, limit),
        )
        ids = [row["id"] for row in cur.fetchall()]

    if not ids:
        return {"nodes": [], "edges": [], "truncated": False}

    cur.execute(
        "SELECT id, object_type, title, status, created_at FROM research_objects "
        "WHERE id = ANY(%s)",
        (ids,),
    )
    nodes = list(cur.fetchall())

    cur.execute(
        f"""
        SELECT e.id, e.source_object_id, e.target_object_id, e.relationship_type,
               e.confidence, e.status, e.evidence_id
        FROM research_edges e
        WHERE {where} AND e.source_object_id = ANY(%s) AND e.target_object_id = ANY(%s)
        """,
        (*params, ids, ids),
    )
    edges = list(cur.fetchall())

    #  — say when the view is partial rather than implying completeness.
    cur.execute("SELECT COUNT(*) AS n FROM research_objects WHERE project_id = %s",
                (project_id,))
    total = int(cur.fetchone()["n"])
    return {"nodes": nodes, "edges": edges, "total_objects": total,
            "truncated": total > len(nodes),
            "note": (f"Showing {len(nodes)} of {total} objects. Expand from a node "
                     "to load more." if total > len(nodes) else None)}


def evidence_graph(cur, *, finding_id: str) -> dict[str, Any]:
    """Why do we believe this?

    Returns the finding with its claims, the evidence for and against each, the
    analyses that produced them, and the sources underneath — the whole chain a
    reviewer needs to decide whether to accept the conclusion.
    """
    cur.execute("SELECT * FROM findings WHERE id = %s", (finding_id,))
    finding = cur.fetchone()
    if not finding:
        raise ValueError(f"Unknown finding: {finding_id}")

    cur.execute(
        """
        SELECT c.id, c.statement, c.claim_type, c.status, c.confidence
        FROM finding_claims fc JOIN claims c ON c.id = fc.claim_id
        WHERE fc.finding_id = %s ORDER BY c.created_at
        """,
        (finding_id,),
    )
    claims = list(cur.fetchall())

    for claim in claims:
        cur.execute(
            """
            SELECT e.id, e.evidence_type, e.direction, e.strength, e.confidence,
                   e.location, e.source_object_id, o.title AS source_title,
                   o.object_type AS source_object_type, s.title AS source_document
            FROM evidence e
            LEFT JOIN research_objects o ON o.id = e.source_object_id
            LEFT JOIN sources s ON s.id = o.source_id
            WHERE e.claim_id = %s
            ORDER BY e.direction, e.created_at
            """,
            (claim["id"],),
        )
        rows = list(cur.fetchall())
        claim["supporting"] = [r for r in rows if r["direction"] == "supports"]
        claim["contradicting"] = [r for r in rows if r["direction"] == "contradicts"]
        claim["other"] = [r for r in rows if r["direction"] not in {"supports", "contradicts"}]

    # The analyses and connections behind the finding, via lineage.
    analyses: list[dict[str, Any]] = []
    connections: list[dict[str, Any]] = []
    if finding["object_id"]:
        cur.execute(
            """
            SELECT r.id, r.status, r.result, s.method, s.variables, s.research_question
            FROM artifact_lineage_edges e
            JOIN research_objects o ON o.id = e.source_artifact_id
            JOIN analysis_runs r ON r.object_id = o.id
            JOIN analysis_specs s ON s.id = r.spec_id
            WHERE e.target_artifact_id = %s
            """,
            (finding["object_id"],),
        )
        analyses = list(cur.fetchall())

        cur.execute(
            """
            SELECT c.id, c.left_variable, c.right_variable, c.method, c.lifecycle_status,
                   c.estimate, c.p_value, c.q_value, c.effect_size, c.evidence_quality
            FROM artifact_lineage_edges e
            JOIN connections c ON c.object_id = e.source_artifact_id
            WHERE e.target_artifact_id = %s
            """,
            (finding["object_id"],),
        )
        connections = list(cur.fetchall())

    cur.execute(
        "SELECT id, verdict, summary, created_at FROM challenges WHERE finding_id = %s "
        "ORDER BY created_at DESC LIMIT 5",
        (finding_id,),
    )
    challenges = list(cur.fetchall())

    supports = sum(len(c["supporting"]) for c in claims)
    contradicts = sum(len(c["contradicting"]) for c in claims)
    return {
        "finding": finding,
        "claims": claims,
        "analyses": analyses,
        "connections": connections,
        "challenges": challenges,
        "limitations": finding["limitations"],
        "balance": {"supporting": supports, "contradicting": contradicts},
        # An evidence graph that cannot show contradicting evidence is a
        # marketing diagram, so the absence is stated explicitly.
        "note": (None if contradicts else
                 "No contradicting evidence has been recorded. That is not the same "
                 "as none existing."),
    }


def discovery_map(cur, *, project_id: str) -> dict[str, Any]:
    """ — the project overview: what has been found, and what needs attention."""
    counts: dict[str, Any] = {}

    for label, query in (
        ("sources", "SELECT COUNT(*) AS n FROM sources WHERE project_id = %s"),
        ("papers", "SELECT COUNT(*) AS n FROM papers WHERE project_id = %s"),
        ("datasets", "SELECT COUNT(*) AS n FROM datasets WHERE project_id = %s"),
        ("analyses", "SELECT COUNT(*) AS n FROM analysis_runs WHERE project_id = %s "
                     "AND status = 'completed'"),
        ("contradictions", "SELECT COUNT(*) AS n FROM contradictions "
                           "WHERE project_id = %s AND status = 'open'"),
    ):
        cur.execute(query, (project_id,))
        counts[label] = int(cur.fetchone()["n"])

    cur.execute(
        "SELECT lifecycle_status, COUNT(*) AS n FROM findings WHERE project_id = %s "
        "GROUP BY lifecycle_status",
        (project_id,),
    )
    findings_by_status = {row["lifecycle_status"]: int(row["n"]) for row in cur.fetchall()}

    cur.execute(
        "SELECT lifecycle_status, COUNT(*) AS n FROM connections WHERE project_id = %s "
        "GROUP BY lifecycle_status",
        (project_id,),
    )
    connections_by_status = {row["lifecycle_status"]: int(row["n"]) for row in cur.fetchall()}

    cur.execute(
        "SELECT id, left_variable, right_variable, method, lifecycle_status, estimate, "
        "q_value, effect_size, evidence_quality, rank_score FROM connections "
        "WHERE project_id = %s AND lifecycle_status IN ('exploratory','validated','replicated') "
        "ORDER BY rank_score DESC LIMIT 10",
        (project_id,),
    )
    top_connections = list(cur.fetchall())

    return {
        "counts": counts,
        "findings": findings_by_status,
        "connections": connections_by_status,
        "top_connections": top_connections,
        "recommended_next_action": _recommend(counts, findings_by_status,
                                              connections_by_status),
    }


def _recommend(counts: dict[str, Any], findings: dict[str, int],
               connections: dict[str, int]) -> str:
    """One concrete next step, chosen from the project's actual state."""
    if not counts["sources"]:
        return "Add sources: upload papers or a dataset to begin."
    if not counts["datasets"]:
        return "Add a dataset — discovery needs tabular data to test relationships."
    if not counts["analyses"]:
        return "Run discovery on a dataset to generate candidate relationships."
    if connections.get("exploratory"):
        return (f"{connections['exploratory']} exploratory connection(s) are awaiting "
                "robustness validation. Supply candidate confounders and validate them.")
    if connections.get("validated") and not findings:
        return ("Validated connections exist but no findings have been recorded. "
                "Turn the strongest into a finding with its evidence.")
    if findings.get("candidate"):
        return f"{findings['candidate']} finding(s) still need evidence before promotion."
    if findings.get("validated"):
        return "Challenge the validated findings before communicating them."
    return "Review the project's contradictions and gaps."
