# ADR 0002 — Neo4j joins as a derived projection. PostgreSQL remains the system of record.

**Status:** accepted
**Date:** 2026-08-09
**Supersedes:** parts of [ADR 0001](0001-graph-store.md) — the "no separate graph
database, and none is planned" position. The reasoning in 0001 about
transactional integrity still holds and is what shapes this design.
**Requested by:** *"also use PostgreSQL + pgvector and neo4j whereever which
ever is best depending on the requirement of the graphs"*

## Decision

Both stores, with a strict and asymmetric division:

- **PostgreSQL + pgvector is the system of record.** Every write goes here.
  Artifacts, lineage edges and audit entries commit in one transaction, exactly
  as before.
- **Neo4j is a read-only projection**, rebuilt from PostgreSQL. It is never
  written to by application code, never the source of a fact, and never
  consulted for anything on the provenance path.
- **Queries are routed by what they need.** Shallow, bounded, transactional
  reads stay in SQL. Deep variable-length traversal, pathfinding and graph
  algorithms go to Neo4j when it is available.
- **Neo4j is optional at every point.** If it is absent, stale or unreachable,
  the system answers from PostgreSQL where it can and says plainly what it
  cannot do (§123). It never silently degrades.

## Why this shape and not dual-write

The objection in ADR 0001 was not that Neo4j is a bad graph database. It is that
Law 1 ("no result without provenance") and Law 5 ("no output detached from its
source graph") are guarantees about *atomicity*. If an artifact lands in
PostgreSQL and its edge fails to land in Neo4j, a finding now exists with no
traceable origin — the exact state the laws forbid — and no retry logic converts
two stores into one transaction.

A derived projection dissolves that objection rather than arguing with it.
Provenance is written once, transactionally, in one place. The projection can
fail, lag, or be wiped, and the worst outcome is that a traversal query is
unavailable or stale — never that a result loses its origin. This is the
standard CQRS split, and it is the only arrangement in which "use both" and "the
laws hold" are simultaneously true.

## What each store is actually best at

Routed on the shape of the query, which is what the request asked for:

| Query | Store | Why |
|---|---|---|
| Provenance ancestors of an artifact | PostgreSQL | Bounded depth, must be transactionally consistent with the write that produced it |
| Evidence graph for a finding | PostgreSQL | Three levels, fixed shape, on the audit path |
| Hybrid lexical + semantic retrieval | PostgreSQL | `pgvector` puts embeddings beside the rows; fusion is one query |
| Any read inside a write transaction | PostgreSQL | The projection may not have caught up |
| Shortest path between two objects | **Neo4j** | Variable-length; a recursive CTE explores exponentially where Cypher prunes |
| Influence / centrality ranking | **Neo4j** | Native PageRank over the whole graph |
| Clusters of related work | **Neo4j** | Community detection has no reasonable SQL equivalent |
| "How is X connected to Y at all" | **Neo4j** | Open-ended traversal, unknown depth |

The PostgreSQL column is not a fallback list. Those queries are *better* in SQL
here, and moving them would cost correctness.

## Staleness is reported, never hidden

The projection carries the `updated_at` of the newest row it was built from.
Every Neo4j-answered result states how far behind it is. A researcher reading a
centrality ranking computed before their last five uploads needs to know that,
and the alternative — a silently stale number — is worse than no number.

## Operational consequences

- **Local-first is preserved.** No Neo4j, no problem: the workspace runs
  exactly as it does today, minus four query types, each of which says so.
- **Backups do not change.** `backup.sh` still dumps PostgreSQL and the object
  store. The projection is derived and is rebuilt, not restored — which is why
  it must never hold a fact of its own.
- **`THROUGHLINE_NEO4J_URI` enables it.** Absent means disabled.

## When to revisit

- If the projector cannot keep up with write volume, move it from synchronous
  refresh to a worker queue (the interface already tolerates staleness, so this
  is a change of latency, not of contract).
- If Neo4j ends up answering nothing the SQL path could not, remove it. The
  router makes that a one-line change and the ADR should then be superseded
  again.
