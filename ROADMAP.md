# Roadmap — what is left, and in what order

Written after auditing the repository against the unified brief (Parts A–S). It
records what exists, what does not, and the reasoning behind the sequence. Where
the audit was wrong, the correction is kept rather than quietly edited out.

`PLAN.md` is the historical record of the install/Docker/Windows remediation and
is finished. This is the live document.

---

## Where the project actually stands

**The scientific spine is real; the spatial interface is not.**

Five of the six comparison verbs are wired end to end, each with a substantial
refusal taxonomy — claim test (P4, P5, P8–P13, including an underpowered-is-not-
null distinction), compatibility (D1–D14), paper reconciliation (R9–R12 with an
explicit `INCOMMENSURABLE` outcome), finding consistency (F1–F10), image
similarity (I1–I9, which deliberately never asserts misconduct). They render
through one shared `Verdict.tsx` that states what was changed, what would fix it,
what is still possible, and what the verdict does not say. That is Part H1 built
properly, and it is the differentiator the brief names.

Law 2 (sandboxed computation) and Law 6 (a post-generation validator in
`causal.py`, invoked from `journal.py` — enforcement, not a prompt instruction)
are both real. So are provenance and lineage, the result card's Part C anatomy
including lifecycle wording, the dark-mode export trap solved on both client and
server, `d3-force` in a genuine Web Worker with `Float32Array` transfer, keyboard
graph traversal, a recommender that states its reason in the interface, a critic
with nine real checks, and ADRs settling Postgres vs Neo4j as Part N required.

What is missing is the canvas, 3D, maps, most of the integration surface, and a
frontier model. Those are the subject of what follows.

---

## Wave 0 — done

Closed by building up to each claim rather than trimming it back. The suite went
541 → 571 passing, with the same nine optional-capability skips throughout.

| Claim | How it closed |
|---|---|
| Nine formats advertised, five readable | Thirteen readable, nine more behind opt-in extras |
| P5 marked `renders` with nothing behind it | Built end to end, and reachable from the workspace |
| Gallery: "All 14 primitives render", showed eight | Shows fourteen |
| `AUDIT.md` stating stale facts in the present tense | Dated and superseded |

**Four bugs surfaced that nobody was looking for**, three of them pre-existing. A
malformed `.xlsx` raised a bare pandas `ValueError` that escaped every
`except UnsupportedDataset` upstream, so §104's "never a generic error" was
already being broken. `/api/analyses/{run_id}/points` was defined twice — FastAPI
matches the first, so the second was dead and would have silently swallowed any
edit made to it. And the binned figure was unreachable: `figures.tsx` fell back to
a scatter for any visual type it did not recognise, so the recommender said one
thing and the screen showed another. The fourth was introduced here: a linear
colour ramp on heavy-tailed counts, which reproduced the exact overplotting the
chart exists to cure.

Two lessons worth carrying into later waves. **A capability a researcher cannot
reach is not a capability** — the primitive was built, tested, and drawn only in
the gallery, while real analyses got a scatter. And **a guard that checks a
component exists does not check that anything reaches it**; the registry test
written to prevent exactly this class of drift passed throughout, because those
are different claims.

**One claim is still unverified here: `.sas7bdat`.** No Python library writes one
and `pyreadstat` ships no samples, so there is no round-trip to run. The dispatch
is tested and the test says so out loud, but the reader itself rests on
`pyreadstat` being right rather than on evidence in this repository. Closing it
properly needs a small committed sample file — a justified exception to
generating fixtures rather than committing them, since this format cannot be
generated.

<details>
<summary>The original statement of the problem</summary>

Small, and first, because every other claim rests on the project being accurate
about its own state. §123 is the standard it sells itself on.

**1. The binned-aggregation primitive is marked as rendering and has no
component.** `apps/web/lib/primitives.ts` sets `status: "renders"`; no matching
component exists. This is a mistake rather than scaffolding, and the distinction
matters: the registry already has an honest way to say "designed, not built," and
`app/page.tsx` generates the landing page's "Not built" ledger from exactly that
field. The honest option was available and was bypassed. Fix by building the
chart or flipping the flag — then derive the flag from whether a component
actually resolves, so the ledger cannot drift again. A list that "cannot outlive
the code" must not depend on a hand-typed string.

**2. The connector layer advertises formats ingestion cannot read.**
`connector-sdk/.../datasets.py` lists `sav`, `dta` and `rds` under a comment
describing them as formats the system can actually read.
`ingestion/.../structured.py` accepts only `.csv`, `.tsv`, `.xlsx`, `.xlsm` and
`.json`. A Stata file fetched from a repository is rejected on the way in. Either
the claim goes or the readers arrive (see Wave 3).

