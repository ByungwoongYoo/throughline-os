# Throughline OS

An AI-native research operating system. Built to the Canonical V1 master
specification.

**Deployment target: local-first desktop.** One researcher, one machine. The
database, the job queue and the scientific sandbox all run locally; nothing
leaves the machine unless the researcher connects an external service.

## Status

**Phases 0–4 complete — the §137 MVP workflow works end to end, and
produces real publication figures.** See `docs/PHASE_0.md`, `docs/PHASE_1.md` and
`docs/PHASE_2.md`, `docs/PHASE_3.md`, `docs/PHASE_4.md` for exactly what is
and is not implemented at each stage. Per §123 of the specification, nothing in this repository is
a placeholder presented as working functionality.

## Layout (§9)

```
apps/
  api/                  FastAPI application — HTTP surface only, no research logic
  web/                  Next.js researcher interface (requires Node ≥ 20)
packages/
  schemas/              Pydantic domain schemas, versioned (§113)
  research-domain/      The research model: objects, lineage, claims, evidence, findings
  workflow-sdk/         Durable workflow contracts and node definitions (§36)
  connector-sdk/        Connector interface and capability model (§32)
  visual-spec/          ResearchVisualSpec (§73), recommendation, critic, renderers
  motion-spec/          Scientific Motion Grammar (§87) — Phase 8
  types/                Shared TypeScript types for the web app
services/
  workers/              Durable background workers (§37, §38)
  scientific-runtime/   Isolated analysis execution (§43) — Phase 2
  video-renderer/       Deterministic 4K scene renderer (§89) — Phase 8
infrastructure/         Local runtime: embedded Postgres, storage roots
docs/                   Architecture decisions and phase records
tests/                  Cross-package tests
evals/                  Self-evaluation harness (§58) — grows from Phase 1
```

Business logic does not live in React components. Research logic does not live
in API route handlers.

## Requirements

- Python 3.12+
- Node 20+ *(only for `apps/web`; the API and workers run without it)*

PostgreSQL is **not** a prerequisite — `pgserver` bundles a real PostgreSQL with
pgvector as a Python wheel and runs it against a local data directory.

## Quick start

```bash
./scripts/bootstrap.sh
```

Then:

```bash
./scripts/dev.sh
```
