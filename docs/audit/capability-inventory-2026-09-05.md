# Capability inventory — 2026-09-05

A dated snapshot, in the spirit of `docs/AUDIT.md`: every screen of the workspace, every capability a
researcher can exercise on it and how it is reached (visible, behind a toggle, menu, mode, detail, palette
or URL, or unreachable), the API routes the interface never calls, and the recorded design decisions a
redesign must respect. Produced for T135 by ten readers over the code, a completeness critic and a writer;
it is the evidence base `THE_LOOP_IS_THE_SHELL.md` cites by section. It describes the tree at commit
f85927c and will go stale the way every audit does — treat it as a record of that day, not of today.

---

# Interface Capability Inventory — Evidence Base for Design Panel

Sources merged: three group inventories (shell/nav; landing+gate+machine pages; overview/sources/search/variables; discover/connections/preregister/findings; connections-detail/analyses/findings-detail; workboard; compare/patterns/runanalysis; literature) + one reachability audit (`tests/test_routes_are_reachable.py`) + one critic pass. Every `(critic)` tag marks an addition or correction the critic made to the base inventories; everything else is from the original group inventories. `file:line` citations are preserved verbatim from source.

---

## 1. Screen Table

| # | Screen id | Label | Purpose (short) | # Capabilities | Visible | Hidden (by class) | Dead end? |
|---|-----------|-------|------------------|----------------|---------|--------------------|-----------|
| 1 | shell/rail-topbar | Application shell | Navigate every screen; live progress counts | 32 | 32 | 0 | No |
| 2 | command-palette | Command palette (⌘K) | Jump by name to any section/object | 13 | 13 | 0 (indexes 23 sections, critic) | No |
| 3 | project-switcher | Project switcher | Switch/create/delete projects | 8 | 2 | 6 behind_menu | No |
| 4 | account-menu | Account menu | Confirm identity, sign out | 4 | 1 | 3 behind_menu | Yes |
| 5 | inspector | Context inspector | Context-sensitive help + install caps | 6 | 5 | 1 detail_only | Yes |
| 6 | theme-toggle | Theme toggle | Light/dark/system | 4 | 4 | 0 | Yes |
| 7 | drag-drop-upload | Drag-and-drop upload | Add sources by drag | 4 | 4 | 0 | No |
| 8 | keyboard-shortcuts | Global keyboard shortcuts | Mouse-free operation | 7 | 7 | 0 | No |
| 9 | / (landing) | Landing page | Orientation + entry | 11 | 11 | 0 | No |
| 10 | /workspace (Gate) | Sign-in / setup | Account creation & sign-in | 8 | 6 | 2 behind_mode | No |
| 11 | /workspace (FirstProject) | First project screen | Worked example or own question | 5 | 5 | 0 | No |
| 12 | /workspace (NewProject) | New project form | Question intake | 6 | 6 | 0 | No |
| 13 | /charts-3d | Spatial charts | Prove every 3D primitive renders | 3 | 3 (CatalogueBrowser is interactive — critic) | 0 | Yes |
| 14 | /gesture-check | Check hand tracking | Verify tracking works | 11 | 8 (critic: 3 relocated) | 3 behind_mode (critic; actually live in SpatialControl.tsx) | Yes |
| 15 | /air-ink | Draw in the air | Mid-air ink/selection/voice test | 13 | 13 (critic: 2 reclassified from hidden) | 0 (critic) | Yes |
| 16 | workspace/Shell:MachinePages-nav | "This machine" nav group | Cross-cutting nav note | 3 | 3 | 0 | Yes |
| 17 | overview | Overview | State at a glance + next step | 12 | 12 | 0 | No |
| 18 | sources | Sources | Ingested files + add more | 13 | 13 | 0 | No |
| 19 | sources/detail | Source detail | What ingestion extracted | 14 | 0 | 11 detail_only, 2 behind_mode, 1 unreachable | No |
| 20 | search | Search sources | Query ingested passages | 6 | 6 | 0 | Yes |
| 21 | variables | Variables | Approve labels/aliases | 10 | 8 | 2 behind_mode | No |
| 22 | discover | Discovery | Run a sweep, read connections | 15 | 12 | 2 behind_toggle, 1 url_only | No |
| 23 | connections | Connections | Ledger, deviations, pre-reg | 17 | 13 | 4 behind_toggle | No |
| 24 | preregister | Register a hypothesis | Pre-registration form | 11 | 1 | 10 behind_toggle | No |
| 25 | findings | Findings | List + lifecycle counts | 4 | 4 | 0 | No |
| 26 | findings/detail | Finding detail (evidence graph) | Why a finding is believed | 21 | 15 | 4 behind_toggle, 1 behind_mode, 1 detail_only | No |
| 27 | connections/connection-detail | Connection detail | Validate + record a finding | 14 | 10 | 4 behind_toggle | No |
| 28 | analyses | Analysis list | Every recorded run | 5 | 5 | 0 | No |
| 29 | analyses/analysis-detail | Analysis detail | Full statistical result | 6 | 6 | 0 | No |
| 30 | analyses/analysis-detail#plain-reading | Plain reading | Model summary of a run | 3 | 3 | 0 | Yes |
| 31 | analyses/analysis-detail#forks | Forks / sensitivity | Branch + compare variants | 7 | 5 | 2 behind_toggle | No |
| 32 | findings/finding-detail#provenance-log | Provenance log / script | Download reproducibility artifacts | 2 | 2 | 0 | Yes |
| 33 | findings/finding-detail#standing | Finding standing / lifecycle | Promote/demote a finding | 9 | 7 | 1 behind_toggle, 1 behind_mode | No |
| 34 | findings/finding-detail#challenges | Challenges (adversarial critic) | Run critic against a finding | 6 | 6 | 0 | No |
| 35 | findings/finding-detail#library-note | Library note preview | Preview Zotero note | 3 | 0 (critic: all 3 gated) | 3 behind_toggle (critic) | Yes |
| 36 | board | Workboard | Spatial arrangement of objects | 31 | 22 (critic: 3 reclassified) | 5 behind_toggle, 4 behind_mode (critic) | No |
| 37 | board/card-detail | Card Detail | One object in isolation: impact + mentions | 6 | 0 | 6 detail_only | Yes (critic corrects false→true) |
| 38 | compare | Compare (shell + Dataset↔dataset) | Are two datasets comparable | 6 | 6 | 0 | No |
| 39 | compare/claim | Compare — Paper↔dataset (Claim test) | Test a claim against data | 8 | 6 | 1 behind_toggle, 1 detail_only | No |
| 40 | compare/papers | Compare — Paper↔paper (Reconcile) | Are two papers even comparable | 7 | 7 | 0 | No |
| 41 | compare/many | Compare — Several papers (Synthesis) | Quoted-evidence matrix, 3+ papers | 12 | 12 | 0 | No |
| 42 | compare/manydata | Compare — Several datasets | Pooling ceiling across a set | 7 | 7 | 0 | No |
| 43 | compare/images | Compare — Figures | Image reuse / rescale / rotation | 8 | 8 | 0 | No |
| 44 | compare/findings | Compare — Finding↔finding (Consistency) | Which results disagree | 7 | 7 | 0 | No |
| 45 | compare/scans | Compare — Scan↔scan (CaseCompare) | Imaging comparability | 17 | 15 | 2 behind_toggle | No |
| 46 | patterns | Patterns (Across the project) | Shape of every result together | 9 | 9 | 0 | No |
| 47 | patterns/robustness | Patterns — Would it survive? (Spec curve) | Estimate spread across specs | 9 | 7 | 1 behind_mode, 1 behind_toggle | No |
| 48 | patterns/believable | Patterns — Worth believing? (Diagnostics) | Volcano/QQ/funnel plots | 4 | 3 | 1 behind_mode | Yes |
| 49 | runanalysis | Specify an analysis | Hand-specify + run an analysis | 13 | 11 | 1 behind_mode, 1 behind_toggle | No |
| 50 | literature | Find papers | Multi-database search + PaperReader | 29 | 13 | 2 behind_toggle, 11 detail_only, 3 behind_mode | No |
| 51 | literature/harvest | Harvest a repository | Bulk OAI-PMH listing | 9 (source truncated) | 6 | 3 detail_only | Unknown (source cut off) |
| — | **(critic-added, no base entry)** Reports | Reports | Draft/export project reports | 12+ | mostly detail_only | most detail_only | No |
| — | **(critic-added)** Figures | Figures | Chart the project's own data | 15+ | mixed | several behind_mode/detail_only | No |
| — | **(critic-added)** Publish (figure) | Publish a figure | Server-side figure publication | 4 | detail_only | detail_only (nested inside Figures) | No |
| — | **(critic-added)** SavedFigures | Saved figures | Edit title/caption, re-run critic | 3 | detail_only | detail_only | No |
| — | **(critic-added)** Bibliography/Exports | Take-away exports | results.csv / snapshot.zip / .bib | 3 | detail_only | detail_only (nested inside Reports) | No |
| — | **(critic-added)** Notebook | Notebook | Wikilinks, lint, hubs, backlinks | 10+ | mixed | several behind_toggle | No |
| — | **(critic-added)** Settings | Settings | Password/people/packs/model/version | 10+ | mixed | several behind_toggle | Yes |
| — | **(critic-added)** DataSearch | Find data | Dataset-repository search | 2 | visible | none | Yes |
| — | **(critic-added)** Read a figure | Read a figure (digitise) | Recover data from a chart image | 6 | mixed | attestation-gated | Yes |
| — | **(critic-added)** Research graph | Research graph | Canvas graph + node journal + versions | 8+ | mixed | several detail_only | mixed |
| — | **(critic-added)** Chart primitives (Gallery) | Chart primitives | Every 2D primitive incl. 2 refusals | 3+ | visible | none | Yes |
| — | **(critic-added)** SpatialControl panel | Hand-tracking control panel | Consent, calibrate, pause, sensitivity | 11 | mixed | mostly behind_mode (gated on camera running) | n/a (embedded control) |

*Screen count: 51 base screens (1 with source data truncated) + 12 screens/sub-panels identified by the critic as entirely missing from the base inventories. Capability counts for critic-added screens are drawn from the citations given, not independently re-derived line-by-line at the same granularity as the base groups.*

---

## 2. Per-Screen Capability Detail

Format per screen: capability — how_reached — evidence — note (only where the source gave one). Next steps offered and friction follow each screen.

### 1. shell/rail-topbar — Application shell (rail, topbar, breadcrumbs)
Purpose: Navigate between every research screen/project; live progress counts.

| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Open Workboard | visible | Shell.tsx:54 | Deliberately first — §4/§109 call it "the central operating surface"; never built before, so objects "lived in a list and never in a place" (Shell.tsx:48-54) |
| Open Overview | visible | Shell.tsx:55 | |
| Open Sources (live count badge) | visible | Shell.tsx:56,405-407 | |
| Open Variables | visible | Shell.tsx:63 | Reuses Sources icon on purpose (Shell.tsx:230-232) |
| Open Search sources | visible | Shell.tsx:73 | Named for have-it/get-it distinction (Shell.tsx:64-72) |
| Open Find papers | visible | Shell.tsx:74 | |
| Open Find data | visible | Shell.tsx:75 | |
| Open Read a figure | visible | Shell.tsx:83 | "the opposite" of Figures (Shell.tsx:76-82) |
| Open Discovery | visible | Shell.tsx:94 | Renamed from "Discovery map" (Shell.tsx:89-93) |
| Open Compare | visible | Shell.tsx:95 | |
| Open Patterns | visible | Shell.tsx:96 | |
| Open Analyses (count) | visible | Shell.tsx:112 | |
| Open Connections (count) | visible | Shell.tsx:113 | Ordered Analyses→Connections→Findings to match the data model (Shell.tsx:97-111) |
| Open Findings (count) | visible | Shell.tsx:114 | |
| Open Research graph | visible | Shell.tsx:125 | Renamed from "Evidence graph" to avoid collision (Shell.tsx:115-124) |
| Open Embedding space | visible | Shell.tsx:126 | |
| Open Reports (count) | visible | Shell.tsx:132 | |
| Open Figures (count) | visible | Shell.tsx:133 | |
| Open Notebook | visible | Shell.tsx:134 | |
| Open Journal | visible | Shell.tsx:142 | "everything written… including what a model wrote" (Shell.tsx:135-141) |
| Open Activity | visible | Shell.tsx:154 | Exists because audit_log had "nine writers and no readers" (Shell.tsx:143-153) |
| Open Chart primitives | visible | Shell.tsx:176 | Filed under "This machine", away from Figures (Shell.tsx:160-175) |
| Open Settings | visible | Shell.tsx:177 | |
| Open Spatial charts (/charts-3d) | visible | Shell.tsx:206-207,414-422 | Previously URL-only (Shell.tsx:182-203) |
| Open Check hand tracking (/gesture-check) | visible | Shell.tsx:208-209 | |
| Open Draw in the air (/air-ink) | visible | Shell.tsx:210-211 | |
| Resize rail panel | visible | Shell.tsx:432 | |
| Resize inspector panel | visible | Shell.tsx:450 | Only rendered above 1101px (Shell.tsx:440-457) |
| Click project-root breadcrumb | visible | Shell.tsx:358-360 | |
| Click ancestor breadcrumb (leave detail view) | visible | Shell.tsx:361-368 | |
| Open command bar via "Jump to anything" | visible | Shell.tsx:370-373 | |
| See live rail counts | visible | Shell.tsx:305-312,405-407 | |

