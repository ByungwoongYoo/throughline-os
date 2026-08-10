# The Researcher Interface

Per §65, §66, §115 and §140. Four phases of working machinery were reachable only
by `curl`; this is the interface that makes them usable.

**Status: working end to end.** Account creation → research question → upload →
ingestion → discovery → validation, all driven from the browser against the real
API, with real papers and a real dataset.

## Node

Node was not installed on this machine, which is why `apps/web` did not exist
until now. It is installed **user-locally** at `~/.local/opt/node` (v22.11.0) —
nothing was written outside your home directory, and removing that one folder
undoes it completely. `scripts/dev.sh` puts it on `PATH` itself, so no shell
configuration was changed.

If `node` is absent the dev script still runs the API and worker, and says
plainly that the interface is unavailable rather than failing obscurely (§123).

## Layout (§65, §66)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Throughline  ·  project     [ Ask, analyze, compare, discover… ⌘K ]  │
├────────────┬────────────────────────────────────┬────────────────────┤
│ RESEARCH   │                                    │ CONTEXT            │
│  Overview  │                                    │  what is selected  │
│  Sources 4 │        current workspace           │                    │
│  Search    │                                    │ THIS INSTALLATION  │
│ DISCOVER   │                                    │  Search    hybrid  │
│  Discovery │                                    │  Sandbox  enabled  │
│  Connections 6                                  │  AI provider none  │
│  Findings  │                                    │                    │
│  Analyses 9│                                    │                    │
│  Evidence  │                                    │                    │
│ COMMUNICATE│                                    │                    │
│  Figures   │                                    │                    │
└────────────┴────────────────────────────────────┴────────────────────┘
```

Rail counts are live, because §70 wants the project's state legible at a glance
and a nav item that never shows a number teaches nothing.

## What the interface is *for*

It is not a wrapper on the API. Its job is to make the scientific discipline
visible, and every design decision follows from that:

**The connections table shows rejected candidates.** The real association sits at
`q = 7.44e-39` as `EXPLORATORY`; two spurious ones sit at `q = 0.066` and
`q = 0.083` as `CANDIDATE`. Both of those are `p < 0.05` uncorrected. Showing
only survivors would hide the single most important fact about the run — that
most of what looked significant was not.

**Assumption checks have their own vocabulary.** A passed check renders `PASSED`,
not `VALIDATED`. Reusing the §13 lifecycle's words for something that is not a
lifecycle state would teach a false equivalence. (I had this wrong first, and the
rendered screen is what showed it.)

**Reproducibility is a panel, not a footnote.** Seed, duration, exact dependency
versions, dataset hash, spec hash, and the sandbox's real isolation — including
`network: python_level_only`, the honest limit rather than a padlock icon.

**The inspector says what is missing.** `AI provider — none`, with "No model
provider is configured yet." A researcher should never have to guess whether a
capability exists.

**Every state §140 requires exists as a component.** `Loading` carries a label
saying what is happening (§105: "Running robustness checks in the sandbox", not a
spinner). `Empty` explains what to do. `Failure` shows the server's own message
and offers a retry.

## Nothing is computed in the browser

The web client never receives a dataset (§106, §107) and never derives a
statistic. Every number on screen comes from a recorded analysis run. A figure or
a p-value recomputed in React could disagree with the analysis that produced it —
which is precisely the fidelity failure §58 evaluates for.

## Honest gaps

Two rail items say plainly that they are not built:

- **Evidence graph** — the API serves both graphs and the Findings view already
  renders a finding's evidence, but there is no interactive node-link canvas.
- **Figures** — publication figures are rendered server-side and are real; the
  interface cannot yet browse or embed them.

Per §123 these are stated in the view itself, not disguised with a plausible
placeholder.

Also absent: project switching, and a light-theme toggle (the theme is defined;
the app follows the system preference).

The command bar (⌘K) is now a real palette over every source, connection,
finding and section, with subsequence matching — `cddres` finds
`consumption_ddd × resistance_pct`. What it still cannot do is §69's actual
subject, parsing a question written in words, because that needs a model
provider. The palette says so in its own footer rather than leaving you to
discover it by typing a sentence.

## Running it

```bash
./scripts/dev.sh
# Throughline      http://127.0.0.1:3000
# API docs         http://127.0.0.1:8080/docs
```

One caveat worth knowing: do not run `npm run build` while `npm run dev` is
running — they share `.next` and the dev server will start returning 500s. Stop
the stack, `rm -rf apps/web/.next`, and restart.


## The UX pass

Six things were wrong when a researcher, rather than a curl script, drove this.

**The Discovery screen could never find a dataset.** `GET /sources` returned bare
source rows with no paper or dataset attached, so the filter that looks for
tabular data always came back empty and the screen said "no dataset to search"
for a project that had one. The list now joins in what ingestion produced.

**Validation ran but its report was unreachable.** There was no route from a
connection to its §51 report, so a connection changed lifecycle state and the
reasoning was invisible. `GET /api/connections/{id}/validations` closes that, and
the report renders every check — including the ones recorded `not_tested`, which
is not a pass.

**Confounders were free text.** You had to remember whether the column was
`gdp_per_capita` or `GDP per capita`, and a typo was silently recorded as
"confounder not tested" — which reads on the report as though adjustment had been
considered. It is now a picker built from the profiled schema, with the two
variables under test excluded, because adjusting a variable for itself is a
mistake the interface should make impossible rather than report afterwards.

**Repeat discovery quietly duplicated the correction family.** The idempotency
key was `discovery:{run_id}`, generated after the row was inserted and therefore
unique by construction — it never collided and never prevented anything. Each
extra run re-tested the same pairs and corrected them within a *separate* family
of the same size, so the table showed every pair twice at the same q-value, which
reads as replication and is not. A second run over unchanged data is now refused
unless `force` is passed, and the screen says why instead of appearing to work.

**A grade of `weak` next to r = 0.90 looked like a bug.** It is not: §47 grades
evidence from the assumptions the method needed, and this association violates
normality on both variables. That is the product's whole argument, so the grade
now always renders with the checks that produced it.

**Two components fetched the same list.** `Sources` and the shell each called
`GET /sources`, so an upload refreshed one copy and the other kept showing the
old rows — files landed, were ingested, and never appeared. The shell owns the
list now.

Smaller, in the same spirit: drop files anywhere in the window; clicking a source
opens its profiled schema; every detail view has a breadcrumb and answers Escape;
the overview is a checklist ticked from real counts rather than six large cards
of integers; and the ingestion bar shows position in the real nine-stage §24
pipeline instead of an invented percentage.

Two of these were found only by driving the screen, which is the argument for
doing so.
