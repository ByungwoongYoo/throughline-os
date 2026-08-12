# Remediation plan — install, verification, Docker, Windows

Everything below was found by installing this project from a clean clone and
driving the §137 MVP workflow end to end in a browser. Each claim states how it
was verified; nothing here is inferred from reading alone unless said so.

Target: this branch accumulates the fixes and merges to `main` once final.

---

## Status

All seven issues are fixed on this branch, plus the rate-limit tuning and the
Windows port. Verified by running, not by reading:

| # | Issue | State | How it was verified |
|---|---|---|---|
| 1 | Installer omitted three required packages | fixed | `bootstrap.sh` run against a clean tree: all nine install, migrations apply, every module imports. Both failure paths exercised too. |
| 2 | Docker build referenced a directory that never existed | fixed | Line removed; build itself **not run** — no Docker on the machine used. CI now builds the image and health-checks it. |
| 3 | Native Windows could not import the API | fixed | Whole stack verified natively on Windows: API imports (180 routes), embedded PostgreSQL boots and applies all 24 migrations, `/api/health` returns 200, and the sandbox runs a real analysis under a Job Object. |
| 4 | Duplicate upload orphaned a source forever | fixed | Regression test reproduces the orphan against the old keying and passes against the new. |
| 5 | Workflow does not finish in the browser | **open** | Out of scope — a feature, not a fix. See below. |
| 6 | Three tests pinned to the author's laptop | fixed | Paper is generated; all three now run. The §137 end-to-end test passes for the first time off its author's machine. |
| 7 | `python-pptx` / `python-docx` / neo4j driver undeclared | fixed | Both previously failing tests pass. |

Also landed: credential rate limits relax on a local install while the sandbox
limits stay strict, `policy_report()` derives from the active backend instead of
returning hardcoded `True`, one launcher replaces the bash-only entrypoints, and
CI gained a Windows job scoped to the sandbox.

**An eighth issue, found by doing the work rather than by review.** On Windows the
sandbox working directory was never destroyed — `shutil.rmtree` will not delete a
file with the read-only attribute, which the sandbox sets on its input, and
`ignore_errors=True` hid it. A copy of the researcher's data was left in the temp
folder after every analysis while the policy report claimed otherwise. Fixed and
verified: a full sandbox run now leaves nothing behind. Two more were bugs in these
fixes themselves — a partial `.venv` that made the next run fail confusingly, and a
launcher that ignored `SIGTERM` and orphaned the whole stack. All three surfaced
only by running the thing, which is the argument for workstream F in one line.

**Native Windows works, and `pgserver` was never the obstacle.** It publishes
`win_amd64` wheels up to cp312, so on Python 3.12 the embedded PostgreSQL boots
on Windows exactly as it does elsewhere — verified, 24 migrations applied. The
POSIX-only sandbox was the whole blocker. What remains for a *pleasant* Windows
experience is E4, since `scripts/*.sh` still assume bash and `.venv/bin/python`;
the stack itself no longer needs porting.

Still needing someone with the right machine: `docker build` (issue 2). No Docker
was available here, so the fix is reasoned rather than run — CI now builds the
image and health-checks it, which is where that claim should be settled anyway.

The workstream sections below are left as written. They record why each fix takes
the shape it does, which outlives the moment the work landed; the table above is
what says where things stand.

---

## What the run established

The core of the product works, and works well. Discovery ran six real sandboxed
analyses and reproduced the numbers the landing page advertises:
`consumption_ddd × resistance_pct` promoted at r=0.8784, q=7.44e-39, while
`resistance_pct × gdp_per_capita` was correctly held back at q=0.066 despite
being significant on its own at p=0.022. Validation ran three more sandboxed
analyses and passed all six checks; adjusting for `gdp_per_capita` moved the
coefficient only 0.8784 → 0.7984. The Figures section rendered a real
confidence-interval plot from that run. The test suite is substantial:
**532 passed, 2 failed, 12 skipped** in 8m33s.

The problems are not in the engine. They are in packaging and verification.