Next steps offered: Add sources; Profile variables; Discover connections; Validate findings; Record a finding; Communicate.
Dead end: No.
Friction: TRY_IT.md:190-202's first pass predates Workboard being first (Shell.tsx:48-54); "q-value"/"lifecycle_status" unglossed (workspace/page.tsx:823; CommandPalette.tsx:327,334); inspector vanishes below 1100px (Shell.tsx:440-457); the 3 "This machine" links are plain `<a>` visually identical to rail buttons but leave the resizable layout (Shell.tsx:414-422).

### 2. command-palette — Command palette (⌘K)
Purpose: Jump by name to any section, source, connection, or finding.

| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Open via ⌘K/Ctrl+K | visible | page.tsx:456-465 | |
| Open via "Jump to anything" | visible | Shell.tsx:370-373 | |
| Fuzzy subsequence search | visible | CommandPalette.tsx:34-63,249-258 | |
| Move highlight (arrows / Ctrl+p/n) | visible | CommandPalette.tsx:157-165 | |
| Open highlighted (Enter) | visible | CommandPalette.tsx:167-181 | |
| Open by click | visible | CommandPalette.tsx:266-283 | |
| Close (Escape) | visible | CommandPalette.tsx:131-137 | |
| Close (backdrop click) | visible | CommandPalette.tsx:246 | |
| Jump to **23** rail sections by label | visible | CommandPalette.tsx:308-309; Shell.tsx:215 | **(critic)** base inventory said 20; `GROUPS.flatMap` over Shell.tsx produces 23 (`grep -c '{ id: "'` confirms), passed whole to `buildCommands` (page.tsx:552) |
| Jump to a source by title (row/page count, ingestion status hint) | visible | CommandPalette.tsx:311-320 | |
| Jump to a connection by variable pair (lifecycle hint) | visible | CommandPalette.tsx:322-329 | |
| Jump to a finding by title (lifecycle hint) | visible | CommandPalette.tsx:330-336 | |
| Disclaimer: NL queries unsupported without a model provider | visible | CommandPalette.tsx:288 | "That needs a model, and there isn't one configured, so this does not pretend to." (CommandPalette.tsx:3-14) |

Next steps offered: Jump directly to any stage/object.
Dead end: No.
Friction: Analyses and Reports/Figures never indexed into the palette (page.tsx:550-558); NL disclaimer only visible in the footer, not told upfront.

### 3. project-switcher
Purpose: See/switch/create/delete projects.

| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| See current project name in trigger | visible | ProjectMenu.tsx:141-149 | |
| Open project list | visible | ProjectMenu.tsx:139-161 | |
| See name + truncated question preview | behind_menu | ProjectMenu.tsx:181-187 | |
| See tick on current project | behind_menu | ProjectMenu.tsx:178-180 | Current project is `menuitemradio`, not `menuitem` (ProjectMenu.tsx:41-43) |
| Switch to another project | behind_menu | ProjectMenu.tsx:166-170 | |
| Delete a project | behind_menu | ProjectMenu.tsx:196-211 | |
| Itemized typed-confirmation delete dialog | behind_menu | ProjectMenu.tsx:227-258 | Counts are shown before asking (ProjectMenu.tsx:17-19) |
| Create a new project | behind_menu | ProjectMenu.tsx:218-221 | |

Next steps offered: Switch project; start a new project.
Dead end: No.
Friction: Delete is one icon-only trash button in a switching menu; deletion is deliberately non-optimistic, producing a visible confirm-to-disappear delay (ProjectMenu.tsx:11-16,121-135).

### 4. account-menu
Purpose: Confirm identity, sign out.

| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Open via avatar trigger | visible | AccountMenu.tsx:70-77 | |
| See name/email + admin badge | behind_menu | AccountMenu.tsx:83-90 | |
| See local-only reassurance | behind_menu | AccountMenu.tsx:92-96 | |
| Sign out | behind_menu | AccountMenu.tsx:104-108 | Full document navigation even on failed logout call — "local session should end regardless" (AccountMenu.tsx:6-20,53-65) |

Next steps offered: none. Dead end: Yes.
Friction: Sign-out lands back at /workspace (the sign-in gate) with no distinct confirmation (AccountMenu.tsx:53-65).

### 5. inspector — Context inspector (right panel)
Purpose: Context-sensitive help + installation capabilities.

| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| See "Context" heading | visible | page.tsx:856 | |
| Explanation of a connection / Validate | detail_only | page.tsx:857-862 | Only for `selection.kind === "connection"` |
| Recommended next action (no selection) | visible | page.tsx:863-865 | **(critic-verified)** confirmed: entire Inspector function contains zero onClick/Link/button — plain `<p>` |
| Installation capabilities (search mode, model, sandbox, methods, AI provider) | visible | page.tsx:867-882 | |
| Note when no AI provider configured | visible | page.tsx:883-885 | |
| Server retrieval note | visible | page.tsx:886 | |

Next steps offered: none. Dead end: Yes (critic-verified).
Friction: `recommended_next_action` names the step but has no control to take it; contextual note exists only for connections; hidden entirely below 1100px.

### 6. theme-toggle
| Capability | how_reached | Evidence |
|---|---|---|
| Match this machine (system) | visible | Theme.tsx:79-93 |
| Force light | visible | Theme.tsx:79-93 |
| Force dark | visible | Theme.tsx:79-93 |
| Choice persists (localStorage) | visible | Theme.tsx:69-74 |

Next steps: none. Dead end: Yes.
Friction: The three-way rationale ("exports always render light regardless of app theme") lives only in a code comment (Theme.tsx:6-16), not on screen.

### 7. drag-drop-upload
| Capability | how_reached | Evidence |
|---|---|---|
| Drag files to trigger overlay | visible | Shell.tsx:326-342,460-467 |
| See accepted formats on overlay | visible | Shell.tsx:463-464 |
| Drop to upload (`POST /api/projects/{id}/sources`) | visible | Shell.tsx:337-342; upload() at page.tsx:479-495 |
| Auto-navigate to Sources on drop | visible | page.tsx:483 |

Next steps offered: Add sources. Dead end: No.
Friction: Drop target is the whole shell regardless of section, silently redirecting to Sources (page.tsx:483); requires an active project, silently no-ops otherwise (page.tsx:480).

### 8. keyboard-shortcuts
| Capability | how_reached | Evidence |
|---|---|---|
| ⌘K/Ctrl+K opens palette anywhere | visible | page.tsx:456-465 |
| Escape closes detail view | visible | page.tsx:467-474 |
| Arrow/Ctrl-p/n move palette highlight | visible | CommandPalette.tsx:157-165 |
| Enter opens highlighted result | visible | CommandPalette.tsx:167-181 |
| Escape closes palette | visible | CommandPalette.tsx:131-137 |
| Typing captured even without input focus | visible | CommandPalette.tsx:184-199 |

Next steps offered: Navigate anywhere (⌘K); back out (Escape). Dead end: No.
Friction: No on-screen shortcut list beyond the palette's own footer hint (CommandPalette.tsx:287); Escape-to-back never advertised. **(critic)** Additionally, every `ViewTabs` strip across Compare/Patterns/Notebook/Notegraph answers ArrowLeft/Right/Home/End with roving tabindex and real tabpanel semantics — not recorded anywhere in this screen's inventory (ViewTabs.tsx:68-135, header at 1-34: "declared role=\"tablist\" and answered no arrow key").

### 9. / (landing)
Purpose: Orientation for a visitor; state what the system does/doesn't do.

| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| "Open the workspace →" hero CTA | visible | page.tsx:213-215 | |
| "See how it works" anchor scroll | visible | page.tsx:216 | |
| The loop: 5 pipeline stages | visible | page.tsx:23-29,227-248 | Informational only |
| Correction table (4-row real run) | visible | page.tsx:32-37,258-292 | Static demo data; "q (corrected)" unexplained beyond one sentence |
| Provenance chain | visible | page.tsx:309-315 | |
| "What the system can do today" ledger | visible | page.tsx:39-49,330-337 | |
| "What it cannot do yet" ledger | visible | page.tsx:60-80,350-357 | Generated from DESIGNED/PRIMITIVES registry so it can't stale; "Understating is the same defect as overstating" |
| ClaimTestBeat / PrimitiveBeat scroll sections | visible | page.tsx:16,362,364 | |
| Second "Open the workspace →" CTA | visible | page.tsx:376-378 | |
| Parallax depth-layer motion | visible | page.tsx:87-133 | Decorative |
| Scroll-triggered reveal animation | visible | page.tsx:137-170 | |

Next steps offered: Open the workspace (×2); read pipeline first. Dead end: No.
Friction: "q (corrected)"/"q-value" unglossed; two identical CTAs give no hint of branching (sign-in vs straight to project).

### 10. /workspace (Gate) — sign-in / setup
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Name field (creation only) | behind_mode | page.tsx:155-161 | Only when `creating` true |
| Email field | visible | page.tsx:162-167 | |
| Password field (minLength 12 create / 1 else) | visible | page.tsx:168-174 | Hint shown only when creating |
| Submit ("Create account…" / "Sign in") | visible | page.tsx:178-181 | |
| Mode toggle | behind_mode | page.tsx:186-196 | "Not shown during first-run setup: nothing to switch to until an account exists" |
| Error message | visible | page.tsx:176,119 | |
| "← Back" to landing | visible | page.tsx:198 | |
| Static reassurance copy | visible | page.tsx:126-132 | |

Next steps offered: Sign in / create account into workspace. Dead end: No.
Friction: Three real modes share one screen distinguished by a toggle hidden in first-run mode; password minLength silently differs (12 vs 1) with no visible indicator.

### 11. /workspace (FirstProject)
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| "Open a worked example" | visible | FirstProject.tsx:94-100 | Idempotent per account; offered first deliberately — a blank form "is the highest-effort possible first action" |
| "Start with your own question" | visible | FirstProject.tsx:101-104 | Switches local state to show NewProject |
| Error on example-creation failure | visible | FirstProject.tsx:106 | "§104 — say what failed" |
| Explanatory note (example is a real project) | visible | FirstProject.tsx:107-110 | |
| 3-step pipeline explainer | visible | FirstProject.tsx:112-128 | |

Next steps offered: Open worked example; start new-question project. Dead end: No.
Friction: No indication of how long "Building the example…" takes, or that ingestion is still running when the workspace opens.

### 12. /workspace (NewProject form)
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Research question textarea | visible | FirstProject.tsx:177-182 | |
| Project name field (optional) | visible | FirstProject.tsx:183-184,156 | |
| "Create project" submit | visible | FirstProject.tsx:187-191 | `POST /api/projects` |
| "Cancel" | visible | FirstProject.tsx:192-196 | Only when `onCancel` passed |
| "Open the worked example" secondary | visible | FirstProject.tsx:197-203 | Only via `offerExample` prop — reached from project-switcher path only |
| Error on create failure | visible | FirstProject.tsx:185 | |

Next steps offered: Create project; open worked example instead. Dead end: No.
Friction: Whether "Open the worked example" appears depends on which screen led here, invisibly.

### 13. /charts-3d — Spatial charts
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Full chart catalogue (network/field/voxel/lines/isosurface/bars/globe) | visible | charts-3d/page.tsx:26-33,42-52 | "A renderer nobody can open is indistinguishable from one that was never written" |
| One hand control operating whichever chart's rectangle the hand occupies | visible | charts-3d/page.tsx:15-19 | §189: answered by rectangle occupancy, not mount order |
| CatalogueBrowser (registry browser) | visible | charts-3d/page.tsx:36-44 | **(critic)** base inventory treated this as one static readout; it is actually interactive: a family `<select>` filter (CatalogueBrowser.tsx:99-118) plus a per-entry draw `<button>` (CatalogueBrowser.tsx:131) |

Next steps offered: none. Dead end: Yes.
Friction: A first-time researcher may not realize this is disconnected from their own project data.

### 14. /gesture-check — Check hand tracking
Purpose: Verify hand tracking works on this machine.

| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Live numeric telemetry (fps, gesture counts, tracker state) | visible | gesture-check/page.tsx:29-31,33-38 | |
| State/verdict banner (waiting/bad/recovering) | visible | gesture-check/page.tsx:113-138 | |
| Synthetic 3D scatter (Volume chart) | visible | gesture-check/page.tsx:29,45-63 | |
| Synthetic saddle surface | visible | gesture-check/page.tsx:30,65-75 | |
| 6 written judgment questions | visible | gesture-check/page.tsx:88-105 | |
| No account/project reached | visible | gesture-check/page.tsx:15-19 | |
| Back/nav link | visible | gesture-check/page.tsx:31 | |
| "Try hand gestures"/"Turn on the camera" | **behind_mode (critic)** | SpatialControl.tsx:621-625,709-716,722-745 | **(critic correction)** base inventory cited page.tsx:132-134 as the control itself; those lines are actually `verdictFor()` copy naming the buttons. Real controls are a 3-step gated sequence in SpatialControl.tsx, not this page |
| "Calibrate" | **behind_mode (critic)** | SpatialControl.tsx:820-826 | **(critic correction)** base inventory cited page.tsx:96-98, which is actually the `CHECKS` string array, not a control. Only renders once camera running and not already calibrating |
| "Hand outline" toggle | **behind_mode (critic)** | SpatialControl.tsx:852-866 | **(critic correction)** base inventory cited docs/TRY_IT.md with location "not confirmed"; it's a checkbox rendered only while camera runs, in SpatialControl not this page. "gesture-check/page.tsx contains exactly one `<button` in 488 lines" (the haptics tap, see below) |
| Haptics self-test: "Tap the trackpad" | visible | gesture-check/page.tsx:438-462 | **(critic-added)** `POST /api/haptics/tap`; explicit "no haptic actuator this program can reach" branch — the only literal `<button>` on this page |

