# Throughline

**A research workspace that runs on your own computer.** You bring papers and
datasets. Throughline tests relationships in the data properly — correcting for
how many comparisons were made — tries to break the ones that look real, records
what survives as a finding with its evidence and provenance attached, and helps
you write it up. Nothing leaves your machine unless you connect a service, and
the interface says so before one is used.

**Download:** [throughline-research.pages.dev](https://throughline-research.pages.dev)
— the current release is `v0.3.0`. **Licence:** Apache 2.0 (`LICENSE`).

## What you do in it

Every screen carries the same six steps, with the next one named and one button
to take it:

1. **Add sources** — upload papers (PDF, Word, text) and datasets (CSV, Excel,
   JSON and more), or find them: *Find papers* searches ten literature sources
   at once, and *Find data* searches four open data repositories.
2. **Profile a dataset** — every column typed, with its units, spread and
   missingness.
3. **Generate and test candidates** — *Discovery* tests every pair of columns and
   corrects for how many tests it ran (Benjamini–Hochberg). On your own dataset,
   one press on the Overview runs this and records the strongest survivor as a
   finding.
4. **Try to destroy what survived** — validation re-runs a result resampled,
   without its outliers, against its missingness and adjusted for confounders
   you choose. Nothing is called validated until it survives.
5. **Record a finding** — tied to the analysis and evidence it rests on.
6. **Communicate it** — a report that references its evidence rather than
   copying it, and figures that export with their specification.

Three workspaces carry the work:

| Workspace | Where | What it is for |
|---|---|---|
| **Reasoning** | Evidence → Compare | Can a paper's claim be tested with this dataset? The paper's quoted claim, your judgement and the model's reading side by side. |
| **The analysis cockpit** | Analysis → Analyses, open a run | One run read five ways — result, specification, assumptions, sensitivity, reproducibility — with its figure, its run family and everything it is linked to. |
| **The research river** | Lineage → Research graph → River | Every object in six stages, with what was derived from what drawn as a line whose weight, colour and pattern say what kind of relationship it is. |

## Where it stands

**Works end to end today: starting from a dataset.** Upload it, press once, and
discovery, corrected tests, a finding with its lineage, validation and a report
all follow from buttons the product offers.

**Does not yet: starting from a topic or a single paper.** Walked on
2026-09-15 and recorded rather than smoothed over:
- *Find papers* fails entirely when one database hangs (D409).
- A paper added from a search keeps only its metadata, so its claims cannot be
  located (D410).
- Importing a found dataset sends the repository page instead of the file (D411).
- A paper-first project stops at claims when no model is connected, without
  saying how to connect one (D412).
- The loop has no route from a paper's claim to data that could test it (D413).

**The AI model is optional.** Statistics, validation, provenance and reports all
work without one. Locating a paper's claims and model-written readings need one;
see *Models* below.

The depth — imaging comparison, the interpretation layer, the 3D chart
catalogue, statistical conformance and the single verdict — is in
`docs/CAPABILITIES.md`. What is missing, and the order it is being built in, is
in `ROADMAP.md`.

## Quick start

```bash
curl -fsSL https://throughline-research.pages.dev/install.sh | sh
```

On **Windows**, in PowerShell — there is no `sh` on a stock Windows, so the line
above cannot work there and the equivalent is:

```powershell
irm https://throughline-research.pages.dev/install.ps1 | iex
```

That downloads the current release to `~/throughline-os` (override with
`THROUGHLINE_INSTALL_DIR`), checks it against the checksum the release
publishes, and runs the bootstrap. It does **not** clone the repository — this
one is private, so the clone that used to happen here failed for everybody
without credentials (D050). Set `THROUGHLINE_REPO` to take the git path on
purpose if you have access.

A terminal line rather than a
download on purpose: the quarantine flag that triggers Gatekeeper and SmartScreen
is set by the downloading browser, not by the operating system, so this path
carries no security warning at all.

From an existing clone, the bootstrap directly:

```bash
./scripts/bootstrap.sh
```

Then:

```bash
./scripts/dev.sh
```

### Without a terminal

`launchers/` holds one door per platform, and **each is a file you can hand
somebody on its own**. Run it and it opens Throughline — installing it first if
that machine has not got it yet. There is one install sequence rather than three:
each launcher does two cheap local checks and then delegates.

It looks in three places, cheapest first, with the network only in the last:

1. **Inside a checkout** — running from a clone keeps working, and uses *that*
   clone rather than some other copy in the home directory.
2. **`~/throughline-os`**, or wherever `THROUGHLINE_INSTALL_DIR` points. This is
   the common case for a downloaded launcher on its second run, and it costs two
   `stat` calls.
3. **Nothing yet** — hand over to `install.sh`, which clones and sets up, and
   ends by starting it.

They previously assumed they were already inside a checkout, so a launcher saved
on its own to a downloads folder failed looking for `scripts/manage.py` one
directory up. That made them a convenience for somebody who already had the code
rather than a way to get it, which is the opposite of what a download is for.

| Platform | Double-click | First-run warning |
|---|---|---|
| macOS | `launchers/Throughline.command` | Gatekeeper — System Settings > Privacy & Security > Open Anyway, or use the Terminal one-liner |
| Windows | `launchers/Throughline.bat` | SmartScreen — More info, Run anyway, once |
| Linux | `python scripts/manage.py desktop-entry`, then Throughline in the menu | none |

The warnings are what being unsigned costs; signing removes them for roughly
$100–500 a year, and is worth buying the first time a link goes to somebody
nobody has spoken to. The `curl | sh` line above carries no warning at all,
because quarantine is set by the downloading browser rather than by the
operating system.

**The window stays open while it installs.** A first run pulls several hundred
megabytes, and behind a hidden window that is indistinguishable from a freeze.

**And it opens a browser when the app answers** — not when the port starts
listening, which is several seconds earlier and shows a connection error. A
launcher that starts a server the researcher cannot see has not started
anything, as far as they can tell. `manage.py dev` deliberately does *not* do
this: a developer restarts it twenty times an hour. `THROUGHLINE_NO_BROWSER=1`
declines it.

**Settings shows the door for the machine it is running on**, under *Starting
Throughline* — including the security warning to expect, and on Linux a button
that adds the menu entry. This section is a reference; the app is where somebody
who has never opened a terminal will actually find it, which is the whole point
of the launchers existing.

Linux gets a `.desktop` entry rather than an `.AppImage`: an AppImage is a
squashfs image built by `appimagetool` around a bundled runtime, which is a
build pipeline rather than a script in this repository. The entry is written
rather than committed because it has to carry an absolute path.

On Windows, or wherever bash is not the shell, call the launcher directly — the
shell scripts are wrappers around it and there is no separate implementation to
fall out of step:

```
python scripts\manage.py bootstrap
python scripts\manage.py dev
```

## Requirements

**Any Python 3.8 or newer, and git.** That is the whole list, and it is short
because the bootstrap now fetches what it actually runs on rather than asking
you to.

What it fetches, and why it cannot just use yours:

- **Python 3.12 exactly** — not merely 3.12 or newer. `pgserver`, which provides
  the embedded PostgreSQL, publishes no wheel past cp312, so 3.13 and 3.14
  cannot install the database. A relocatable build is downloaded from
  `python-build-standalone`, verified against a checksum committed to this
  repository, and the bootstrap re-executes itself under it. If your machine
  already has 3.12, that one is used and nothing is downloaded.
- **Node 20+ — but only to *build* the interface, never to run it.** The
  interface is exported to a folder of HTML, CSS and JavaScript that the API
  serves itself, so a copy that already has it built needs no Node at all. A
  source checkout builds one during bootstrap and fetches Node to do it; that
  is the only reason it is ever downloaded, and it is not needed again.

Both land in `~/.throughline-os/runtimes`, versioned, so an update can be walked
back. `THROUGHLINE_RUNTIME_DIR` moves them; `THROUGHLINE_SKIP_NODE=1` declines
the Node download for a deliberately headless install.

### One process, one port

The API serves the interface as well as answering it, on **port 8080**. There is
no second server.

That is not tidiness. The session cookie is `httpOnly` and `SameSite=strict`, so
a cross-origin request drops it *silently* — no error, just a researcher who
appears logged out. Serving both from one process makes same-origin true by
construction rather than by a proxy rule somebody has to keep correct.

`next dev` still runs on port 3000 during development, with its own proxy, so
hot reload is unaffected. Only the shipped product changed.

```bash
python scripts/manage.py build-interface
```

Exports the interface to `apps/web/out`, which is what the API serves. If it is
missing, every page answers 503 naming that command rather than showing a blank
screen.

PostgreSQL is **not** a prerequisite — `pgserver` bundles a real PostgreSQL with
pgvector as a Python wheel and runs it against a local data directory.

### Feature packs

The base install carries what every researcher needs. Nine further capabilities
are optional, reported by `/api/system/capabilities`, and installable from
Settings — or by hand, since the screen shows the command next to the button:

```bash
pip install 'throughline-domain[speech]'
```

Each one states what is **withheld** without it rather than only what it adds,
and its approximate size. That matters most for `speech`, which pulls in torch
and is gigabytes where everything else on the list is tens of megabytes.

None of them is needed to open your work, run an analysis, or read a paper. A
capability that is off is reported as *"needs the X extra"* and never as
unavailable-and-unexplained — the same rule `datasets.py` has always applied to
file formats, now applied to all of them.

Linux, macOS and Windows. The analysis sandbox was POSIX-only until it grew a
Windows backend built on Job Objects; see `services/scientific-runtime`.

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

## Accounts and the administrator

The first account created on an installation is its **administrator**, and
nobody after it is. The role is enforced on the server, not only hidden in the
interface. Only the administrator can:
- add people;
- install feature packs;
- choose the model and save or clear its key;
- install the desktop entry;
- open sign-up to the network.

Those act on the machine for everyone who uses it rather than on one
researcher's projects, so anyone else gets a 403 and sees the setting and who
can change it, not a button that fails.

**Sign-up from the network is off by default.** Accounts can be created at the
machine itself; opening registration to other machines is a switch in Settings,
behind a confirmation. It is off by default because a laptop joins café wifi.

Every account's work stays its own. An id is checked against the project it
arrives with, whether it comes in the path or in the request body, and an id
from another project answers 404, the same as one that does not exist. Fetches
the server makes on a caller's behalf — a paper, a dataset, a repository
harvest — refuse addresses on this machine or its network, and check again
after DNS resolves and on every redirect. Rate limits count once per request,
against the route that was actually matched.

## Updating

```bash
python scripts/manage.py update --check
python scripts/manage.py update
```

Never automatic, and never from inside the running app — applying an update
replaces the code the API process is executing, so it cannot swap itself out
from underneath a request. Settings has a **Check for updates** button; it
checks and then names this command.

The order matters more than the mechanism, because the database is your only
copy of your research:

1. **Refuses on a dirty checkout.** Updating fast-forwards the working tree, and
   uncommitted work is what this must not silently discard.
2. **Backs up before anything changes** — database and object store in one
   archive, since either without the other is useless.
3. **Fast-forward only.** A merge could conflict, and a half-updated checkout is
   worse than an old one.
4. Reinstalls, rebuilds the interface, migrates — in that order, because a
   migration may need code that arrived in the update.
5. **Puts the previous version back if any of that fails**, and tells you where
   the backup is. It does *not* restore the database for you: that is
   destructive and would discard anything done since the backup, which is your
   decision rather than the updater's.

An installation follows `main` until somebody tags a release, and follows tags
after that — one mechanism, not two.

**A version this installation cannot state is a hole in its own provenance.**
`main` on Tuesday and `main` on Thursday are different software wearing one
name, so the version is reported along with *where that answer came from*: a
stamped release, a git checkout, or nothing. A modified checkout says so, since
it names something nobody else can obtain.

## Is this installation healthy?

```bash
python scripts/manage.py doctor
```

One pass over the Python version, the virtualenv, Node, the hand-tracking model
and its hash, both ports, the database and its migrations, and whether this
machine has haptic hardware. Every failing check names the command that fixes
it, and a port held by an already-running Throughline is reported as *already
serving* rather than as a failure.

## Trying it by hand

`docs/TRY_IT.md` is a walkthrough for testing the product yourself — starting
the stack, what to look at, how to exercise the gesture controls, and what each
startup failure means. It is written to be followed with nobody to ask, and
`tests/test_try_it_guide.py` checks its claims against the code so it cannot
quietly go stale.

## Backups

Local-first means the researcher owns the only copy, so backup is part of the
product rather than an operational afterthought.

```bash
./scripts/backup.sh
```

```bash
./scripts/restore.sh <archive.tar> [--force]
```

One archive holds a `pg_dump` of the database *and* a tarball of the `objects`
tree, because they reference each other: a figure render is a row pointing at a
file, and restoring either alone produces a corpus whose provenance links
resolve to nothing. The database is dumped rather than file-copied — a
file-level copy of a running PostgreSQL is not a consistent snapshot.

## Container

The image ships the embedded PostgreSQL rather than expecting an external one,
because that is what the product is: a workspace someone installs, not a service
someone operates.

**The container is x86-64 only, and that is a hard limit rather than a default.**
The embedded PostgreSQL (`pgserver`) publishes no Linux ARM build — no aarch64
wheel in any release, and no source distribution to fall back on — so the image
is pinned to `linux/amd64`. On an ARM host it therefore runs under emulation,
and `pgvector`, which is compiled C using SIMD instructions, crashes the server
as it loads. PostgreSQL itself is fine under emulation; the extension is not.

So **on an Apple Silicon Mac, use `scripts/bootstrap.sh` rather than the
container.** It is the supported route there and considerably faster besides.
Running the image anyway is not dangerous — it refuses at startup with an
explanation instead of failing halfway through a migration — but it will not
run.

This is invisible to CI, which is why it is written down here: the docker job
runs on `ubuntu-latest`, which is amd64, so it passes and would keep passing.

There is no published image; build it first.

```bash
docker build -t throughline-os .
```

```bash
docker run -p 8080:8080 -v throughline:/data throughline-os
```

Then open `http://localhost:8080` — the API serves the interface itself, on one
port.

**The volume is not optional.** PostgreSQL runs inside the container and writes
to `/data`; without a mount, the entire corpus is destroyed by the second
`docker run`, and it presents as the application having forgotten everything
rather than as a missing volume.

The health check answers 200 while degraded on purpose. A workspace with no
model still does everything deterministic, and restarting it would lose
in-flight work to fix nothing. Only an unreachable database answers 503.

## Tests

The suite is at least **2828 backend tests and 3712 web tests** — the backend
number is what a base install collects; a machine with optional extras
installed collects more, so the smaller figure is the one that is true
everywhere.

How many of those skip depends on which optional extras a machine has
installed, so the number is not fixed and is not claimed as one: on a checkout
with every extra present it is six, all of them `no Neo4j configured`, and on
one with none of them it is more. What *is* fixed is that every skip must carry
a reason on CI's allowlist in `.github/workflows/ci.yml` — an optional service,
library or pack that is not installed — because a skip with an unrecognised
reason fails the build.
That is the property worth stating: the suite cannot quietly shrink by skipping
its way out of a failure.

Those numbers are checked by `tests/test_readme_claims.py`, which collects the
suite and compares. They were wrong before it existed — the file said 848 and
161 long after both had moved — and a document that claims a number nothing
verifies is the same defect this project spends its time hunting elsewhere.


Before pushing, run what CI runs, in one command:

```bash
python scripts/manage.py preflight
```

It finds node the same way `dev` does — including a user-local install at
`~/.local/opt/node` that is not on `PATH` — so it works in a shell where a bare
`npx` would not. It also refuses to start while another `pytest tests` is
running: both suites share one embedded PostgreSQL, and two concurrent runs
produce a scatter of unrelated failures that look like real regressions and are
not.

The suites individually:

```bash
.venv/bin/python -m pytest tests -q
```

```bash
cd apps/web && npm test
```

`npm test` is `vitest run` from `package.json`, which resolves the local binary;
`npx vitest run` reaches for the network if the package is missing.

CI runs the suite across Linux and macOS, a Windows job for the sandbox, the web
build, and a Docker job that builds the image and polls `/api/health` until the
API answers inside it — a Dockerfile that is written but never built is not
evidence of anything.

**It is manual only: nothing runs on a push or a pull request.** Actions minutes
are metered on a private repository and the multipliers are steep — a full run
billed about 82 minutes, 66 of them macOS — so with two people pushing often,
automatic runs verified the same commit five times on its way to being merged
once. A clean-environment check therefore happens when somebody asks for it:

```bash
gh workflow run ci.yml --ref "$(git rev-parse --abbrev-ref HEAD)"
```

The trade is real and worth stating: a defect only a fresh checkout can see now
waits until someone dispatches a run. That is why `preflight` builds the
interface as well as running the tests — the production build catches what unit
tests cannot, and for a while nothing anywhere was doing it.

### What counts as a passing test here

A test that passes is not evidence on its own; a test that fails when the
behaviour it names is removed is. Several guards in this repository were written,
seen green, and found to be checking nothing — `tests/test_sql_references.py`
passed with the exact bug it existed to catch reintroduced, because it only
inspected the first string literal in each statement.

So the standard for anything load-bearing is: **break it deliberately and watch
the test fail.** Where that has been done, `TASKS.md` records which mutation
killed which test in the `Evidence` column. "Looks right" is not evidence, and
neither is a green run.
## Working with someone else

Two people build this repository, so the loop starts and ends with a command
rather than with `git push`:

```bash
./scripts/sync.sh
```

```bash
./scripts/preflight.sh --full
```

`sync` fetches and prints what everyone else is on — branches, and who is
claiming what in `TASKS.md`. Running it first is not politeness: the same
feature has been written twice from two clones before, which cost a day and is
why the ledger exists at all.

`CONTRIBUTING.md` has the rest, including why a single contributor showing up
under two `user.name` values is harmless (`sync` prints the email beside the
name, so a second identity never reads as a second person).

New API surface goes in its **own router module** mounted with one line in
`app.py`, rather than as more routes inside it. This is a merge decision, not an
architectural one: `app.py` is the file two branches always both touch, and the
last wave merged with zero conflicts because nothing new was added to it.

## Building a release

```bash
python scripts/manage.py release
```

Writes a tarball, its SHA-256 and a `latest.json` manifest into `dist/`. **One
artifact serves every platform** — the interface is a static export with no
native binaries, and the runtimes are fetched per machine at install time — so a
release is one build rather than three, and 19 MB rather than the 850 MB the
build dependencies weigh.

It refuses on a dirty checkout. A release built from uncommitted changes looks
exactly like one built from a commit, and the difference only surfaces when
somebody tries to reproduce it and cannot.

The archive is an allowlist of declared paths rather than a directory walk with
exclusions, so nothing ships because it happened to be lying in the folder.

**The manifest is signed**, and the public key travels inside every tarball —
it has to arrive with the software rather than from the server being verified,
which is the whole reason a signature beats a checksum published beside its own
file. Make a key once with `python scripts/manage.py release-key`; see
`keys/README.md`.

**What a first install cannot check.** Verifying a download happens before
anything is installed, and the library that checks a signature arrives *in* that
download. So a first install trusts HTTPS and the digest in the manifest; every
update afterwards verifies the signature properly, because the virtualenv exists
by then. Said here rather than implied, because a verification that silently
does nothing is worse than none — it is believed.

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

Database migrations are not a top-level directory: they live with the code that
owns the schema, at
`packages/research-domain/src/throughline_domain/migrations/`, applied in
filename order by `migrate.py`.

The Markdown files at the root are not interchangeable, and reading the wrong
one is the usual way two people end up doing the same work twice:

| File | Answers |
|---|---|
| `README.md` | How do I run this, and what is it? |
| `docs/CAPABILITIES.md` | What is built, in depth, with the claims its tests check. |
| `ROADMAP.md` | What is the project trying to become, and what is honestly missing? Corrections to earlier audits are kept, not edited out. |
| `TASKS.md` | Who is doing what **right now**. Where it disagrees with the roadmap, this one is current. |
| `CONTRIBUTING.md` | The workflow two people share without colliding. |
| `PLAN.md` | The original specification the section numbers (§55, §102) refer to. |
| `docs/MASTER_BUILD_PROMPT.md` | The immersive-spatial specification, verbatim, with its hash pinned. Committed rather than remembered: 236 sections do not survive being carried in anybody's head. |
| `docs/REQUIREMENTS.md` | What exists against each of those 236 sections. `unreviewed` means no claim has been made yet, and the count may only fall. |
| `CLAUDE.md` | Instructions for Claude sessions working in this repository. |

Planned and not present: the Scientific Motion Grammar and the deterministic 4K
scene renderer. Institutional sign-on and the licensed bibliographic databases
are likewise unbuilt.

The durable workflow contracts live inside `research-domain` as `workflow.py`
rather than in a package of their own.

Business logic does not live in React components. Research logic does not live
in API route handlers.

## Licence

Apache License 2.0 — see `LICENSE`.
