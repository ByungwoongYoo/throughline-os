# Audit against the unified brief

Per Part Q. Grounded in the code as it stands: ~13,300 lines of Python, ~4,600
of TypeScript/CSS, 50 tables, 55 endpoints, 199 tests.

## The finding that reframes the rest

**The web application has three dependencies: `react`, `react-dom`, `next`.**

No D3. No Vega. No Sigma, PixiJS, three.js, deck.gl, MapLibre, GSAP or Lenis.
Which means:

- **Not one chart is rendered in the browser.** The API produces Vega-Lite specs
  and nothing consumes them — `lib/api.ts` has no visual type at all.
- **There is no graph renderer.** Part E's living knowledge graph is not a
  redesign of something; it is greenfield.
- **There is no canvas.** Part B's central surface does not exist in any form.
- The Figures view is a placeholder that says so.

The 3,186 lines of frontend are tables, forms and text. They are competent and
honest, and they are not the product this brief describes.

So the work is roughly **85% frontend**, against a backend that already holds the
semantic layer the frontend would need. That is the good news: the hard,
slow-to-build part — provenance, lineage, immutability, statistical execution,
the value-reference system — is done and tested. The visible product is not.

---

## Retain

Keep these. They are load-bearing and meet the trust bar.

| What | Why |
|---|---|
| **Six laws, enforced structurally** | Law 2 is a schema constraint: a report block has no field a number could be typed into. Citations are foreign keys, so a fabricated reference cannot be *stored*. Completed runs are immutable at trigger level. This is the trust bar, already met. |
| **Value-reference rendering** | Report text holds `{{ref:name}}` plus a pointer to a recorded row; the number resolves at render. Exactly what Part C's provenance strip needs. |
| **Canonical variable layer** | Just built. Labels, definitions, units, `suggested → approved → rejected`. Part C's "zero raw column names" requirement runs straight through it. |
| **Analysis execution + sandbox** | 10 methods, assumption checks, reproducibility record, immutability. |
| **BH correction and the §51 validation suite** | The exploration ledger (Part H2) needs a corrections engine; it exists. |
| **`/evals` harness** | Declares four categories `not_implemented` with reasons rather than hiding them. |
| **Model provider abstraction** | Structured-output-only, schema-validated, prompt-versioned, nonce-fenced. Part M's routing table drops onto it. |
| **Backup / restore, rate limiting, security headers** | Built this session, round-trip verified. |

## Redesign

| What | Change |
|---|---|
| **The whole shell** | Part B is right about the diagnosis. Three regions compete: rail, workspace, inspector. The inspector shows text unanchored to anything on screen. Replace with: canvas permanent, sources summoned, detail anchored to the clicked object, insights as canvas objects. |
| **Section navigation** | Currently tabs that swap content. Part B3 wants lenses over one persistent surface. The swap is what makes it feel like a dashboard. |
| **The result presentation** | Today: `Status` chip, four `Stat` tiles, a table. Part C wants the sentence first, numbers labelled in words, the provenance strip permanent. The pieces exist; the arrangement is wrong. |
| **Lifecycle vocabulary** | We show internal states — `exploratory`, `candidate`. Part C's mapping to researcher words is a small change with large comprehension effect. |
| **Report titles and axis labels** | Now correct in report titles via the canonical layer. Not yet applied to charts, tooltips or exports. |

## Remove

| What | Why |
|---|---|
| **`GraphPlaceholder` and `FiguresPlaceholder`** | Honest today, but Part S forbids visible controls that do nothing. Either build or delete the nav entry. |
| **The landing page's bespoke parallax** | ~320 lines of hand-rolled rAF parallax in `app/page.tsx` + `landing.css`. Part K specifies Lenis + GSAP ScrollTrigger. Replace rather than extend. |
| **`Stat` component** | Superseded by Part C's labelled-in-words treatment. |
| **Hand-rolled CSS tokens** | 37 hardcoded hex values and 11 distinct hardcoded durations in `globals.css`. Part A requires one token source. |

## Simplify

- **`views.tsx` is 1,101 lines** holding nine unrelated views. Split per view; it
  is the file most likely to accumulate bugs.
- **`workspace/page.tsx` is 477 lines** doing routing, upload, keyboard handling,
  breadcrumbs and palette wiring. The interaction-model redesign should dissolve
  most of it.
- **Two ingestion-status vocabularies.** The 9-stage §24 machine and a separate
  `ready | failed` shorthand. One.
- **`primitives.tsx`** — `Loading`/`Empty`/`Failure` are good and should become
  the basis of the shared card anatomy (Part B4) rather than living alongside it.

## Missing

Ordered by what the Definition of Done (Part S) actually needs.

**On the critical path, absent:**

1. **Claim location in papers.** Part I calls paper↔dataset the differentiator.
   Nothing extracts a testable claim from a paper today. Without it the claim
   test cannot start.
2. **Compatibility adjudication.** Table and schema exist; `compare.py` does not.
   The brief says build the refusal path *first*, and it is unbuilt.
3. **Any browser rendering** — charts, graph, canvas.

**Also absent:** the 14 primitives (6 chart types exist, server-side only), 3D,
maps, all connectors, the exploration ledger, pre-registration gate, Law 6's
causal-language validator, design tokens, motion tokens, frontend tests, the
worked-example empty state, SSO, and the marketing site.

## Technically weak

| Issue | Consequence |
|---|---|
| **Sandbox network egress is `python_level_only`** | A patched `socket.connect` inside a subprocess. `os.system` or a spawned binary walks past it. Needs container/VM isolation. The single most serious item here. |
| **No row-level security** | Isolation is `scoped_project()` calls only. One forgotten call in one endpoint is a cross-tenant leak with nothing behind it. |
| **Zero frontend tests** | 4,600 lines, no coverage. Every UI bug this project has found was found by hand. |
| **In-memory rate limiter** | Correct for one node, wrong for several. Documented as such. |
| **No observability** | Part L sets frame-time and INP targets. Nothing measures anything today. |
| **Model is 1.5B** | Part M says statistical interpretation must be frontier, always. Current summaries are visibly weak — "Statistical Result Summary" as a headline. |
| **Paper→finding path never run end to end** | Every verification has used a CSV. Half the differentiator is unproven. |
| **One unexplained flake** | `test_paper_plus_dataset_to_validated_finding_with_full_provenance` failed once under CPU contention, never reproduced. Not root-caused. |

---

## What I would build next, and why

The brief's Definition of Done is one path. Against it:

| Step | State |
|---|---|
| paper + dataset ingested | ✅ |
| canonical variables confirmed | ✅ |
| **claim located** | ❌ |
| **compatibility assessed** | ❌ |
| analysis executed | ✅ |
| interpreted in plain language | ✅ (weak model) |
| **validated or refused** | ✅ validated · ❌ refused |
| traced to source | ✅ |
| exported publication-grade | ✅ server-side · ❌ from the UI |

Three gaps, and two of them are the same feature: **Part I's claim test and its
refusal path**. The brief is explicit — *"Build the refusal path first — the
credibility of the feature rests on it"* — and Part H1 calls refusal the highest
trust-building moment in the product.

It is also the piece no competitor has, it needs no new frontend framework, and
it closes the Definition of Done. Frontend rebuild (Parts A–G) is larger and
better done against a backend whose critical path is complete.