---

## Issues

### 1. A fresh clone cannot install — every platform

`scripts/bootstrap.sh` installs four workspace packages; the dependency graph
needs nine. Missing: `packages/visual-spec` (required by `research-domain`),
`packages/ingestion` and `services/scientific-runtime` (both required by
`services/workers`). These exist only in this repo, so pip resolves them against
the public index and fails.

Reproduced by running the script's exact install line in a clean venv:

```
ERROR: Could not find a version that satisfies the requirement
       throughline-visual (from throughline-domain) (from versions: none)
ERROR: No matching distribution found for throughline-visual
exit 1
```

Confirmed that `throughline-visual`, `throughline-ingestion`,
`throughline-runtime` and `throughline-schemas` all return 404 from PyPI.

`packages/model` and `packages/connector-sdk` are also omitted but nothing
depends on them, so they do not break the install.

### 2. The Docker build is broken too

`Dockerfile:46` installs `./packages/workflow-sdk`. That directory has **never
existed** in this repository's git history (verified with `git log
--diff-filter=D` and `git ls-files`; it is not gitignored either). Its code
lives inside `research-domain` as `workflow.py`, so the package was folded in
but the Dockerfile and README were not updated. `compose.yaml` uses `build: .`,
so `docker compose up` fails the same way.

Not verified by running `docker build` — Docker is not installed on the machine
used. The cause is unambiguous (pip cannot install a path that does not exist),
but removing the line is necessary, not provably sufficient.

Everything else in that install line is correct and in a valid order.

### 3. Native Windows cannot run the API at all

`services/scientific-runtime/src/throughline_runtime/executor.py` uses
POSIX-only primitives: `import resource` at module level (line 37), plus
`os.setsid()`, `preexec_fn=`, and `os.killpg()`.
`apps/api/src/throughline_api/app.py:32` imports that module at import time, so
the FastAPI app fails to import on Windows before any analysis runs.

Two secondary blockers: all scripts assume bash and `.venv/bin/python`
(Windows uses `.venv\Scripts\python.exe`), and `pgserver` publishes no wheel
past CPython 3.12 — a constraint on every platform, not just Windows.

Verified indirectly: the same code imports and runs cleanly under WSL2 Ubuntu
24.04, so the divide is POSIX vs Windows, not macOS vs Windows.

### 4. Duplicate upload orphans a source permanently

Uploading a file whose bytes match one already in the project returns
`202 Accepted` and creates a new `sources` row that never ingests. It sits at
`ingestion_status = 'uploaded'` with empty `ingestion_detail` indefinitely,
and the UI shows "Waiting for a worker to pick it up…" forever.

Cause: `app.py:673` enqueues with
`idempotency_key=f"ingest:{project_id}:{record['content_hash']}"`, and
`workflow.py:44` `enqueue()` returns the id of the existing run when that key is
already present. For duplicate content the new row therefore gets no run of its
own, and the original run has already completed.

Observed live: 4 `sources` rows, 2 `workflow_runs`, 2 rows stuck.

### 5. The §137 workflow does not finish in the browser

After validation succeeds, the Overview says "Record a finding — NEXT". The
Findings section renders **zero buttons**, and no `api.post` to `/findings`
exists anywhere in `apps/web` (verified by enumerating every `api.post` call).
The capability exists in the API and is exercised by the test suite, but it is
unreachable by click.

The README states the workflow "runs end to end from the browser". That is not
currently true. The landing page's otherwise admirable "Not built" ledger does
not mention this gap either.

### 6. Three tests are pinned to the author's laptop and silently skip

`tests/test_mvp_end_to_end.py:21` and `tests/test_ingestion.py:19` both read:

```python
Path("/Users/sarthakpattnaik/Downloads/throughline_v18_zero_motion_1_8_0/"
     "data/files/workspace_default").glob("*.pdf")
