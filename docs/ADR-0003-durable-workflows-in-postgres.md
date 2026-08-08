# ADR-0003 — Durable workflows in PostgreSQL, not Redis

**Status:** accepted · **Context:** local-first desktop target

§8 suggests a Redis-backed queue, prefers Temporal for complex durable
workflows, and explicitly permits: "If unavailable, implement workflow state
durably in PostgreSQL."

**Decision.** Implement the workflow engine on the database already present.

**Mechanism.**
- **Leases, not locks.** `claim_next` uses `FOR UPDATE SKIP LOCKED` to hand a run
  to exactly one worker for a bounded time. A dead worker's lease lapses and the
  run is reclaimed — proven by `test_run_survives_a_worker_that_dies_mid_flight`.
- **Idempotency keys** (§38) make enqueue safe to repeat.
- **Node-level state** so a resumed run skips work already paid for.

**Consequences.** No broker to install, and workflow state is transactionally
consistent with the research data it produces — a finding and the record of the
workflow that created it commit together, which a separate queue cannot promise.
Throughput is bounded by database round-trips; irrelevant at desktop scale, and
the interface is narrow enough to swap for Temporal if this is ever hosted.
