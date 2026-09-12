<!-- T135. Written 2026-09-05 from a capability inventory (docs/audit/capability-inventory-2026-09-05.md),
three friction audits, three independent proposals, three judges and two skeptics. The plan the team
implements in three slices; TASKS.md says which slice is where. -->

# The loop is the shell — the plan the team implements

> **Superseded in part (T155).** The five verb groups this plan proposes, and the
> twenty-three-section rail the table below maps, were replaced by the recovered
> UI/UX package's six groups and fifteen sections: eight of the entries named here
> are now views of the screen that owns them. The *argument* still holds and is
> what T155 built on — the rail's order is the work's order, and a step belongs to
> the strip rather than to the rail. Read the table as the reasoning behind each
> entry, not as where it currently lives; `apps/web/components/Shell.tsx` is.

**Task row:** T135. **Discoveries this plan closes:** D200–D208, plus D209 (recorded
below, fix already in the working tree). **Author:** design lead, from three audits,
three proposals, three judges, two skeptics.

Every file path below is relative to the repository root unless it starts with
`apps/web`, in which case it is written in full. Every "exposes X" claim cites the
capability inventory at `docs/audit/capability-inventory-2026-09-05.md` by section, and every recorded
design decision it touches is either honoured or the deviation is argued in §6 or §7.

---

## 1. The idea

