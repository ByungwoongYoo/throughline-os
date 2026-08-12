# Throughline OS

An AI-native research operating system. Built to the Canonical V1 master
specification.

**Deployment target: local-first desktop.** One researcher, one machine. The
database, the job queue and the scientific sandbox all run locally; nothing
leaves the machine unless the researcher connects an external service.

## Status

**Phases 0–4 complete, with a working researcher interface.** The §137 MVP
workflow runs end to end from the browser and produces real publication figures. See `docs/PHASE_0.md`, `docs/PHASE_1.md` and
`docs/PHASE_2.md`, `docs/PHASE_3.md`, `docs/PHASE_4.md` and
`docs/PHASE_5_INTERFACE.md` for exactly what is and is not implemented at
each stage. Per §123 of the specification, nothing in this repository is
a placeholder presented as working functionality.

## Layout (§9)

Every directory below exists. Per §123 a layout that lists directories which are
not there is the same defect as a feature claim that is not true — what is
planned but unbuilt is named under it, separately.

```
apps/
  api/                  FastAPI application — HTTP surface only, no research logic
  web/                  Next.js researcher interface (§65, §66, §115)
packages/
  schemas/              Pydantic domain schemas, versioned (§113)
  model/                Shared model-facing types
  research-domain/      The research model: objects, lineage, claims, evidence,
                        findings, and the durable workflow contracts (§36)
  connector-sdk/        Connector interface and capability model (§32)
  ingestion/            PDF, spreadsheet and document parsing (§24)
  visual-spec/          ResearchVisualSpec (§73), recommendation, critic, renderers
services/
  workers/              Durable background workers (§37, §38)
  scientific-runtime/   Isolated analysis execution (§43)
docs/                   Architecture decisions and phase records
tests/                  Cross-package tests
evals/                  Self-evaluation harness (§58) — grows from Phase 1
```

Planned, and not present in this repository yet: the Scientific Motion Grammar
(§87) and the deterministic 4K scene renderer (§89), both Phase 8.

The durable workflow contracts (§36) live inside `research-domain` as
`workflow.py` rather than in a package of their own.

Business logic does not live in React components. Research logic does not live
in API route handlers.

## Requirements

- Python **3.12** — not merely 3.12 or newer. `pgserver`, which provides the
  embedded PostgreSQL, publishes no wheel past cp312, so 3.13 and 3.14 cannot
  install the database. `bootstrap` checks this and says so rather than letting
  pip fail obliquely.
- Node 20+ *(for `apps/web`; if installed user-locally at `~/.local/opt/node`,
  the launcher finds it. The API and workers run without it.)*

PostgreSQL is **not** a prerequisite — `pgserver` bundles a real PostgreSQL with
pgvector as a Python wheel and runs it against a local data directory.

Linux, macOS and Windows. The analysis sandbox was POSIX-only until it grew a
Windows backend built on Job Objects; see `services/scientific-runtime`.

## Quick start

```bash
./scripts/bootstrap.sh
```

Then:

```bash
./scripts/dev.sh
```

On Windows, or wherever bash is not the shell, call the launcher directly — the
shell scripts are wrappers around it and there is no separate implementation to
fall out of step:

```
python scripts\manage.py bootstrap
python scripts\manage.py dev
```
