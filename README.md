# Throughline OS

An AI-native research operating system.

**Deployment target: local-first desktop.** One researcher, one machine. The
database, the job queue and the scientific sandbox all run locally. Nothing
leaves the machine unless the researcher connects an external service — and
where one can be connected, the interface says so before it is used.

## Status

The scientific spine works end to end: a paper goes in, claims come out, a
dataset tests them, and the result renders as a publication figure with its
provenance intact. Five of the six comparison verbs are wired with real refusal
taxonomies — a comparison the system declines to make is a first-class answer,
not an error.

What is missing is the spatial canvas, most of the integration surface, and the
video engine. `ROADMAP.md` is the live document: it records what exists, what
does not, and the order the rest is being built in. Where an earlier audit was
wrong, the correction is kept rather than quietly edited out.

**Nothing here is a placeholder presented as working functionality.** That is
the standard the project sells itself on, so it is also the thing most worth
checking: `tests/test_packaging.py` and the primitive registry exist to make
drift between what is claimed and what runs visible in CI rather than in a demo.

## Layout

Every directory below exists. A layout that lists directories which are not
there is the same defect as a feature claim that is not true, so what is planned
but unbuilt is named separately, underneath.

```
apps/
  api/                  FastAPI application — HTTP surface only, no research logic
  web/                  Next.js researcher interface
packages/
  schemas/              Pydantic domain schemas, versioned
  model/                Model providers, prompts, and the provider interface
  research-domain/      The research model: objects, lineage, claims, evidence,
                        findings, the notebook, and the durable workflow contracts
  connector-sdk/        Connector interface and capability model
  ingestion/            PDF, spreadsheet and document parsing
  visual-spec/          ResearchVisualSpec, recommendation, critic, renderers
services/
  workers/              Durable background workers
  scientific-runtime/   Isolated analysis execution
docs/                   Architecture decisions and phase records
tests/                  Cross-package tests
evals/                  Self-evaluation harness
scripts/                manage.py, and the shell wrappers around it
```

Planned and not present: the Scientific Motion Grammar and the deterministic 4K
scene renderer. Institutional sign-on and the licensed bibliographic databases
are likewise unbuilt.

The durable workflow contracts live inside `research-domain` as `workflow.py`
rather than in a package of their own.

Business logic does not live in React components. Research logic does not live
in API route handlers.

## Models

The platform runs without a model at all. Every deterministic path — ingestion,
statistics, validation, the refusal taxonomies, provenance, export — works with
no provider configured, and says so plainly rather than degrading into a version
of the product that quietly makes things up.

Two backends exist, and the choice between them is a privacy decision:

| | |
|---|---|
| `ollama` *(default)* | Runs on this machine. Nothing sent to it leaves the device, which is what makes it usable on unpublished data. |
| `anthropic` | A frontier model, for statistical interpretation. **Sends text to a hosted API.** |

Nothing selects the hosted provider implicitly. There is no fallback that
reaches for it when the local model is missing: that would move unpublished
research off the machine to fix an availability problem, which is not a trade
the software gets to make on a researcher's behalf. It is configured
deliberately, or not at all.

```bash
export THROUGHLINE_MODEL_PROVIDER=anthropic
export ANTHROPIC_API_KEY=...
```

The hosted client is an optional extra (`pip install 'throughline-model[anthropic]'`);
a workspace without it reports the provider unavailable rather than failing to
import.

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

## Container

The image ships the embedded PostgreSQL rather than expecting an external one,
because that is what the product is: a workspace someone installs, not a service
someone operates.

There is no published image; build it first.

```bash
docker build -t throughline-os .
```

```bash
docker run -p 3000:3000 -p 8080:8080 -v throughline:/data throughline-os
```

**The volume is not optional.** PostgreSQL runs inside the container and writes
to `/data`; without a mount, the entire corpus is destroyed by the second
`docker run`, and it presents as the application having forgotten everything
rather than as a missing volume.

The health check answers 200 while degraded on purpose. A workspace with no
model still does everything deterministic, and restarting it would lose
in-flight work to fix nothing. Only an unreachable database answers 503.

## Tests

```bash
.venv/bin/python -m pytest tests -q
```

```bash
cd apps/web && npx vitest run
```

CI runs the suite across Linux and macOS, a Windows job for the sandbox, the web
build, and a Docker job that builds the image and polls `/api/health` until the
API answers inside it — a Dockerfile that is written but never built is not
evidence of anything.
