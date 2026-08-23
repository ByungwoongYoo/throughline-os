/**
 * Frames in, strokes out.
 *
 * The state machine decides *whether* the researcher is drawing; this decides
 * *what they drew*. It is deliberately headless — no canvas, no React — because
 * every interesting failure here is a wrong number rather than a wrong pixel,
 * and a wrong number is only findable in a test that can read it.
 *
 * **Strokes are recorded in viewport pixels, mirrored, exactly as `hover`,
 * `select` and `rotate` are.** This is the T035 lesson applied before it can bite
 * again rather than after: the machine once emitted rotation in normalised image
 * coordinates while the chart consumed pixels, both sides tested, both sides
 * passing, and the feature simply never worked. Ink has the same shape of risk
 * and a worse consequence — a stroke in the wrong units would still *draw*, and
 * `withinPolygon` would confidently return the wrong observations. So the
 * conversion happens here, once, against the same viewport the machine uses, and
 * the polygon a selection is resolved against is in the coordinate system the
 * chart actually paints in.
 *
 * **Prediction is kept out of the record entirely.** `predictAhead` extends the
 * visible line about one frame to hide camera and inference latency, and that
 * extension lands in `points` — the drawing path — and never in
 * `originalPoints`. `observedPoints` filtering on the `predicted` flag stays as a
 * second line of defence, but the first is that a guess is never written into
 * the record in the first place. A region bounded partly by a prediction would
 * contain observations the hand never enclosed.
 *
 * **Prediction is computed in normalised units, before the mapping to pixels.**
 * `DEFAULT_PREDICT`'s speed floor and step ceiling are fractions of the camera
 * frame; applying them to pixels would make them mean something different on
 * every display, and the clamp that stops a tracking spike throwing the line
 * across the screen would be the first thing to break.
 */

import { HandFrame } from "@/lib/spatial/types";
import {
  DEFAULT_STABILISATION_LEVEL, InkStabilisation, STABILISATION, Stabiliser,
  StabilisationLevel,
} from "./stabilise";
import { SpatialSettings } from "@/lib/spatial/machine";
import {
  DEFAULT_STYLE, InkTool, SpatialStroke, StrokePoint, StrokeStyle, newStrokeId,
  resample,
} from "./stroke";
import { DEFAULT_INK_SETTINGS, InkEvent, InkSettings, InkStateMachine } from "./machine";
import { DEFAULT_PREDICT, PredictSettings, predictAhead } from "./predict";
import { InkHistory, applyOperation } from "./history";
import { ERASER_RADIUS, ErasePath, eraseAlong } from "./erase";
import { Shape, recognise } from "./shapes";

export type Viewport = { width: number; height: number };

export type RecorderResult = {
  /** The stroke being drawn right now, or null. Re-rendered every frame. */
  open: SpatialStroke | null;
  /** True only when `finished` gained a stroke on this frame. */
  committed: boolean;
  /**
   * A finished lasso boundary (§180), which is never kept as a mark.
   *
   * A lasso is a question, not an annotation: the researcher drew it to ask
   * *which of these*, and leaving it on the figure afterwards would turn every
   * selection into a permanent scribble somebody has to clean up. It is handed
   * over once, on the frame it closes, and then it is gone.
   */
  lasso: SpatialStroke | null;
  events: InkEvent[];
};

export type RecorderOptions = {
  ink?: Partial<InkSettings>;
  spatial?: Partial<SpatialSettings>;
  predict?: Partial<PredictSettings>;
  /**
   * How hard to fight the hand's tremor. See `stabilise.ts`.
   *
   * A level rather than a set of constants, because the useful question is
   * "am I writing or gesturing" and the four numbers that follow from it are
   * not ones anybody should have to reason about.
   */
  stabilisation?: StabilisationLevel;
  /** Individual overrides, for the settings panel and for tests. */
  stabiliser?: Partial<InkStabilisation>;
  style?: Partial<StrokeStyle>;
  author?: string;
  /**
   * A clock, so tests do not depend on the wall.
   *
   * Frames carry their own timestamps and those are what points record; this is
   * only for `createdAt`, which is metadata rather than measurement.
   */
  now?: () => number;
};

