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
| built | 37 |
| partial | 3 |
| not-built | 22 |
| unreviewed | 174 |
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
| §25 | AUDIO FEEDBACK | not-built |  |  | No audio feedback. |
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
| §36 | AI RESEARCH ASSISTANT | unreviewed |  |  |  |
| §37 | DEICTIC REFERENCES | unreviewed |  |  |  |
| §38 | GESTURE | unreviewed |  |  |  |
| §39 | AI SHOULD OPERATE THROUGH COMMANDS | unreviewed |  |  |  |
| §40 | AI ANALYTICAL GUARDRAILS | unreviewed |  |  |  |
| §41 | RESEARCH PROVENANCE | unreviewed |  |  |  |
| §42 | UNDO / REDO | unreviewed |  |  |  |
| §43 | HISTORY | unreviewed |  |  |  |
| §44 | BRANCHING | unreviewed |  |  |  |
| §45 | DATA INGESTION | unreviewed |  |  |  |
| §46 | DATA PROFILING | unreviewed |  |  |  |
| §47 | LARGE DATASETS | unreviewed |  |  |  |
| §48 | VISUALIZATION CONTROLLER | built | apps/web/lib/spatial/commands.ts | apps/web/tests/chart-conformance.test.tsx | One seam, exhaustively typed, and now one conformance suite for every chart behind it. |
| §49 | THREE-DIMENSIONAL RENDERING | built | apps/web/lib/charts/scene3d.ts | apps/web/tests/scene3d.test.ts | One shared projection. T043 fixed it never fitting its own canvas. |
| §50 | GPU STRATEGY | unreviewed |  |  |  |
| §51 | RENDER LOOP | unreviewed |  |  |  |
| §52 | PERFORMANCE BUDGETS | unreviewed |  |  |  |
| §53 | MAIN THREAD PROTECTION | unreviewed |  |  |  |
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
| §85 | AUDITABILITY | unreviewed |  |  |  |
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
| §96 | DESTRUCTIVE ACTIONS | unreviewed |  |  |  |
| §97 | ONBOARDING | unreviewed |  |  |  |
| §98 | DISCOVERABILITY | unreviewed |  |  |  |
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
| §142 | PEN-DOWN FEEDBACK | unreviewed |  |  |  |
| §143 | DRAWING COORDINATE SYSTEMS | partial | apps/web/lib/ink/stroke.ts | apps/web/tests/ink.test.ts | Screen space only. Object, data, world and surface spaces are typed but not implemented. |
| §144 | STROKE DATA MODEL | built | apps/web/lib/ink/stroke.ts | apps/web/tests/ink.test.ts | Stroke model with per-point timestamp and confidence. |
| §145 | THE ZERO-LAG PRINCIPLE | built | apps/web/lib/ink/predict.ts | apps/web/tests/ink-recorder.test.ts | Short-horizon prediction, clamped and abandoned at corners. |
| §146 | DUAL-PATH DRAWING ARCHITECTURE | built | apps/web/components/spatial/InkLayer.tsx | apps/web/tests/ink-layer.test.tsx | Two canvases: cost per frame does not grow with the session. |
| §147 | PROVISIONAL INK | built | apps/web/components/spatial/InkLayer.tsx | apps/web/tests/ink-layer.test.tsx | The live layer is the provisional ink. |
| §148 | SHORT-HORIZON MOTION PREDICTION | built | apps/web/lib/ink/predict.ts | apps/web/tests/ink-recorder.test.ts | Never enters the record; at most one predicted point. |
| §149 | TARGET PERFORMANCE | unreviewed |  |  |  |
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
| §174 | PRESERVE HUMAN INTENT | built | apps/web/lib/ink/stroke.ts | apps/web/tests/ink.test.ts | originalPoints is never rewritten by any later interpretation. |
| §175 | ERASE WITH THE HAND | not-built |  |  | No erasing. |
| §176 | DO NOT USE RANDOM PALM MOVEMENT AS DELETE | not-built |  |  | No erasing. |
| §177 | PHYSICAL ERASER FEEDBACK | not-built |  |  | No erasing. |
| §178 | PARTIAL STROKE ERASING | not-built |  |  | No erasing. |
| §179 | UNDO MUST BE INSTANT | built | apps/web/lib/ink/recorder.ts | apps/web/tests/ink-recorder.test.ts | Undo is immediate and local. |
| §180 | LASSO TOOL | unreviewed |  |  |  |
| §181 | SHAPE TOOL | not-built |  |  |  |
| §182 | STRAIGHTEDGE MODE | not-built |  |  |  |
| §183 | SPATIAL RULER | not-built |  |  |  |
| §184 | HAND-DRAWN MEASUREMENTS A | not-built |  |  |  |
| §185 | TWO-HANDED DRAWING WORKFLOW | unreviewed |  |  |  |
| §186 | BIMANUAL OBJECT MANIPULATION | unreviewed |  |  |  |
| §187 | "EVERYTHING THROUGH THE HAND" PRINCIPLE | unreviewed |  |  |  |
| §188 | MANIPULATION LOCKS | unreviewed |  |  |  |
| §189 | GESTURE TARGET OWNERSHIP | unreviewed |  |  |  |
| §190 | DEPTH-AWARE TARGETING | unreviewed |  |  |  |
| §191 | MAGNETIC TARGETING | unreviewed |  |  |  |
| §192 | SMART GRAB VOLUME | unreviewed |  |  |  |
| §193 | HAPTIC DRAWING LANGUAGE | unreviewed |  |  |  |
| §194 | HAPTIC TEXTURE | unreviewed |  |  |  |
| §195 | PSEUDO-HAPTIC DRAWING | unreviewed |  |  |  |
| §196 | AI UNDERSTANDING OF DRAWING | unreviewed |  |  |  |
| §197 | NEVER LET AI INTERPRET SILENTLY | partial | apps/web/app/air-ink/page.tsx | apps/web/tests/ink.test.ts | A region is reported and not applied. No confirmation UI for anything beyond selection. |
| §198 | DRAWING AS AI CONTEXT | not-built |  |  | Ink is not yet handed to the assistant as context. |
| §199 | TEMPORAL SPEECH-GESTURE FUSION | unreviewed |  |  |  |
| §200 | LIVE PRESENTATION DRAWING | unreviewed |  |  |  |
| §201 | INK LAYERS | not-built |  |  |  |
| §202 | COLOR AND STYLE | unreviewed |  |  |  |
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
| §218 | NEVER QUEUE OLD CAMERA FRAMES | unreviewed |  |  |  |
| §219 | TIMESTAMP EVERYTHING | built | apps/web/lib/ink/stroke.ts | apps/web/tests/ink.test.ts | Every point carries a monotonic timestamp on a shared clock. |
| §220 | DISPLAY-REFRESH-AWARE RENDERING | unreviewed |  |  |  |
| §221 | REFERENCE HARDWARE PROFILES | unreviewed |  |  |  |
| §222 | DRAWING TEST HARNESS | unreviewed |  |  |  |
| §223 | END-TO-END DRAWING LATENCY TEST | unreviewed |  |  |  |
| §224 | GESTURE CONFLICT RESOLUTION | unreviewed |  |  |  |
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