Next steps offered: none. Dead end: Yes.
Friction: TRY_IT.md frames the typed URL as primary entry though it's now nav-linked; the SAME control also lives inside the real workspace (Chart primitives P13, Embedding space) per TRY_IT.md, unstated on screen. **(critic)** Every group that documented hand-tracking controls attributed them to this file when 11 controls (offer/consent, pause/resume, turn off, calibrate, reset view, sensitivity sliders, camera preview/hand outline, feedback channels, device select) actually live in SpatialControl.tsx:615-931 (see §7 Constraints and the Research-graph/SpatialControl critic-added screen).

### 15. /air-ink — Draw in the air
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| InkLayer/InkSurface (draw strokes) | visible | air-ink/page.tsx:27 | |
| Stroke tools + stabilisation control | visible | air-ink/page.tsx:44,56-58 | |
| Straightedge tool | **visible (critic)** | air-ink/page.tsx:473-490 | **(critic correction)** base inventory called this `behind_mode`; it is an always-rendered labelled row of option buttons in the same unconditional toolbar as the tool/stabilisation pickers (line 483-484) |
| Eraser (fixed radius) | visible | air-ink/page.tsx:45 | |
| Selection within a closed stroke | visible | air-ink/page.tsx:34,38 | |
| Measurement between two points | visible | air-ink/page.tsx:49 | |
| Shape recognition | visible | air-ink/page.tsx:43 | |
| Multiple annotation layers | **visible (critic)** | air-ink/page.tsx:752-772,688-702 | **(critic correction)** base inventory called this `behind_menu`; it's a plain always-rendered list of layer checkboxes ("Show layers" fallback line when nothing drawn) — no menu exists. Colour row is 4 unconditional buttons ("four colours rather than a picker") |
| Voice: scripted speech, deixis, intent | visible | air-ink/page.tsx:53-55 | Scripted, not live mic |
| Reference timeline | visible | air-ink/page.tsx:36 | |
| Selection context description | visible | air-ink/page.tsx:35 | |
| Same two synthetic figures as /gesture-check | visible | air-ink/page.tsx:60-77 | Deliberately reused so a mis-resolution is visible |
| No account, no project | visible | air-ink/page.tsx:19-20 | |

Next steps offered: none. Dead end: Yes.
Friction: Jargon ("deixis", "stabilisation level") ungl­ossed.

### 16. workspace/Shell:MachinePages-nav
| Capability | how_reached | Evidence |
|---|---|---|
| "Spatial charts" link → /charts-3d | visible | Shell.tsx:206-207,414 |
| "Check hand tracking" link → /gesture-check | visible | Shell.tsx:208-209,414 |
| "Draw in the air" link → /air-ink | visible | Shell.tsx:210-211,414 |

Next steps offered: none. Dead end: Yes.
Friction: Despite gesture-check/air-ink claiming "no account, no project", the in-product path to all three sits inside the authenticated shell — only a typed URL skips the Gate.

### 17. overview
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Project name and research question | visible | views.tsx:110-113 | |
| Readout strip (6 counts) | visible | views.tsx:120-127 | One strip, not six cards — "the dashboard reflex this deliberately avoids" |
| "The loop" checklist (6 clickable steps) | visible | views.tsx:54-146 | |
| Done/next/waiting shown as a word | visible | views.tsx:140-143 | |
| Server's recommended-next-action sentence | visible | views.tsx:148-150 | |
| Connections by lifecycle state | visible | views.tsx:153,159-179 | |
| Findings by lifecycle state | visible | views.tsx:154,159-179 | |
| "Compare results now" (contradiction sweep) | visible | contradictions.tsx:97-99; page.tsx:595-606 | "a meter a reader cannot click through to is a number they have to take on trust" |
| List of contradictions | visible | contradictions.tsx:104 | |
| Ranked explanations (examined vs not) | visible | contradictions.tsx:114-150 | Kept split deliberately |
| Close a contradiction (required reason) | visible | contradictions.tsx:152-203 | Button disabled until text entered |

Next steps offered: Add sources; profile dataset; discover; validate; record finding; communicate; compare results now. Dead end: No.
Friction: "Lifecycle" undefined on screen; "Record a finding" loop step sends to Connections, not Findings, a stated inconsistency; contradiction sweep is an undiscoverable manual button; TRY_IT.md's first pass never mentions Contradictions/Variables/Search.

### 18. sources
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Withdrawn-upstream panel (quiet note when nothing withdrawn) | visible | withdrawn.tsx:69-88; page.tsx:617-630 | Deliberately not styled as Empty |
| Withdrawn panel: title/reason/currency | visible | withdrawn.tsx:91-105 | "Not styled as an alarm" |
| Withdrawn source: citing artifacts list | visible | withdrawn.tsx:113-128 | Titles are text, no link-through |
| Withdrawn source: citation/extraction counts | visible | withdrawn.tsx:130-134 | |
| "Add sources" file picker | visible | views.tsx:224-231 | |
| Drag-and-drop anywhere | visible | Shell.tsx:341-342,460-467; views.tsx:241 | |
| Upload/list error banners with retry | visible | views.tsx:234-236 | |
| Empty state guidance | visible | views.tsx:238-243 | |
| Sources table (title/type/trust) | visible | views.tsx:245-267 | Trust shown inline, not its own column |
| Ingestion status badge + live progress | visible | views.tsx:268-276,485-501 | |
| Ingestion detail text / row-col / page-passage counts | visible | views.tsx:277-294 | |
| Background auto-refresh (1.5s) | visible | views.tsx:203-215 | |
| Open source detail | visible | views.tsx:256-262 | |

Next steps offered: Add sources; open a source → Discover connections. Dead end: No.
Friction: Withdrawn-source artifact titles have no link to open them; importing a table only reachable from a FAILED ingestion row, with no signal on the list.

### 19. sources/detail
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Title/status/type/trust | detail_only | views.tsx:327-333 | |
| Ingestion-failed error banner | detail_only | views.tsx:335-337 | |
| "Text addressed to an AI system" notice | detail_only | views.tsx:349-367 | Only when injection_signals non-empty |
| Database tables listing | behind_mode | views.tsx:375-377; databasetables.tsx:70-90 | Only when ingestion failed as multi-table |
| Import one table | behind_mode | databasetables.tsx:91-100 | `onImported` unwired at call site (views.tsx:376) — clicking produces no navigation |
| Paper stats (pages, passages) | detail_only | views.tsx:379-384 | |
| Dataset stats (rows, cols, version) | detail_only | views.tsx:386-392 | |
| "Discover connections" button | detail_only | views.tsx:396-402 | |
| Subsets (cohort) tree | detail_only | cohorts.tsx:157-187; views.tsx:416-417 | Both shares always shown |
| Click a cohort's name | **unreachable** | cohorts.tsx:167-170; views.tsx:416-417 | `onSelect` never passed here — clicking does nothing |
| Record a new subset | detail_only | cohorts.tsx:116-138 | |
| Profiled schema table | detail_only | views.tsx:421-447 | |
| Per-column data-quality notices | detail_only | views.tsx:430-463 | |
| "Nothing structured extracted" empty state | detail_only | views.tsx:474-479 | |

Next steps offered: Discover connections; import a table; record a subset. Dead end: No.
Friction: A "ready" source with neither paper nor dataset is a true dead end; cohort-name click looks interactive but does nothing; table import gives no confirmation beyond an inline note.

### 20. search — Search sources
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Explanation of scope + pointers to Find papers/data | visible | views.tsx:516-521 | |
| Query input + Search submit | visible | views.tsx:527-533 | |
| Error/loading states | visible | views.tsx:535-536 | |
| Result metadata (strategy, lexical/semantic candidates, retrieval_event_id) | visible | views.tsx:540-543 | id shown as bare mono string; `GET /api/retrievals/{event_id}` exists but is **unreachable** (see §3) |
| "Nothing matched" empty state | visible | views.tsx:544 | |
| Per-hit rank/locator/section/scores/excerpt | visible | views.tsx:545-556 | |

Next steps offered: none. Dead end: Yes.
Friction: Jargon (strategy/lexical/semantic/retrieval_event_id) unglossed; no click-through from a hit back to its source; no action on a result at all.

### 21. variables
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Explanatory note from server | visible | variables.tsx:125 | |
| "Suggest labels for {source}" | visible | variables.tsx:136-153 | Error surfaces "no model configured" verbatim |
| Pending-label count summary | visible | variables.tsx:156-161 | |
| Pending label review cards (least-confident first) | visible | variables.tsx:163-185 | "no confidence recorded" is an honest phrase for null |
| Approve/Reject per pending label | visible | variables.tsx:186-211 | "Nothing is applied until a person approves it" |
| "Columns measuring the same thing" (harmonization) list | behind_mode | variables.tsx:219-237 | Only once ≥1 equivalence exists |
| Vocabulary summary stats | visible | variables.tsx:244-248 | |
| "Teach a term" form | behind_mode | variables.tsx:322-396 | Renders only once ≥1 canonical variable exists; variable chosen from dropdown, never typed |
| Pending alias review | visible | variables.tsx:256-269 | |
| Approve/Reject alias | visible | variables.tsx:270-296 | "silently resolves that term in everything afterwards" |

Next steps offered: none. Dead end: No.
Friction: Nothing here links forward to where an approved label actually shows up; TRY_IT.md never mentions this screen despite the code calling it the reason "every chart is titled resistance_pct".

### 22. discover — Discovery
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Lede on what a sweep does | visible | views.tsx:672-676 | |
| "Waiting for you" approval gate list | visible | views.tsx:680-684; approvals.tsx:106-135 | Only when something is held |
| Release a held step | visible | approvals.tsx:125-131 | |
| Re-run a reused sweep anyway | behind_toggle | views.tsx:686-698 | Only after server reports the run was reused |
| Empty state ("No dataset to search") | visible | views.tsx:701-703 | |
| "Show me results before recording" checkbox | visible | views.tsx:705-717 | Off by default deliberately (views.tsx:589-591) |
| "Discover connections" button | visible | views.tsx:719-733 | `POST /api/projects/{id}/discoveries` |
| Row/column count per dataset | visible | views.tsx:722-725 | |
| Running-state label | visible | views.tsx:728-736 | |
| "What this search did" panel (pairs, tests, correction, FDR) | visible | views.tsx:738; sweep.tsx:77-101 | "a q-value means nothing without the number of tests" |
| "Columns not searched" list | behind_toggle | sweep.tsx:103-121 | Only when exclusion_reasons non-empty |
| In-progress/errored note | visible | sweep.tsx:63-73 | |
| Connections table | visible | views.tsx:740-801 | Shared with Connections screen; capped 100 rows here, no "showing N of M" |
| Footnote (BH correction) | visible | views.tsx:795-798 | |
| Deep-link auto-start | **url_only** | views.tsx:609-616; page.tsx:610-615 | Reached only via Source detail's onDiscover callback — a hidden entry path |

Next steps offered: Discover connections; open a connection; release approval. Dead end: No.
Friction: q-value/FDR/Benjamini-Hochberg unglossed at first exposure; the Exploration Ledger/Deviations panels that explain the q-value count live on a *different* sidebar section entirely; hold checkbox easy to miss.

### 23. connections
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Connections table (shared) | visible | page.tsx:806-828; views.tsx:749-801 | `GET …/connections?limit=200` |
| Exploration Ledger (enquiry name, looks, rename) | visible | ledger.tsx:142-197 | |
| Rename current enquiry | visible | ledger.tsx:170-179,152-168 | Reachable only by clicking the name, styled as text |
| "Earlier work" toggle | behind_toggle | ledger.tsx:186-189,206-248 | Past enquiries "used to disappear" |
| Past-enquiry rows | behind_toggle | ledger.tsx:233-247 | |
| "Start a new line of enquiry" | visible | ledger.tsx:190-193 | Deliberately explicit, not implicit |
| Family counters (looks, family size, survive, pre-registered, uncorrectable) | visible | ledger.tsx:276-286 | |
| Per-test table | visible | ledger.tsx:288-338 | Uncorrectable tests shown, not dropped |
| Empty state (nothing tested) | visible | ledger.tsx:263-270 | |
| "Register a hypothesis" button | visible | deviations.tsx:103,113; preregister.tsx:124-129 | Also the only escape from the old permanent empty state |
| Preregistration form | behind_toggle | preregister.tsx:134-224 | See screen 24 |
| Per-registration cards | visible | deviations.tsx:119-173 | |
| "No analysis plan recorded" notice | visible | deviations.tsx:128,136-142 | |
| "Draft the deviations section" button | visible | deviations.tsx:177-180 | `GET …/deviations/narrative`; every "why" left blank deliberately |
| Drafted narrative display | behind_toggle | deviations.tsx:182-190 | |
| Empty state (nothing registered) | visible | deviations.tsx:93-106 | |
| Note text throughout | visible | deviations.tsx:115-117 | |

