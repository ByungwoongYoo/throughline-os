# ADR 0001 — PostgreSQL + pgvector is the graph store. Not Neo4j.

**Status:** accepted
**Date:** 2026-08-09
**Requested by:** the unified brief, Part N — *"Settle the graph store in writing
now. An earlier brief specified Neo4j; this specifies Postgres + pgvector. Both
cannot be true — contradictory briefs are how agents produce divergent
architectures."*

## Decision

Relationships live in PostgreSQL tables. Vector similarity uses `pgvector` in the
same database. There is no separate graph database, and none is planned before
the constraints below are actually hit.

## Why

**One transaction, or the guarantee is fiction.** Law 1 says no result without
provenance, and Law 5 says no output detached from its source graph. Those hold
only if an artifact, its lineage edges and its audit entry commit *together*. A
separate graph store makes that a distributed write: the row lands, the edge
fails, and a finding now exists with no traceable origin — precisely the state
the laws exist to forbid. No amount of retry logic converts two stores into one
transaction.

**The traversals here are shallow.** Provenance walks ancestors; the evidence
graph walks claim → evidence → source; the knowledge graph is bounded and
truncates. Recursive CTEs handle all of it, and the depth-limited queries already
in `lineage.py` and `graphs.py` are the proof. Neo4j earns its place on deep,
variable-length, high-fanout traversal. That is not this workload.

**One store, one backup.** `backup.sh` dumps the database and the object store
together because either alone is useless. A third system would need its own
consistent snapshot taken at the same instant — and a backup that restores two
of three stores is worse than none, because it looks like it worked.

**`pgvector` puts embeddings beside the rows they describe.** Hybrid retrieval
(§29) fuses full-text and semantic ranking. Both live in one query today. Split
across two systems, fusion becomes an application-level join over two ranked
lists fetched by network.

**Operational weight is a product constraint.** This ships local-first: an
embedded PostgreSQL and nothing else. Requiring a JVM graph database alongside it
would make a researcher's laptop install a deployment.

## What we give up

Honestly stated, since the point of the record is to make the reversal decision
easy later:

- No Cypher. Graph queries are SQL with recursive CTEs, which is more verbose and
  less pleasant for pathfinding.
- No native graph algorithms — PageRank, community detection, shortest path
  across a large graph. These would need computing in Python or a plugin.
- Deep variable-length traversal will be slower than a native graph engine.

## When to revisit

Concrete triggers, not vibes:

1. A single project routinely exceeds ~100k edges **and** the knowledge-graph
   query exceeds 500ms after indexing.
2. A feature genuinely requires unbounded pathfinding or community detection at
   interactive latency.
3. Multi-hop recommendation over the citation graph becomes a core surface.

Until one of those is true and measured, this is settled. The graph adapter in
`graphs.py` keeps queries behind a module boundary so a future backend is a
replacement rather than a rewrite — which is the cheap insurance that makes
deferring this correct rather than reckless.

## Consequence for the frontend

Part E's living knowledge graph is a **rendering** decision, not a storage one.
Sigma.js / PixiJS / WebGL and a Web Worker force simulation read positions from
whatever the API returns. Nothing in Part E requires a graph database.
