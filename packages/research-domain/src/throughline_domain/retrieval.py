"""Hybrid retrieval with recorded provenance.

 is explicit: "Do not rely entirely on embeddings." Lexical search finds the
exact term a researcher typed — a gene name, a country code, a specific metric —
which embeddings blur. Semantic search finds the passage that means the same
thing in different words. Neither is sufficient alone.

The two rankings are fused with Reciprocal Rank Fusion, which combines *ranks*
rather than scores. Lexical `ts_rank` and cosine similarity are not on a common
scale, and normalising them against each other would invent a comparability that
does not exist; RRF needs no such assumption.

Every retrieval writes a `retrieval_event` plus per-result scores, so an answer
built on these passages can be audited later.
"""

from __future__ import annotations

from typing import Any, Sequence

from .embeddings import provider as embedding_provider
from .ids import new_id

#: RRF damping. 60 is the value from the original Cormack et al. formulation and
#: keeps any single ranker from dominating the fused order.
RRF_K = 60


def _vector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(f"{float(v):.7f}" for v in values) + "]"


def lexical_search(
    cur, *, project_id: str, query: str, limit: int = 50,
    source_ids: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    """PostgreSQL full-text ranking over passage content and section."""
    clauses = ["p.project_id = %s", "p.search_vector @@ websearch_to_tsquery('english', %s)"]
    params: list[Any] = [project_id, query]
    if source_ids:
        clauses.append("p.source_id = ANY(%s)")
        params.append(list(source_ids))
    cur.execute(
        f"""
        SELECT p.id, p.source_id, p.content, p.locator, p.page, p.section,
               p.char_start, p.char_end,
               ts_rank_cd(p.search_vector, websearch_to_tsquery('english', %s)) AS score
        FROM passages p
        WHERE {' AND '.join(clauses)}
        ORDER BY score DESC, p.ordinal
        LIMIT %s
        """,
        (query, *params, limit),
    )
    return list(cur.fetchall())


def semantic_search(
    cur, *, project_id: str, query: str, limit: int = 50,
    source_ids: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    """Cosine nearest neighbours over pgvector. Empty when no model is installed."""
    embedder = embedding_provider()
    if embedder is None:
        return []
    vector = embedder.embed([query])
    if not vector:
        return []

    clauses = ["p.project_id = %s"]
    params: list[Any] = [project_id]
    if source_ids:
        clauses.append("p.source_id = ANY(%s)")
        params.append(list(source_ids))
    literal = _vector_literal(vector[0])
    cur.execute(
        f"""
        SELECT p.id, p.source_id, p.content, p.locator, p.page, p.section,
               p.char_start, p.char_end,
               1 - (e.embedding <=> %s::vector) AS score
        FROM passage_embeddings e
        JOIN passages p ON p.id = e.passage_id
        WHERE {' AND '.join(clauses)}
        ORDER BY e.embedding <=> %s::vector
        LIMIT %s
        """,
        (literal, *params, literal, limit),
    )
    return list(cur.fetchall())


def hybrid_search(
    cur, *, project_id: str, query: str, limit: int = 10,
    source_ids: Sequence[str] | None = None, pool: int = 50,
    record_provenance: bool = True,
) -> dict[str, Any]:
    """Run both rankers, fuse by RRF, and record what was retrieved."""
    lexical = lexical_search(cur, project_id=project_id, query=query, limit=pool,
                             source_ids=source_ids)
    semantic = semantic_search(cur, project_id=project_id, query=query, limit=pool,
                               source_ids=source_ids)

    strategy = "hybrid" if semantic else "lexical"
    scores: dict[str, dict[str, Any]] = {}

    for rank, row in enumerate(lexical, start=1):
        entry = scores.setdefault(row["id"], {"row": row, "lexical": None, "semantic": None, "fused": 0.0})
        entry["lexical"] = float(row["score"])
        entry["fused"] += 1.0 / (RRF_K + rank)
    for rank, row in enumerate(semantic, start=1):
        entry = scores.setdefault(row["id"], {"row": row, "lexical": None, "semantic": None, "fused": 0.0})
        entry["semantic"] = float(row["score"])
        entry["fused"] += 1.0 / (RRF_K + rank)

    ordered = sorted(scores.values(), key=lambda e: e["fused"], reverse=True)[:limit]
    results = [
        {
            "passage_id": entry["row"]["id"],
            "source_id": entry["row"]["source_id"],
            "content": entry["row"]["content"],
            "locator": entry["row"]["locator"],
            "page": entry["row"]["page"],
            "section": entry["row"]["section"],
            "char_start": entry["row"]["char_start"],
            "char_end": entry["row"]["char_end"],
            "lexical_score": entry["lexical"],
            "semantic_score": entry["semantic"],
            "fused_score": entry["fused"],
            "rank": index,
        }
        for index, entry in enumerate(ordered, start=1)
    ]

    event_id = None
    if record_provenance:
        event_id = _record(cur, project_id=project_id, query=query, strategy=strategy,
                           source_ids=source_ids, results=results)

    return {
        "query": query,
        "strategy": strategy,
        "retrieval_event_id": event_id,
        "lexical_candidates": len(lexical),
        "semantic_candidates": len(semantic),
        "results": results,
    }


def _record(
    cur, *, project_id: str, query: str, strategy: str,
    source_ids: Sequence[str] | None, results: list[dict[str, Any]],
) -> str:
    event_id = new_id("ret")
    cur.execute(
        "INSERT INTO retrieval_events(id, project_id, query, strategy, filters, result_count) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (event_id, project_id, query, strategy,
         {"source_ids": list(source_ids)} if source_ids else {}, len(results)),
    )
    for item in results:
        cur.execute(
            "INSERT INTO retrieval_results(id, event_id, passage_id, rank, lexical_score, "
            "semantic_score, fused_score) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (new_id("rr"), event_id, item["passage_id"], item["rank"],
             item["lexical_score"], item["semantic_score"], item["fused_score"]),
        )
    return event_id


def retrieval_provenance(cur, event_id: str) -> dict[str, Any]:
    """ — reconstruct exactly what an answer was built from."""
    cur.execute("SELECT * FROM retrieval_events WHERE id = %s", (event_id,))
    event = cur.fetchone()
    if not event:
        raise ValueError(f"Unknown retrieval event: {event_id}")
    cur.execute(
        """
        SELECT r.rank, r.lexical_score, r.semantic_score, r.fused_score, r.rerank_score,
               p.id AS passage_id, p.content, p.locator, p.page, p.section,
               p.char_start, p.char_end, s.title AS source_title, s.id AS source_id
        FROM retrieval_results r
        JOIN passages p ON p.id = r.passage_id
        JOIN sources s ON s.id = p.source_id
        WHERE r.event_id = %s ORDER BY r.rank
        """,
        (event_id,),
    )
    event["results"] = list(cur.fetchall())
    return event