Throughline already computes the right mental model and shows it in exactly one place:
the Overview's **"The loop"** — six steps ticked from the project's real database counts,
each with one plain-English sentence of method, each marked done/next/waiting as a word
and not only a colour (`apps/web/components/views.tsx:46-146`). This plan promotes that
one card from a screen to the **spine of the shell**: a single sticky band at the top of
the workspace column, on all 23 sections, that names the step the project is on and
carries its next action as the screen's one primary button — so the answer to "what do I
do here" is structurally un-scrollable-away, and the loop's own step 5 stops being the
seventh block on the longest scroll in the product. Underneath that spine, three things
change and nothing is removed: the rail keeps all 26 entries but is regrouped into five
groups and split into a scrolling body plus a pinned "This machine" footer, so Settings
and the three machine pages stop falling off a 900 px laptop; every object detail screen
gains an **actions band** directly under its heading, listing what can be done to that
object, where an empty downstream slot is rendered as an offer ("Reports — none yet ·
Draft one from this") rather than as an absence; and sixteen capabilities that are fully
built and reachable only from a screen nobody opens are given a second door on the object
they act on. No capability is removed, merged away, or put behind a menu, mode or palette.

It satisfies the three requirements as follows. **SMOOTH** — the strip is one insertion
point in `Shell.tsx` above `<main className="workspace">`, so every one of the 23 sections
names the current step and offers it; the Overview's loop rows gain a visible destination
and a verb; and steps 4 and 5 open the connection the server already ranks highest
(`DiscoveryMap.top_connections`, `apps/web/lib/api.ts:211-217`) instead of a six-row table.
**SIMPLE** — one vocabulary (ResultCard's plain phrases) wherever a lifecycle state is
displayed; one `<Term>` gloss for the six words a first-timer meets before they are
defined (D207); five rail groups instead of a register of screens; and the landing page's
call to action inside the fold at both measured widths (D200). **NOTHING HIDDEN** — the
26 rail entries stay 26, the palette goes from 23 sections and 3 object kinds to 26 and 6,
and every capability the skeptics found buried is placed on the object that produces it,
with the ones we deliberately withhold (Zotero write, `POST /objects`) *stated* rather than
silently absent.

---

## 2. Principles

Each is one sentence and each is testable.

1. **One loop, computed once.** The six steps, the current step and its destination come
   from `apps/web/lib/loop.ts` and nowhere else; the Overview card, the step strip and any
   later consumer import it. *Test: no file outside `lib/loop.ts` contains the literal
   string "Try to destroy what survived".*
2. **The primary action of every screen is above the fold.** *Test:
   `scripts/walk-the-flow.mjs` asserts that on every section at 1440×900 the first
   `.btn-primary` in the workspace column has `getBoundingClientRect().bottom <= 900`.*
3. **The rail claims only what it is.** A rail group names a kind of screen, never a loop
   step, because only four of the 23 sections are step destinations; step numbering lives
   in the strip, which knows the project's state. *Test: no `.rail-heading`'s first span (the group's
   name) matches `/^\d/` — `tests/step-strip.test.tsx`, and C26 of the walk.*
4. **Nothing is hidden; depth is layered.** A capability may be second in a list, below a
   fold, or inside a `<details>` **whose closed summary states what is inside it**
   (`ChartTable.tsx:1-21`); it may never be behind a mode, an unlabelled toggle, a menu, or
   a URL. *Test: `tests/pages-are-reachable.test.ts`, plus
   `tests/one-thing-on-the-screen.test.tsx`: every fold rests closed, its summary is the
   noun phrase for what it holds, and the count of what it holds is on `data-count`.*
5. **A scroll with a visible edge is not a hide; a menu is.** The rail may scroll, and it
   must say so with a fade and keep its most consequential rows in the visible box.
   *Test: `reports`, `figures` and `settings` rail rows are inside the rail's visible box
   at 1440×900.*
6. **An action lives on the object that produced it; entrances are added, rooms are never
   moved.** A finding is still recorded from a result (`recordfinding.tsx:14-19`), a subset
   from the schema that produced it, an alias from a dropdown of variables the project has.
   *Test: no `+ New` / `Create a …` control appears on any list screen.*
7. **An empty downstream slot is an offer, not an absence.** Where a capability could act
   on this object and has not yet, the object says so and offers it; where it cannot, the
   object says why in place rather than omitting the control. *Test: the connection detail
   renders a report control in both the eligible and the ineligible case.*
8. **The inspector is a readout, never a location.** It is not rendered below 1101 px
   (`Shell.tsx:440-457`), so no capability may live only there. *Test: every capability the
   inspector names is reachable from the workspace column at 1024 px width.*
9. **A control looks like a control, and does what it appears to do (§123 and its
   converse).** *Test: no `<button>` in `components/` fires an optional callback the only
   mounting site does not pass.*
10. **Nothing is computed in the browser** (`views.tsx:6-9`, `cohorts.tsx:76-79`);
    `lib/loop.ts` derives booleans from counts the API already sent and takes every
    sentence verbatim from the server. *Test: `lib/loop.ts` contains no arithmetic operator
    other than comparison against zero.*
11. **A word a first-timer meets is glossed where they meet it, not in a glossary they must
    go and find.** *Test: the six terms in §4's Term list each appear inside a `<Term>` on
    their first use per screen.*
12. **Every slice leaves the product working and green on the fast loop** (`vitest` in
    `apps/web`, `pytest`); a CI dispatch happens only for a platform-shaped change or a
    merge to `main`, per `CLAUDE.md`.

---

## 3. Navigation

### 3a. Where every section and page goes

The four existing groups become five: today's **Research** group mixes two whole-project
surfaces (a canvas and a dashboard) with six gathering tools, which is S2's sharpest
finding; splitting it is the only structural change, and it is one array edit. Every id,
label, icon, count and within-group order is unchanged, so no URL, no saved link, no
`placeFor` result and no `KIND_OF_SECTION` entry changes meaning, and every assertion in
`apps/web/tests/rail-follows-the-work.test.ts` still holds (sources < discover < analyses <
connections < findings < reports/figures/notebook; "Chart primitives" after "Journal").

| id / page | New group | Label (unchanged unless noted) | Reason |
|---|---|---|---|
| `board` | The project | Workboard | Stays rail row one, verbatim per `Shell.tsx:48-54` (§4/§109, "the central operating surface"). It is a place you arrange, not a step. |
| `overview` | The project | Overview | The state of the whole project, and the home of the loop card the strip reads from. Second, as today. |
| `sources` | Gather | Sources | Loop step 1 and 2's destination. First in the group; the have-it entries lead. |
| `variables` | Gather | Variables | Beside Sources for the reason `Shell.tsx:56-63` gives — what the columns mean, and the only way a chart stops being titled `resistance_pct`. |
| `search` | Gather | Search sources | Have-it. The have-it/get-it distinction (`Shell.tsx:64-83`) is preserved and made more legible: the group now reads have-it (Sources, Variables, Search sources) then get-it. |
| `literature` | Gather | Find papers | Get-it. |
| `datasearch` | Gather | Find data | Get-it. |
| `readfigure` | Gather | Read a figure | Beside Find data, verbatim per `Shell.tsx:76-83` — how a project gets numbers a paper printed as a picture. |
| `discover` | Discover and test | Discovery | Loop step 3's destination. Group renamed from "Discover" to "Discover and test" so the eyebrow covers the validation half honestly; no member moves. |
| `compare` | Discover and test | Compare | One screen, eight tabs (`compare.tsx:70-77`). Unmoved. |
| `patterns` | Discover and test | Patterns | One screen, three tabs. Unmoved. |
| `analyses` | Discover and test | Analyses | Contiguous and in order with the two below, per `Shell.tsx:97-111` (the data model's own order: a finding is `from_connections`, every connection joins an `analysis_run`). |
| `connections` | Discover and test | Connections | Loop steps 4 and 5' destination. |
| `findings` | Discover and test | Findings | |
| `graph` | Discover and test | Research graph | Stays where it is. The §115-124 rename rationale is about the *name* colliding with the per-finding evidence graph, not the position; moving it would cost an argument we have not earned. |
| `embedding` | Discover and test | Embedding space | Beside the research graph, as today. |
| `reports` | Communicate | Reports | Loop step 6's destination, and the home of the inventory's #1 and #8 ranked hidden capabilities (§6). Unmoved; opened in Slice 3. |
| `figures` | Communicate | Figures | Unmoved. |
| `notebook` | Communicate | Notebook | Gains a visible one-line note (below), because three consecutive one-word labels share one glyph. |
| `journal` | Communicate | Journal | Gains its note: "everything written, in order". Adjacency argued at `Shell.tsx:135-141`. |
| `activity` | Communicate | Activity | Gains its note: "everything done, in order". It exists because `audit_log` had nine writers and no readers (`Shell.tsx:143-153`); a note is how that reason reaches the screen. |
| `gallery` | This machine (pinned footer) | Chart primitives | Stays away from Figures, verbatim per `Shell.tsx:160-175`: the Figures screen chooses a chart from the shape of the data, and a browsable catalogue beside it would read as an alternative way of choosing. |
| `settings` | This machine (pinned footer) | Settings | Today this is the entry that falls off the 900 px fold. Pinning is the fix. |
| `/charts-3d` | This machine (pinned footer) | Spatial charts | Stays a real `<a>` so opening in a new tab works (`Shell.tsx:414-422`); its `note` becomes visible text instead of a `title` tooltip, because a tooltip is a hidden label. |
| `/gesture-check` | This machine (pinned footer) | Check hand tracking | As above. |
| `/air-ink` | This machine (pinned footer) | Draw in the air | As above. |

**Coverage:** 23 section ids in, 23 out — The project 2, Gather 6, Discover and test 8,
Communicate 5, This machine 2 = 23; plus 3 pages = 26 rail entries in, 26 out. Nothing is
removed, collapsed into a menu, or put behind a mode. Two additions to reachability: the
three machine pages are exported as `PAGES` alongside `SECTIONS` and passed to
`buildCommands` with an `href` branch, so the palette indexes 26 of 26 entries instead of
23 of 26 (`Shell.tsx:215`, `CommandPalette.tsx:296-306`); and `analyses`, `reports` and
`figures` join `buildCommands`, so the palette indexes six object kinds instead of three.
**They are exported as `PAGES`, not folded into `SECTIONS`, because
`rail-follows-the-work.test.ts:70-76` asserts `section.id` never contains `charts-3d` and
that anything matching `/primitives|spatial/i` sits after `journal` — folding the pages
into `SECTIONS` breaks that guard twice over.**

### 3b. The rail as it will read, top to bottom

```
THE PROJECT
  Workboard
  Overview
GATHER
  Sources            2
  Variables
  Search sources
  Find papers
  Find data
  Read a figure
DISCOVER AND TEST
  Discovery
  Compare
  Patterns
  Analyses           6
  Connections        6
  Findings           1
  Research graph
  Embedding space
COMMUNICATE
  Reports            1
  Figures
  Notebook           your pages, and what they link to
  Journal            everything written, in order
  Activity           everything done, in order
─────────────────────────── (pinned; does not scroll)
THIS MACHINE
  Chart primitives   every chart drawn against illustrative data
  Settings
  Spatial charts     every catalogued chart, drawn
  Check hand tracking  does the camera see your hands
  Draw in the air    marking up a figure by hand
```

**The arithmetic, stated rather than asserted.** At 1440×900 the rail has 848 px
(`900 − 52 px topbar`, `globals.css:380-385`). A `.rail-item` is `6px` padding top and
bottom over a 20.25 px line = 32.25 px (`globals.css:497-509`); an `.eyebrow` is 15 px
plus 6 px padding = 21 px (`globals.css:364-370, 495`); `.rail-group` carries 18 px of
bottom margin and `.rail` 28 px of vertical padding. Today: 26 rows + 4 eyebrows + 4
margins + padding = **~1022 px in 848 px**, which is the ~5 rows the screenshots show
clipped, ending mid-"Chart primitives" with Settings gone. This plan does three things and
claims only what they buy: `.rail-item` padding 6 → 5 px (row 30.25 px), `.rail-group`
margin 18 → 12 px, and the "This machine" group moved out of the scrolling `<nav>` into a
sibling `<nav class="rail-footer">` inside `.rail-panel`, which is **already**
`display:flex; flex-direction:column` (`globals.css:395-399`). The footer is 1 eyebrow +
5 rows + 10 px = ~182 px, leaving 666 px for the scrolling body, which needs 21 rows +
4 eyebrows + 3 margins + 14 px = **~769 px**. So roughly **100 px, about three rows, still
scrolls, and the rows that scroll are Notebook, Journal and Activity** — not Settings, and
not Reports, which is the loop's own step 6. That is the improvement being bought, and it
is the whole of it.

Note the mechanism, because the obvious one does not work: `margin-top: auto` on the last
`.rail-group` is inert while `.rail` is `display:block` (`globals.css:486-492`), and once
`.rail` is made a flex column it resolves to 0 the moment the content overflows — which is
the only case that matters. Hence a second `<nav>`, with `.rail { flex: 1 1 auto;
min-height: 0 }` and `.rail-footer { flex: 0 0 auto }` overriding the `flex: 1 1 auto`
that `.rail-panel > *` currently gives every child (`globals.css:400-407`).

---

## 4. Per-screen changes

Ordered within each screen by priority. Effort: **S** ≤ 1 h, **M** 2–4 h, **L** ≥ 1 day.

### 4.1 Landing page `/` — D200

1. **Make the display size height-aware and widen the measure.** `--type-display:
   clamp(2.6rem, min(8.4vw, 11.5vh), 7.6rem)` at `app/landing.css:54`, and
   `.l-hero-inner .l-display { max-width: 22ch }` above 1200 px at `landing.css:242`.
   *Why:* measured — at 1440×900 the h1 is 640 px tall (`8.4vw` = 121 px × `line-height
   1.04` × 5 lines, `landing.css:79`) and "Open the workspace →" sits at y≈971, below the
   fold; at 1280×720 the last line is cut in half. The one door into the product is
   invisible to a laptop visitor whose only instruction is a corner "Scroll" hint.
   *Exposes:* the product's only entry control — every capability behind the gate is,
   for that visitor, hidden behind a scroll nobody told them to make (inventory §2 screen
   9, "two identical CTAs give no hint of branching"). *Onward step:* Open the workspace.
   *Effort:* S. *Files:* `apps/web/app/landing.css`, `apps/web/tests/landing-fits.test.ts`
   (new). The parallax (`app/page.tsx:87-133`), the reveal (`:137-170`) and the HeroGraph
   are untouched — this is type scale, not composition.
2. **Add one clause to the lede naming the first step:** "…and shows you everything it
   threw away. You start by adding a paper and a dataset." *Why:* the loop is the spine;
   the landing page should be teaching step 1, not only describing the pipeline.
   *Effort:* S. *Files:* `apps/web/app/page.tsx:205-210`.

### 4.2 Sign-in gate `/workspace`

1. **Present the two paths as equal labelled choices when the browser has no prior
   session, with "Create an account" first.** *Why:* the landing page's only CTA lands a
   brand-new visitor on a form headed "Welcome back" with "Sign in" as the primary and
   account creation as an underlined link in body text; the walk harness had to click that
   link to proceed (`walk-show/report.txt:7-8`). The localhost-only signup rule
   (`docs/TRY_IT.md:98-104`) is unaffected. *Effort:* S. *Files:*
   `apps/web/app/workspace/page.tsx` (Gate), `apps/web/tests/gate.test.tsx`.

### 4.3 Shell — `lib/loop.ts` (new), the step strip, the rail, the palette

1. **`apps/web/lib/loop.ts`** — lift the six steps out of `Overview` verbatim
   (`views.tsx:53-104`) as `loopSteps(map)`, `currentStep(map)`,
   `isStepDestination(section, step)`. Pure functions of `DiscoveryMap`. The module header
   states the boundary: *it ticks steps off counts the server computed and never invents a
   number, and the recommendation sentence comes from `map.recommended_next_action`
   verbatim* — honouring `views.tsx:6-9`. Overview imports it and renders identically.
   *Why:* the rail, the Overview and the strip must agree or the product teaches two
   models; one module makes every later slice cheap. *Effort:* S. *Files:*
   `apps/web/lib/loop.ts`, `apps/web/components/views.tsx`, `apps/web/tests/loop.test.ts`.
2. **The step strip.** One sticky band in `Shell.tsx`, immediately above
   `<main className="workspace">`, driven by a `strip` prop that `page.tsx` builds from
   `currentStep(map)`. It has exactly two halves and never wraps: left, the step in words
   — `Step 4 of 6 · Try to destroy what survived` — as a button opening Overview's loop
   card; right, that step's action as the screen's one `btn btn-primary`. When the current
   section **is** the current step's destination the left half reads `You are here — step 4
   of 6: …`. **It never says "not a step".** The strip states what the *project* is doing,
   not what the *screen* is; a screen that is not a step is simply not claimed to be one,
   which is why no per-screen copy table is needed and why 19 sections need no new sentence.
   Height is capped at one 36 px line. *Why:* the product knows the next step and says it
   twice — under the loop card (`views.tsx:146`) and at the top of the inspector
   (`page.tsx:863-865`) — and neither sentence can be acted on; the entire Inspector
   function contains no button, link or `onClick` (D204). A band above the scroll region is
   the structural cure for both measured fold defects. *Exposes:* the recommended next
   action becomes pressable for the first time (inventory §2 screen 5, "names the step but
   has no control to take it"). *Onward step:* whatever the loop says is next, from any of
   the 23 sections. *Effort:* M. *Files:* `apps/web/components/Shell.tsx`,
   `apps/web/app/workspace/page.tsx`, `apps/web/app/globals.css`,
   `apps/web/tests/step-strip.test.tsx` (new). **Not on `/charts-3d`, `/gesture-check` or
   `/air-ink`** — those pages are recorded as reaching no project and needing no account
   (`app/charts-3d/page.tsx:21`, `app/gesture-check/page.tsx:18`), and all three already
   link back to `/workspace` (D197, walk C7).
3. **Regroup the rail into five groups** exactly as §3a lists, keeping every id, label,
   icon, count and within-group order. *Why:* "Research" holds a canvas, a dashboard, two
   object lists and four tools; splitting the two whole-project surfaces out is the one
   honest edit, and it costs one eyebrow. *Effort:* S. *Files:*
   `apps/web/components/Shell.tsx`, `apps/web/tests/shell-nav.test.tsx`,
   `apps/web/tests/rail-follows-the-work.test.ts` (update in the same commit; the ordering
   assertions all still pass).
4. **Split the rail into a scrolling body and a pinned footer**, with the metrics and the
   flex mechanism in §3b, plus a bottom fade on `.rail` so the scroll is visible. *Why:*
   at 1440×900 the rail is clipped mid-"Chart primitives" and Settings — model choice,
   feature packs, version, people — is off-screen entirely, which is precisely the group
   `Shell.tsx:182-203` was written to rescue from being URL-only. *Exposes:* Settings,
   Spatial charts, Check hand tracking, Draw in the air (inventory §1 screens 13–16 and §2
   screen 1's friction note). *Effort:* S. *Files:* `apps/web/components/Shell.tsx`,
   `apps/web/app/globals.css`.
5. **Render the three machine pages' `note` as visible secondary text instead of a `title`
   tooltip, and give Notebook, Journal and Activity the same treatment.** *Why:* a tooltip
   is a hidden label; three consecutive one-word labels share one glyph
   (`Shell.tsx:247-255`) and the distinction lives only in code comments. *Effort:* S.
   *Files:* `apps/web/components/Shell.tsx`, `apps/web/app/globals.css`.
6. **Extend the palette.** Export `PAGES` beside `SECTIONS`, give `buildCommands` an
   `href` branch for them, and pass `analyses` (already fetched at `page.tsx:406`),
   `reports` and `figures`. Rename the placeholder to name what it indexes. *Why:* ⌘K
   indexes 23 of 26 entries and the three it misses are three of the five below the fold —
   both discovery paths fail on the same items; and a finding detail prints
   `arun_15d025cf892c41b1806e` on screen (`views.tsx:960`) while the bar promising to "jump
   to anything" cannot find it. *Exposes:* the three machine pages plus every analysis,
   report and figure (inventory §2 screen 2 friction: "Analyses and Reports/Figures never
   indexed"). *Effort:* S. *Files:* `apps/web/components/Shell.tsx`,
   `apps/web/components/CommandPalette.tsx`, `apps/web/app/workspace/page.tsx`.

### 4.4 Overview

1. **Give every loop row a visible destination and the `next` row a verb.** A chevron plus
   the section name on the right of each row; the state word (`NEXT`, currently set in blue
   and the most button-like thing on the card) demoted to a quieter weight; the `next` row
   gains a right-aligned `btn btn-primary` carrying the action — "Add sources →", "Try to
   destroy what survived →". *Why:* every row is a `<button>` (`views.tsx:130-146`) and
   none looks like one; on a brand-new project the only button-shaped element on the screen
   is "Compare results now" (`contradictions.tsx:97-98`), which on an empty project can only
   report nothing (`walk-show/15-after-new-project.png`). The one thing the researcher came
   to do has no visible control. This is §123's converse. *Onward step:* the step marked
   next becomes a press. *Effort:* M. *Files:* `apps/web/components/views.tsx`,
   `apps/web/app/globals.css`.
2. **Carry the object through on steps 4 and 5.** Use `map.top_connections[0]`, which
   `DiscoveryMap` already ships (`apps/web/lib/api.ts:211-217`), so the row opens the
   connection the recommendation names and the button truthfully says "Open
   consumption_ddd × resistance_pct →". *Why:* two steps land in the same place with
   nothing saying so, and the researcher arriving at a six-row table meets a table, an
   Exploration Ledger and a Deviations panel at once; the server already knows which
   connection ranks highest (`views.tsx:148-150`). **No server field is needed** — the
   deferral in the winning proposal was unnecessary. *Effort:* S. *Files:*
   `apps/web/lib/loop.ts`, `apps/web/components/views.tsx`.
3. **Wire the `next` row's primary button on an empty project to the file picker Sources
   already uses** (`views.tsx:174-181`), so the first action happens without leaving
   Overview. *Why:* the screen a researcher with one paper and one CSV actually lands on
   contains no control for adding them (D-class friction, `15-after-new-project.png`).
   *Exposes:* upload, from the screen that tells you to upload (inventory §2 screen 7).
   *Effort:* M. *Files:* `apps/web/components/views.tsx`,
   `apps/web/app/workspace/page.tsx`.
4. **Say the loop is a loop, and pick `next` from the recommendation.** The card's sub-line
   reads "The steps may be taken out of order — this is where the project is now." and
   `currentStep` prefers the step the server's recommendation names over
   `steps.find(s => !s.done)`. *Why:* the worked example ships with step 5 DONE above step
   4 NEXT on a numbered list (`04-overview-caught-up.png`), because a finding may
   legitimately be recorded from an unvalidated connection
   (`recordfinding.tsx:110-120`). A numbered checklist that contradicts itself teaches a
   first-timer that the numbers are decoration. *Effort:* S. *Files:*
   `apps/web/lib/loop.ts`, `apps/web/components/views.tsx`.
5. **Keep "Compare results now" at constant weight and change its copy on an empty
   project** — "Compare results now — nothing to compare until an analysis has run". *Why:*
   the recorded decision that the sweep is offered rather than run on load
   (`contradictions.tsx:91-95`) stays; demoting the control's *rank* by project state would
   make one control two controls and re-create the §123 problem this plan exists to remove,
   and the inventory already calls this sweep undiscoverable. Refusal stated in place is the
   house style. *Effort:* S. *Files:* `apps/web/components/contradictions.tsx`.

### 4.5 Connection detail — the pivot of the loop

1. **Move `<RecordFinding>` above `<Fragility>` and `<ValidationReports>`**, so the order is
   h1 → ResultCard → Trace → EvidenceGrade → "Try to destroy it" → **Record this as a
   finding** → How fragile is this? → Validation reports. *Why:* measured — at 1440×900 the
   fold ends inside "How fragile is this?" with a large 29.4 as the last visible thing, and
   `RecordFinding` is the seventh block, roughly two screens down (`views.tsx:1204-1345` (ResultCard :1212, EvidenceGrade :1242, "Try to destroy it" :1247, Fragility :1316, ValidationReports :1317, RecordFinding :1328);
   `10-connection-detail.png`). Recording is the act that *follows* validation; fragility
   and the report history are the reading that supports it, not a gate before it. The
   recorded rule is untouched — the form still belongs to this result and the connection
   still travels with it (`recordfinding.tsx:14-19`). *Effort:* S. *Files:*
   `apps/web/components/views.tsx`.
2. **Add the actions band directly under the ResultCard**, a single row of controls that
   act on *this connection*: `Validate ↓` · `Record this as a finding ↓` ·
   `Draft a report from this` · `How are these connected?` · `Trace`. The two ↓ entries
   scroll to and **focus** the real control already on the page — never a duplicate form.
   Empty downstream slots are offers: where no report exists yet the entry reads "Reports —
   none yet · Draft one from this". *Why:* the loop's steps 5 and 6 cannot be seen on
   arrival at the screen the Overview sent the researcher to. *Exposes:* report drafting,
   the inventory's **§6 rank 1** most consequential hidden capability. *Onward step:* record,
   then communicate, without leaving the object. *Effort:* M. *Files:*
   `apps/web/components/views.tsx`, `apps/web/components/objectactions.tsx` (new),
   `apps/web/app/globals.css`.
3. **"Draft a report from this"** posts to the same `/api/projects/{id}/artifacts/draft`
   route Reports uses (`reports.tsx:48` — `grep -rn "artifacts/draft" --include=*.tsx`
   returns exactly one caller). Export `canDraftReport(connection)` from `reports.tsx` so
   §80's eligibility rule (`reports.tsx:39-41` — only a connection with an
   `analysis_run_id`) is **one rule with two callers**, not a rule copied to a second call
   site. Where the connection is ineligible the control stays and says why: "A report starts
   from a result that was computed. This connection has no recorded analysis run, so there
   is nothing yet for a report to reference." Where a draft already exists it reads "Drafted
   — open it" rather than silently drafting a second. *Why:* the loop's last step cannot be
   taken from either object a researcher is holding. *Exposes:* inventory §6 rank 1.
   *Effort:* M. *Files:* `apps/web/components/views.tsx`,
   `apps/web/components/reports.tsx`.
4. **"How are these connected?"** beside Trace, calling `GET
   /api/projects/{id}/graph/path`. Trace answers how the number was made; this answers how
   the two objects relate. Both sit under one heading with that one-sentence distinction, so
   the fourth provenance surface does not compound the three-way confusion the inventory
   records (§7, "Provenance is duplicated across 3 unrelated mechanisms"). Where Neo4j is
   absent it states the reduced feature set rather than failing (ADR 0002,
   `settings.tsx:980-1000`). *Exposes:* `graph/path`, one of the orphan routes in inventory
   §3. *Effort:* M. *Files:* `apps/web/components/views.tsx`, `apps/web/lib/api.ts`.
5. **Make each row of `ValidationReports` open `GET /api/validations/{report_id}`.** It is
   already a list of report ids and the route has no caller anywhere in `apps/web`.
   *Exposes:* `GET /api/validations/{report_id}` (inventory §3). *Effort:* S. *Files:*
   `apps/web/components/views.tsx:1407-1450`.
6. **Fragility leads with the sentence and lets it carry the number** — "An unmeasured
   confounder would have to be about 29× stronger than anything measured here to explain
   this away" — with "E-value: 29.4" as the labelled figure beneath; the closed-by-default
   assumptions `<details>` stays. *Why:* the heading asks "How fragile is this?"
   (`fragility.tsx:88`) and answers with a bare 29.4 whose polarity is the opposite of the
   question. This is ResultCard's own law (`ResultCard.tsx:1-25` — sentence first, numbers
   labelled in words) applied to the one panel on the screen that inverts it; the file's own
   header already says "the number is never shown on its own" (`fragility.tsx:16`).
   *Effort:* S. *Files:* `apps/web/components/fragility.tsx`.

### 4.6 Finding detail

1. **Add one "Take it further" card below Challenges**, holding `<PublishFigure
   findingId={id} analysisRunId={runId}>` and "Draft a report from this finding".
   **Both ids are already on the wire and no server work is required:** `GET
   /api/findings/{id}/evidence-graph` returns `analyses[]` and `connections[]`, both typed
   (`apps/web/lib/api.ts:385-397`, `EvidenceGraph.connections: Connection[]`), and the
   domain function selects them by lineage
   (`packages/research-domain/src/throughline_domain/graphs.py:184-207`). So the run id is
   `evidence.analyses[0].id` and the report's connection is
   `evidence.connections.find(canDraftReport)`. `EvidenceGraphView` lifts both through a new
   optional `onLoaded` callback rather than page.tsx fetching the graph twice. Where no
   eligible connection exists the card says so in place. *Why:* the object researchers most
   want to communicate can do neither of the two things this product exists to do with it;
   `publish.tsx:95` declares a documented `findingId?: string | null` that its only caller
   never passes (`figures.tsx:757-761`) — the repository's own named recurring defect (a
   prop with nowhere to land, `CardDetail.tsx:6-9`) recurring on the highest-value object.
   *Exposes:* server-side figure publication with its VISUALIZES lineage edge and figure
   critic (inventory §6 rank 5, §2 "Publish (figure)"), and report drafting (§6 rank 1).
   *Onward step:* step 6, from the object step 5 produced. *Effort:* M. *Files:*
   `apps/web/app/workspace/page.tsx:665-691`, `apps/web/components/views.tsx`
   (`EvidenceGraphView`), `apps/web/components/publish.tsx`,
   `apps/web/components/reports.tsx`.
2. **Extract `<ObjectHistory objectId>` = `NodeJournal` + `ObjectVersions` and mount it as
   the last section of the finding detail, the source detail, the analysis detail and the
   Workboard card detail.** *Why:* restore-forward — the one recovery path for an edited
   research object, deliberately additive rather than destructive
   (`objectversions.tsx:1-17`) — is mounted only inside `NodeJournal`, which is mounted only
   by the Research graph (`graphview.tsx:152`). It is absent from every screen that shows
   the object being versioned. One extracted component means no duplicated logic, and
   `NodeJournal`'s rule that a model's note and a person's note are styled identically
   (`NodeJournal.tsx:1-20`) travels with it. *Exposes:* object version history and
   restore-forward, inventory **§6 rank 7**. *Effort:* M. *Files:*
   `apps/web/components/objecthistory.tsx` (new), `apps/web/components/NodeJournal.tsx`,
   `apps/web/app/workspace/page.tsx`, `apps/web/components/board/CardDetail.tsx`.
3. **One vocabulary for lifecycle.** Adopt ResultCard's plain phrases wherever a state is
   displayed — list chips, the lifecycle breakdown headings, and the transition buttons,
   which state their direction: "Mark as exploratory — a step back from candidate",
   "Retire this finding". *Why:* the connection detail chip reads "Tested — needs
   replication" (`ResultCard.tsx:36-44`) while the lists and the lifecycle panel read
   EXPLORATORY and CANDIDATE and offer "Move to exploratory" with no statement of which
   direction is forward (`05-findings-list.png`, `06-finding-detail.png`). Part of D207.
   *Effort:* M. *Files:* `apps/web/components/lifecycle.tsx`,
   `apps/web/components/primitives.tsx`, `apps/web/components/views.tsx`.
4. **One button vocabulary on this screen and everywhere.** Rewrite `.nj-primary` →
   `class="btn btn-primary"` (12 sites) and `.ct-dataset` → `class="btn"` (9 sites), delete
   both rules from `globals.css`, add `a.btn { text-decoration: none }`, and give the 42
   unclassed `<button>` elements `.btn` or the text-button class. Add a lint test that fails
   on any new component-scoped button class. *Why:* four button vocabularies plus a fifth
   state of no class at all, so the same rank of action looks different depending on which
   screen invented its CSS first — "Search" is `btn-primary` on Search sources
   (`views.tsx:492`) and `.nj-primary` on Find papers (`literature.tsx:305`) and Find data
   (`datasearch.tsx:120`), one verb at one rank in two shapes on three adjacent rail
   entries; and on the finding detail four same-rank controls have four appearances, one of
   them underlined because `a { color: inherit }` (`globals.css:352`) resets colour but not
   `text-decoration`. **Land this early**: every change in this plan adds controls, and each
   one added before the unification is another site to rewrite. *Effort:* M. *Files:*
   `apps/web/app/globals.css`, `apps/web/components/*.tsx`,
   `apps/web/tests/one-button-vocabulary.test.ts` (new).

### 4.7 Workboard and card detail

1. **Make the card face keyboard-openable.** Add a focusable open affordance inside the
   `<article>` (a real `<button>` carrying the title) whose `onPointerDown` stops
   propagation the way `.board-lower` and `.board-remove` already do, so press-versus-drag
   keeps working; state plainly in the board's lede that "cards can be opened from the
   keyboard; arranging them needs a pointer". *Why:* board cards are `<article>` elements
   and `setOpened` fires only from the pointer-up branch (`Board.tsx:432-452, 869-882`), so
   every capability behind CardDetail is pointer-only — and this plan is about to put four
   more behind that door. Refusing to claim drag parity we have not built is §123 applied
   one layer up; §30 (`Volume.tsx:739-756`) is law. *Exposes:* the whole card detail for
   keyboard users (inventory §6 rank 2's principle applied to the board). *Effort:* M —
   **not S**; it sits inside the pointer-down drag machinery, and it must land in the same
   slice as the wiring below. *Files:* `apps/web/components/board/Board.tsx`,
   `apps/web/tests/board.test.tsx`.
2. **Thread the workspace's `select(kind)` callback into `CardDetail`** so every dependent
   artifact under "Built on this" and every note under "Mentioned in" becomes a
   `button.pick` that opens it in the section that shows its kind, via `placeFor`. Where a
   target genuinely has no home, render it as text — a dead button is worse than plain
   text. *Why:* the Workboard is what `Shell.tsx:48-54` calls the central operating surface,
   and its card detail is the only place in the product where you can see a relationship and
   cannot follow it: dependents render as `<span>` (`CardDetail.tsx:106-120`) and mentions
   as `<b>`/`<p>` (`:136-147`), breaking the product's own single navigation rule
   (`page.tsx:294-303`, D195). *Exposes:* impact and backlinks as navigation (inventory §1
   screen 37, `dead_end: true`). *Onward step:* from a card to everything built on it, and
   back. *Effort:* S. *Files:* `apps/web/components/board/CardDetail.tsx`,
   `apps/web/components/board/Board.tsx`, `apps/web/app/workspace/page.tsx`.
3. **Under "Built on this", add "…and everything downstream"** calling `GET
   /api/projects/{id}/graph/reachable` — the deep version of the shallow impact list already
   there, sitting under the list it deepens so it reads as more of the same answer.
   *Exposes:* `graph/reachable` (inventory §3). *Effort:* M. *Files:*
   `apps/web/components/board/CardDetail.tsx`, `apps/web/lib/api.ts`.
4. **Mount `<ObjectHistory>` under "Mentioned in".** `CardDetail`'s own doc comment claims
   to be "what is behind the card you just pressed"; notes and versions are exactly that.
   *Exposes:* inventory §6 rank 7, from the board. *Effort:* S (after 4.6.2). *Files:*
   `apps/web/components/board/CardDetail.tsx`.

### 4.8 Source detail

1. **Pass the two handlers that are declared and never supplied.** `CohortTree onSelect`
   (declared `cohorts.tsx:167-170`, mounted without it at `views.tsx:416-417`) scrolls to
   and highlights that subset's row in the profiled-schema chain; `DatabaseTables
   onImported` (declared `databasetables.tsx:56`, mounted without it at `views.tsx:375-377`)
   calls the workspace's `select("source")` on the returned `source_id`. If a target
   genuinely does not exist, render the cohort name as text. *Why:* both are live §123
   breaches — controls that do nothing when pressed — and the import case leaves the
   researcher on a failed source with no route to the dataset they just created. This is the
   third instance of the pattern `CardDetail.tsx:6-9` names by hand. Closes D205.
   *Effort:* S. *Files:* `apps/web/components/views.tsx`,
   `apps/web/components/cohorts.tsx`, `apps/web/components/databasetables.tsx`.
2. **Add a one-word status on the Sources *list* row when a failed ingestion has importable
   tables.** *Why:* importing a table is reachable only from a failed ingestion row with no
   signal on the list (inventory §2 screen 18 friction), so wiring `onImported` alone leaves
   the capability undiscoverable. *Effort:* S. *Files:* `apps/web/components/views.tsx`.
3. **Bridge to Variables from the schema that needs it:** under the profiled schema table,
   one line — "4 of 11 columns have no approved label. Review them →" — opening Variables.
   *Why:* Variables is the reason a chart stops being titled `resistance_pct`
   (`Shell.tsx:56-63`) and nothing links forward to it from the data it describes. This is a
   route, not a duplicated control: the approve/reject cards stay on Variables, where the
   alias dropdown is built from the variables the project actually has
   (`variables.tsx:317-320`). *Onward step:* approve labels, then every chart names them.
   *Effort:* S. *Files:* `apps/web/components/views.tsx`.
4. **Mount `<ObjectHistory>`** as the last section. *Effort:* S. *Files:*
   `apps/web/components/views.tsx`.

### 4.9 Search sources — D203

1. **One sentence, then two named disclosures.** The default line reads "Searched every
   passage in this project." Beneath it, **two** controls, each naming its own contents:
   "Which passages this search was built from" opening `GET /api/retrievals/{event_id}`
   (with the raw id kept inside for citation), and "How this search ran: hybrid, 40 lexical
   and 40 semantic candidates" expanding the strategy detail. *Why:* the one identifier
   printed beside every search is the one thing on the screen that cannot be opened
   (`views.tsx:540-543`), and the route that audits which passages an answer was built from
   has no caller anywhere in `apps/web` — the inventory's sole dead end by omission rather
   than by design (§6 rank 9). **Two disclosures, not one**, because folding the strategy
   and the two candidate counts under a summary that names only the event id would bury
   three currently-visible readouts behind a label that does not mention them, breaching
   `ChartTable`'s law (`ChartTable.tsx:1-21`) that this plan invokes as principle 4.
   *Exposes:* `GET /api/retrievals/{event_id}` (inventory §3, §6 rank 9). *Onward step:*
   read the passages an answer rests on. *Effort:* M. *Files:*
   `apps/web/components/views.tsx:515-560`, `apps/web/lib/api.ts`.
2. **Make each hit's locator open its source** via the existing `placeFor` rule. *Why:* the
   screen has no forward edge at all; one rule already knows where a source opens
   (`apps/web/lib/place.ts`) and this screen never calls it. *Effort:* S. *Files:*
   `apps/web/components/views.tsx`, `apps/web/app/workspace/page.tsx`.
3. **Add "Take this passage" per hit**, writing to the same excerpt board Find papers keeps
   (`literature.tsx:441-465`). *Why:* three of the four search-family screens hand nothing
   back to the loop, on a rail where the fourth does it in one click. *Effort:* M. *Files:*
   `apps/web/components/views.tsx`, `apps/web/components/literature.tsx`.

### 4.10 Discovery and Connections (shared `ConnectionsTable`)

The two stay two rail entries. The merge the runner-up proposed is a real diagnosis with a
real fix, but it changes what two section URLs mean two days after D194–D199 bought the
address, and the ledger problem it solves can be solved by moving a panel instead.

1. **Render `<ExplorationLedger>` on Discovery as well as Connections, and move the
   Benjamini–Hochberg sentence above the table as its caption.** *Why:* the screen that runs
   the sweep does not show the running total the correction depends on; the ledger and
   Deviations hang off `connections` (`page.tsx:646-664`) while the sweep runs on `discover`
   (`page.tsx:636-645`). Three separate files state that a q-value means nothing without the
   number of tests it was corrected across (`views.tsx:650-651`, `sweep.tsx:12-13`,
   `ledger.tsx:6-9`), and a first-timer reading top to bottom meets 7.44e-39 before the
   concept. *Exposes:* the exploration ledger on the screen where a q-value is first met
   (inventory §2 screen 22/23). *Effort:* M. *Files:*
   `apps/web/app/workspace/page.tsx`, `apps/web/components/views.tsx`,
   `apps/web/components/ledger.tsx`.
2. **Rewrite the ledger's empty state to name its boundary:** "This line of enquiry counts
   the looks taken since it was opened. The results above were produced before it began."
   with the discovery run's own test count beside it. *Why:* a table of six corrected tests
   sits ~200 px above a panel reading "0 looks / Nothing tested yet"; a reader can only
   conclude the ledger is broken or the q-values are uncorrected, and both are wrong. The
   panel keeps its deliberately non-alarm tone (`ledger.tsx:14-17`). *Effort:* S. *Files:*
   `apps/web/components/ledger.tsx`.
3. **Offer "Register a hypothesis" from Discovery** as well as from Deviations. *Why:*
   pre-registration is reachable only from the Deviations panel on Connections — never from
   the screen where a researcher is about to run a new test, which is the only moment
   registering one is meaningful. *Exposes:* inventory §1 screen 24 (11 capabilities, 1
   visible, 10 behind_toggle). *Effort:* S. *Files:* `apps/web/components/views.tsx`,
   `apps/web/components/preregister.tsx`.
4. **Make each Deviations registration card open `GET
   /api/projects/{id}/deviations/{registration_id}`.** *Exposes:* an orphan route
   (inventory §3), on a panel this plan already touches. *Effort:* S. *Files:*
   `apps/web/components/deviations.tsx`.
5. **Disclose truncation.** Render "Showing the first 200. This screen does not know how
   many there are in total." whenever `data.length === limit`, on both instances; the
   better second step is to have the list endpoints return a total and use `ChartTable`'s
   exact sentence. Closes D201. *Why:* both lists are capped (100 on Discovery, 200 on
   Connections, `page.tsx:407,409,807`) and neither says so, while `ChartTable` one
   directory away discloses truncation in its **closed** summary
   (`ChartTable.tsx:74-78`). *Effort:* S (client), M (with the API total). *Files:*
   `apps/web/components/views.tsx`, `apps/web/app/workspace/page.tsx`, and for the total,
   `apps/api/src/throughline_api/app.py`.
6. **Add a "Most connected objects" panel beside the ledger**, calling `graph/centrality`
   and `graph/communities` under one honest heading — "Which objects this project has
   connected most", stated as a structural fact and not a research finding, per the route's
   own summary. *Exposes:* two orphan routes whose home the inventory names as exactly this
   screen (§3). *Effort:* M. *Files:* `apps/web/app/workspace/page.tsx`,
   `apps/web/components/graphstats.tsx` (new), `apps/web/lib/api.ts`.

### 4.11 Reports — the loop's step 6, opened

The winning proposal never opened this screen. It is step 6 and it holds the inventory's
**§6 rank 1** and **rank 8** hidden capabilities, so it is scheduled before, not after, the
two new drafting entrances that will double the traffic into it.

1. **Make per-block provenance permanent.** Under every traceable block, a footer line —
   "3 values from pearson correlation · 2 citations, 1 unverified" — with the existing
   "Where this came from" control expanding the full chain beneath it. *Why:* the provenance
   guarantee behind every cited number is invisible until a reader presses a per-block
   toggle (`reports.tsx:352, 371-380`), and citations already carry their entailment state
   including `unverified` (`reports.tsx:4-14`). Printing that word before the press is
   strictly more honest, and the chain stays layered, not removed. *Exposes:* inventory §6
   rank 1. *Effort:* S. *Files:* `apps/web/components/reports.tsx`.
2. **State the export block as a refusal above the export row**, not as a disabled control,
   naming the integrity problems that caused it. The rule itself — export blocked while
   integrity reports problems, "a file outlives the warning that would have accompanied it
   on screen" (`reports.tsx:267-292`) — is unchanged. *Effort:* S. *Files:*
   `apps/web/components/reports.tsx`.
3. **Give the three take-away exports a named block of their own** on the Reports screen —
   results.csv, snapshot.zip and the .bib (`bibliography.tsx:48,76,104`) — each with its
   existing sentence, including the honest note that the snapshot is "an archive to read and
   keep, not a backup to restore from". *Exposes:* inventory §6 rank 8. *Effort:* S.
   *Files:* `apps/web/components/reports.tsx`, `apps/web/components/bibliography.tsx`.
4. **Add the per-export staleness readout** calling `GET
   /api/projects/{id}/artifacts/{id}/staleness` — every export of one document and whether
   each still reflects the current analysis. *Exposes:* an orphan route whose home the
   inventory names as this screen (§3). *Effort:* M. *Files:*
   `apps/web/components/reports.tsx`, `apps/web/lib/api.ts`.

### 4.12 Figures

1. **Swap the emphasis, not the content.** `<PublishFigure>` becomes the `btn-primary` and
   renders first; "Save this view" is demoted to a text-weight control underneath, keeping
   its existing sentence verbatim. *Why:* the path that silently loses the VISUALIZES
   lineage edge, the figure critic and the journal formats is the one that looks like the
   default, and it sits directly above the real one at the same visual weight
   (`figures.tsx:744-762`; `publish.tsx:5-28` documents exactly what the DOM path loses).
   Nothing is removed; the layering just matches the stated cost. *Exposes:* inventory §6
   rank 5. *Effort:* S. *Files:* `apps/web/components/figures.tsx`,
   `apps/web/components/publish.tsx`.

### 4.13 Notebook

1. **Label the lint and name what it found.** "Check the notebook" states what it checks,
   and its four finding kinds — `stale_evidence`, `unwritten_page`, `isolated`, `no-source`
   — render as named blocks with the why and the what-to-do the component already returns.
   *Why:* inventory **§6 rank 6** — findings behind an unlabelled button on a screen no
   inventory group opened; `stale_evidence` is the notebook's counterpart to the Exports
   staleness panel. *Effort:* M. *Files:* `apps/web/components/notebook.tsx:341-375`.
2. **Put the dangling-link to-do list and the "Where to start" hubs above the page body**
   rather than below it. *Why:* both answer "what should I write next" and both are below
   the fold on arrival. *Effort:* S. *Files:*
   `apps/web/components/notebook.tsx:292,308-320,379-393`.

### 4.14 Find data — D202, and Read a figure — D206

1. **Add "Add to this project" beside each usable record on Find data**, matching Find
   papers' affordance and wording exactly (`literature.tsx:428-434`). *Why:* Find data's
   only onward control is an external link to the repository, on the rail entry directly
   beside the one that imports in a click; the refusal case is already designed — unusable
   records are shown dimmed with the blocker named (`datasearch.tsx:3-24`) — so only the
   success case is missing. *Onward step:* step 1, from the screen that found it.
   *Effort:* M. *Files:* `apps/web/components/datasearch.tsx`.
2. **End Read a figure by offering the recovered table as a source**, after the existing
   CSV download. The attestation gate (`readfigure.tsx:234-256`) is unchanged and still
   precedes the read. *Why:* digitised points reach an `<a download="digitised.csv">` and
   never become a source, so the numbers a researcher just recovered leave the product
   instead of entering it. *Effort:* M. *Files:* `apps/web/components/readfigure.tsx`,
   `apps/web/app/workspace/page.tsx`.

### 4.15 Context inspector — D204

1. **Keep it a readout; make its two sentences honest and one of them actionable.** The
   recommendation renders **always**, not only when nothing is selected, as a sentence with
   its object attached plus the same "Open consumption_ddd × resistance_pct →" button the
   Overview uses. The installation rows are renamed "Search model: none installed — search
   is lexical only" and "Writing model: configured". *Why:* the whole Inspector function is
   `<p>`/`<dl>` with no button, link or `onClick` (`page.tsx:849-889`); and "Model: none"
   two lines above "AI provider: configured" reads as two contradictory statements about one
   thing. *It deliberately does not gain an action list*: the panel is not rendered below
   1101 px (`Shell.tsx:440-457`), so a capability that lived only there would be hidden from
   a large class of laptops — which is why the actions band lives on the page (§4.5.2).
   *Effort:* S. *Files:* `apps/web/app/workspace/page.tsx:849-889`.

### 4.16 `/gesture-check`, and the project switcher and account menu

1. **Move `<SpatialControl>` above the two synthetic figures on `/gesture-check`**, directly
   under the banner that names its buttons. *Why:* the banner reads 'The camera is not on
   yet. Press "Try hand gestures", then "Turn on the camera"'
   (`app/gesture-check/page.tsx:125`) and neither button is on screen — they sit two full
   chart-heights down (`Volume` :251, `Surface` :263, `SpatialControl` :278), and the only
   control in the first viewport is "Reset the view". Nothing starts on mount and the camera
   is still explained before it is requested (`SpatialControl.tsx:1-19`), so the recorded
   consent sequence is untouched; the panel simply sits where its own instructions point,
   and the charts are what you check *after* the camera is on. *Exposes:* all eleven
   hand-tracking controls, inventory **§6 rank 3**. *Effort:* S. *Files:*
   `apps/web/app/gesture-check/page.tsx`.
2. **Put "New project" beside the project name in the topbar**, not only inside its
   dropdown, and leave switch/delete in the menu where a list belongs. *Why:* inventory §1
   screen 3 records 8 capabilities, 2 visible, **6 behind_menu**, and screen 4 records 4
   capabilities, 1 visible, **3 behind_menu** — the brief's explicitly forbidden class. The
   account menu's three (identity readout, local-only reassurance, sign out) are argued as a
   **stated exception** in §6: they are properties of the session, not of a research object,
   and a persistent sign-out control is a hazard, not a capability. An omission that is
   stated is not a hidden capability (`librarynote.tsx:92-97` is the template). *Effort:* S.
   *Files:* `apps/web/components/ProjectMenu.tsx`, `apps/web/components/Shell.tsx`.

### 4.17 Product-wide: the glossary that is not a page — D207

1. **Add a shared `<Term>` component** that renders a word with a permanently visible
   one-clause gloss on **first use per screen** — not a tooltip, because a tooltip is a
   hidden label by this plan's own argument about `MACHINE_PAGES`' `title`. Apply it at
   minimum to: **q-value** ("corrected for how many tests ran"), **Benjamini–Hochberg**
   ("the correction; it divides the tolerance for false positives across every test in the
   run"), **E-value** ("how much stronger than everything measured an unmeasured cause would
   have to be"), **lifecycle state** ("how far a result has got through validation"),
   **causal status** ("whether anything here licenses the word 'causes'"), **estimand**
   ("the quantity the analysis is trying to estimate"). The BH caption on the connections
   table reads "corrected for how many tests ran" *before* it says Benjamini–Hochberg.
   *Why:* every inventory group independently flagged that there is no glossary anywhere and
   that the screens lean on jargon (§8); the `Status` pills and the connections table are
   where a newcomer meets it first. *Effort:* M. *Files:*
   `apps/web/components/term.tsx` (new), `apps/web/app/globals.css`,
   `apps/web/components/views.tsx`, `apps/web/components/fragility.tsx`,
   `apps/web/components/primitives.tsx`.

### 4.18 `docs/TRY_IT.md` §2b — D208

1. **Replace the five-step first pass with one instruction** — "open Overview and work The
   loop from the top; the strip at the top of every screen carries the same step, so you can
   start it from wherever you are" — keeping only the two things the loop cannot say: that
   Workboard is first in the rail and why, and that Chart primitives needs no project and
   lives under This machine. *Why:* the doc maintains a second, divergent navigation — its
   step 1 is the rail's step 2, it never mentions Discovery (the step that produces every
   connection it then tells the reader to go and read), and it sends the reader to Chart
   primitives, which has since moved (`TRY_IT.md:190-202`; `Shell.tsx:47-54, 165-178`).
   Deleting a divergence beats documenting one. *Effort:* S. *Files:* `docs/TRY_IT.md`.

---

## 5. Slices

Every item carries files and a one-line acceptance check that `scripts/walk-the-flow.mjs`
(or, where noted, `vitest`) can assert. New walk checks are numbered from **C9** so C1–C8
keep their meaning.

### Slice 1 — one focused day (~8 h). The spine, the fold, and the table.

| # | Item | Files | Acceptance check |
|---|---|---|---|
| 1.1 | **Commit the `ConnectionsTable` header fix already in the working tree** and record it as **D209** in `TASKS.md`: seven `<th>` over eight `<td>` put the correlation under Q-VALUE and the q-value under N on two rail entries. The positional test is in the tree too. | `apps/web/components/views.tsx` (modified), `apps/web/tests/datasearch-and-connections.test.tsx` (modified), `TASKS.md` | **vitest:** for one rendered row, `thead th` and `tbody tr:first-child td` are parallel arrays and `cells[4]` holds the q-value. |
| 1.2 | **Landing hero fits the fold.** Height-aware display clamp, 22ch measure above 1200 px. | `apps/web/app/landing.css:54,242` | **C9:** at 1440×900 and at 1280×720, `.l-cta-row`'s `getBoundingClientRect().bottom` is ≤ the viewport height, and so are the wordmark, h1 and lede. |
| 1.3 | **`lib/loop.ts`**, a verbatim lift; Overview imports it and renders identically. | `apps/web/lib/loop.ts`, `apps/web/components/views.tsx`, `apps/web/tests/loop.test.ts` | **vitest:** `currentStep` on a map with 0 sources returns step 1; on the worked example's map it returns the step the server's recommendation names; and no file outside `lib/loop.ts` contains "Try to destroy what survived". |
| 1.4 | **Rail: five groups, pinned "This machine" footer, 5 px rows, 12 px group margins, bottom fade.** | `apps/web/components/Shell.tsx`, `apps/web/app/globals.css`, `apps/web/tests/shell-nav.test.tsx`, `apps/web/tests/rail-follows-the-work.test.ts` | **C10:** at 1440×900 the `Settings`, `Reports` and `Figures` rail rows are each fully inside the rail's own bounding box, and all 26 rail entries are present in the DOM. |
| 1.5 | **The step strip** on all 23 sections, one 36 px line, above `<main className="workspace">`. | `apps/web/components/Shell.tsx`, `apps/web/app/workspace/page.tsx`, `apps/web/app/globals.css`, `apps/web/tests/step-strip.test.tsx` | **C11:** on every one of the 23 sections at 1440×900, the workspace column's first `.btn-primary` has `bottom <= 900`, and the strip's left half names the same step the Overview card marks `next`. |
| 1.6 | **Connection detail: `RecordFinding` above `Fragility`/`ValidationReports`, plus the actions band** with `Validate ↓`, `Record this as a finding ↓`, and `Draft a report from this` (using `canDraftReport` exported from `reports.tsx`; the ineligible case says why in place). | `apps/web/components/views.tsx`, `apps/web/components/objectactions.tsx` (new), `apps/web/components/reports.tsx`, `apps/web/app/globals.css` | **C12:** on the connection detail at 1440×900, a control whose accessible name matches `/record .*finding/i` is inside the first 900 px; pressing it moves focus into the record form; and a control matching `/report/i` is present whether or not the connection has an `analysis_run_id`. |
| 1.7 | **Overview: loop rows get a destination and the `next` row a verb; the recommendation gets its object button** from `map.top_connections[0]`. | `apps/web/components/views.tsx`, `apps/web/lib/loop.ts`, `apps/web/app/globals.css` | **C13:** on the worked example's Overview, the `next` row contains a `.btn-primary`; pressing the step-4 row lands on a connection detail (an h1 of the form "X and Y"), not the Connections list. |
| 1.8 | **Run the fast loop and the walk.** `vitest` in `apps/web`, `pytest`, then `scripts/walk-the-flow.mjs`; C1–C8 must still pass. **No CI dispatch** — nothing platform-shaped changed. | — | C1–C8 PASS, C9–C13 PASS, 0 FAIL. |

At the end of Slice 1 the product still routes to all 23 sections, no URL has changed
meaning, the landing page has a visible way in at both measured widths, every screen names
the current step and offers it above the fold, the rail keeps Settings and Reports on
screen, and the evidence ledger is correctly headed.

### Slice 2 — the object is the interface (~2 days).

| # | Item | Files | Acceptance check |
|---|---|---|---|
| 2.1 | **One button vocabulary** (`.nj-primary` → `btn btn-primary`, `.ct-dataset` → `btn`, `a.btn { text-decoration: none }`, 42 unclassed buttons classed), plus the lint test. Do this **first in the slice**, before more controls are added. | `apps/web/app/globals.css`, `apps/web/components/*.tsx`, `apps/web/tests/one-button-vocabulary.test.ts` | **vitest:** no file under `components/` contains `nj-primary` or `ct-dataset`, and no `<button>` in `components/` lacks a class. |
| 2.2 | **Board card face is keyboard-openable**, with the honest lede about dragging. | `apps/web/components/board/Board.tsx`, `apps/web/tests/board.test.tsx` | **vitest:** Tab reaches a control whose accessible name is the card's title, and Enter opens `CardDetail`. |
| 2.3 | **`CardDetail` dependents and mentions become `button.pick`** opening via `placeFor`; targets with no home render as text. | `apps/web/components/board/CardDetail.tsx`, `apps/web/components/board/Board.tsx`, `apps/web/app/workspace/page.tsx` | **C14:** opening a card and pressing the first entry under "Built on this" changes the section to the one that shows that kind, and the breadcrumb names the object. |
| 2.4 | **`<ObjectHistory>` extracted** and mounted on finding, source, analysis and card detail. | `apps/web/components/objecthistory.tsx` (new), `apps/web/components/NodeJournal.tsx`, `apps/web/app/workspace/page.tsx`, `apps/web/components/views.tsx`, `apps/web/components/board/CardDetail.tsx` | **vitest:** each of the four detail screens renders a heading matching `/history|versions/i`, and `objectversions.tsx` has exactly one import site. |
| 2.5 | **Finding detail "Take it further"** — `PublishFigure` with `findingId` and the run id from `evidence.analyses[0].id`, and "Draft a report from this finding" from `evidence.connections.find(canDraftReport)`; the missing case says so in place. | `apps/web/app/workspace/page.tsx`, `apps/web/components/views.tsx`, `apps/web/components/publish.tsx`, `apps/web/components/reports.tsx` | **C15:** the worked example's finding detail shows both a figure control and a report control; `grep` shows `findingId` passed by at least one caller. |
| 2.6 | **Source detail: wire `onSelect` and `onImported`** (D205), add the list-row signal for importable tables, and the Variables bridge line. | `apps/web/components/views.tsx`, `apps/web/components/cohorts.tsx`, `apps/web/components/databasetables.tsx` | **vitest:** no `<button>` in `components/` fires an optional callback its only mounting site omits; **C16:** pressing a cohort name scrolls its schema row into view. |
| 2.7 | **Search sources: two named disclosures, openable locators, "Take this passage"** (D203). | `apps/web/components/views.tsx`, `apps/web/components/literature.tsx`, `apps/web/lib/api.ts` | **C17:** the results header contains no bare `ret_evt_` string outside a control, and a control named `/which passages/i` opens a panel listing passages. |
| 2.8 | **Palette: `PAGES` + `href` branch + analyses/reports/figures.** | `apps/web/components/Shell.tsx`, `apps/web/components/CommandPalette.tsx`, `apps/web/app/workspace/page.tsx` | **C18:** typing "air" in ⌘K offers "Draw in the air"; typing an `arun_` id offers the analysis. |
| 2.9 | **Inspector: recommendation always rendered with its object button; model rows renamed** (D204). | `apps/web/app/workspace/page.tsx` | **vitest:** the Inspector renders a `<button>` when a map is present, whether or not something is selected; the strings "Search model" and "Writing model" both appear. |
| 2.10 | **Lifecycle vocabulary unified; `<Term>` added** for the six words (D207 part 1). | `apps/web/components/term.tsx` (new), `apps/web/components/lifecycle.tsx`, `apps/web/components/primitives.tsx`, `apps/web/components/views.tsx`, `apps/web/components/fragility.tsx` | **vitest:** the string "Move to deprecated" appears nowhere; every occurrence of "q-value" on the connections screen is inside a `<Term>` or its caption. |
| 2.11 | **Fragility leads with its sentence.** | `apps/web/components/fragility.tsx` | **vitest:** the first text node inside "How fragile is this?" is a sentence of ≥ 8 words, not a number. |
| 2.12 | **`/gesture-check`: `SpatialControl` above the figures.** | `apps/web/app/gesture-check/page.tsx` | **C19:** at 1440×900 a control named `/try hand gestures/i` is inside the first 900 px. |
| 2.13 | **Gate: equal labelled choices, "Create an account" first.** | `apps/web/app/workspace/page.tsx` | **C20:** on a fresh browser profile, a control named `/create an account/i` is a `.btn-primary`. |

### Slice 3 — the rooms nobody opened (~2 days).

| # | Item | Files | Acceptance check |
|---|---|---|---|
| 3.1 | **Reports: permanent per-block provenance footer; export refusal stated above the row; take-away exports as a named block; staleness readout.** | `apps/web/components/reports.tsx`, `apps/web/components/bibliography.tsx`, `apps/web/lib/api.ts` | **C21:** a report detail shows "citations" and, where applicable, "unverified" without any press; a control named `/results\.csv|snapshot/i` is visible on the Reports screen without opening a report. |
| 3.2 | **Figures: `PublishFigure` first and primary; "Save this view" demoted to text weight.** | `apps/web/components/figures.tsx`, `apps/web/components/publish.tsx` | **vitest:** in `figures.tsx` the `PublishFigure` element appears before the `exportSvg` button, and only the former carries `btn-primary`. |
| 3.3 | **Discovery/Connections: ledger on Discovery, BH caption above the table, ledger boundary sentence, "Register a hypothesis" on Discovery, Deviations drill-down, truncation disclosed** (D201). | `apps/web/app/workspace/page.tsx`, `apps/web/components/views.tsx`, `apps/web/components/ledger.tsx`, `apps/web/components/deviations.tsx`, `apps/web/components/preregister.tsx` | **C22:** the Discovery screen shows a heading matching `/looks|exploration/i` and a control matching `/register a hypothesis/i`; the BH sentence's DOM position precedes the table's. |
| 3.4 | **"Most connected objects" panel** (`graph/centrality`, `graph/communities`) beside the ledger; **"…and everything downstream"** (`graph/reachable`) in `CardDetail`; **"How are these connected?"** (`graph/path`) beside Trace; **`ValidationReports` rows open `graph`-free `GET /api/validations/{report_id}`**; **"Rebuild the graph projection"** in Settings beside the Neo4j readout as a maintenance action. | `apps/web/components/views.tsx`, `apps/web/components/board/CardDetail.tsx`, `apps/web/components/graphstats.tsx` (new), `apps/web/components/settings.tsx`, `apps/web/lib/api.ts` | **pytest:** `tests/test_routes_are_reachable.py` reports **9** unreachable routes, down from 17 — the remaining being `health`, `exploration/tests`, `speech/transcribe`, the Zotero write, `POST /objects`, `workflows/{run_id}`, `POST /reconcile`, and two held for a later slice — with the deliberate ones named in the test's own allowlist. |
| 3.5 | **Notebook: lint labelled and its findings named; dangling links and hubs above the body.** | `apps/web/components/notebook.tsx` | **C23:** the Notebook screen shows a control whose accessible name states what it checks, and its result names at least one of the four finding kinds in words. |
| 3.6 | **Find data "Add to this project"** (D202); **Read a figure offers the table as a source** (D206). | `apps/web/components/datasearch.tsx`, `apps/web/components/readfigure.tsx`, `apps/web/app/workspace/page.tsx` | **C24:** a usable Find data record shows a control matching `/add to this project/i`; the digitise screen shows one matching `/add .*as a (source|dataset)/i` after a read. |
| 3.7 | **Project switcher: "New project" in the topbar; account-menu exception stated in `TASKS.md` and in a code comment.** | `apps/web/components/ProjectMenu.tsx`, `apps/web/components/Shell.tsx` | **C25:** a control matching `/new project/i` is reachable without opening the project menu. |
| 3.8 | **`docs/TRY_IT.md` §2b rewritten** (D208). | `docs/TRY_IT.md` | **vitest** (`tests/docs-match-the-rail.test.ts`): every section name §2b mentions exists in `SECTIONS` or `PAGES`. |
| 3.9 | **Dispatch CI** — Slice 3 is the point at which this work is proposed for `main`. | — | `gh workflow run ci.yml --ref <branch>` then watch; report the result as dispatched, not local. |

---

## 6. What stays as it is, and why

- **The Overview's "The loop" itself** — six steps ticked from real counts, one plain
  sentence of method each, done/next/waiting as a word and not only a colour (§118). This
  plan promotes it; it does not replace it (`views.tsx:46-146`).
- **The address is the place.** `?project=&section=&item=` with `pushState`, `placeFor`'s
  one rule that a thing opens in the section that shows its kind, Escape and the breadcrumb
  closing a detail *by navigation* so Back reopens it, and the invariant that no `placeFor`
  result lands in a section that cannot render the item (`page.tsx:280-303`, D194–D199).
  Every change here inherits it verbatim. **This is also why the `discover`/`connections`
  merge is declined** — it is a good diagnosis, but it changes what two section URLs mean
  two days after this was bought, and §4.10 gets the same integrity fix by moving a panel.
- **Polling only while work is in flight** (`counts.in_flight`, `page.tsx:389-395`). The
  walk measured the meters moving 2/0/0/0/0 → 2/1/6/6/1 in ~15 s with no click.
- **ResultCard's law** — sentence first and always visible, numbers labelled in words,
  disclosure that adds a layer and never removes one (`ResultCard.tsx:1-25`). Fragility is
  changed specifically to obey it.
- **"Open a worked example" offered before the blank form**, with its reason stated
  (`FirstProject.tsx:94-110`). The single best onboarding decision in the product.
- **Empty states that distinguish "nothing was found" from "nobody has looked"** —
  "No critic has run against it yet. That is not the same as it having survived one"
  (`challenges.tsx:106-116`). This honesty is what makes the product credible.
- **Actions placed where their triggering context exists** — a finding from a result
  (`recordfinding.tsx:14-19`), a subset from the schema (`cohorts.tsx`), an alias from a
  dropdown of the project's own variables (`variables.tsx:317-320`). Every exposure in this
  plan is a second door onto an existing room; none is a list-level "+ New".
- **Compare as one screen with eight tabs and Patterns as one with three**
  (`compare.tsx:70-77`), on the shared `ViewTabs` strip with roving tabindex and real
  tabpanel semantics — §30 already paid for.
- **One `VerdictCard`, refusal as a full artifact, "what you can still do" beside every
  negative verdict, three shared loading/empty/failure states** (`Verdict.tsx:6-10`,
  `primitives.tsx:1-5`). Every new refusal in this plan follows it.
- **Deliberate non-alarm styling** for withdrawn sources, contradictions, deviations and
  challenge verdicts, and the placements that are panels rather than nav items:
  `WithdrawnSources` above Sources, `Contradictions` under the Overview meters,
  `ExportedDocuments` above the Reports list, the Exploration Ledger under the candidates it
  qualifies. None is promoted to a rail entry.
- **`Board.tsx`'s real DOM cards, single-transform layout, batched drag persistence and
  soft-delete-with-undo** (`Board.tsx:12-27,127-135`). **No canvas or node library**, on the
  accessibility grounds its own opening comment records (`Board.tsx:19-22`), and no ROADMAP
  Wave 4 rewrite: every defect the audits measured is layout or wiring — a hero that
  outgrows the fold, a control seven blocks down, a rail 200 px too tall, four handlers never
  passed — and none is answered by six to ten weeks touching nearly every component. This
  plan takes the "adopt the shell deliberately" branch and spends the saving on wiring the
  board's card detail, which is what the canvas was wanted for: objects you can follow
  rather than only arrange.
- **Workboard first (§4/§109), the have-it/get-it labels, and Analyses→Connections→Findings
  in the data model's order** (`Shell.tsx:48-54, 64-83, 97-111`). All three keep their
  reasons and their positions; only two group *names* change and one group is split.
- **Chart primitives filed under "This machine", away from Figures** (`Shell.tsx:160-175`).
  Its reason is promoted from a code comment to visible rail text.
- **Append-only notes, restore-forward rather than revert, export blocked while integrity
  reports problems, one resolved artifact behind every export format, §80's rule that only a
  connection with a recorded analysis may start a report, and the theme toggle's three-way
  rationale.** None is relaxed; §80 becomes one shared predicate with two callers.
- **The Zotero write path, deliberately withheld with the reason on screen**
  (`librarynote.tsx:92-97`) — the template for anything held back. **`POST
  /api/projects/{id}/objects`** joins it as a *stated* omission: creating a research object
  from a list is exactly the list-level "+ New" the placement law forbids, so it stays
  uncalled and this document is where that is written down. **The account menu's three
  behind-menu items** are the third stated exception: they are properties of the session,
  not of a research object.
- **`GET /api/health`, `POST /api/projects/{id}/exploration/tests` and `POST
  /api/speech/transcribe`** stay uncalled by design, as inventory §3 already records.

---

## 7. Risks and mitigations

1. **The step strip becomes chrome nobody sees.** A band in the same pixels on every screen
   is the shape of a thing readers learn to skip. *Mitigation:* it changes text on every
   navigation, it carries the screen's only `btn-primary`, it is capped at one 36 px line,
   and C11 makes the claim testable. Add a before/after run of C11 so the ~4 % of workspace
   height it costs on screens that were already fine is visible rather than assumed. If the
   number of presses from Overview to a recorded finding does not fall, the strip has not
   earned its height.
2. **The rail still scrolls, and three rows are Notebook, Journal and Activity.** This is
   arithmetic, not a choice: 26 readable rows do not fit 848 px. *Mitigation:* the fade makes
   the scroll visible, C10 pins Reports, Figures and Settings inside the box, and the
   position is argued rather than hidden — a scrolling nav with a visible edge is a normal
   affordance; a menu is not. If the owner would rather have all 26 on screen, the only
   honest lever left is a denser row (4 px padding, ~28 px), which is an open question in §8.
3. **A client-side loop drifts from the server's recommendation.** *Mitigation:*
   `lib/loop.ts` computes only booleans from `DiscoveryMap` counts the server already sent —
   exactly what `Overview` does inline today — and takes every sentence verbatim from
   `map.recommended_next_action`. The boundary is stated in the module header, because the
   next session will otherwise widen it.
4. **Marking a current step is a claim that can be wrong.** A project working in two places
   at once will see one step named. *Mitigation:* `currentStep` defers to the server's
   recommendation rather than `steps.find(s => !s.done)`; the loop card says the steps may be
   taken out of order; no rail entry is ever dimmed or disabled.
5. **Scroll-to-focus links degrade into duplicate controls under later edits.** The pressure
   to "just put the button here too" arrives the first time somebody finds the scroll
   annoying. *Mitigation:* `objectactions.tsx` carries a contract in its header — *it either
   performs the action or scrolls to and focuses the real control, and never renders a form*
   — with §123 named, and the vitest in 2.6 fails on a second form.
6. **Two new entrances to `/artifacts/draft` can produce duplicate drafts.**
   *Mitigation:* one shared `canDraftReport` predicate exported from `reports.tsx`, and both
   entrances show "Drafted — open it" when an artifact for that connection already exists.
   If §80 is ever relaxed it is relaxed on the server, once.
7. **Making `CardDetail` the board's hub widens the §30 gap** if the card face stays
   pointer-only. *Mitigation:* 2.2 lands **in the same slice as** 2.3 and 2.4, sized M rather
   than S because it sits inside the pointer-down drag machinery, and it declines to claim
   drag parity it has not built.
8. **The graph panels depend on the Neo4j projection, and the projection rebuild is
   itself an orphan route.** *Mitigation:* every new graph control states a reduced feature
   set where Neo4j is absent (ADR 0002, `settings.tsx:980-1000`) rather than failing or
   vanishing, and "Rebuild the graph projection" lands in Settings beside the capability
   readout in the same slice (3.4), framed as housekeeping, not research.
9. **Regrouping the rail invalidates muscle memory and two test files.** *Mitigation:*
   `shell-nav.test.tsx` and `rail-follows-the-work.test.ts` are edited in the same commit;
   every id, label, count and within-group order is unchanged, so no URL, saved link or ⌘K
   result changes — but a researcher who knows "Overview is under Research" will look in the
   wrong eyebrow once.
10. **Exposing more controls before the button vocabulary is unified makes the exposure read
    as clutter.** *Mitigation:* 2.1 is the first item of Slice 2, before any further control
    lands. Slice 1's four new controls are the exception and are written as `btn`/`btn-primary`
    from the start.
11. **Sixteen exposures are cheap wiring, and cheap work ships without the test that stops it
    regressing** — the pattern that produced two dozen callerless capabilities in this
    codebase. *Mitigation:* every exposure slice extends `tests/test_routes_are_reachable.py`
    or a vitest guard in the same commit; 3.4's acceptance check is a route count, not a
    screenshot.
12. **This is a lot of small slices, and small slices are how a house style drifts.**
    *Mitigation:* the three slices are each a single branch with a single ledger row, each
    ending on the fast loop, and only Slice 3 dispatches CI.

---

## 8. Open questions for the product owner

Four, and each changes the work materially.

1. **The rail at 900 px: density or scroll?** Slice 1 leaves ~3 rows (Notebook, Journal,
   Activity) below the fold in a nav that visibly scrolls. Dropping `.rail-item` padding to
   4 px (a ~28 px row) would fit all 26 on a 1440×900 laptop, at the cost of a tighter
   pointer target and a denser rail. **Do you want all 26 rows on screen at 900 px, or a
   comfortable row height and a visible scroll?** If the answer is "all 26", say so before
   1.4 lands, because the metric is one line of CSS and re-tuning it afterwards means
   re-measuring C10.
2. **Discovery and Connections: two entries or one?** They render the same table over the
   same endpoint and differ only in a silent row cap and which panels attach. This plan keeps
   two and moves the panel, because merging changes what two URLs mean two days after
   D194–D199. **If you would accept the URL change, the merge is the cleaner screen** — one
   destination, sweep above and everything tested below — and it costs about a day plus a
   normalisation guard. Say now, because Slice 3.3 is written for the two-entry version.
3. **The account menu's three items** (identity readout, local-only reassurance, sign out)
   are behind a menu, which the brief forbids. This plan argues them as a stated exception:
   they are properties of the session rather than of a research object, and a persistent
   sign-out is a hazard, not a capability. **Accept the exception, or should sign-out become
   a visible topbar control?**
4. **`POST /api/projects/{id}/objects`** — creating a research object directly — is the one
   built route this plan deliberately leaves uncalled, because placing it would be exactly
   the list-level "+ New" that `recordfinding.tsx:14-19` and `cohorts.tsx` forbid.
   **Confirm it stays withheld and stated**, or name the triggering context it should hang
   off, and it goes in Slice 3.
