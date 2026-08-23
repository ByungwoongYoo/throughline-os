# Requirements ledger

Every section of `docs/MASTER_BUILD_PROMPT.md`, and what exists against it.

This file is the answer to "remember each and every line". A specification of 236
sections cannot be held reliably in anybody's head, and it certainly cannot
survive a model's context being compacted — which happened twice while building
against it. A remembered specification loses requirements *silently*, which is
the whole problem. So every section has a row here, and
`tests/test_requirements_ledger.py` fails the build if one goes missing, if a
status is invented, if a file named here does not exist, or if the specification
itself changes without the ledger being revisited.

## What the statuses mean

| Status | Meaning |
|---|---|
| `built` | Implemented, and covered by the test named in the row. |
| `partial` | Some of it exists. The note says what does not. |
| `not-built` | Assessed against the code. Nothing yet, deliberately or not. |
| `unreviewed` | **Not yet assessed.** No claim either way. |

`unreviewed` is the important one. It would have been easy to fill all 236 rows
with plausible-looking judgements, and every wrong one would be a false claim of
coverage in the document whose entire purpose is to prevent false claims of
coverage. A row is only moved off `unreviewed` when somebody has read the section
and looked at the code. The test requires the count never to grow.

## Where it stands

| Status | Sections |
|---|---|
| built | 60 |
| partial | 19 |
| not-built | 13 |
| unreviewed | 144 |
| **total** | **236** |

Nothing here has been verified by anybody other than its author. `TASKS.md`
tracks that separately, and its *Verified* table is still empty.

The specification this tracks is pinned at `sha256 = b7bfb4cce514141ec1272bddb23fd3e944711645d3b251b1b0a13ccf227a4dcd`.
If that changes, `tests/test_requirements_ledger.py` fails until this file is
revisited — an edited specification is exactly when requirements go missing.

## The ledger