export class InkRecorder {
  private machine: InkStateMachine;
  private open: SpatialStroke | null = null;
  private finished: SpatialStroke[] = [];
  /**
   * Everything that can be taken back (§42).
   *
   * Held by the recorder rather than by the page, because the recorder is what
   * knows when a stroke actually became a mark — a pinch that never met the
   * contact rule must not appear in a researcher's undo history as something
   * they did.
   */
  private readonly past = new InkHistory();
  /**
   * Stabilisation for the pen, which is emphatically not the gesture layer's.
   *
   * Sharing one filter coupled two signals that want opposite things, and it was
   * a real defect rather than a tidiness question: the palm centroid driving
   * rotation wants lag removed above all, while a fingertip being written with
   * wants to be held still above all. The gesture tuning is also nearly flat
   * across the pen's speed range, so it barely adapts where §154 needs it to.
   *
   * Rebuilt at every pen-down: the filter, the dead zone and the gain anchor all
   * belong to one stroke.
   */
  private stabiliser: Stabiliser;
  private stabilisation: InkStabilisation;
  private predictSettings: PredictSettings;
  private style: StrokeStyle;
  private author: string;
  private now: () => number;
  private viewport: Viewport = { width: 1, height: 1 };

  constructor(options: RecorderOptions = {}) {
    this.machine = new InkStateMachine(
      { ...DEFAULT_INK_SETTINGS, ...options.ink }, options.spatial);
    this.stabilisation = {
      ...STABILISATION[options.stabilisation ?? DEFAULT_STABILISATION_LEVEL],
      ...options.stabiliser,
    };
    // The level's prediction horizon, then any explicit override. Prediction and
    // stabilisation are one decision, not two: a long horizon undoes the
    // steadiness the filter just bought.
    this.predictSettings = {
      ...DEFAULT_PREDICT, ...this.stabilisation.predict, ...options.predict,
    };
    this.stabiliser = new Stabiliser(this.stabilisation);
    this.style = { ...DEFAULT_STYLE, ...options.style };
    this.author = options.author ?? "researcher";
    this.now = options.now ?? (() => Date.now());
  }

  /** Set by the host, in the pixels of whatever the ink is drawn over. */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  arm(): void {
    this.machine.arm();
  }

  /**
   * Put the pen away, ending any open stroke.
   *
   * The open stroke is *kept*, not discarded. Disarming mid-line is something
   * people do when they have finished drawing and reached for the mouse, and
   * throwing away the mark they just made because they put the tool down would
   * be indefensible. A stroke is only lost when it was never a mark — see
   * `strokeCancelled`.
   */
  disarm(): void {
    this.commit();
    this.machine.disarm();
  }

  state() {
    return this.machine.current();
  }

  strokes(): SpatialStroke[] {
    return this.finished;
  }

  /**
   * The stroke being drawn right now, or null.
   *
   * Exposed because the renderer needs exactly this every frame, and deriving it
   * by subtracting the finished set from `all()` would be a linear scan of the
   * whole session's work sixty times a second — the growing-cost-per-frame the
   * two-layer split exists to prevent, reintroduced by the code doing the split.
   */
  openStroke(): SpatialStroke | null {
    return this.open;
  }

  /** The finished strokes plus the one in progress, for rendering and for undo. */
  all(): SpatialStroke[] {
    return this.open ? [...this.finished, this.open] : this.finished;
  }

  /**
   * Take on everything a previous recorder held.
   *
   * For the one case where the recorder is replaced mid-session: changing the
   * stabilisation level. One call rather than two, because the first version
   * moved the strokes and left the history behind — so adjusting a setting
   * silently destroyed the researcher's ability to undo, including recovering a
   * clear, with nothing to indicate it had happened. Undo simply stopped being
   * offered, and the obvious reading is that there was nothing to undo.
   *
   * The strokes themselves are carried unchanged and never re-interpreted:
   * re-stabilising a finished mark would change what the researcher drew after
   * the fact, which is what §174 forbids most directly. New settings apply to
   * the next stroke, not to the ones already on the page.
   */
  adoptFrom(previous: InkRecorder): void {
    this.finished = [...previous.finished];
    this.past.adoptFrom(previous.past);
  }

  /**
   * The pen or the eraser (§176).
   *
   * A mode, and that is the requirement rather than an implementation choice.
   * People wave their hands while they talk, so an open-hand wipe may only
   * erase once the researcher has said they are erasing — "do not interpret an
   * arbitrary wiping motion as delete during normal interaction". The mode is
   * what establishes intent; without it, erasing would be the most destructive
   * thing on the canvas and the easiest to trigger by accident.
   */
  private tool: InkTool = "pen";

  setTool(tool: InkTool): void {
    this.tool = tool;
  }

  currentTool(): InkTool {
    return this.tool;
  }