**3. `docs/AUDIT.md` is a stale snapshot presented as current.** It states that
no chart renders in the browser and that `apps/web` has three dependencies. Both
were true once and neither is now. It needs a header saying what it was and when,
not deletion — a dated audit is useful; an undated wrong one is not.

### Not defects, recorded so the same wrong call is not made twice

An earlier pass flagged two more items. Both were wrong.

`digitise.py` is unreached from any route or component, but it is deliberate,
careful work: its opening argues that axis calibration must come from the
researcher rather than OCR (a misread axis corrupts every value silently while
the points still land on the curve), that pixel uncertainty must propagate into
every downstream statistic, and that a log axis must be declared rather than
guessed. That is backend-first sequencing, not abandonment.

`ResultCard`'s `preRegistered` prop is never set true, but its default is
*correct* — every finding today genuinely was found by browsing, because the gate
does not exist yet. The card displays the truth.

"Nothing is a placeholder" is about visible controls that do not do what they
appear to do. Digitise has no visible control; `preRegistered` displays an
accurate value. Neither breaks the rule. The only useful action is a line in each
saying the backend is ready and the surface is pending.

*(Both now carry that line. The judgement above held: neither was a defect.)*

</details>

---

## Wave 1 — close the Definition-of-Done failures

- **Raw column names reach charts.** `visual-spec/.../recommend.py` builds axis
  and title labels with `name.replace("_", " ")`, bypassing the `display_label`
  and unit the canonical variable layer already holds. This fails a Definition-of-
  Done item outright, in a place that already has the right data to hand.
- **The three fonts are never loaded.** Inter, Source Serif 4 and JetBrains Mono
  are named in `globals.css` with no `@font-face`, no `next/font` and no files, so
  everything falls back to system fonts. The cheapest available change to how the
  product feels, and today it is a no-op — including the deliberate signal that
  serif means "this text came from a paper."
- **The empty state is a form.** Part B6 asks for a pre-loaded worked example the
  user can drag, expand and break before investing anything. The seeded topology
  in `HeroGraph.tsx` and the generated AMR fixture in `tests/conftest.py` are
  most of the material already.
- **Accessibility gaps:** no data-table alternative per chart, no
  `prefers-contrast`.
- **Measure the performance claims** rather than asserting them: 60fps at 5,000
  nodes, marketing LCP, five-click provenance depth. A comment is not a
  measurement.

  **All four are now measured, and one of them was not a performance claim at
  all.** The 5,000-node claim was false in both halves (D005). LCP is fine:
  1404ms over Slow 4G, well inside "good". Canvas rasterisation, the piece
  D005's numbers explicitly excluded, costs 0.57ms at its worst against a
  16.67ms frame budget (D006) — it was never the problem.

  The five-click provenance depth is the one worth reading. It is not five
  clicks and it is not six: **the path does not exist.** A finding's detail
  screen offers exactly one action, "Preview this as a library note", and links
  to nothing — not its connection, not the analysis run, not the dataset. Going
  sideways through Connections reaches the result but stops there too; the
  provenance line reads `0 sources · 1 dataset` as plain text. So the number
  this roadmap asked for cannot be produced, because a researcher cannot walk
  from a finding back to its evidence by clicking at all. Recorded as D018, and
  worth more than the figure would have been.

---

## Wave 2 — the interpretation layer

The highest value per unit of effort on this list.

Only a local Ollama provider is wired (`packages/model/.../registry.py` handles
`ollama` and `none`). Part M requires a frontier model for statistical
interpretation without exception, because that sentence is the one a researcher
pastes into a manuscript, and a small model writes fluent, confident, subtly
wrong prose exactly there.

The constraints around the model are already built: structured-output-only
decoding that raises rather than parsing prose, the injection boundary, and the
Law 6 validator. Adding a frontier provider is largely plumbing into a chassis
that already holds it in place.

Then the **pre-registration gate** (giving `preRegistered` something to be true
about) and a **session-scoped exploration ledger** — Benjamini–Hochberg is real
but project-wide and counts only discovery sweeps, not the unified per-session
count across all five verbs that Part H2 describes. Finally, the four evals
categories currently declared `not_implemented`.

---

## Wave 3 — adoption unlocks

Three integrations the brief singles out, chosen over the long tail:

- **Zotero write-back.** Today it reads only. A researcher's library is years of
  accumulated work; a tool that cannot write back forces them to maintain two
  libraries, and nobody does. Writing into someone's irreplaceable library needs
  care reading does not: proper authorisation, idempotent syncs, never clobbering
  a hand-written note, safe failure mid-run.
