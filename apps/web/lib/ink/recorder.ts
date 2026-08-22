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
  DEFAULT_STYLE, SpatialStroke, StrokePoint, StrokeStyle, newStrokeId, resample,
} from "./stroke";
import { DEFAULT_INK_SETTINGS, InkEvent, InkSettings, InkStateMachine } from "./machine";
import { DEFAULT_PREDICT, PredictSettings, predictAhead } from "./predict";

export type Viewport = { width: number; height: number };

export type RecorderResult = {
  /** The stroke being drawn right now, or null. Re-rendered every frame. */
  open: SpatialStroke | null;
  /** True only when `finished` gained a stroke on this frame. */
  committed: boolean;
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
   * Take on a stroke drawn by a previous recorder.
   *
   * For the one case where the recorder is replaced mid-session: changing the
   * stabilisation level. The strokes already on the canvas were drawn under the
   * old settings and are not re-interpreted — re-stabilising a finished mark
   * would change what the researcher drew after the fact, which is the thing
   * §174 forbids most directly.
   */
  adopt(stroke: SpatialStroke): void {
    this.finished.push(stroke);
  }

  /** Remove the most recent finished stroke. Returns it, or null. */
  undo(): SpatialStroke | null {
    return this.finished.pop() ?? null;
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
    this.finished = [];
    this.open = null;
    this.machine.cancelStroke();
  }

  step(frame: HandFrame): RecorderResult {
    const result = this.machine.step(frame);
    let committed = false;

    for (const event of result.events) {
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

    return { open: this.open, committed, events: result.events };
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
    return true;
  }
}