  /**
   * Rub out along a path, splitting strokes rather than removing them whole.
   *
   * Refuses unless the eraser is the active tool, so the mode lock cannot be
   * bypassed by calling this directly — §176 is a property of the system, not
   * of one button.
   */
  erase(path: ErasePath, radius = ERASER_RADIUS): boolean {
    if (this.tool !== "eraser") return false;
    const before = this.finished;
    const result = eraseAlong(before, path, radius, this.now);
    if (!result.changed) return false;
    this.past.did({ kind: "rub", before, after: result.strokes });
    this.finished = result.strokes;
    return true;
  }

  /**
   * The canvas as it was when the current wipe began, or null when not wiping.
   *
   * A pass of the eraser is one thing the researcher did, so it is one entry in
   * the history however many frames it took — undoing a wipe a frame at a time
   * would be unusable. The snapshot is what makes that possible.
   */
  private rubbedFrom: SpatialStroke[] | null = null;
  private rubPath: Array<{ x: number; y: number }> = [];
  /** Whether the eraser is currently over ink, for §177's contact event. */
  private touchingInk = false;
  /** Events this recorder raised itself, merged into the frame's. */
  private pendingEvents: InkEvent[] = [];

  /**
   * What a finished stroke looks like, if it looks like anything (§181).
   *
   * Read after the fact and never applied here: §197 makes an interpretation
   * that changes what a researcher drew a question rather than a side effect.
   */
  shapeOf(strokeId: string): Shape | null {
    const stroke = this.finished.find((s) => s.id === strokeId);
    return stroke ? recognise(stroke.originalPoints) : null;
  }

  /**
   * Accept an offered shape.
   *
   * Replaces the *drawn* copy and never `originalPoints`, so the mark can always
   * say what the hand actually did — which is the whole of §174 and the reason
   * a tidy is safe to offer at all. Reversible, like everything else.
   */
  tidy(strokeId: string, shape: Shape): boolean {
    const index = this.finished.findIndex((s) => s.id === strokeId);
    if (index < 0) return false;
    const before = this.finished[index];
    const after: SpatialStroke = {
      ...before,
      points: shape.points.map((p, i) => ({
        x: p.x, y: p.y,
        // The times the hand was there are not the times of a fitted curve, so
        // the drawn copy takes the stroke's span rather than pretending.
        timestamp: before.originalPoints[
          Math.min(i, before.originalPoints.length - 1)]?.timestamp ?? 0,
        confidence: 1,
      })),
      interpretation: { kind: shape.kind, confidence: shape.confidence },
    };
    this.finished = this.finished.map((s) => (s.id === strokeId ? after : s));
    this.past.did({ kind: "tidy", before, after });
    return true;
  }

  canUndo(): boolean { return this.past.canUndo(); }
  canRedo(): boolean { return this.past.canRedo(); }

  /** What undo would do, for a control that says so before it is pressed. */
  describeUndo(): string | null { return this.past.describeUndo(); }
  describeRedo(): string | null { return this.past.describeRedo(); }

  /**
   * Take back the last thing that happened.
   *
   * Covers clearing as well as drawing, which is the whole reason this exists:
   * *Clear* is the one action here that destroys work, and it destroyed it
   * permanently until now.
   */
  undo(): boolean {
    const operation = this.past.undo();
    if (!operation) return false;
    this.finished = applyOperation(this.finished, operation, "undo");
    return true;
  }

  redo(): boolean {
    const operation = this.past.redo();
    if (!operation) return false;
    this.finished = applyOperation(this.finished, operation, "do");
    return true;
  }

  /**
   * Throw away every stroke, including one being drawn.
   *
   * The machine is told as well. Dropping `open` on its own left it in DRAWING
   * with nothing to draw into: `step` kept reporting `drawing: true`, `extend`
   * kept finding no stroke to extend, and ink was dead until the researcher
   * released the pinch — a failure with no error and no visible cause.
   */
  clear(): void {
    // Recorded before it happens, holding the strokes themselves. An undone
    // clear hands back the same objects rather than rebuilding them from a
    // description — a history that re-derives what it discarded will eventually
    // re-derive it differently, and a researcher gets back something that
    // resembles their annotation, which is worse than losing it.
    if (this.finished.length) this.past.did({ kind: "clear", strokes: this.finished });
    this.finished = [];
    this.open = null;
    this.machine.cancelStroke();
  }