Next steps offered: Open a connection; start new enquiry; register a hypothesis; draft deviations. Dead end: No.
Friction: This is the ONLY place the Ledger/Deviations panels appear, with no cross-link from Discovery which shares the same table; "Pre-registered" as a category presumes familiarity with a mechanism reached only from here; rename affordance looks like plain text.

### 24. preregister — Register a hypothesis
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Entry button | visible | preregister.tsx:124-129 | Previously an orphaned API route with no caller anywhere |
| Hypothesis text (required) | behind_toggle | preregister.tsx:143-150 | |
| Predicted direction (required select) | behind_toggle | preregister.tsx:152-165,30-35 | "a prediction that cannot be wrong is a description" |
| Exposure/Outcome fields | behind_toggle | preregister.tsx:167-174 | |
| Method/design fields | behind_toggle | preregister.tsx:176-186 | |
| Covariates (comma list) | behind_toggle | preregister.tsx:187-192,50-53 | Null (not empty array) when blank |
| "Not checkable yet" live warning | behind_toggle | preregister.tsx:194-201,56-69 | |
| Falsification condition field | behind_toggle | preregister.tsx:203-211 | |
| Submit/Cancel | behind_toggle | preregister.tsx:215-222 | `POST …/preregistrations` |
| Post-submit confirmation card | behind_toggle | preregister.tsx:113-121 | |
| Inline error on failure | behind_toggle | preregister.tsx:213 | |

Next steps offered: Return to Deviations/Ledger to see it counted. Dead end: No.
Friction: Reachable only from Deviations/its empty state, never from Discovery where a researcher is about to run a new test; "confirmatory"/"plan_hash" assumed-familiar terms.

### 25. findings
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Lede: a finding must link evidence before promotion | visible | views.tsx:849-857 | |
| Finding cards (title/status/statement/type/causal status) | visible | views.tsx:863-874,822-837 | Keyboard- and mouse-activatable |
| Empty state | visible | views.tsx:860-862 | Sends researcher OFF-screen to a connection deliberately |
| Lifecycle breakdown counts | visible | views.tsx:875 | |

Next steps offered: Open a finding. Dead end: No.
Friction: No control here to create a finding at all (deliberate); "causal_status"/"finding_type" shown raw with no glossary.

### 26. findings/detail — evidence graph
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Title, status, evidence balance | visible | views.tsx:902-909 | |
| Optional server note | visible | views.tsx:911 | |
| Claims list w/ per-claim evidence lines | visible | views.tsx:913-937 | |
| Empty state for claims | visible | views.tsx:914-919 | |
| "Computations behind it" list (button opens analysis) | visible | views.tsx:939-968 | Fixes a previously measured dead end (views.tsx:884-888) |
| Challenges summary (condensed duplicate) | visible | views.tsx:970-980 | Only when challenges exist; duplicates the full Challenges panel below |
| "Where this finding stands" | visible | lifecycle.tsx:170-182; page.tsx:676 | |
| "Move to <state>" buttons | visible | lifecycle.tsx:184-191 | Client-side mirror of server's legal-transition map |
| Transition form (required reason) | behind_toggle | lifecycle.tsx:193-260 | `POST /api/findings/{id}/transition` |
| Robustness-check radio triples | behind_mode | lifecycle.tsx:207-247,53-60 | Only when target is "validated"; 3-state deliberately |
| Pre-filled read of what validation already recorded | visible | lifecycle.tsx:218-232,88-106 | Shown, not auto-answered |
| Terminal-state message (deprecated) | visible | lifecycle.tsx:160-167 | |
| "Download the provenance log" | visible | provenancelog.tsx:45-62; page.tsx:681 | |
| "Download the script" (per analysis) | detail_only | provenancelog.tsx:29-42; page.tsx:697-702 | Actually lives one click further, on Analyses detail |
| Challenges: "Argue against this finding" | visible | challenges.tsx:60-91,106-116,127-129 | `POST /api/findings/{id}/challenge` |
| Empty state (nothing has challenged) | visible | challenges.tsx:106-116 | |
| Per-challenge card (verdict/lifecycle-change/probes) | visible | challenges.tsx:131-176,18-21 | |
| Re-run challenge | visible | challenges.tsx:124-129 | |
| "Preview this as a library note" | behind_toggle | librarynote.tsx:48-55 | |
| Rendered library-note HTML | behind_toggle | librarynote.tsx:58-97 | `GET …/library-note` |
| Statement that Zotero send is NOT offered | behind_toggle | librarynote.tsx:92-97,3-19 | Preview-only until write path tested on a throwaway library |

Next steps offered: Open an analysis; move lifecycle; run a challenge; download provenance; preview library note. Dead end: No.
Friction: Six required-check names shown raw with no definitions; Challenges summary duplicated twice on one screen.

### 27. connections/connection-detail
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Plain-language sentence | visible | ResultCard.tsx:122-137 | Always shown before any number |
| Labelled Effect/Significance/Evidence/Design stats | visible | ResultCard.tsx:141-174 | |
| "See why" evidence grade | behind_toggle | ResultCard.tsx:164-196 | Assumption-based, not p-value-based |
| "Show the exact figures" | behind_toggle | ResultCard.tsx:198-216 | |
| Trace → provenance chain | behind_toggle | views.tsx:1221-1230; ResultCard.tsx:224 | Only rendered when `analysis_object_id` exists — never shown as an empty chain |
| Provenance strip + origin badge | visible | ResultCard.tsx:218-231 | |
| Lifecycle chip | visible | ResultCard.tsx:36-44,130 | |
| Evidence-grade violated-assumption detail | visible | views.tsx:1359-1388 | Only when a check is violated |
| Confounder picker | visible | views.tsx:1258-1280 | Self-adjustment filtered out entirely |
| Validate (robustness suite) | visible | views.tsx:1288-1291 | Polls up to 48s (views.tsx:1146-1171) |
| Fragility (E-value) | visible | fragility.tsx:39-109 | Assumptions behind a `<details>`, closed by default |
| Validation reports (history) | visible | views.tsx:1411-1448 | "not validated" distinguished from a pass |
| Record this connection as a finding | behind_toggle | recordfinding.tsx:106-165 | Offered even unvalidated, with a non-blocking caution |
| Confirmation + finding id | visible | recordfinding.tsx:76-103 | |

Next steps offered: Trace provenance; adjust confounders/re-validate; record a finding. Dead end: No.
Friction: q-value/evidence quality/"not tested" vs "not passed" unglossed on first exposure; Trace silently absent with no explanation when no analysis_object_id; Validate can take ~48s with only a generic label.

### 28. analyses (list)
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Run name/method/origin/headline | visible | analyses.tsx:41-88,126-151 | |
| Failed-run error message inline | visible | analyses.tsx:143-147 | |
| Forked-run fork reason inline | visible | analyses.tsx:148-150 | |
| Open a run | visible | analyses.tsx:127-134 | |
| Run a new analysis (RunAnalysis) | visible | analyses.tsx:24,116 | Reloads on queue rather than jumping to detail |

Next steps offered: Open a run; queue a new analysis. Dead end: No.
Friction: Origin labels (sweep/specified/fork) require prior knowledge of BH correction/forking.

### 29. analyses/analysis-detail
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Method name + question | visible | views.tsx:1009-1010 | |
| Run status/error | visible | views.tsx:1011-1013 | |
| 4 separated judgements (estimate/p/n/quality) | visible | views.tsx:1017-1023 | "§47" |
| Interpretation, significance, rationale, limitations | visible | views.tsx:1026-1037 | |
| Assumption-checks table | visible | views.tsx:1040-1054 | |
| Reproducibility metadata (seed, versions, hashes, sandbox) | visible | views.tsx:1056-1074 | "§44" |

Next steps offered: Download reproduction script. Dead end: No.
Friction: "violated"/"not_tested" chips have no legend here.

### 30. plain-reading
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Headline, meaning, confidence text | visible | analyses.tsx:192-197 | Rendered beneath AnalysisDetail |
| Causal-language permission + reason | visible | analyses.tsx:204-214 | Kept beside the reading deliberately |
| Server's own refusal text (409/no model) | visible | analyses.tsx:184-187 | |

Next steps offered: none. Dead end: Yes.

### 31. forks
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Lineage note + ancestor/descendant chain | visible | forklineage.tsx:87-124 | Only when depth>0 or has children |
| Open ancestor/child run | visible | forklineage.tsx:110-113,134-137 | |
| Cycle-detected note | visible | forklineage.tsx:101-107 | |
| "Try this a different way" (fork form) | behind_toggle | sensitivity.tsx:83-183 | Rank-based swap offered only when a same-role alternative exists |
| Unchanged-re-run warning | visible | sensitivity.tsx:163-169 | "flattery rather than evidence" |
| "Compare these N runs" | behind_toggle | sensitivity.tsx:210-218 | Only once ≥2 runs exist |
| Comparison verdict + table | visible | sensitivity.tsx:221-263 | Verdict placed above the table deliberately |

Next steps offered: Queue a forked run; open ancestor/child. Dead end: No.
Friction: Rank-based swap uses jargon ("distributional assumption"); comparing requires a manual press; fork form cannot edit filters, only method/reason, stated as a passing note.

### 32. findings/finding-detail#provenance-log
| Capability | how_reached | Evidence |
|---|---|---|
| Download provenance log (provenance.md) | visible | provenancelog.tsx:45-62 |
| Download reproduction script (reproduce.py) | visible | provenancelog.tsx:29-42 |

Next steps offered: none. Dead end: Yes.
Friction: Both are plain `<a download>` with no in-app preview; overlaps confusingly with the unrelated Trace provenance chain.

### 33. findings/finding-detail#standing
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Current state + evidence count | visible | lifecycle.tsx:172-182 | |
| Rule shown before any attempt | visible | lifecycle.tsx:177-181 | |
| Terminal message (deprecated) | visible | lifecycle.tsx:160-167 | |
| Move-to-legal-state buttons | visible | lifecycle.tsx:40-47,184-191 | |
| Required free-text reason | behind_toggle | lifecycle.tsx:199-205 | |
| 6 robustness-check radios | behind_mode | lifecycle.tsx:207-248,53-60 | 3-state, only for target "validated" |
| Machine-recorded check shown beside radio (not pre-filled) | visible | lifecycle.tsx:117-123,218-232 | |
| Server's 409/422 error text | visible | lifecycle.tsx:150-157,250 | |
| Cancel | visible | lifecycle.tsx:256-258 | |

Next steps offered: Move lifecycle state. Dead end: No.
Friction: "candidate/exploratory/validated…" raw underscore-stripped labels — different vocabulary from ResultCard's plain-phrase chip; researcher re-answers by hand what Validate already ran.

### 34. findings/finding-detail#challenges
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Empty-state distinction (nothing challenged vs sound) | visible | challenges.tsx:106-116 | |
| "Argue against this finding" | visible | challenges.tsx:60-91 | Polls up to 40s |
| Verdict word (holds/weakens/uncertain/disappears) | visible | challenges.tsx:131-136,18-21 | Deliberately not colour-coded |
| Lifecycle before→after when changed | visible | challenges.tsx:137-148 | |
| Summary + per-probe list | visible | challenges.tsx:155-166 | |
| Note when no probe detail exists | visible | challenges.tsx:168-173 | |

Next steps offered: Re-run critic after new evidence. Dead end: No.
Friction: The critic can silently change lifecycle elsewhere on the same page; no confounder picker here unlike the connection screen.

### 35. findings/finding-detail#library-note
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| "Preview this as a library note" toggle | behind_toggle | librarynote.tsx:34-56 | |
| Read composed note (status/causation/look-count) | **behind_toggle (critic)** | librarynote.tsx:65-90 | **(critic correction)** base inventory marked this "visible"; the HTML is only fetched/rendered after the toggle is pressed |
| Statement that nothing has been written, no send button | **behind_toggle (critic)** | librarynote.tsx:92-97 | **(critic correction)** base inventory marked this "visible" too — same gating applies |

Next steps offered: none. Dead end: Yes.
Friction: A researcher may look for a "send to Zotero" button given the title; absence explained only in a trailing paragraph.