```

Three tests are gated on that path existing and skip themselves everywhere else
— including `test_paper_plus_dataset_to_validated_finding_with_full_provenance`,
the single test that covers the whole product. This is why issue 5 went
unnoticed.

### 7. Two libraries are used but never declared

- `packages/research-domain/src/throughline_domain/render_artifact.py:322`
  imports `pptx`. `python-pptx` appears in no `pyproject.toml`. **PPTX export
  raises `ModuleNotFoundError` for every user.** Test failure:
  `tests/test_communication.py::test_every_format_renders_from_one_resolved_artifact`
  — the test is correct; the declaration is missing.
- The same file's line 255 imports `docx`. `python-docx` is declared in
  `packages/ingestion`, a *different* package, so DOCX export works only by
  transitive accident.
- `tests/test_graph_projection.py:95` asserts `"unaffected" in
  capability["note"]`, which only holds when a neo4j driver is installed — also
  declared nowhere. Fails with
  `AssertionError: assert 'unaffected' in 'The Neo4j driver is not installed in
  this environment.'` The same file defines `needs_neo4j` on line 24 but this
  test does not use it.

### Not a defect

The Overview briefly showed 0 analyses / 0 connections after work completed
elsewhere in the SPA. A reload gives the correct 9 and 6 — stale client state,
not lost data. Low priority.

---

## Root cause

Five of the seven issues share one cause: **nothing has ever run this project on
a machine that is not the author's.** No CI, no from-scratch install check, and
the one test that would exercise the whole product cannot run anywhere else.
That single gap produced the broken installer, the broken Docker build, the
missing findings UI, the PPTX crash, and both test failures.

Workstream F addresses the cause. Without it, the rest will regress.

---

## Sequencing

```
A + C  →  D  →  F  →  B  →  E
```

A and C are both dependency-declaration work: one pass fixes both and takes the
suite to 0 failures, which is the baseline that makes every later change
verifiable. D is nearly free and gives Windows users a working route today. F
closes the class of bug permanently. B is product logic and deserves a clean
bench. E is the largest piece and goes last.

---

## A. Fix the installer

**Goal:** `git clone && ./scripts/bootstrap.sh` works on a machine that has
never seen this project.

- Replace the four-package list with all nine in dependency order:
  `schemas, model, connector-sdk, visual-spec, ingestion, scientific-runtime,
  research-domain, workers, api`. This order is verified working.
- Guard the venv step: `python3 -m venv` fails on Ubuntu 24.04 because
  `ensurepip` is not bundled. Fail with "install python3.12-venv", not a
  traceback.
- Guard the interpreter version: `pgserver` has no wheels past CPython 3.12.
  Check up front and say so, rather than surfacing a confusing pip resolution
  error.
- Reconsider `pip install -q`. Quiet mode helped hide this.

**Verify:** clone to a temp directory, bootstrap in a clean environment, import
all seven modules. **Risk:** low; self-proving.

## C. Fix the undeclared dependencies

**Goal:** suite reaches 534 passed, 0 failed.

- Declare `python-pptx` and `python-docx` in `packages/research-domain`.
- Decide core vs optional. The codebase has a strong precedent for optional —
  `/api/system/capabilities` reports a missing embedding model as unavailable
  rather than crashing. Following it for exports means an extra plus graceful
  degradation; declaring them hard dependencies is the two-minute version.
- Fix `tests/test_graph_projection.py:95`: apply the existing `needs_neo4j`
  marker, or assert what holds regardless (`configured is True`,
  `reachable is False` — both already pass).

**Risk:** low.

## D. Fix the Docker build

**Goal:** `docker compose up` becomes a one-command install, including Windows.

- Remove `./packages/workflow-sdk` from `Dockerfile:46`.
- Correct the README layout section, which lists five directories that do not
  exist: `workflow-sdk`, `motion-spec`, `types`, `video-renderer`,
  `infrastructure/`. Two are honestly labelled Phase 8; the rest should go or be
  marked.

**Prerequisite:** Docker Desktop installed. **Verify:** build succeeds, compose
comes up, `/api/health` returns 200, the web UI loads, data survives
`docker compose down` and back up. **Risk:** low for the edit; the remainder of
the build is unproven.

