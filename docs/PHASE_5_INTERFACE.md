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

Also absent: the command bar is a affordance that routes to Search rather than a
real command palette (§69 needs intent parsing, which needs a model provider);
project switching; and the light theme is defined but the app follows the system
preference without a toggle.

## Running it

```bash
./scripts/dev.sh
# Throughline      http://127.0.0.1:3000
# API docs         http://127.0.0.1:8080/docs
```

One caveat worth knowing: do not run `npm run build` while `npm run dev` is
running — they share `.next` and the dev server will start returning 500s. Stop
the stack, `rm -rf apps/web/.next`, and restart.