  step(frame: HandFrame): RecorderResult {
    const result = this.machine.step(frame);
    let committed = false;

    for (const event of result.events) {
      if (event === "penDown" && this.tool === "eraser") {
        // No stroke is begun: the eraser makes no mark. The canvas is
        // remembered so the whole wipe becomes one entry in the history.
        this.rubbedFrom = this.finished;
        this.rubPath = [];
        continue;
      }
      if (event === "penDown") {
        // A fresh filter per stroke. Carrying state across would drag the first
        // few points of a new mark toward where the last one ended, which is
        // most visible exactly where it matters least tolerably: the start of a
        // deliberate line.
        this.stabiliser = new Stabiliser(this.stabilisation);
        // Cleared with the filter, and cleared *here only*.
        //
        // A history carried across strokes would make the first prediction of a
        // new mark an extrapolation of the journey between two marks — the
        // fastest movement in the whole session, and one the researcher was not
        // drawing. It appears as a hook on the start of every line after the
        // first, pointing back at the previous one.
        //
        // This was originally also cleared on commit, which is why it is worth a
        // note: two resets meant the common path never reached this one, so the
        // guard could not be shown to work, and the paths that skipped commit
        // entirely — `clear()` while a stroke was open — skipped both.
        this.normalisedHistory = [];
        this.open = this.begin();
      } else if (event === "penUp") {
        if (this.commit()) committed = true;
      } else if (event === "strokeCancelled") {
        // A pinch too short to be a mark. Nothing is kept — this is the case the
        // two-frame contact rule exists for, and honouring it here is what stops
        // a dot appearing every time a hand closes on its way somewhere else.
        this.open = null;
      }
    }

    if (result.drawing && result.at && this.open) {
      this.extend(this.open, result.at, frame.timestamp);
    }

    if (this.tool === "eraser") committed = this.rub(result) || committed;

    /*
     * A lasso is drawn like a stroke and kept like a question.
     *
     * §180 asks for persistent visual feedback *while* lassoing, which is why
     * it is drawn at all — a boundary you cannot see is one you cannot close
     * accurately. What it must not do is survive: it is handed to the host on
     * the frame it closes and removed from the canvas in the same breath.
     */
    let lasso: SpatialStroke | null = null;
    if (this.tool === "lasso" && committed) {
      lasso = this.finished[this.finished.length - 1] ?? null;
      if (lasso) {
        this.finished = this.finished.slice(0, -1);
        // And out of the history too. A lasso is not something a researcher
        // would ever want to undo *back onto* the figure.
        this.past.undo();
        committed = false;
      }
    }

    void 0;
    const events = this.pendingEvents.length
      ? [...result.events, ...this.pendingEvents]
      : result.events;
    this.pendingEvents = [];
    return { open: this.open, committed, lasso, events };
  }

  /**
   * One frame of a wipe.
   *
   * Applied continuously so the ink disappears under the hand rather than at
   * pen-up — a wipe whose effect only arrives on release gives the researcher
   * nothing to aim with. The history entry is still one per pass, written when
   * the hand lifts.
   */
  private rub(result: { drawing: boolean; at: { x: number; y: number } | null;
                        events: readonly InkEvent[] }): boolean {
    if (result.drawing && result.at && this.rubbedFrom) {
      this.rubPath.push(this.toViewport(this.stabiliser.push(result.at, 0)
                                        ?? result.at));
      const pass = eraseAlong(this.finished, this.rubPath,
                              ERASER_RADIUS, this.now);
      // Only when something was actually taken. `eraseAlong` builds a fresh
      // array every call, so assigning unconditionally replaced the canvas with
      // an equal-but-different one on every frame — and the identity check at
      // pen-up then saw a change that had not happened, recording "erasing
      // across 0 strokes" in the history for a wipe over empty space.
      if (pass.changed) {
        this.finished = pass.strokes;
        // §177, on the transition only. `touching` is reset when the eraser
        // leaves ink, so crossing a second mark is felt as a second contact.
        if (!this.touchingInk) {
          this.touchingInk = true;
          this.pendingEvents.push("erasedInk");
        }
      } else {
        this.touchingInk = false;
      }
      return false;
    }

    if ((result.events.includes("penUp")
         || result.events.includes("strokeCancelled")) && this.rubbedFrom) {
      const before = this.rubbedFrom;
      this.rubbedFrom = null;
      this.rubPath = [];
      // Recorded only if the pass actually took something. A wipe over empty
      // canvas in the history would make the first press of undo appear to do
      // nothing.
      if (before !== this.finished) {
        this.past.did({ kind: "rub", before, after: this.finished });
        return true;
      }
    }
    return false;
  }

