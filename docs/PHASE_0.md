# Phase 0 — System Foundation

Per §128. This document states exactly what is implemented and what is not, so
nothing here can be mistaken for working functionality it does not have (§123).

**Status: complete for the local-first target. 51 tests passing against a real
PostgreSQL.**

## Implemented

| §128 requirement | Where | Proven by |
|---|---|---|
| Authentication | `throughline_domain.auth` | `test_auth_and_storage.py` — PBKDF2 600k rounds, hash-only session storage, constant-work unknown-email path |
| Project scoping | `auth.owns_project`, `api.scoped_project` | `test_api.py::test_another_account_cannot_see_a_project` — a stranger gets 404, not 403 |
| Database migrations | `throughline_domain.migrate` | Forward-only, checksummed; editing an applied migration fails loudly |
| Object storage | `throughline_domain.storage` | Content-addressed SHA-256, atomic rename, per-project dedup, path-escape refused |
| Research object model (§10) | `throughline_domain.objects` | 34 object types, versioning, parent/child |
| Source model (§18) | `objects.create_source` | Ingestion state machine cannot run backwards |
| **Artifact lineage (§11)** | `throughline_domain.lineage` | Full `dataset → analysis → finding → visual → slide` chain traversed both directions; cycles terminate |
| Claim / evidence (§15, §16) | schema + `findings.evidence_summary` | Evidence carries an exact location |
| **Finding lifecycle (§13)** | `throughline_domain.findings` | Candidate cannot jump to validated; promotion without evidence refused; §51 checks required and must pass |
| **Workflow engine (§36–§38)** | `throughline_domain.workflow` | Lease-based claiming, idempotency keys, per-node resume, approval gates, cost limits |
| Background workers (§37) | `throughline_workers` | A worker killed mid-run loses nothing; a replacement finishes the job |
| Audit foundation (§99) | `throughline_domain.events` | Every creation writes an audit row |
| Domain events (§112) | `events.emit` / `events.since` | Monotonic sequence for resumable streams |

## The laws, as enforced code

- **LAW 1** — `objects.create_object(derived_from=…)` writes the artifact and its
  lineage in one transaction. `lineage.record_derivation` refuses an empty input
  list rather than creating an unexplained artifact.
- **LAW 3** — `findings.transition` raises `EvidenceRequired` for any promotion
  past CANDIDATE without linked evidence.
- **LAW 4** — `workflow.gate` halts a run at `awaiting_approval` and only a
  `POST /api/workflows/{id}/nodes/{name}/approve` releases it, given from the
  approval screen on the discovery view.

  This line used to name `start_node`, and it was true of the engine and false
  of the system. `start_node` halts a run whose node carries
  `requires_approval` — and nothing ever created one: no caller passed `nodes=`
  to `enqueue`, nothing outside `workflow.py` called `start_node`, and no route
  listed what was waiting, so the approve endpoint needed a run id nothing
  handed out. The law was recorded as enforced while being enforceable by
  nothing. A researcher now asks for the hold per sweep, and the gate is
  reached, described and released through the interface.
- **LAW 5** — lineage edges (`visualizes`, `communicates`) mean a slide still
  resolves to the dataset behind it.
- **LAW 2** — *not yet enforceable.* It requires the Phase 2 sandbox. No LLM runs
  in this codebase yet, so nothing can fabricate a number, but that is an absence
  of opportunity rather than a control. See the gate below.

## Deliberately not implemented

- **Organizations and workspaces (§96, §97).** Local-first: one researcher on one
  machine. `project` is the scoping unit and every research row already carries
  `project_id`, so adding the higher tiers later is additive. See ADR-0002.
- **Row-level security.** Meaningless with a single local account; project
  ownership is checked server-side on every request. Revisit if hosted.
- **Redis / Temporal.** §8 explicitly permits durable workflow state in
  PostgreSQL when a queue is unavailable, and a desktop install should not
  require a broker. See ADR-0003.
- **The web app.** `apps/web` is an empty directory. Node is not installed on
  this machine, and scaffolding a Next.js app that cannot run would be exactly
  the fake surface §123 forbids.
- **Ingestion, analysis, discovery, visualization, communication.** Phases 1–8.
  The only registered workflow handler is `system.echo`, used to prove the queue
  is durable.

## Gates on the next phase

1. **The sandbox comes before any LLM-authored analysis (§43).** The old
   codebase runs pandas in the API process; repeating that with generated code
   is remote execution with database credentials in scope.
2. **The prompt-injection boundary comes before connector expansion (§35).**
   `sources.trust_level` already defaults to `untrusted`; the tagging must be
   honoured by whatever first sends source text to a model.
3. **Evals start with Phase 1 (§58).** The §137 differentiator is unprovable
   without them.

## Running it

```bash
./scripts/bootstrap.sh   # venv, packages, migrations (boots bundled PostgreSQL)
./scripts/dev.sh         # API on :8080 + one worker
./scripts/test.sh        # 51 tests
```