> Note: Docker Desktop on Windows runs Linux containers via WSL2 underneath, so
> this is still Linux. The difference is user experience — "install Docker
> Desktop and click run" instead of "learn what WSL is" — which is the point.

## F. Clean-environment verification (the root-cause fix)

- CI job: fresh clone, run `bootstrap.sh` from scratch, run the suite, on Ubuntu
  and macOS.
- Replace the hardcoded macOS PDF path with a fixture generated at test time,
  so all three skipped tests actually run. A working generator exists — it
  produces a real multi-page PDF with extractable text plus the exact dataset
  `_amr_csv()` expects. Generating beats committing a binary.
- Assert an expected skip count in CI so a test cannot go quiet unnoticed again.

**Payoff:** would have caught issues 1, 2, 5 and 7 on the first commit.

## B. Fix the duplicate-upload orphan

**Goal:** uploading the same file twice never leaves a stuck entry.

Decide semantics before writing code. Three options:

1. Look up the existing source by `(project_id, content_hash)` before insert and
   return it instead of creating a duplicate. Most consistent with the project's
   stated principles, but changes the API contract — today it returns 202 with a
   new id, and the web UI must tolerate a 200 pointing at an existing one.
2. Create the row but resolve it immediately from the completed run, so it lands
   at `ready`.
3. Make the idempotency key per-source (`ingest:{source_id}`) so every row gets
   its own run, accepting duplicated work.

Check first: whether the schema intends `content_hash` to be unique per project
(read the `compatibility_uniqueness` migration), and whether any code
legitimately wants two sources with identical bytes.

Add a regression test — the current suite does not cover this path.

**Risk:** medium. Touches the data model and an API contract.

## E. Native Windows support — E1, E2, E3 landed

E1, E2 and E3 turned out to be one refactor and were done together. E4, E5 and E6
are still open and described below.

`executor.py` now selects a backend by platform. POSIX keeps `setrlimit` between
fork and exec plus `setsid`/`killpg`, unchanged and still passing its tests.
Windows gets `jobobject.py`: a Job Object carrying the same ceilings, bound with
`ctypes` rather than adding a platform-specific dependency. The mapping is
`RLIMIT_AS → JOB_OBJECT_LIMIT_JOB_MEMORY`, `RLIMIT_CPU → JOB_OBJECT_LIMIT_JOB_TIME`,
`RLIMIT_NPROC → JOB_OBJECT_LIMIT_ACTIVE_PROCESS`, and
`setsid`+`killpg` → `TerminateJobObject`. `KILL_ON_JOB_CLOSE` makes cleanup
stricter than POSIX in one respect: an orphaned process group survives a dead
parent, a job does not.

Two differences are real and are reported as best-effort rather than smoothed
over. `chmod(0o444)` on Windows sets an attribute the analysis could clear, where
POSIX mode bits deny the write; and the job is attached just after the process is
created rather than just before it starts, because `Popen` does not expose the
suspended thread handle that would be needed to do it earlier. Both are named in
`policy_report()`.

If the Job Object cannot be attached, the run is refused rather than continued
unprotected — a run that had quietly lost its ceilings would otherwise be
recorded against a report claiming it had them.

Verified natively on Windows: a real `pearson_correlation` returning
r = 0.999419, identical on rerun; a non-whitelisted method refused; a 1-second
timeout terminating the job; and a 16 MB ceiling actually killing the process
rather than being exceeded.

### E4, E5, E6 — landed

**E4.** `scripts/manage.py` holds the sequence; `bootstrap.sh` and `dev.sh` are
wrappers. Standard library only, since bootstrap runs before there is a
virtualenv. Verified on POSIX end to end — API answers, web serves, and a
`SIGTERM` leaves zero processes and zero held ports. Verified on Windows for the
parts that differ: the `Scripts\python.exe` path, the version guard, the package
order, `SIGBREAK`.