- **SPSS and Stata variable labels.** These files already carry human-readable
  labels and value labels for every column — precisely what the canonical variable
  layer works to infer elsewhere. The brief calls this the highest-leverage ingest
  feature in the product, and it also resolves Wave 0 item 2 honestly.
- **A generic OAI-PMH harvester.** One implementation reaches thousands of
  institutional repositories.

---

## Wave 4 — the fork

**The spatial canvas does not exist.** Parts B and G describe a permanent canvas
with draggable, pinnable, snapping widgets, drop-to-compare, and six verbs as
lenses. What exists is a conventional shell (`Shell.tsx`) with roughly seventeen
routed sections. That is a different architecture, not a missing feature.

Two honest options: build it, at six to ten weeks touching nearly every
component; or adopt the shell deliberately, update the brief and docs to describe
what exists, and spend the time on 3D embedding space and deck.gl maps — the two
places spatial interaction earns its cost without a rewrite.

**Decide after Waves 0–2, not before.** The feel bar currently fails for a much
cheaper reason than architecture: the fonts do not load and the first screen is a
form. Fix those, look again, and judge whether the canvas is the gap. Rebuilding
the interaction model to answer a question that two days of work can answer would
be the expensive way round.

---

## Wave 5 — commercial gates

SSO/SAML/Shibboleth, EZproxy and OpenAthens entitlements, the licensed databases
(Scopus, Web of Science, Embase — all behind user credentials), and observability
proper: OpenTelemetry, metrics, error tracking. Structured JSON logging with
redaction and per-dependency health already exist; tracing and alerting do not.

These gate selling to a university, not validating the product. Early is
expensive insurance against a sale not yet in hand.

---

## Wave 6 — Phase 8

The Scientific Motion Grammar (§87) and the deterministic 4K renderer (§89). The
project already labels both Phase 8 and unbuilt. Leave them there.

---

## Threaded throughout

Frontend tests for `Shell.tsx`, `app/workspace/page.tsx`, `KnowledgeGraph.tsx`
and `CommandPalette.tsx` — the four most load-bearing untested components, out of
roughly twenty-five with no coverage. Write them alongside whatever wave touches
them rather than as a separate campaign.

---

## Routing

Model tier and effort per item, per the working preferences in `CLAUDE.md`.

Wave 0 is struck through: done, on `feat/wave-0-build-to-claims`. Its estimates
are left visible rather than deleted, because two of them were wrong in a way
worth remembering — "build or mark honestly" turned into a full primitive plus a
server-side binning endpoint, and the format work quadrupled once building up to
the claim replaced trimming it down.

| Item | Wave | Tier | Effort |
|---|---|---|---|
| ~~Binned primitive: build or mark honestly~~ | 0 ✓ | Sonnet | medium *(became Opus/high)* |
| ~~Derive primitive status from real components~~ | 0 ✓ | Opus | medium |
| ~~Connector/ingestion format contradiction~~ | 0 ✓ | Sonnet | low *(became Opus/high)* |
| ~~Date and supersede `AUDIT.md`~~ | 0 ✓ | Sonnet | low |
| ~~Note pending surfaces in digitise / preRegistered~~ | 0 ✓ | Sonnet | low |
| Commit a `.sas7bdat` sample so the last format claim is evidenced | 0 | Sonnet | low |
| Labels via `display_label` instead of raw names | 1 | Opus | medium |
| Load the three fonts | 1 | Sonnet | low |
| Worked-example empty state | 1 | Opus | medium |
| Chart data tables, `prefers-contrast` | 1 | Sonnet | medium |
| Measure 60fps / LCP / trace depth | 1 | local, no model | — |
| Frontier provider behind the existing guards | 2 | Opus | high |
| Pre-registration gate + session ledger | 2 | Opus | high |
| The four unimplemented evals categories | 2 | Opus | medium |
| Zotero write-back | 3 | Opus | high |
| SPSS/Stata parsing | 3 | Sonnet | medium |
| SPSS/Stata labels into canonical variables | 3 | Opus | medium |
| OAI-PMH harvester | 3 | Sonnet | medium |
| Canvas rebuild *(if chosen)* | 4 | Opus | xhigh |
| 3D embedding space / deck.gl maps *(if chosen)* | 4 | Opus | high |
| SSO/SAML/Shibboleth | 5 | Opus | high |
| OpenTelemetry, metrics, error tracking | 5 | Sonnet | medium |
| Tests for the four untested components | any | Sonnet | medium |

The canvas rebuild is the only candidate for escalating beyond Opus, and only if
an Opus attempt stalls on the architecture rather than the code.