### 36. board — Workboard
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Put something on the board (open picker) | visible | Board.tsx:646-649 | Only queries while open |
| Add unplaced object | behind_toggle | Board.tsx:763-774 | Placed with an offset so multiple adds "deal them out" |
| Picker empty state | behind_toggle | Board.tsx:758-761 | |
| Reset view | visible | Board.tsx:650 | |
| Fit to contents | visible | Board.tsx:651-655 | Disabled with no cards; was a no-op until a surface-size bug was fixed |
| Zoom percentage readout | visible | Board.tsx:656-658 | |
| "N of M in view" | visible | Board.tsx:659-663 | No render margin, unlike the 200px-margin render cull |
| Pan (drag background) | visible | Board.tsx:374-390,392-399 | |
| Zoom (scroll wheel, pointer-anchored) | visible | Board.tsx:360-372 | |
| Drag a card (snap + guides) | visible | Board.tsx:392-430 | Snap threshold is screen-pixel, converted through zoom |
| Press a card (raise + select/open) | visible | Board.tsx:439-464 | Not keyboard-reachable — card is an `<article>` |
| Send card behind others (lower) | visible | Board.tsx:898-906 | |
| Take a card off the board | visible | Board.tsx:503-518,907-915 | Optimistic; restores on failure |
| "X is off the board — Put it back" banner | behind_mode | Board.tsx:747-752,580-596 | §96: soft delete + immediate undo instead of a modal |
| Undo (labelled with what it undoes) | visible | Board.tsx:733-741; history.ts:141-150 | Only "move" commands are actually undoable |
| Redo (static label) | visible | Board.tsx:742-744 | |
| Undo/redo keyboard shortcut | visible | Board.tsx:564-578 | Suppressed while focus is in a text field, unstated on screen |
| "Frame this area" | visible | Board.tsx:670-679,276-290 | `window.prompt()`; captures only the current viewport — board has no multi-select |
| Region label + member count | visible | Board.tsx:830-835 | |
| Rename a region | **behind_mode (critic)** | Board.tsx:837-840 | **(critic correction)** base inventory called this "visible"; it renders only inside a region's own box, which exists only once a region has been drawn |
| Nudge a region left | **behind_mode (critic)** | Board.tsx:841-845,311-319 | **(critic correction)** same gating as rename; fixed 60px, left only |
| Remove a region | **behind_mode (critic)** | Board.tsx:846-849,301-308 | **(critic correction)** same gating; removes frame only, not cards |
| "How to organise" phrase input | visible | Board.tsx:681-689 | Pre-filled "by type" — reads as the only valid phrase |
| Preview tidy | visible | Board.tsx:690-693,333-343 | Disabled with no cards; a refusal "names what this understands" |
| Tidy preview panel | behind_toggle | Board.tsx:701-715 | "Nothing has moved yet" stated explicitly |
| Apply the tidy plan | behind_toggle | Board.tsx:709-712,345-356 | |
| Discard the tidy plan | behind_toggle | Board.tsx:713 | |
| Card face info (type/title/status) | visible | Board.tsx:880-882 | |
| Board-level error banner | visible | Board.tsx:717 | |
| Explanatory lede | visible | Board.tsx:640-644 | |
| Empty-board state | visible | Board.tsx:788-792 | |

Next steps offered: Add an object; open a card into its detail panel. Dead end: No.
Friction: Cards are pointer-only (no keyboard press/drag/open); "Frame this area" silently frames only the viewport; organise-phrase default reads as required; region controls (rename/nudge/remove) are small and appear only once a region exists (**critic**: this makes them behind_mode, not visible); Undo restores only moves, not place/remove; Ctrl/Cmd+Z silently suppressed in text fields; a prior surface-measurement bug made "Fit to contents" a no-op and the view count always claim full visibility, silently.

### 37. board/card-detail — Card Detail
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Close panel | detail_only | CardDetail.tsx:70 | |
| Object header (type/title/status) | detail_only | CardDetail.tsx:64-69 | |
| "Built on this" (dependent artifacts, findings-losing-evidence called out first) | detail_only | CardDetail.tsx:73-124 | `GET /objects/{id}/impact` "had no caller" before this screen; deliberately NOT framed as deletion consequences |
| List of up to 12 dependents ("Showing 12 of N") | detail_only | CardDetail.tsx:106-120 | |
| "Mentioned in" (backlinks with citing excerpt) | detail_only | CardDetail.tsx:126-147 | `GET /objects/{id}/mentions`, also previously uncalled |
| Per-section loading/retry states | detail_only | CardDetail.tsx:75-76,129-130 | |

Next steps offered: See what would need revisiting; follow a backlink (listed, but see friction). Dead end: **Yes (critic correction)** — base inventory said `false`; critic notes the panel's own friction entry concedes no onward link exists to actually revisit a dependent or open a citing note, so no listed next step is actually performable.
Friction: Only reachable by pressing a card on the Workboard, with no link from Findings/Connections/anywhere else; no onward action into the dependents or citing notes it lists.

### 38. compare (shell + Dataset↔dataset)
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Switch verb via 8 tabs | visible | compare.tsx:78-80,121-134 | Deliberately one screen — splitting "would teach the researcher that they are different features" |
| Two-slot dataset picker | visible | compare.tsx:103-117,254-274 | |
| Automatic compatibility check on 2nd pick | visible | compare.tsx:89-101,111 | No separate Compare button |
| Verdict card (tone/mismatch/remedy/still-possible/method) | visible | compare.tsx:369-444 | "never a red X" |
| "Already checked" history | visible | compare.tsx:280,300-367 | Previously had no caller (compare.tsx:302-306); can go stale when harmonisation changes |
| Empty state (<2 datasets) | visible | compare.tsx:229-241 | |

Next steps offered: Add another dataset; harmonise named columns; act on "what you can still do". Dead end: No.
Friction: 8-tab shorthand unglossed until clicked; stale "already checked" verdicts have no visual flag.

### 39. compare/claim — Claim test
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Pick a paper | visible | claimtest.tsx:158-170 | |
| Read stored claims-record (no model call) | visible | claimtest.tsx:91-119 | Previously an uncalled `GET /sources/{id}/claims` |
| "Read it again" (re-run the model) | behind_toggle | claimtest.tsx:186-204 | Only appears once a from-record reading is shown |
| Each claim as a verbatim blockquote | visible | claimtest.tsx:206-222 | Never paraphrased |
| "Test against" per-dataset buttons | visible | claimtest.tsx:223-234 | |
| Result verdict card (4-step sequence) | detail_only | claimtest.tsx:256-318 | Only after Test is run |
| Provenance line (model + prompt version) | visible | claimtest.tsx:237-241 | Claims marked "proposed", not findings |
| Empty state (no paper/dataset) | visible | claimtest.tsx:142-149 | |

Next steps offered: Test a claim; re-read the paper. Dead end: No.
Friction: "No testable claim found" gives only the model's own note; located-vs-stored distinction easy to miss.

### 40. compare/papers — Reconcile
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Two-slot paper picker | visible | reconcile.tsx:71-82,101-117 | Same gesture as dataset compare deliberately |
| Automatic run on 2nd pick | visible | reconcile.tsx:62-69,81 | |
| Side-by-side claim columns | visible | reconcile.tsx:171-197 | Shown even when it blocked the comparison, "especially then" |
| Verdict card + "ruled out first" list | visible | reconcile.tsx:135-159 | |
| "No comparable claims found" | visible | reconcile.tsx:122-133 | |
| Footer note (claim-location model use vs deterministic comparison) | visible | reconcile.tsx:161-166 | |
| Empty state (<2 papers) | visible | reconcile.tsx:84-91 | |

Next steps offered: Pick a different pair. Dead end: No.
Friction: "Cannot compare" not flagged on-screen as expected/common; "estimand" unglossed.

### 41. compare/many — Synthesis
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Multi-select paper picker | visible | synthesis.tsx:189-226 | |
| Per-paper read-status check (auto) | visible | synthesis.tsx:140-160 | |
| Inline unread-papers notice + Read buttons | visible | synthesis.tsx:234-254 | Fixes a prior post-Compare-only failure |
| "Compare N papers" | visible | synthesis.tsx:256-269 | |
| "Taken together" key points (counted, never generated) | visible | synthesis.tsx:75-86,281-300 | |
| Key-points failure kept separate from table failure | visible | synthesis.tsx:117-124,274-279 | |
| "Before you read across" objections, above the table | visible | synthesis.tsx:323-324,388-433 | |
| Side-by-side quoted matrix (2 kinds of blank, never merged) | visible | synthesis.tsx:326-376 | |
| Per-paper discarded count | visible | synthesis.tsx:333-341 | |
| "Not yet read" notice (post-table) | visible | synthesis.tsx:305-321 | |
| Accuracy/multiplicity footer | visible | synthesis.tsx:379-381 | |
| Empty state (<2 papers) | visible | synthesis.tsx:197-204 | |

Next steps offered: Read an unread paper inline; re-pick set. Dead end: No.
Friction: Two nearly-identical unread-paper notices at different points confuse; "stated_by N/M" unlegended.

### 42. compare/manydata — DatasetSynthesis
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Multi-select dataset picker | visible | multicompare.tsx:88-110 | |
| "Compare N datasets" (pairwise) | visible | multicompare.tsx:112-117 | |
| Ceiling banner (weakest pair, not average) | visible | multicompare.tsx:124-130 | |
| "Pairs that cannot be compared" | visible | multicompare.tsx:132-146 | |
| Side-by-side table (design/population/confirmed vars/unmapped columns named) | visible | multicompare.tsx:148-208 | |
| Footer (confirmed-everywhere vars + pairwise count) | visible | multicompare.tsx:210-215 | |
| Empty state (<2 datasets) | visible | multicompare.tsx:71-78 | |

Next steps offered: Add dataset; harmonise unmapped columns. Dead end: No.
Friction: No time estimate before O(n²) adjudication.

### 43. compare/images — Image comparison
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Multi-select figure picker (image-extension only) | visible | multicompare.tsx:298-303,335-352 | |
| "Compare N figures" | visible | multicompare.tsx:354-359 | |
| Denominator-first multiplicity aside | visible | multicompare.tsx:369-381 | "one flagged pair out of 190 is what chance produces" |
| Checks-run notice (e.g. OpenCV missing) | visible | multicompare.tsx:241,383-385 | |
| "Worth opening side by side" flagged list | visible | multicompare.tsx:387-405 | |
| NothingFlagged (3 distinct empty states) | visible | multicompare.tsx:244-296 | Fixed a bug where a caveat and a contradicting headline coexisted |
| Language-note/limits footer | visible | multicompare.tsx:408-410 | |
| Empty state (<2 figures) | visible | multicompare.tsx:317-324 | |

Next steps offered: Open a flagged pair (implied). Dead end: No.
Friction: Figure identified purely by filename-extension regex — silent exclusion for non-standard names.

### 44. compare/findings — Consistency
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Automatic sweep on load | visible | consistency.tsx:53-77 | Opens on the sweep, not a picker |
| "Ask about two in particular" manual picker | visible | consistency.tsx:116-185 | Previously had no picker; only when ≥2 connections exist |
| 2nd select excludes 1st | visible | consistency.tsx:163-174 | |
| Report (verdict + side-by-side detail) | visible | consistency.tsx:189-241 | |
| "Ruled out first" checks-passed list | visible | consistency.tsx:205-216 | |
| Sweep-level footer note | visible | consistency.tsx:101 | |
| Empty state | visible | consistency.tsx:70-77 | |

Next steps offered: Ask about a specific pair. Dead end: No.
Friction: Manual picker invisible below 2 connections project-wide, with no placeholder explaining why; unformatted underscored labels.

### 45. compare/scans — CaseCompare (imaging)
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Synthetic 5-case demo library (default) | visible | CaseCompare.tsx:17-27,82-111 | Covers all 5 verdict outcomes |
| File picker (NIfTI/DICOM) | visible | CaseCompare.tsx:250-272,130-206 | |
| "Your name, for the marks" input | visible | CaseCompare.tsx:273-282 | |
| Per-file failure list (named, not counted) | visible | CaseCompare.tsx:283-287,149-158,176-179,197-200 | |
| PHI/identifiability review | visible | CaseCompare.tsx:240-248 | |
| NIfTI-vs-DICOM limits note | visible | CaseCompare.tsx:288-296 | NIfTI pairs always "cannot be judged" |
| First scan opened = "the case" | visible | CaseCompare.tsx:208-211,299-304 | Explicit, not guessed |
| Shared camera/window across all scans | visible | CaseWorkspace.tsx:93-125,300-306 | |
| Draw/mark on the case scan only | visible | HighlightLayer.tsx:44-53,110-129; CaseWorkspace.tsx:210-224 | |
| "What is being marked" note field | visible | CaseWorkspace.tsx:215-224 | |
| Marks list (chronological, view-restoring) | behind_toggle | CaseWorkspace.tsx:227-231,426-475 | Only once marks exist |
| Persisted marks (salted per-series handle) | visible | CaseWorkspace.tsx:139-150,445-454 | NIfTI marks are session-only, stated |
| "Narrow to this case's acquisition" filter | behind_toggle | CaseWorkspace.tsx:161-171,233-263 | Only once library>3; off by default |
| Partition summary + 4 grouped sections | visible | CaseWorkspace.tsx:72-87,266-298,382-416 | Every scan shown even when refused |
| Per-scan evidence strength (% read vs guessed) | visible | CaseWorkspace.tsx:336-344 | |
| Withheld-mark notice | visible | HighlightLayer.tsx:130-140 | Silence would falsely read as "nothing marked" |
| Compressed-DICOM handling | visible | CaseCompare.tsx:259-264 | Header still classified even when pixels can't decode |

Next steps offered: Open own scans; mark/annotate the case; narrow the library. Dead end: No.
Friction: Scans here are never persisted to the project, unlike every other Compare tab, stated only in-screen; no ranking (deliberate) may surprise users coming from other tabs; filter appears only above a 3-scan threshold.

### 46. patterns — Across the project
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Switch view via 3 tabs | visible | patterns.tsx:98-99,118-130 | |
| Multiplicity banner first | visible | patterns.tsx:231-257 | "not a caveat banner — it is the frame the rest of the page is read inside" |
| "Worth your attention" key findings | visible | patterns.tsx:186-194,259-280 | |
| Per-finding "What argues against this" | visible | patterns.tsx:284-296 | LAW 3: shown inline, never in an appendix |
| Per-finding "What supports it"/"Also worth knowing" | visible | patterns.tsx:297-315 | |
| Grouped pattern sections ("why this is not a finding") | visible | patterns.tsx:81-87,196-213,320-346 | |
| Contradiction pattern → full VerdictCard | visible | patterns.tsx:200-208 | "A contradiction is a verdict, not an observation" |
| Footer (examined count, coverage, note) | visible | patterns.tsx:215-219 | |
| Empty state ("Run discovery") | visible | patterns.tsx:179-183 | |