| § | Section | Status | Code | Test | Note |
|---|---|---|---|---|---|
| §1 | PRIMARY PRODUCT VISION | unreviewed |  |  |  |
| §2 | THE FUNDAMENTAL ARCHITECTURAL PRINCIPLE | unreviewed |  |  |  |
| §3 | PRODUCT EXPERIENCE | unreviewed |  |  |  |
| §4 | THE RESEARCH WORKBOARD | unreviewed |  |  |  |
| §5 | RESEARCH OBJECT MODEL | unreviewed |  |  |  |
| §6 | OBJECT SEMANTICS | unreviewed |  |  |  |
| §7 | THE OBJECT CONNECTION SYSTEM | unreviewed |  |  |  |
| §8 | DRAG-AND-DROP INTELLIGENCE | unreviewed |  |  |  |
| §9 | UNIVERSAL VISUALIZATION SYSTEM | unreviewed |  |  |  |
| §10 | DO NOT FORCE 3D | built | apps/web/components/charts/ | apps/web/tests/chart-conformance.test.tsx | Honoured as a refusal: the ten 2D charts stayed 2D, and only z=f(x,y) and point clouds became spatial. |
| §11 | CHART CREATION | unreviewed |  |  |  |
| §12 | SMART VISUALIZATION RECOMMENDATIONS | unreviewed |  |  |  |
| §13 | SPATIAL INTERACTION MODE | built | apps/web/components/spatial/SpatialControl.tsx | apps/web/tests/spatial-control.test.tsx | Opt-in, explained before the camera is requested, never required. |
| §14 | GESTURE DESIGN PRINCIPLE | built | apps/web/lib/spatial/machine.ts | apps/web/tests/spatial-machine.test.ts | Point, pinch, pinch+move, two-hand distance, release. No symbolic vocabulary. |
| §15 | GESTURE A | built | apps/web/lib/spatial/machine.ts | apps/web/tests/spatial-machine.test.ts | Proximity scoring and sticky targeting; pixel-perfect pointing never required. |
| §16 | GESTURE B | built | apps/web/lib/spatial/machine.ts | apps/web/tests/spatial-machine.test.ts | Pinch as clutch, with hysteresis. |
| §17 | GESTURE C | built | apps/web/lib/spatial/machine.ts | apps/web/tests/spatial-machine.test.ts | Relative two-hand distance, smoothed and clamped. |
| §18 | GESTURE D | built | apps/web/lib/charts/scene3d.ts | apps/web/tests/chart-conformance.test.tsx | Rotation, in viewport pixels across the seam. |
| §19 | GESTURE E | built | apps/web/lib/spatial/machine.ts | apps/web/tests/chart-conformance.test.tsx | Point then pinch selects; selection persists. |
| §20 | DELETION AND | not-built |  |  | No deletion or throw-away gesture. Deliberate: destructive actions by gesture need §96 first. |
| §21 | SPATIAL PHYSICS | not-built |  |  | No spatial physics. |
| §22 | PSEUDO-WEIGHT | not-built |  |  | No pseudo-weight. |
| §23 | HAPTICS ARCHITECTURE | built | apps/web/lib/spatial/feedback.ts | apps/web/tests/spatial-control.test.tsx | Real macOS trackpad haptics via the local API. Cannot be felt mid-air, which is stated rather than implied. |
| §24 | PSEUDO-HAPTICS | partial | apps/web/lib/spatial/feedback.ts | apps/web/tests/spatial-control.test.tsx | Detents exist; no visual resistance or pseudo-force. |
| §25 | AUDIO FEEDBACK | built | apps/web/lib/spatial/feedback.ts | apps/web/tests/feedback.test.ts | A short click on a lazily created AudioContext, off by default because a research tool that clicks in a shared office gets muted on the first afternoon and then there is no feedback at all. |
| §26 | GESTURE STATE MACHINE | built | apps/web/lib/spatial/machine.ts | apps/web/tests/spatial-machine.test.ts | Explicit states and transitions. |
| §27 | HYSTERESIS | built | apps/web/lib/spatial/machine.ts | apps/web/tests/spatial-machine.test.ts | Separate on/off thresholds throughout. |
| §28 | LANDMARK PROCESSING | built | apps/web/lib/spatial/mediapipe.ts | apps/web/tests/spatial-mediapipe.test.ts | Vendored model and WASM; never a CDN. |
| §29 | SMOOTHING | built | apps/web/lib/spatial/filter.ts | apps/web/tests/ink-stabilise.test.ts | One Euro, tuned separately for the scene and for the pen. |
| §30 | DEAD ZONES | built | apps/web/lib/ink/stabilise.ts | apps/web/tests/ink-stabilise.test.ts | Dead zones on both paths; measured, not assumed. |
| §31 | TRACKING FAILURE | built | apps/web/lib/spatial/session.ts | apps/web/tests/spatial-session.test.ts | Loss ends an open stroke rather than bridging it. |
| §32 | MULTIPLE PEOPLE | built | apps/web/lib/spatial/machine.ts | apps/web/tests/spatial-machine.test.ts | One acting hand chosen; spike rejection on raw landmarks. |
| §33 | CALIBRATION | built | apps/web/lib/spatial/calibration.ts | apps/web/tests/spatial-calibration.test.ts | Two-pose, offered and never required. |
| §34 | CAMERA UX | built | apps/web/lib/spatial/camera.ts | apps/web/tests/spatial-control.test.tsx | Device picker, preview, explicit off. |
| §35 | PRIVACY | built | apps/web/components/spatial/SpatialControl.tsx | apps/web/tests/spatial-control.test.tsx | All inference local; no frame leaves the machine; counts only in telemetry. |
| §36 | AI RESEARCH ASSISTANT | partial | packages/research-domain/src/throughline_domain/selection.py | tests/test_selection.py | A selection becomes AI context, computed rather than asserted. There is no ResearchContextEngine: filters, chart configuration, spatial focus and recent actions are not part of what the assistant is told. |
| §37 | DEICTIC REFERENCES | partial | apps/web/lib/voice/deixis.ts | apps/web/tests/voice-fusion.test.ts | "this"/"these"/"that"/"those" resolve against the gesture timeline, each word at its own moment. An unresolved word is refused rather than defaulted. Not wired to a live recogniser, and current focus and recent objects are not yet inputs. |
| §38 | GESTURE | partial | apps/web/lib/voice/timeline.ts | apps/web/tests/voice-fusion.test.ts | The fusion is built and covers the specification's own timing case — a word spoken while the circle is still being drawn. No recogniser is connected, so it runs from typed input today. |
| §39 | AI SHOULD OPERATE THROUGH COMMANDS | built | apps/web/lib/voice/intent.ts | apps/web/tests/voice-fusion.test.ts | Speech produces a validated structured intent and never an action. A closed verb set, refused clearly rather than misinterpreted confidently, and confirmed before anything happens. |
| §40 | AI ANALYTICAL GUARDRAILS | built | packages/research-domain/src/throughline_domain/critic.py | tests/test_claim_test.py | Observation, calculation, inference and interpretation are kept apart throughout; a fitted surface says it is a fit, and a hand-drawn selection says it is not a sample. |
| §41 | RESEARCH PROVENANCE | built | packages/research-domain/src/throughline_domain/lineage.py | tests/test_lineage.py | Every consequential transformation is recorded and inspectable. |
| §42 | UNDO / REDO | partial | apps/web/lib/ink/history.ts | apps/web/tests/ink-history.test.ts | Undo and redo for the destructive action that exists: clearing the canvas, which discarded every annotation permanently, plus per-stroke undo. Both name what they would do. Movement, filters, transformations and model changes are not covered because those actions do not exist in the gesture layer yet. |
| §43 | HISTORY | partial | packages/research-domain/src/throughline_domain/events.py | tests/test_objects.py | The timeline exists as data — domain events and an audit log — with no history view and no restore to a previous state. |
| §44 | BRANCHING | built | packages/research-domain/src/throughline_domain/lineage_forks.py | tests/test_lineage_forks.py | Forks are first-class and read back as branches; nothing counts a fork against the researcher. |
| §45 | DATA INGESTION | partial | packages/ingestion/src/throughline_ingestion/datasets.py | tests/test_dataset_formats.py | CSV, TSV, XLSX, JSON, Parquet and Arrow. No SQL, no APIs, no scientific or geographic formats. |
| §46 | DATA PROFILING | partial | packages/ingestion/src/throughline_ingestion/datasets.py | tests/test_ingestion.py | Row count, column types, missing fractions and numeric ranges. No duplicates, categories, candidate identifiers, unit detection or anomalies. Uploaded data is never altered. |
| §47 | LARGE DATASETS | partial | packages/ingestion/src/throughline_ingestion/datasets.py | tests/test_ingestion.py | Sampling above a row limit, and the sample is declared rather than hidden. No aggregation, level of detail, tiling, streaming or GPU path. |
| §48 | VISUALIZATION CONTROLLER | built | apps/web/lib/spatial/commands.ts | apps/web/tests/chart-conformance.test.tsx | One seam, exhaustively typed, and now one conformance suite for every chart behind it. |
| §49 | THREE-DIMENSIONAL RENDERING | built | apps/web/lib/charts/scene3d.ts | apps/web/tests/scene3d.test.ts | One shared projection. T043 fixed it never fitting its own canvas. |
| §50 | GPU STRATEGY | not-built |  |  | No WebGL, WebGPU, instancing or GPU compute. Deliberate and recorded in scene3d.ts: a scene graph is ~600KB for what is, at this scale, a 4x4 matrix and a sort, and the premise is a laptop install. Revisited when a chart genuinely cannot be drawn on canvas. |
| §51 | RENDER LOOP | partial | apps/web/lib/charts/scene3d.ts | apps/web/tests/volume-paint.test.tsx | Rendering is rAF-driven behind a dirty flag, independent of the tracker's 30Hz. Interpolation between gesture states is *declined*: it smooths by rendering a lagged position, which trades away the latency this subsystem is tuned for, and the One Euro filter already smooths the input. |
| §52 | PERFORMANCE BUDGETS | partial | apps/web/lib/spatial/latency.ts | apps/web/tests/latency.test.ts | End-to-end frame-to-response and hand-detection latency are measured as p50/p95/p99 with a budget, and shown on /gesture-check. Render latency, dropped frames, memory, GPU usage, startup and import time are not. |
| §53 | MAIN THREAD PROTECTION | not-built |  |  | Nothing is off the UI thread: inference, the gesture machine and painting all run on it. Now measured rather than assumed — /gesture-check reports what inference alone costs against an 8ms budget, half a 60Hz frame — so a worker migration can be justified by a number instead of by the specification listing workers. |
| §54 | WORKSPACE LAYOUT | unreviewed |  |  |  |
| §55 | FOCUS MODE | unreviewed |  |  |  |
| §56 | COMMAND PALETTE | unreviewed |  |  |  |
| §57 | SEARCH | unreviewed |  |  |  |
| §58 | AI-GENERATED WORKSPACES | unreviewed |  |  |  |
| §59 | AI AGENTS AS RESEARCH OBJECTS | unreviewed |  |  |  |
| §60 | COMPUTATIONAL PIPELINES | unreviewed |  |  |  |
| §61 | CODE INTEGRATION | unreviewed |  |  |  |
| §62 | STATISTICS SYSTEM | unreviewed |  |  |  |
| §63 | SCIENTIFIC UNITS | unreviewed |  |  |  |
| §64 | FILTERING | unreviewed |  |  |  |
| §65 | CROSS-FILTERING | unreviewed |  |  |  |
| §66 | TEMPORAL DATA | unreviewed |  |  |  |
| §67 | SIMULATION MODE | unreviewed |  |  |  |
| §68 | PARAMETER MANIPULATION A | unreviewed |  |  |  |
| §69 | PRESENTATION MODE | unreviewed |  |  |  |
| §70 | COLLABORATION | unreviewed |  |  |  |
| §71 | COLLABORATIVE AI CONTEXT | unreviewed |  |  |  |
| §72 | COMMENTS AND ANNOTATIONS | unreviewed |  |  |  |
| §73 | CITATIONS | unreviewed |  |  |  |
| §74 | RESEARCH REPORT GENERATION | unreviewed |  |  |  |
| §75 | EXPORT | unreviewed |  |  |  |
| §76 | SAVING | unreviewed |  |  |  |
| §77 | AUTOSAVE | unreviewed |  |  |  |
| §78 | OFFLINE / DEGRADED MODE | unreviewed |  |  |  |
| §79 | ACCESSIBILITY | unreviewed |  |  |  |
| §80 | MOTOR ACCESSIBILITY | unreviewed |  |  |  |
| §81 | REDUCED MOTION | unreviewed |  |  |  |
| §82 | COLOR | unreviewed |  |  |  |
| §83 | SECURITY | unreviewed |  |  |  |
| §84 | AI DATA BOUNDARIES | unreviewed |  |  |  |
| §85 | AUDITABILITY | built | packages/research-domain/src/throughline_domain/events.py | tests/test_deletion_is_recorded.py | An append-only audit log; deletions are recorded rather than vanishing. |
| §86 | TELEMETRY | unreviewed |  |  |  |
| §87 | FALSE ACTION METRIC | unreviewed |  |  |  |
| §88 | SUCCESS CRITERIA | unreviewed |  |  |  |
| §89 | TEST WITH REAL RESEARCHERS | unreviewed |  |  |  |
| §90 | ENVIRONMENTAL TESTING | unreviewed |  |  |  |
| §91 | DEVICE TESTING | unreviewed |  |  |  |
| §92 | ERROR HANDLING | unreviewed |  |  |  |
| §93 | SAFETY LIMITS | unreviewed |  |  |  |
| §94 | FEEDBACK SYSTEM | unreviewed |  |  |  |
| §95 | INTENT PREVIEW | unreviewed |  |  |  |
| §96 | DESTRUCTIVE ACTIONS | partial | apps/web/lib/ink/history.ts | apps/web/tests/ink-history.test.ts | The one destructive action here is now recoverable and its control says what it would take back — "Undo clearing 12 strokes" rather than "Undo". No confirmation step before destructive actions. |
| §97 | ONBOARDING | built | apps/web/lib/spatial/onboarding.ts | apps/web/tests/onboarding.test.ts | Point, pinch, move, release — advanced by evidence from the hand rather than by a Next button, so finishing it is proof that gestures work here and being stuck on a step is a precise report. Skippable a step at a time and entirely, blocks nothing, and shown once. |
| §98 | DISCOVERABILITY | built | apps/web/lib/spatial/cursor.ts | apps/web/tests/cursor.test.ts | What a pinch would do, shown beside the hand when the answer changes and whenever the hand goes still, and faded while it is moving — §98 asks for a cue and forbids permanent clutter, and a label pinned to the cursor is the version that loses. |
| §99 | SETTINGS | unreviewed |  |  |  |
| §100 | TECHNICAL MODULES | unreviewed |  |  |  |
| §101 | STATE MANAGEMENT | unreviewed |  |  |  |
| §102 | COMMAND ARCHITECTURE A | unreviewed |  |  |  |
| §103 | EVENT MODEL | unreviewed |  |  |  |
| §104 | PREFERRED IMPLEMENTATION DIRECTION | unreviewed |  |  |  |
| §105 | COMPONENT PERFORMANCE | unreviewed |  |  |  |
| §106 | MEMORY MANAGEMENT | unreviewed |  |  |  |
| §107 | LOADING | unreviewed |  |  |  |
| §108 | FEATURE FLAGS | unreviewed |  |  |  |
| §109 | DEVELOPMENT SEQUENCE | unreviewed |  |  |  |
| §110 | PHASE 1 | unreviewed |  |  |  |
| §111 | PHASE 2 | unreviewed |  |  |  |
| §112 | PHASE 3 | unreviewed |  |  |  |
| §113 | PHASE 4 | unreviewed |  |  |  |
| §114 | PHASE 5 | unreviewed |  |  |  |
| §115 | PHASE 6 | unreviewed |  |  |  |
| §116 | PHASE 7 | unreviewed |  |  |  |
| §117 | PHASE 8 | unreviewed |  |  |  |
| §118 | PHASE 9 | unreviewed |  |  |  |
| §119 | PHASE 10 | unreviewed |  |  |  |
| §120 | PHASE 11 | unreviewed |  |  |  |
| §121 | PHASE 12 | unreviewed |  |  |  |
| §122 | PHASE 13 | unreviewed |  |  |  |
| §123 | PHASE 14 | unreviewed |  |  |  |
| §124 | TEST STRATEGY | unreviewed |  |  |  |
| §125 | GESTURE RECORDING TEST HARNESS | unreviewed |  |  |  |
| §126 | DEBUG MODE | unreviewed |  |  |  |
| §127 | PERFORMANCE PROFILING | unreviewed |  |  |  |
| §128 | QUALITY BAR | unreviewed |  |  |  |
| §129 | ANTI-PATTERNS | unreviewed |  |  |  |
| §130 | THE DESIRED END-STATE | unreviewed |  |  |  |
| §131 | CORE PRODUCT DIFFERENTIATION | unreviewed |  |  |  |
| §132 | THE CONTINUOUS RESEARCH LOOP | unreviewed |  |  |  |
| §133 | FINAL NORTH STAR | unreviewed |  |  |  |
| §134 | IMPLEMENTATION INSTRUCTION | unreviewed |  |  |  |
| §135 | REQUIRED ENGINEERING OUTPUTS | unreviewed |  |  |  |
| §136 | FINAL NON-NEGOTIABLE RULES | unreviewed |  |  |  |
| §137 | AIR INK | built | apps/web/lib/ink/stroke.ts | apps/web/tests/ink.test.ts | Air Ink exists as a first-class subsystem. |
| §138 | WHY AIR INK MATTERS FOR RESEARCH | unreviewed |  |  |  |
| §139 | AIR INK MUST BE INTENTIONAL | built | apps/web/lib/ink/machine.ts | apps/web/tests/ink.test.ts | Two locks: armed, and pinched. Pointing never draws. |
| §140 | DRAWING STATE MACHINE | built | apps/web/lib/ink/machine.ts | apps/web/tests/ink.test.ts | Full drawing state machine. |
| §141 | THE FINGERTIP BECOMES A TOOL | built | apps/web/lib/ink/machine.ts | apps/web/tests/ink-stabilise.test.ts | The pen is the pinch midpoint, not the fingertip — T044. |
| §142 | PEN-DOWN FEEDBACK | built | apps/web/components/spatial/HandCursor.tsx | apps/web/tests/cursor.test.ts | A ring at the pinch point, an arc filling as the fingers close, and a pulse at the moment contact is accepted. The arc answers "am I drawing yet" continuously rather than confirming it afterwards, which is what makes a failing pinch diagnosable instead of silent. |
| §143 | DRAWING COORDINATE SYSTEMS | partial | apps/web/lib/spatial/commands.ts | apps/web/tests/chart-conformance.test.tsx | Screen space, plus the honest treatment of the case with no data-space equivalent: a screen loop over a rotatable 3D scene cannot be converted, because depth is ambiguous from one projection. An annotation therefore carries the view it was drawn in, says when that is no longer the view, and offers to go back to it. Object, data, world and surface spaces are still unimplemented — data space is well-posed for the 2D charts and is the next one worth building. |
| §144 | STROKE DATA MODEL | built | apps/web/lib/ink/stroke.ts | apps/web/tests/ink.test.ts | Structural stroke model: coordinate space, tool, style, author, per-point timestamp and confidence, the predicted flag, and originalPoints kept apart from the drawn copy so no later interpretation can overwrite what the hand did. |
| §145 | THE ZERO-LAG PRINCIPLE | built | apps/web/lib/ink/predict.ts | apps/web/tests/ink-recorder.test.ts | Short-horizon prediction, clamped and abandoned at corners. |
| §146 | DUAL-PATH DRAWING ARCHITECTURE | built | apps/web/components/spatial/InkLayer.tsx | apps/web/tests/ink-layer.test.tsx | Two canvases: cost per frame does not grow with the session. |
| §147 | PROVISIONAL INK | built | apps/web/components/spatial/InkLayer.tsx | apps/web/tests/ink-layer.test.tsx | The live layer is the provisional ink. |
| §148 | SHORT-HORIZON MOTION PREDICTION | built | apps/web/lib/ink/predict.ts | apps/web/tests/ink-recorder.test.ts | Never enters the record; at most one predicted point. |
| §149 | TARGET PERFORMANCE | partial | apps/web/lib/spatial/latency.ts | apps/web/tests/latency.test.ts | The budget is stated and measured at p50/p95/p99 with the fraction over it. Honest about being a floor: camera exposure and the compositor are outside what a page can see, and it says so rather than being quoted as camera-to-photons. |
| §150 | NO NETWORK IN THE DRAW LOOP | built | apps/web/lib/ink/recorder.ts | apps/web/tests/ink-recorder.test.ts | No network anywhere in the draw loop. |
| §151 | THREAD SEPARATION | unreviewed |  |  |  |
| §152 | GPU DRAWING | unreviewed |  |  |  |
| §153 | DRAWING QUALITY A | built | apps/web/lib/ink/stabilise.ts | apps/web/tests/ink-stabilise.test.ts | Confidence, spike rejection, adaptive smoothing, dead zone — in that order. |
| §154 | VELOCITY-AWARE SMOOTHING | built | apps/web/lib/ink/stabilise.ts | apps/web/tests/ink-stabilise.test.ts | Velocity-aware, and measured: over-smoothing was shown to damage a letter. |
| §155 | VIRTUAL PRESSURE A | unreviewed |  |  |  |
| §156 | SPATIAL DEPTH FOR DRAWING | unreviewed |  |  |  |
| §157 | DRAWING PLANES | unreviewed |  |  |  |
| §158 | SURFACE DRAWING | unreviewed |  |  |  |
| §159 | RESEARCH ANNOTATION | unreviewed |  |  |  |
| §160 | DRAW-TO-SELECT A | built | apps/web/lib/ink/select.ts | apps/web/tests/ink.test.ts | Draw-to-select, resolved exactly against the chart's own marks. |
| §161 | DRAW-TO-FILTER | unreviewed |  |  |  |
| §162 | DRAW-TO-GROUP | unreviewed |  |  |  |
| §163 | DRAW ARROWS TO CREATE RELATIONSHIPS | unreviewed |  |  |  |
| §164 | HAND-DRAWN GRAPHS | unreviewed |  |  |  |
| §165 | SKETCH-TO-VISUALIZATION A | unreviewed |  |  |  |
| §166 | DRAWING MATHEMATICS | not-built |  |  |  |
| §167 | DRAW-TO-CALCULATE A | not-built |  |  |  |
| §168 | SCIENTIFIC DIAGRAM RECOGNITION | not-built |  |  |  |
| §169 | HAND-DRAWN NETWORKS | not-built |  |  |  |
| §170 | DRAWING | unreviewed |  |  |  |
| §171 | SPEAK-TO-DRAW | unreviewed |  |  |  |
| §172 | VOICE-CONTROLLED PEN | unreviewed |  |  |  |
| §173 | DRAW AND TRANSFORM A | unreviewed |  |  |  |
| §174 | PRESERVE HUMAN INTENT | built | apps/web/lib/ink/shapes.ts | apps/web/tests/ink-shapes.test.ts | originalPoints is never rewritten by anything, and recognition returns a proposal rather than a replacement. Tested at the point it matters: a deliberately irregular boundary is left alone rather than offered as an ellipse. |
| §175 | ERASE WITH THE HAND | partial | apps/web/lib/ink/erase.ts | apps/web/tests/ink-erase.test.ts | Method A is complete and reachable by hand: the fingertip rubs out along a path, continuously as the hand moves, splitting strokes rather than removing them whole. Grab-and-throw, region erase by voice and whole-annotation delete are not built. |
| §176 | DO NOT USE RANDOM PALM MOVEMENT AS DELETE | built | apps/web/lib/ink/recorder.ts | apps/web/tests/ink-erase.test.ts | Erasing refuses unless the eraser is the active tool, checked in the recorder rather than at a button so a second entry point cannot route around it. People wave their hands while they talk; the mode is what establishes intent. |
| §177 | PHYSICAL ERASER FEEDBACK | partial | apps/web/components/spatial/InkLayer.tsx | apps/web/tests/ink-erase.test.ts | A haptic tick at the moment the eraser meets ink, on the transition rather than per frame — a tick along a long line is a buzz, not a boundary. No visual resistance. |
| §178 | PARTIAL STROKE ERASING | built | apps/web/lib/ink/erase.ts | apps/web/tests/ink-erase.test.ts | Erasing the middle of a stroke leaves two strokes. Each fragment is a subsequence of the points the hand made — never resampled or refitted — and carries `derivedFrom`, so a mark that was once one and is now two can still say what it was. |
| §179 | UNDO MUST BE INSTANT | built | apps/web/lib/ink/history.ts | apps/web/tests/ink-history.test.ts | Synchronous and local: no network, no await, nothing that can fail. An undo that might not work is not an undo. |
| §180 | LASSO TOOL | built | apps/web/lib/ink/recorder.ts | apps/web/tests/ink-lasso.test.ts | A freeform boundary that selects and does not become a mark, drawn visibly while it is being made (§180's persistent feedback) and absent from the undo history afterwards. Resolved through the same exact region query a drawn loop uses, against whichever figure the hand was addressing. |
| §181 | SHAPE TOOL | built | apps/web/lib/ink/shapes.ts | apps/web/tests/ink-shapes.test.ts | Line, circle, ellipse, rectangle, polygon, arrow and bracket, read after the stroke finishes and never during it, offered rather than applied, and reversible when accepted. A mark that fits nothing is reported as fitting nothing. |
| §182 | STRAIGHTEDGE MODE | built | apps/web/lib/ink/straightedge.ts | apps/web/tests/ink-straightedge.test.ts | Straight, horizontal, vertical, 45 degrees and magnetic constraints, applied while drawing rather than after. Magnetic pulls a line onto an axis or a diagonal only when it is already near one, so a deliberately oblique line is left alone. |
| §183 | SPATIAL RULER | built | apps/web/lib/ink/measure.ts | apps/web/tests/ink-measure.test.ts | Two observations picked, and the difference along each axis in that axis's own units. The single distance §183 draws is refused, because the axes are scaled independently and the line between two observations has no length in the data — reporting one would invent a unit. |
| §184 | HAND-DRAWN MEASUREMENTS A | built | apps/web/lib/ink/measure.ts | apps/web/tests/ink-measure.test.ts | "Never infer physical dimensions if scale information is unavailable. Say so clearly." — said with every measurement rather than once in a footnote, since the person reading it months later is the one without the surrounding conversation. |
| §185 | TWO-HANDED DRAWING WORKFLOW | unreviewed |  |  |  |
| §186 | BIMANUAL OBJECT MANIPULATION | unreviewed |  |  |  |
| §187 | "EVERYTHING THROUGH THE HAND" PRINCIPLE | unreviewed |  |  |  |
| §188 | MANIPULATION LOCKS | unreviewed |  |  |  |
| §189 | GESTURE TARGET OWNERSHIP | built | apps/web/lib/spatial/targeting.ts | apps/web/tests/targeting.test.ts | A pinch locks the figure it started on until release, so a drag that crosses another chart, or leaves every chart, stays with the one it began on. Unlocking when the held target leaves the page, so a gesture cannot be stuck holding something unmounted. |
| §190 | DEPTH-AWARE TARGETING | partial | apps/web/lib/spatial/targeting.ts | apps/web/tests/targeting.test.ts | Overlapping figures are ranked by nearest centre, and an unmeasurable one is skipped. No raycast, visibility or selection-history ranking within a figure. |
| §191 | MAGNETIC TARGETING | built | apps/web/components/charts/Volume.tsx | apps/web/tests/chart-conformance.test.tsx | Nearest-within-a-radius selection in each chart, so a hand never needs surgical precision — and the cursor is drawn where the hand is, never at what it would select, because §191 asks the attraction to affect selection rather than move the pointer. |
| §192 | SMART GRAB VOLUME | unreviewed |  |  |  |
| §193 | HAPTIC DRAWING LANGUAGE | unreviewed |  |  |  |
| §194 | HAPTIC TEXTURE | unreviewed |  |  |  |
| §195 | PSEUDO-HAPTIC DRAWING | unreviewed |  |  |  |
| §196 | AI UNDERSTANDING OF DRAWING | unreviewed |  |  |  |
| §197 | NEVER LET AI INTERPRET SILENTLY | partial | apps/web/app/air-ink/page.tsx | apps/web/tests/ink.test.ts | A region is reported and not applied. No confirmation UI for anything beyond selection. |
| §198 | DRAWING AS AI CONTEXT | built | apps/web/lib/ink/context.ts | apps/web/tests/ink-context.test.ts | A drawn region becomes the ask endpoint's selection payload. Nothing is summarised on the way — the count, mean and range are computed by the backend so they are calculated rather than asserted by the interface. |
| §199 | TEMPORAL SPEECH-GESTURE FUSION | built | apps/web/lib/voice/timeline.ts | apps/web/tests/voice-fusion.test.ts | Referents are intervals on the shared clock, so a word binds to a gesture in progress. Short-lived windows, asymmetric: forward binding gives up sooner than backward, because it guesses at what somebody is about to do. |
| §200 | LIVE PRESENTATION DRAWING | unreviewed |  |  |  |
| §201 | INK LAYERS | built | apps/web/lib/ink/layers.ts | apps/web/tests/ink-layers.test.ts | Layers with per-layer visibility, and the integrity requirement enforced rather than styled: an assistant's annotation is drawn dashed from its origin at render time, so it stays distinguishable however its style is set or copied. |
| §202 | COLOR AND STYLE | built | apps/web/lib/ink/layers.ts | apps/web/tests/ink-layers.test.ts | Colour, width, opacity and dash per layer, with four colours rather than a picker — §202 warns against a floating palette for every change. A researcher's own dash is deliberately not the assistant's. |
| §203 | HANDWRITING | not-built |  |  |  |
| §204 | WRITING ON PAPERS A | unreviewed |  |  |  |
| §205 | RESEARCH PAPER TO WORKBOARD A | unreviewed |  |  |  |
| §206 | GRAPH ANNOTATION TO DATA | unreviewed |  |  |  |
| §207 | FREEFORM IDEA SPACE | unreviewed |  |  |  |
| §208 | AI SKETCH ASSIST | not-built |  |  |  |
| §209 | DRAWING VERSION HISTORY | unreviewed |  |  |  |
| §210 | COLLABORATIVE AIR INK | not-built |  |  |  |
| §211 | CONFLICT MANAGEMENT | not-built |  |  |  |
| §212 | ACCESSIBILITY FOR AIR INK | unreviewed |  |  |  |
| §213 | FATIGUE MANAGEMENT | unreviewed |  |  |  |
| §214 | DRAWING RECOGNITION MUST BE ASYNCHRONOUS | unreviewed |  |  |  |
| §215 | FRAME PRIORITY | unreviewed |  |  |  |
| §216 | ADAPTIVE QUALITY | unreviewed |  |  |  |
| §217 | HARD PERFORMANCE GUARDRAIL | unreviewed |  |  |  |
| §218 | NEVER QUEUE OLD CAMERA FRAMES | built | apps/web/lib/spatial/mediapipe.ts | apps/web/tests/spatial-session.test.ts | Inference runs inside the rAF tick on the freshest frame, and the session's rate governor drops rather than queues. No backlog can form, because nothing is enqueued. |
| §219 | TIMESTAMP EVERYTHING | built | apps/web/lib/spatial/clock.ts | apps/web/tests/clock-discipline.test.ts | Every landmark sample and stroke point carries a timestamp, and — after a shipped bug where speech and gesture ran on clocks 55 years apart — they are all on one monotonic clock, enforced structurally. |
| §220 | DISPLAY-REFRESH-AWARE RENDERING | unreviewed |  |  |  |
| §221 | REFERENCE HARDWARE PROFILES | unreviewed |  |  |  |
| §222 | DRAWING TEST HARNESS | unreviewed |  |  |  |
| §223 | END-TO-END DRAWING LATENCY TEST | unreviewed |  |  |  |
| §224 | GESTURE CONFLICT RESOLUTION | partial | apps/web/lib/spatial/targeting.ts | apps/web/tests/targeting.test.ts | Target is now part of how intent is resolved, alongside gesture state and the active tool: a hand over nothing addresses nothing rather than steering the nearest figure. Erasing and lassoing do not exist, so those modes are not yet distinguished. |
| §225 | HAND AS UNIVERSAL RESEARCH INSTRUMENT | unreviewed |  |  |  |
| §226 | AIR INK MODULES | unreviewed |  |  |  |
| §227 | NEW COMMANDS | unreviewed |  |  |  |
| §228 | SCIENTIFIC INTEGRITY A | unreviewed |  |  |  |
| §229 | EXAMPLE RESEARCH WORKFLOW | unreviewed |  |  |  |
| §230 | EXAMPLE | unreviewed |  |  |  |
| §231 | EXAMPLE | unreviewed |  |  |  |
| §232 | EXAMPLE | unreviewed |  |  |  |
| §233 | EXAMPLE | unreviewed |  |  |  |
| §234 | END-STATE AIR INK EXPERIENCE | unreviewed |  |  |  |
| §235 | FINAL AIR INK NON-NEGOTIABLE RULES | unreviewed |  |  |  |
| §236 | UPDATED MASTER NORTH STAR | unreviewed |  |  |  |