Two bugs it turned up, both only visible by running it. `SIGTERM` killed the
launcher without unwinding, so the children survived holding both ports — Ctrl-C
worked, which is why it would have gone unnoticed. And the README asked for
"Python 3.12+", which cannot be true when `pgserver` stops at cp312.

**E5.** Pinned and documented rather than made optional. `bootstrap` refuses
anything but 3.12 and names `pgserver` as the reason. Making the embedded database
an optional extra so newer interpreters could run against external PostgreSQL
remains possible — `db.py` already imports `pgserver` lazily — but it is a
structural change to a package that works, so it is left as a choice rather than
taken unilaterally.

**E6.** A `windows-latest` job scoped to `tests/test_sandbox.py`, not the whole
suite. It covers what only a Windows runner can: the Job Object limits, the
process-tree kill, the read-only-attribute cleanup, and the policy report. The
full suite is not run there because each analysis spawns a subprocess and Windows
process creation is several times more expensive — 12 sandbox tests take about two
minutes on Windows against seconds elsewhere, so 541 would be a poor gate. Ubuntu
and macOS run everything.

One fragility worth knowing before anyone runs the full suite on Windows: if a
`pgserver` instance is killed rather than shut down, the stale data directory makes
the next `pg_ctl start` time out, and with no per-test timeout that presents as an
indefinite hang with no CPU use. Deleting the data directory clears it. A fresh CI
runner never has that state.

**A third bug, found by running the suite on Windows.** The sandbox working
directory was not being destroyed. `shutil.rmtree` refuses to delete a file
carrying the Windows read-only attribute, and the sandbox sets exactly that on its
input and job description — so `ignore_errors=True` swallowed the failure and left
a copy of the researcher's data in the temp folder after *every* analysis, while
`policy_report()` claimed the environment had been destroyed. POSIX never showed
it, because there the right to unlink comes from the parent directory. Cleanup now
clears the attribute and retries, and does not ignore errors: research data left
behind is the failure, and hiding it is worse than the exception. Verified — a full
sandbox run now leaves zero directories behind.

Nothing in E remains open. The original notes for E4, E5 and E6 are folded into the
descriptions above.

---

## Routing

Model tier and effort per item.

| Item | Work | Tier | Effort |
|---|---|---|---|
| A | Install list + version/venv guards | Sonnet | medium |
| A✓ | Fresh-clone install + import check | local, no model | — |
| C1 | Declare `python-pptx` / `python-docx` | Sonnet | low |
| C2 | Optional-extra + graceful degradation *(if chosen)* | Opus | medium |
| C3 | Gate or rewrite the neo4j test | Sonnet | low |
| C✓ | Full pytest run | local, no model | — |
| D1 | Remove bogus path; correct README layout | Sonnet | low |
| D✓ | `docker build` + compose smoke test | local, no model | — |
| F1 | CI workflow, Ubuntu + macOS | Sonnet | medium |
| F2 | Replace hardcoded path with generated fixture | Opus | medium |
| F3 | Skip-count assertion | Sonnet | low |
| B1 | Decide semantics; read spec + migrations | Opus | high |
| B2 | Implement, plus constraint/migration if needed | Opus | high |
| B3 | Regression test for the duplicate path | Sonnet | medium |
| E1 | Guard POSIX imports so Windows boots | Sonnet | medium |
| E2 | Job Objects sandbox backend | Opus | xhigh |
| E3 | Make `policy_report()` platform-truthful | Opus | high |
| E4 | Cross-platform launcher replacing the `.sh` scripts | Opus | medium |
| E5 | Python-version / embedded-DB constraint | Sonnet | medium |
| E6 | Windows CI matrix | Sonnet | low |

E2 is the only candidate for escalation beyond Opus, and only if an Opus attempt
stalls — it is contained platform work, not a frontier problem.

---

## Out of scope here

**The missing findings UI (issue 5)** is a feature to build, not a bug to fix,
and needs its own scoping. But the README's "runs end to end from the browser"
claim is wrong until it exists and should be corrected regardless of when the UI
is built.

**Stale Overview counters** — cosmetic, fix opportunistically.