Next steps offered: Run discovery; open the other 2 tabs. Dead end: No.
Friction: q-value/FDR named only obliquely; "canonical"/"lifecycle_status"/"evidence_quality" unglossed.

### 47. patterns/robustness — Specification curve
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Outcome/exposure selects | visible | speccurve.tsx:101-118 | |
| Covariate chip picker | behind_mode | speccurve.tsx:120-144 | Only once both selects filled; deliberately no recommendation (LAW 6) |
| "Fit 2^N specifications" (live count) | visible | speccurve.tsx:145-149 | |
| Headline + chart (fixed order, never by effect size) | visible | speccurve.tsx:6-21,182-227 | |
| Full spec table `<details>` | behind_toggle | speccurve.tsx:229-256 | Same fixed order as chart |
| "Could not be fitted" list | visible | speccurve.tsx:258-271 | |
| Verdict card | visible | speccurve.tsx:159 | |
| Ordering-method footer | visible | speccurve.tsx:160 | |
| Empty state (no dataset in scope) | visible | speccurve.tsx:81-88 | |

Next steps offered: Fit again with different covariates. Dead end: No.
Friction: No dataset picker on this screen itself if none passed in; "2^N" math shown without explanation of blow-up risk.

### 48. patterns/believable — Diagnostics
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Switch among 3 plots (volcano/QQ/funnel) | visible | diagnostics.tsx:39-45,80-86 | |
| Scatter chart + generated reading caption | visible | diagnostics.tsx:96-105 | |
| Null-diagonal reference line | behind_mode | diagnostics.tsx:109-113 | QQ view only |
| Empty state | visible | diagnostics.tsx:88-93 | |

Next steps offered: Run discovery. Dead end: Yes.
Friction: This whole capability (231 lines) previously had zero caller anywhere; plot-type nicknames unglossed; no onward action.

### 49. runanalysis — Specify an analysis
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Entry button (collapsed form) | visible | runanalysis.tsx:194-199 | |
| Dataset select | visible | runanalysis.tsx:231-243 | |
| Method select (server-populated) | visible | runanalysis.tsx:245-254 | |
| Per-method variable-role pickers | behind_mode | runanalysis.tsx:65-106,271-320 | Only once dataset+method chosen; columns picked, never typed |
| Order-preserving multi-select | visible | runanalysis.tsx:290-317 | First pick = exposure |
| Warning: method has no declared variables | visible | runanalysis.tsx:256-264 | |
| Optional link to a registered hypothesis | behind_toggle | runanalysis.tsx:322-346 | Only if project has registrations; checked server-side, not trusted |
| "Question this answers" field | visible | runanalysis.tsx:348-353 | |
| Required "Why this method" rationale | visible | runanalysis.tsx:355-370 | Asked before the result exists, deliberately |
| "Run it" submit | visible | runanalysis.tsx:374-378,83-90 | |
| Cancel | visible | runanalysis.tsx:379-381 | |
| Post-submit confirmation (registration standing + look-count) | visible | runanalysis.tsx:170-191 | |
| Empty state (no dataset) | visible | runanalysis.tsx:210-220 | |

Next steps offered: Watch queued run appear; run another analysis. Dead end: No.
Friction: This whole feature had no caller anywhere before being wired here (preregistration "was a filing cabinet" without it); role names shown are internal jargon above their own plain-language help; entry point's nav placement unconfirmed from these files.

### 50. literature — Find papers
| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Search box (Enter-to-submit) | visible | literature.tsx:289-304 | |
| Search button | visible | literature.tsx:305-307 | |
| "Read a PDF you have" | visible | literature.tsx:308-310 | |
| Source capability chips | visible | literature.tsx:313-322 | |
| Per-source result status chips | visible | literature.tsx:331-336 | A failing source reported beside arriving results, never as an error page |
| Results summary line | visible | literature.tsx:343-346 | |
| Per-record metadata | visible | literature.tsx:356-367 | |
| Abstract (truncated) | visible | literature.tsx:369-374 | |
| "Databases disagree on X" toggle | behind_toggle | literature.tsx:376-397 | Shown, not resolved |
| Source marks / "found via X + Y" | visible | literature.tsx:400-407 | |
| "open access" badge | visible | literature.tsx:408-410 | |
| "Open" external link | visible | literature.tsx:411-414 | |
| "Read and mark" (open PaperReader) | detail_only | literature.tsx:422-427 | Only for open-access + pdf_url; never routes around a paywall |
| "Add"/"In this project" | visible | literature.tsx:428-434 | |
| "Taken from papers" board | detail_only | literature.tsx:442-466 | Kept at this level so returning to results doesn't discard it |
| Footnote (metadata-only import) | visible | literature.tsx:468-472 | |
| Reader mode "Back to results" bar | detail_only | literature.tsx:245-254 | Reading lives in the same screen deliberately |
| Own-PDF reader "Back to search" bar | behind_mode | literature.tsx:225-242 | Excerpts from own-disk PDFs never kept |
| PaperReader: "Open a paper" file picker | detail_only | PaperReader.tsx:620-627 | |
| PaperReader: page Back/Next | detail_only | PaperReader.tsx:632-638 | |
| PaperReader: Zoom select (75–300%) | detail_only | PaperReader.tsx:639-647 | |
| PaperReader: mark-kind tool buttons | detail_only | PaperReader.tsx:57-65,648-654 | "Rub out" is a separate erase union member, not a 7th kind |
| PaperReader: draw a stroke | detail_only | PaperReader.tsx:472-529 | |
| PaperReader: place a note | behind_mode | PaperReader.tsx:492-496,709-729 | Enter commits, Escape cancels |
| PaperReader: erase | behind_mode | PaperReader.tsx:483-490,503-512 | |
| PaperReader: "Put this on the board" | detail_only | PaperReader.tsx:587-604,655-657 | Requires an existing circle mark; silently takes the *last* one |
| PaperReader: "Mark with your hand" | behind_toggle | PaperReader.tsx:658-661,671-689 | Camera never turns on until pressed |
| PaperReader: "On the board" excerpt list | detail_only | PaperReader.tsx:739-751 | |
| PaperReader: error/problem status line | detail_only | PaperReader.tsx:692 | |

Next steps offered: Add a paper as a source; read+mark an open-access paper; harvest a repository. Dead end: No.
Friction: "Read and mark" silently absent outside its two conditions; reader's tool vocabulary undocumented on screen; "Put this on the board" takes the last circle with no visible selection state.

### 51. literature/harvest — Harvest a repository
*Source data for this screen is truncated at the point of ingestion (cuts off mid-sentence in the withdrawn-sources note).*

| Capability | how_reached | Evidence | Note |
|---|---|---|---|
| Repository base URL input | visible | harvest.tsx:107-113 | |
| "Identify" button (disabled until URL entered) | visible | harvest.tsx:114-116 | Runs separately so a bad URL is caught before a bulk harvest |
| Identity result (name/protocol/earliest date/deletion policy) | detail_only | harvest.tsx:119-128 | |
| Set spec input (optional) | visible | harvest.tsx:131-132 | "set" is unglossed OAI-PMH jargon |
| From-date input | visible | harvest.tsx:133-134 | |
| Max-records ceiling (default 200, 1-5000) | visible | harvest.tsx:135-137 | Shown/editable rather than a hidden default |
| "Harvest" button | visible | harvest.tsx:138-140 | |
| Harvest result note + pages fetched + truncation notice | detail_only | harvest.tsx:146-166 | |
| Withdrawn-sources notice | detail_only | harvest.tsx:154-161 | *[source text truncated here]* |

Dead end: unknown (source truncated). Note this incompleteness explicitly to the design panel.

### Critic-added screens (missing from all base inventories)

The critic identified entire screens and sub-panels that no base group opened, reachable from the rail but never followed. Listed by capability with citation; not re-tabulated to the same granular how_reached scheme as above since the critic's own notes are the only source.

**Reports** (`components/reports.tsx`, 420 lines; mounted page.tsx:721-739) — draft a report from an eligible connection (only those with `analysis_run_id`, reports.tsx:39-41); project-wide citation-integrity report (:95,122,140 — §58); per-block "Where this came from" provenance trace, N values/N cited (:352,371-380, behind_toggle); "Re-cut as a talk" slides referencing the same analysis runs (:253-263); export to markdown/html/docx/pptx, **blocked while integrity reports problems** (:267-290 — "a file outlives the warning that would have accompanied it on screen"). **(critic)**

**Figures** (`components/figures.tsx`; mounted page.tsx:794-796) — 5 view modes (Everything tested / How it all relates / How one variable is spread / One relationship / Where it was measured), aria-current buttons (:221-245); per-run figure picker, first 8 plottable runs (:267); brush-a-range-to-record-a-subset (:700-722); "Save this view" client-side SVG export (:744-750, "related to nothing"); server-side PublishFigure (:752-762); numbers-behind-this-figure `<details>`, first 200 of N (:764-780). **(critic)**