  private begin(): SpatialStroke {
    return {
      id: newStrokeId(),
      tool: "pen",
      // Screen space, because that is what this recorder produces and what the
      // controller seam consumes. Object, data, world and surface strokes are a
      // mapping applied on top of this, not a different recorder.
      space: "screen",
      style: { ...this.style },
      originalPoints: [],
      points: [],
      createdAt: this.now(),
      createdBy: this.author,
    };
  }

  private extend(stroke: SpatialStroke,
                 at: { x: number; y: number; confidence: number },
                 timestamp: number): void {
    // Stabilise first, and record what comes out of it — not the raw landmark.
    //
    // This ordering is load-bearing rather than incidental. Once the pen is
    // stabilised and geared, the line on screen is no longer the raw fingertip
    // path, and the researcher draws against *the line*. Recording the raw
    // landmark instead would mean a loop drawn round four points was resolved
    // against a different, larger loop than the one they saw — the selection
    // would disagree with the picture, silently, which is the worst failure this
    // subsystem has available to it.
    //
    // `originalPoints` therefore means "the mark as drawn, before any shape
    // fitting or recognition touches it". That is what §174 is protecting: not
    // the sensor reading, which nobody drew, but the researcher's own line
    // before the system offers to tidy it.
    const pen = this.stabiliser.push({ x: at.x, y: at.y }, timestamp);
    if (!pen) {
      // A jump no hand could have made. The frame is dropped whole: not
      // recorded, not drawn, and not fed to the predictor, because a glitch that
      // reaches any of the three pulls the line toward it.
      return;
    }

    const observed: StrokePoint = {
      ...this.toViewport(pen),
      timestamp,
      confidence: at.confidence,
    };
    stroke.originalPoints.push(observed);

    // Kept unmapped rather than recovered by inverting the viewport mapping: a
    // second copy of that arithmetic is a second place for it to disagree with
    // the first, which is precisely how the rotation units diverged.
    //
    // The *pen* series, not the raw one. Extrapolating raw velocity and adding
    // it to a geared position would overshoot by one over the gain — a
    // prediction that ran 1.8x too far at the handwriting setting, which is the
    // opposite of what a stabilisation level is being asked for.
    this.normalisedHistory.push({ x: pen.x, y: pen.y, timestamp });
    if (this.normalisedHistory.length > 3) this.normalisedHistory.shift();

    const drawn = stroke.points;
    // Drop any predicted tip from the previous frame before appending this one.
    // Leaving it would accumulate a guess per frame into a line of its own, and
    // the stroke would grow a permanent tail made entirely of extrapolation.
    if (drawn.length && drawn[drawn.length - 1].predicted) drawn.pop();
    drawn.push({ ...observed });

    const ahead = predictAhead(this.normalisedHistory, this.predictSettings);
    if (ahead) {
      drawn.push({
        ...this.toViewport(ahead),
        timestamp,
        confidence: at.confidence,
        predicted: true,
      });
    }
  }

  /** The last three observations, unmapped, for prediction. */
  private normalisedHistory: Array<{ x: number; y: number; timestamp: number }> = [];

  private toViewport(point: { x: number; y: number }): { x: number; y: number } {
    // Mirrored in x, because a webcam image is a mirror: a hand moving right
    // appears to move left in frame. Identical to `SpatialMachine.toScreen`, and
    // deliberately so — ink drawn over a chart and a fingertip hovering a mark
    // have to land in the same place or the two features contradict each other
    // on screen.
    return {
      x: (1 - point.x) * this.viewport.width,
      y: point.y * this.viewport.height,
    };
  }

  /** Finish the open stroke if it is a mark. Returns whether one was kept. */
  private commit(): boolean {
    const stroke = this.open;
    this.open = null;
    if (!stroke || stroke.originalPoints.length < 2) return false;

    // Any predicted tip goes at the end of a stroke: the hand has stopped, so
    // there is nothing left to predict, and leaving the guess in would put the
    // final point somewhere the researcher did not stop.
    stroke.points = stroke.points.filter((point) => !point.predicted);
    // Resample the drawn copy only. The record keeps every observation, because
    // dropping one is a decision about data, while dropping a redundant point
    // from a line is a decision about pixels.
    stroke.points = resample(stroke.points);
    this.finished.push(stroke);
    this.past.did({ kind: "draw", stroke });
    return true;
  }
}