**Publish (figure)** (`components/publish.tsx`, 283 lines, reached only from Figures' "One relationship" view) — lineage edge (VISUALIZES) from analysis run to figure; a figure critic refusing an unfixed blocking problem; PDF/EPS/TIFF at stated pixel height; a server-named traceable filename. Header: "four routes, a critic, a publication renderer and a lineage edge had no caller at all before this." **(critic)**

**SavedFigures** (`components/savedfigures.tsx`, 198 lines) — saved-figures list; edit title/caption only (never rows/variables — "a redraw would leave the old statistics on new data"); re-runs the critic on edit. `GET /visuals/{id}` and `PATCH /visuals/{id}` both had no caller before this component. **(critic)** — this directly corrects the reachability report's claim that `GET /api/visuals/{visual_id}` is unreachable (see §3).

**Bibliography/Exports** (`components/bibliography.tsx`, imported by reports.tsx:23-25) — results.csv (:48); snapshot.zip, whole-project archive (:76); BibTeX bibliography shown on screen with incomplete entries named before saving (:104 — "§75 asked for a spreadsheet export and had none"). **(critic)**

**Notebook** (`components/notebook.tsx`, 627 lines; mounted page.tsx:764) — `[[` wikilink autocomplete (the protected gesture, :550-600); open today's page / name a new page (:242-245,265-274); hubs "Where to start" (:292,308-320); "Check the notebook" lint returning stale_evidence/unwritten_page/isolated/no-source, each with why + what-to-do (:341-375); dangling-link to-do list (:379-393); links-from-this-page and mentioned-in backlinks (:418-455). **(critic)**

**Settings** (`components/settings.tsx`, 1058 lines; mounted page.tsx:776) — change password (:154-176); add people/admin (:179-215); install optional feature packs, with size/what-it-enables/"Without it:" (:314-350); check version and updates (:446-480); "Add to applications menu" (:582-628); choose local model, `runs_here` distinguishing local from `:cloud` (:782-835); configure/remove a hosted Anthropic API key (:893-965); read Neo4j graph-projection status (ADR 0002, :986-1000); read every past model change (:1035). **(critic)**

**Find data / DataSearch** (`components/datasearch.tsx`, 279 lines; mounted page.tsx:791) — dataset-repository search leading with licence/formats/embargo, not authors/venue; unusable records shown dimmed with the blocker stated, never filtered out; "not stated" never drawn as "no" (:1-24,116-124). **Has no import/add control at all** — the only write is `api.post` to `/api/datasets/search` (:96), unlike Literature's "Add". **(critic)** — dead end.

**Read a figure** (`components/readfigure.tsx`, 308 lines; mounted page.tsx:792) — click 4 axis reference points recorded in the image's own pixels; declare log/linear per axis behind an explicit "I have checked both axis scales" attestation (:234-256); "Read the points" with per-point error and provenance, downloadable as CSV (:257-296). Ends at `<a download="digitised.csv">` (:294) — digitised points never become a source/dataset/connection. **(critic)** — dead end.

**Research graph** (`components/graphview.tsx`, `KnowledgeGraph.tsx` 671 lines, `NodeJournal.tsx`, `objectversions.tsx`; mounted page.tsx:777-788) — canvas knowledge graph with an accessible `<details>` table of the same nodes (:165,172-190); NodeJournal: append-only notes on a node, styled identically whether written by a person or a model (:1-20); ObjectVersions: full version chain with restore-forward, never a destructive revert (:1-17). **(critic)**

**Chart primitives (Gallery)** (`components/gallery.tsx`, 508 lines; mounted page.tsx:790) — every 2D primitive rendered against data whose answer is known, including two deliberate refusals (a hierarchy holding a negative value, a flow containing a cycle) (:1-14); two SpatialControl-driven charts (:477,493). Offers no route into the researcher's own project data — dead end. **(critic)**

**Chart data-table fallback** (`components/charts/ChartTable.tsx`, shared by 15 primitives) — disclosed truncation ("shows N of M") rather than a silent cap; one shared table so 13 hand-rolled tables can't drift apart. **(critic)** — flagged by the base inventory's own Group 3 as unverified and handed off; no group followed up.

**Spatial-chart export** (`components/charts/ChartExport.tsx`, used by 7 3D chart types) — still image (multiple formats) or a recorded orbit video, per-chart, §75's fix for spatial figures that "could not be saved at all." **(critic)**

**Chart hover/tooltip and cross-figure brushing** (`components/charts/interaction.tsx`, `linked.tsx`) — a real positioned tooltip with neighbourhood-scoped emphasis; opt-in, key-scoped linked selection (linkKey) so unrelated datasets with colliding ids never cross-highlight; "a selection is not a finding." **(critic)**

**Full keyboard operation of the 3D scatter, including selection** (`components/charts/Volume.tsx:735-780`) — aim-and-press at the view centre with a crosshair on focus; before this a keyboard-only researcher was "locked out of the product's headline capability, not merely inconvenienced." **(critic)**

**SpatialControl panel** (`components/spatial/SpatialControl.tsx:615-931`) — offer→explain→consent sequencing before any camera prompt; skippable per-step onboarding; Pause/Resume; Turn off camera; Calibrate; hands-free "Reset the view" (§31); Sensitivity `<details>` (rotation/zoom sliders); Camera preview and Hand outline toggles (§19); feedback channel toggles offered only where the channel exists; camera-device `<select>` when multiple cameras present. **(critic)** This is the actual home of nearly every control the base inventory attributed to /gesture-check — see screen 14 above.

**Haptics self-test** (`gesture-check/page.tsx:438-462`) — "Tap the trackpad" (`POST /api/haptics/tap`), with an explicit "no haptic actuator this program can reach" branch. **(critic)** The only literal `<button>` in gesture-check/page.tsx.

**Notebook graph (notegraph)** (`components/notegraph.tsx`, 198 lines) — asserted-vs-computed edge kinds drawn differently and filterable separately, "so the graph does not quietly claim a hunch and a derivation are the same kind of fact." **(critic)**

**MapView** (`components/mapview.tsx`, 179 lines; reached from figures.tsx:242-245 only when a geography column exists) — a measurement drawn where it was measured, each place carrying its own n; unrecognised place names NAMED rather than silently absent from the choropleth. No click-through from a place to its rows. **(critic)** — dead end.

**Specialist file viewers** (`components/specialist/mount.tsx`, `molstar.tsx`, `niivue.tsx`, `volume.tsx`, `geomap.tsx`) — molecular structure (Mol*), neuroimaging (NiiVue), volume and geospatial viewers, opened entirely in-browser; the file never leaves the browser; renders NOTHING (not a disabled placeholder) if nothing is offerable. **(critic)**

**Arrow-key tab strips** (`components/ViewTabs.tsx:68-135`) — shared roving-tabindex implementation with real tabpanel semantics, used by Compare/Patterns/Notebook/Notegraph; four screens previously hand-rolled this incorrectly (declared `role="tablist"`, answered no arrow key). **(critic)**

---

## 3. API Routes the Interface Never Reaches

Measured by running the repository's own guard (`tests/test_routes_are_reachable.py`, 33 passed) which discovers every route via `api_leaves()` over `app.routes` and every interface call via regex over `apps/web/**/*.ts*`. Total routes: **185** (up from 115 at D070, 134 at D073). Unreachable: **17** (down from 37, as D071/D072/T075 each wired up a previously-orphaned area).

| Route | What it does | Where it belongs |
|---|---|---|
| `GET /api/health` | Liveness/readiness probe, unauthenticated | None needed — polled by Dockerfile HEALTHCHECK/CI, not person-facing |
| `POST /api/projects/{id}/graph-projection` | Rebuilds the project's Neo4j graph projection from Postgres, whole-project (ADR 0002) | A Graph analytics panel that doesn't exist yet, feeding the 4 graph/* routes below |
| `GET /api/projects/{id}/graph/path` | How two objects are connected (variable-length Neo4j traversal) | Object/Connections detail — "how are these connected?" action |
| `GET /api/projects/{id}/graph/centrality` | Most-connected objects, a structural fact not a research finding | Overview or Connections — a "most connected" insight panel |
| `GET /api/projects/{id}/graph/communities` | Clusters objects grouping through recorded relationships | A graph-visualization view on Connections |
| `GET /api/projects/{id}/graph/reachable` | Everything derived from/contributing to one object at any depth | Object detail's provenance/lineage section |
| `POST /api/projects/{id}/findings/{id}/library-note` | Writes/updates a finding's note in the researcher's Zotero library idempotently, per-request credentials never stored | Findings screen — needs a "save to Zotero" button; currently only reads the note (librarynote.tsx) |
| `POST /api/projects/{id}/objects` | Creates a new research object directly (title, description, metadata, derived_from lineage) | The Objects/dataset screen, which lets a user question an object but never create one |
| `GET /api/retrievals/{event_id}` | Audits exactly which passages an answer was built from | Q&A/finding-evidence screen — a "show sources" link next to an answer; Search sources already shows a bare `retrieval_event_id` string with no way to open it |
| `GET /api/validations/{report_id}` | Fetches one validation report by id | Connections/Findings validation flow — a "view this validation" link |
| `GET /api/projects/{id}/artifacts/{id}/staleness` | Lists every export of one document and whether each still reflects the current analysis | Exports screen — per-document staleness badge/drill-down |
| `GET /api/projects/{id}/deviations/{registration_id}` | Compares one pre-registration against one analysis field by field | Deviations/Preregistration screen — per-registration detail drill-down |
| `GET /api/visuals/{visual_id}` | Loads one figure's full spec plus its renders | ~~Saved Figures screen — needs an 'open figure' detail view~~ **(critic correction)**: this component now exists (`components/savedfigures.tsx`) and calls this route — the reachability report's entry here is stale, or the guard's regex missed the caller |
| `GET /api/workflows/{run_id}` | Full detail of one workflow run | Workflow/approval screen — a "view this run" detail page |
| `POST /api/projects/{id}/reconcile` | Compares two specific claims directly (constructs, populations, outcome definitions, estimands), deterministic | Findings/claims detail — a per-claim-pair "reconcile" control (Compare currently uses the coarser `/reconcile-papers`) |
| `POST /api/projects/{id}/exploration/tests` | Records one statistical "look" and returns the updated exploration ledger | By design not client-posted — server records looks as they happen |
| `POST /api/speech/transcribe` | Turns raw 16kHz mono audio into timed words locally | By design unused — voice input runs client-side via the browser's speech API for privacy |

Total routes: 185. Unreachable: 17 (16 confirmed still orphaned + 1 corrected by the critic to "reachable via SavedFigures").

---

## 4. Capabilities Only in the Palette or by URL

- **Command palette itself exposes no exclusive capability** — it only fuzzy-navigates to sections/sources/connections/findings already reachable via the rail and list screens.
- **`/case-compare`** (`apps/web/app/case-compare/page.tsx`) — reachable only by direct URL, but this is a documented, deliberate deep link (see `WITHOUT_A_LINK` in `apps/web/tests/pages-are-reachable.test.ts`): it opens CaseCompare directly for a researcher handed a specific case, skipping the tab-finding step. Everything on it is also reachable via Compare → Scan↔scan.
- **`/charts-3d`, `/gesture-check`, `/air-ink`** — historically URL-only (the defect D070 described), but are now linked from the Shell nav's "This machine" group per `shell-nav.test.tsx` / `rail-follows-the-work.test.ts`. No longer palette/URL-only.
- **Discover's deep-link auto-start** — pre-fills and immediately fires a sweep when arriving from a source's "Discover connections" button; reachable only via that callback, not as a control on the Discovery screen itself (views.tsx:609-616; page.tsx:610-615).

---

## 5. Critic's Additions and Corrections (summary index)

All individually applied in place above; indexed here for the design panel's convenience.

**Corrections to existing entries (misclassifications):**
1. `/air-ink` Straightedge tool: `behind_mode` → `visible` (critic)
2. `/air-ink` Multiple layers: `behind_menu` → `visible` (critic)
3. `/gesture-check` "Calibrate": `visible`, wrong file → `behind_mode`, actually in SpatialControl.tsx (critic)
4. `/gesture-check` "Try hand gestures"/"Turn on the camera": `visible`, wrong file → `behind_mode`, actually in SpatialControl.tsx (critic)
5. `/gesture-check` "Hand outline" toggle: `visible`, location "not confirmed" → `behind_mode`, actually in SpatialControl.tsx (critic)
6. Command palette "20 rail sections" → actually 23 (critic)
7. Workboard region rename/nudge/remove: `visible` → `behind_mode` (critic)
8. Findings library-note preview body + no-Zotero statement: `visible` → `behind_toggle` (critic)
9. Fragility assumptions `<details>`: parent capability classified "visible" despite closed-by-default disclosure — flagged as an inconsistency (critic)
10. `/charts-3d` CatalogueBrowser: one static "visible" readout → an interactive family-filter `<select>` plus per-entry draw button (critic)
11. Reachability report's `GET /api/visuals/{visual_id}` "unreachable, needs a Saved Figures screen": corrected — SavedFigures component exists and calls it; entry is stale (critic)
12. Board card detail `dead_end: false` → `true`, per the screen's own friction entry (critic)
13. Inspector's recommended-next-action / dead_end:true — **verified correct** by the critic, not overturned (critic)

**Entire screens/capabilities added (missing from all base inventories):** Reports, Figures, Publish (figure), SavedFigures, Bibliography/Exports, Notebook, Settings, DataSearch, Read a figure, Research graph (graphview/KnowledgeGraph/NodeJournal/ObjectVersions), Chart primitives (Gallery), ChartTable, ChartExport, chart interaction/linked, Volume 3D-scatter keyboard+selection, SpatialControl panel (11 controls), haptics self-test, Notebook graph, MapView, Specialist file viewers, ViewTabs arrow-key tab strips. (Full detail under §2 "Critic-added screens".)

---

## 6. Ranked: Ten Most Consequential Hidden Capabilities

Ranked by the critic's own framing of stakes (irreversibility, headline-capability lockout, or credibility-load-bearing) rather than by how deep the gating is:

1. **Report export blocked while integrity reports problems, and per-block provenance trace** (reports.tsx:267-290, :352,371-380) — the product's terminal act (getting work out to a co-author) is `detail_only`, reachable only from a Reports screen no group opened; the provenance guarantee behind every cited number is invisible unless a reader presses a per-block toggle.
2. **Full keyboard operation of the 3D scatter, including selection** (Volume.tsx:735-780) — a keyboard-only researcher was, until this, "locked out of the product's headline capability, not merely inconvenienced," since selection is what feeds a question to the assistant.
3. **The SpatialControl consent-and-control panel** (SpatialControl.tsx:615-931) — 11 controls (pause/resume, turn off camera, calibrate, hands-free "Reset the view", sensitivity, camera preview/hand outline, device picker) misattributed by every group to `/gesture-check`; a researcher whose tracking fails has no idea these exist where they actually live.
4. **Every chart's data-table fallback** (ChartTable.tsx, 15 primitives) — the only non-visual path to a figure's underlying values and the only place truncation is disclosed; unopened, a 5,000-row figure silently reads as 200.
5. **Publishing a figure through the server vs. the DOM "Save this view" export** (publish.tsx vs figures.tsx:744-762) — a near-identical label sits directly above the real one; taking the DOM export silently loses the lineage edge, the figure critic, and journal-required formats, producing a file that looks fine.
6. **Notebook lint ("Check the notebook")** (notebook.tsx:341-375) — `stale_evidence`, `unwritten_page`, `isolated`, `no-source` findings behind an unlabelled button on a screen no group opened; `stale_evidence` is the notebook's counterpart to the Exports staleness panel.
7. **Object version restore-forward** (objectversions.tsx) — the one recovery path for an edited research object, three clicks deep (Research graph → node → NodeJournal) in a section no group opened.
8. **Bibliography / project take-away exports** (bibliography.tsx:48,76,104) — results.csv, snapshot.zip, and a shown-not-downloaded .bib; `bibliography.py` "produced this for some time" with "no route, no control" until wired here.
9. **`GET /api/retrievals/{event_id}`** (§3) — the one id shown next to every search result (`retrieval_event_id`) is the one thing on that screen that cannot be opened; it is the sole non-detail-only entry that is genuinely a dead end by omission rather than by design.
10. **Spatial-chart export (still + orbit video)** (ChartExport.tsx) — before this, "the last step of the work this product exists for… ended at a screenshot"; the orbit video is the only artifact carrying the motion-parallax depth cue the 3D charts exist to provide.

---

## 7. Constraints — Recorded Design Decisions (with file references)

*Grouped by area; each is a decision a redesign must reckon with, not merely a stylistic note.*

**Navigation / shell**
- Workboard is deliberately first in the rail, ahead of Overview — Shell.tsx:48-54 (§4, §109).
- "Search sources"/"Find papers"/"Find data" encode a have-it/get-it distinction — Shell.tsx:64-83.
- Analyses→Connections→Findings ordered to match the data model, not recency — Shell.tsx:97-111.
- "Research graph" renamed to avoid colliding with the per-finding evidence graph — Shell.tsx:115-124.
- Journal and Activity are not redundant: Activity exists specifically because audit_log had "nine writers and no readers" — Shell.tsx:143-153.
- The three "This machine" pages were fully built but reachable only by URL until recently — Shell.tsx:182-203.
- ProjectMenu/AccountMenu/CommandPalette all independently fix hand-rolled popups that declared ARIA roles but answered no arrow key — ProjectMenu.tsx:21-44; AccountMenu.tsx:48-51; CommandPalette.tsx:219-238.
- Project deletion is never optimistic, and shows real counts before confirming — ProjectMenu.tsx:11-19.
- The command palette explicitly disclaims natural-language parsing rather than faking it — CommandPalette.tsx:3-14,288.
- The theme toggle is deliberately three-way because exports always render light — Theme.tsx:6-16.
- The address bar carries project+section+item together with pushState so Back is one step — page.tsx:280-289 (D196).
- "Open a thing of a kind, in the section that shows it" is the one navigation rule every in-view link follows — page.tsx:294-303 (D195).
- Discovery-map/sources/analyses/connections/findings are re-fetched on section change and polled only while `in_flight > 0` — page.tsx:389-395 (D194).
- Tab strips (ViewTabs) are deliberately hand-built, not a library component, because a menu is hard and a tab strip is "small enough to read in one sitting" — ViewTabs.tsx:21-34.
- The confirmation dialog is native `<dialog showModal()>`, focus lands on Cancel not the destructive button, typed-name confirmation only where the loss is unbounded — ConfirmDialog.tsx:1-22.

**Data integrity / "nothing computed in the browser"**
- Every number shown comes from the API — views.tsx:6-9; extended to cohorts (cohorts.tsx:76-79).
- A finding is recorded FROM a result, deliberately not from the Findings list — recordfinding.tsx:14-19.
- Causal status is never offered as a choice at record time — recordfinding.tsx:25-29,147-156.
- A subset is defined from the schema that produced it, not from a list-level "add" — cohorts.tsx.
- An alias is chosen from a dropdown of variables the project has, never typed free-text — variables.tsx:317-320.
- A q-value means nothing without the number of tests it was corrected across, stated near-verbatim in three places — views.tsx:650-651; sweep.tsx:12-13; ledger.tsx:6-9.
- The exploration ledger does not warn or use alarm styling — ledger.tsx:14-17.
- Deviations states, never scolds; a deviation losing its exemption is still shown as offered against a plan — deviations.tsx:12-17,19-22.
- The deviations narrative drafter leaves every "why" blank on purpose — deviations.tsx:24-27.
- Pre-registration direction is a required field because "a prediction that cannot be wrong is a description" — preregister.tsx:19-23,162-165.
- Withdrawn sources and contradictions are both explicitly not styled as alarms — withdrawn.tsx:20-23.

**Verdicts / refusals**
- A refusal is a full artifact, not a disabled button, restated across compare.tsx:3-16, claimtest.tsx:3-14, multicompare.tsx:244-263, synthesis.tsx:12-14, reconcile.tsx:6-11.
- "What can still be done" appears beside nearly every negative verdict — compare.tsx:418-427; Verdict.tsx:144-152; claimtest.tsx:270-287.
- Every verdict across Compare/Consistency/Reconcile/Patterns renders through one shared VerdictCard — Verdict.tsx:6-10.
- Multiplicity/denominator-first framing recurs everywhere multiple comparisons run — patterns.tsx:8-11,231-257; multicompare.tsx:124-130,366-381.
- Compare is deliberately ONE screen with 8 tabs, not 8 features — compare.tsx:70-77.
- The two-slot picker gesture is reused verbatim across Dataset↔dataset and Paper↔paper — compare.tsx:103-117; reconcile.tsx:72-74.
- CaseCompare partitions rather than ranks scans — a product-boundary decision: appearance in medical imaging is dominated by acquisition, so a ranked grid "would mostly be a list of scans taken on the same machine" — CaseWorkspace.tsx:1-20.
- The gallery includes two deliberate refusals (negative-value hierarchy, cyclic flow) so it doesn't misrepresent the primitives — gallery.tsx:1-14.
- Three shared loading/empty/failure states exist "so no view can quietly omit one" — primitives.tsx:1-5.

**Provenance / reproducibility**
- ResultCard's central law: the sentence comes first and is always visible; numbers are labelled in words; progressive disclosure never removes a layer — ResultCard.tsx:1-25.
- Provenance is duplicated across 3 unrelated mechanisms (Trace chain, ProvenanceLog downloads, ReportBlock trace) with nothing linking them — views.tsx:1454-1521; provenancelog.tsx.
- Origin (sweep/specified/fork) is treated as first-class, never flattened — analyses.tsx:26-31; ResultCard.tsx:224-230.
- The three-state robustness-check pattern (unanswered/passed/failed, never a boolean) recurs and is explicitly argued for — lifecycle.tsx:14-20,71-78.
- "Not testable"/refusal-as-answer is a house style — Verdict.tsx:14-17; Fragility.tsx:55-59; analyses.tsx:172-176 (PlainReading).
- The same 6 checks are asked twice in two UIs kept in sync by hand (machine-run ValidationReports vs human-answered radios) — views.tsx:1397-1448; lifecycle.tsx:207-248,117-123.
- LEGAL_NEXT/REQUIRED_CHECKS in lifecycle.tsx are a checked-in copy of server constants, with a test that fails on drift — lifecycle.tsx:40-47,53-60.
- Notes are append-only — no edit button; "you correct a note by writing another one" — NodeJournal.tsx:1-20.
- Restoring an object version adds to history rather than rewriting it, described as "bringing content forward," never "revert" — objectversions.tsx:1-17.
- Report export is blocked while integrity reports problems: "a file outlives the warning" — reports.tsx:274-292.
- Every export format is produced from one resolved artifact so none can state a different number — reports.tsx:211,253-266,267-271.
- Only connections with a recorded `analysis_run_id` may start a report (§80) — reports.tsx:39-41.
- Citations carry their entailment state including `unverified` — reports.tsx:4-14.
- A saved figure's title/caption may be edited but never its rows/variables ("a redraw would leave the old statistics on new data") — savedfigures.tsx:12-21.
- Every chart's data table discloses truncation rather than capping silently — ChartTable.tsx:1-21.
- Provenance log / reproduction script downloads are functionally unrelated to, but named confusingly like, the Trace provenance chain — provenancelog.tsx; views.tsx.

**Charts / spatial**
- A 3D chart must argue against itself: occlusion count and perspective distortion measured every frame, put in the caption (§10) — Bars3D.tsx:10-17,142; Network3D.tsx:152; VoxelVolume.tsx:209; Isosurface3D.tsx:123.
- Rotation is the depth cue, not a convenience, which is why the keyboard path exists on every spatial chart — Bars3D.tsx:138-143.
- The keyboard reaches everything the pointer does, selection included (§30, Rule 5); aim-and-press at the view centre with a crosshair, no invented cursor — Volume.tsx:739-756.
- A gesture must earn its place (§9, Rule 6): anything only changing HOW MANY points the same act gathers is a slider, never a second gesture — Volume.tsx:100-108; embeddingspace.tsx:230-244.
- Linked/brushed selection is opt-in and key-scoped; "a selection is not a finding" — linked.tsx:1-29.
- Hover emphasis is neighbourhood-scoped and object-constant (class+opacity, never a remount) — interaction.tsx:1-24.
- The camera is explained before it is requested, never after; nothing starts on mount — SpatialControl.tsx:1-19.
- Onboarding is skippable per-step, never a gate (§97) — SpatialControl.tsx:673-704.
- A feedback switch is offered only for a channel that exists — SpatialControl.tsx:868-878; same law in specialist/mount.tsx:10-14.
- Cards on the Workboard are real DOM elements, never canvas/WebGL sprites — Board.tsx:19-22.
- Single-transform layout: the whole board plane is scaled/shifted together as one compositor operation — Board.tsx:12-17.
- Drag persistence is batched: server hears once, on release, not per pointer event — Board.tsx:24-27.
- Soft-delete-with-undo (§96) is a recorded product decision for card removal — Board.tsx:127-135.
- Regions/layers/tidy-plan are one idea, not three (§54) — Board.tsx:666-668.
- The knowledge graph is canvas for performance and therefore states its own contents as a real DOM `<details>` table for keyboard/screen-reader access — graphview.tsx:1-8; KnowledgeGraph.tsx:642. Its own prior performance claim was found wrong and the header now says so explicitly — KnowledgeGraph.tsx:9-22.
- Notebook graph edges have kinds (asserted vs computed) and are never drawn identically — notegraph.tsx:1-25.
- Specialist viewers: the file never leaves the browser; render nothing (not a disabled placeholder) if nothing is offerable — specialist/mount.tsx:1-17.

**Literature / data discovery**
- Literature shows database disagreement with the source named rather than silently picking one — literature.tsx:3-22.
- A failing database is reported beside arriving results ("no results" vs "did not answer" are different facts) — literature.tsx:18-22.
- Harvest deliberately has no query box because OAI-PMH cannot be searched; Identify runs first and separately; the record ceiling is visible/editable; truncation is reported, not hidden — harvest.tsx:1-28.
- DataSearch is deliberately separate from Literature ("a paper is cited; a dataset is computed on"); unusable records shown dimmed with the blocker named, never filtered out; "not stated" ≠ "no" — datasearch.tsx:3-24.
- Digitising a figure: clicks are recorded in the image's own pixels, not the screen's, to avoid a plausible-but-uniformly-wrong error; log/linear declaration is an explicit attestation the tool refuses to guess — readfigure.tsx:1-30,244-256.
- The excerpt board ("Taken from papers") lives outside the reader so returning to results doesn't discard what was taken; every entry carries a page-numbered citation — literature.tsx:441-465.

**Settings / model**
- Settings must never claim model choice is "identical whichever you choose" — the trade is recall (coverage), not rigour, and must be stated as such — settings.tsx:18-32,43-53.
- A cloud (`:cloud`) model must be visibly distinguished from a local one — settings.tsx:43-53.
- Which version produced a result is part of that result; an installation that cannot establish its version says so rather than guessing — settings.tsx:446-472.
- Neo4j absence is a reduced feature set, never a broken record (ADR 0002) — settings.tsx:980-1000.

---

## 8. Cross-Cutting Observations

**Recurring design laws, observed across multiple independent groups:**
- An action is placed where its triggering context already exists, never as a bare list-level "add" button (finding-from-a-result, subset-from-a-schema, alias-from-a-dropdown) — a redesign that lifts any of these to a generic list-level button reintroduces the exact failure mode the code comments describe.
- Deliberate non-alarm styling recurs for withdrawn sources, contradictions, deviations, and challenge verdicts — the product's stated theory is that a screen that shouts gets dismissed and is missed the one time it matters.
- Panels are placed "above" or "directly under" another element rather than given their own nav section, each time with a stated rationale (WithdrawnSources above Sources; Contradictions under Overview's meters) — a redesign turning these into standalone nav items should reckon with why they currently are not.
- "Nothing is computed in the browser" is a hard architectural rule, restated independently in views.tsx and cohorts.tsx.
- Jargon without on-screen glossary recurs relentlessly: q-value/p-value/FDR/Benjamini-Hochberg, lifecycle_status, canonical/harmonization, estimand, strategy/lexical/semantic/retrieval_event_id, deixis/stabilisation level, distributional assumption — no group found a glossary anywhere in the product.
- Refusal-as-a-full-artifact and "what can still be done" are stated as explicit laws in at least 5 independent files (compare, claimtest, multicompare, synthesis, reconcile) — this is a house style, not a coincidence.
- Two genuine (non-deliberate) wiring gaps recur across groups: a prop/handler threaded through with nowhere to land (`CohortTree.onSelect`, `DatabaseTables.onImported`, and historically `lib/board/history.ts`'s undo) — CardDetail.tsx:6-9 names this pattern explicitly as one "this codebase has produced three times already."
- A recurring meta-pattern across the whole product's own history: substantial, fully-built capabilities with zero caller anywhere in the interface, discovered and wired up one at a time (Consistency's manual picker, claim-test's stored-reading GET, Patterns' Diagnostics tab, RunAnalysis's whole POST route, CardDetail's `/impact` and `/mentions`, SavedFigures' `GET`/`PATCH /visuals`, Reports, Figures, Publish, Notebook, Settings, DataSearch, ReadFigure, Research graph, Gallery, ChartExport, SpatialControl, notegraph, MapView, specialist viewers, ViewTabs). A "simplification" redesign must not re-hide any of these behind fewer, more generic screens — that is exactly the failure mode that produced them as dead code in the first place.
- TRY_IT.md's documented "first pass" (Overview → Sources → Findings/Connections → Chart primitives → Embedding space) and its "testing the rest of the interface" section together omit: Workboard, Contradictions, Variables, Search sources, Discovery, the Exploration Ledger, Deviations, Pre-registration, Compare (all 8 tabs), Patterns (all 3 tabs), Specify-an-analysis, and — per the critic — Reports, Figures, Notebook, Settings, DataSearch, Read a figure, Research graph, and the Gallery. This is not a minor omission: the documented onboarding path and the actual capability surface have substantially diverged, and nearly every group independently flagged this same gap.
- A model's note and a person's note must never be styled differently (NodeJournal.tsx / journal.tsx) — a repeated instance of "the distinction is decorative" being explicitly rejected as a UI principle.
- Every rotatable/spatial control's actual home (SpatialControl.tsx) was independently misattributed by every group that touched hand tracking to the wrong file (`/gesture-check`) — a documentation/traceability failure the critic surfaces as systemic, not a one-off.
- Truncation-without-disclosure is a recurring, unfixed defect distinct from the deliberate-disclosure pattern above: the shared `ConnectionsTable` component caps at 100 rows (Discover) or 200 rows (Connections) with no "showing N of M" notice on either instance, unlike `ChartTable` and `CardDetail`'s dependents list, which do disclose. A redesign should treat this as a bug to fix, not a design decision to preserve.
