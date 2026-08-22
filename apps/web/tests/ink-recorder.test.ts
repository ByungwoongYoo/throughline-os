/**
 * What the researcher drew, as a number rather than a picture.
 *
 * The recorder is the piece between "they are drawing" and "this is what they
 * drew", and every defect in it is a wrong coordinate rather than a wrong pixel.
 * A stroke in the wrong units still draws — it just selects the wrong
 * observations, silently, which is exactly how rotation was broken from its
 * first commit while both sides of the seam passed their tests.
 */

import { describe, expect, it } from "vitest";
import { InkRecorder } from "@/lib/ink/recorder";
import { observedPoints } from "@/lib/ink/stroke";
import { selectWithinStroke } from "@/lib/ink/select";
import { ScreenPoint, TargetRef, VisualizationController } from "@/lib/spatial/commands";
import { containsPoint } from "@/lib/ink/stroke";
import { Hand, HandFrame } from "@/lib/spatial/types";

const PINCHED = 0.02;
const OPEN = 0.2;

function hand(at: { x: number; y: number }, pinch: number): Hand {
  const span = 0.1;
  return {
    handedness: "right", confidence: 0.95,
    wrist: { x: at.x, y: at.y + span * 2 },
    indexBase: { x: at.x, y: at.y + span },
    thumbTip: { x: at.x - pinch / 2, y: at.y },
    indexTip: { x: at.x + pinch / 2, y: at.y },
    middleTip: { x: at.x, y: at.y + span * 1.7 },
    ringTip: { x: at.x, y: at.y + span * 1.8 },
    pinkyTip: { x: at.x, y: at.y + span * 1.9 },
    palmCenter: { x: at.x, y: at.y },
  };
}

/** Where `hand()` actually puts the pen: the index tip, not the centre. */
function penOf(at: { x: number; y: number }, pinch = PINCHED) {
  return { x: at.x + pinch / 2, y: at.y };
}

type Step = { at: { x: number; y: number }; pinch?: number };

function run(recorder: InkRecorder, steps: Step[], startAt = 1000) {
  return steps.map((step, i) => recorder.step({
    timestamp: startAt + i * 33,
    hands: [hand(step.at, step.pinch ?? PINCHED)],
  } as HandFrame));
}

/** An armed recorder over a 1000x800 viewport, which is the usual case. */
function armed(width = 1000, height = 800) {
  const recorder = new InkRecorder({ now: () => 12345 });
  recorder.setViewport({ width, height });
  recorder.arm();
  return recorder;
}

/** A straight horizontal drag, long enough to have drawn something. */
function line(recorder: InkRecorder, y = 0.5) {
  return run(recorder, [
    { at: { x: 0.30, y }, pinch: OPEN },
    { at: { x: 0.32, y } },
    { at: { x: 0.34, y } },
    { at: { x: 0.36, y } },
    { at: { x: 0.38, y } },
    { at: { x: 0.40, y } },
  ]);
}

describe("strokes are recorded in the coordinates the chart paints in", () => {
  /**
   * The contract that was vague once before and cost the project rotation
   * entirely. Ink is worse: a stroke in normalised units would still *draw*,
   * because a renderer scales whatever it is handed — and then `withinPolygon`
   * would return the wrong observations with no visible symptom at all.
   */
  it("puts an observation in viewport pixels, mirrored", () => {
    const recorder = armed(1000, 800);
    line(recorder);
    recorder.disarm();

    const [stroke] = recorder.strokes();
    const first = stroke.originalPoints[0];
    // The *third* frame, not the second: contact must hold for two frames before
    // a stroke begins, so the first pinched frame arms the pen and the one after
    // it is the first mark. That is the rule that stops a hand closing on its
    // way somewhere else from leaving a dot.
    const pen = penOf({ x: 0.34, y: 0.5 });

    expect(first.x).toBeCloseTo((1 - pen.x) * 1000, 6);
    expect(first.y).toBeCloseTo(pen.y * 800, 6);
  });

  it("mirrors x, because a webcam image is a mirror", () => {
    // A hand moving right in the world appears to move left in frame. Ink that
    // did not mirror would run backwards under the finger drawing it — and
    // would disagree with `hover`, which does mirror, so a fingertip and its own
    // ink would land on different marks.
    const recorder = armed(1000, 800);
    line(recorder);
    recorder.disarm();

    const xs = recorder.strokes()[0].originalPoints.map((p) => p.x);
    expect(xs[xs.length - 1]).toBeLessThan(xs[0]);
  });

  it("scales with the viewport rather than assuming one", () => {
    const wide = armed(2000, 800);
    const narrow = armed(1000, 800);
    line(wide);
    line(narrow);
    wide.disarm();
    narrow.disarm();

    const spanOf = (r: InkRecorder) => {
      const xs = r.strokes()[0].originalPoints.map((p) => p.x);
      return Math.abs(xs[xs.length - 1] - xs[0]);
    };
    expect(spanOf(wide)).toBeCloseTo(spanOf(narrow) * 2, 6);
  });

  it("keeps a timestamp on every point, for fusing with speech", () => {
    const recorder = armed();
    line(recorder);
    recorder.disarm();

    const stamps = recorder.strokes()[0].originalPoints.map((p) => p.timestamp);
    expect(stamps.length).toBeGreaterThan(2);
    expect([...stamps]).toEqual([...stamps].sort((a, b) => a - b));
  });
});

describe("prediction changes how a line looks, never what it claims", () => {
  it("never writes a predicted point into the record", () => {
    const recorder = armed();
    line(recorder);

    const open = recorder.all()[0];
    expect(open.originalPoints.some((p) => p.predicted)).toBe(false);
    expect(observedPoints(open)).toEqual(open.originalPoints);
  });

  it("extends the drawn line ahead of the last observation", () => {
    // The whole point of the subsystem: a line that visibly trails the fingertip
    // reads as a remote pointer rather than a pen.
    const recorder = armed();
    line(recorder);

    const open = recorder.all()[0];
    const tip = open.points[open.points.length - 1];
    expect(tip.predicted).toBe(true);
    // Moving right in the world is moving left on screen, so the prediction is
    // ahead when it is further left than the last real point.
    const lastReal = [...open.points].reverse().find((p) => !p.predicted)!;
    expect(tip.x).toBeLessThan(lastReal.x);
  });

  it("carries at most one predicted point, however long the stroke", () => {
    /**
     * The accumulation bug this guards against is subtle and permanent: append a
     * prediction per frame without removing the last one and the stroke grows a
     * tail made entirely of extrapolation, which then gets committed and drawn
     * for ever.
     */
    const recorder = armed();
    run(recorder, [
      { at: { x: 0.30, y: 0.5 }, pinch: OPEN },
      ...Array.from({ length: 20 }, (_, i) => ({ at: { x: 0.30 + i * 0.01, y: 0.5 } })),
    ]);

    const open = recorder.all()[0];
    expect(open.points.filter((p) => p.predicted)).toHaveLength(1);
  });

  it("leaves no prediction in a finished stroke", () => {
    // The hand has stopped, so there is nothing left to predict, and a guess at
    // the end would put the final point somewhere it never went.
    const recorder = armed();
    line(recorder);
    run(recorder, [{ at: { x: 0.40, y: 0.5 }, pinch: OPEN }]);

    const [stroke] = recorder.strokes();
    expect(stroke.points.some((p) => p.predicted)).toBe(false);
  });

  it("starts a stroke with no prediction at all, having nothing to go on", () => {
    /**
     * Three observations are needed before a velocity can be estimated, so the
     * honest answer at the start of a mark is the observed point and nothing
     * else. This is also what makes the stale-history failure visible: a stroke
     * that begins with a predicted tip is one predicting from the *previous*
     * stroke's motion.
     */
    const recorder = armed();
    const early = run(recorder, [
      { at: { x: 0.30, y: 0.5 }, pinch: OPEN },
      { at: { x: 0.32, y: 0.5 } },
      { at: { x: 0.34, y: 0.5 } },
    ]);

    const open = early[early.length - 1].open!;
    expect(open.points.some((p) => p.predicted)).toBe(false);
  });

  it("does not predict from the last stroke after the canvas is cleared", () => {
    /**
     * `clear()` drops the strokes but the recorder keeps running, and the hand
     * is somewhere else by the time the next mark begins. If the velocity
     * history survived that, the first frame of the new stroke would carry a
     * prediction extrapolated from a hand that jumped across the frame — a
     * 40-pixel hook, clamped only by the step ceiling, on a line the researcher
     * had barely started.
     */
    const recorder = armed();
    line(recorder);              // fills the history
    recorder.clear();

    const next = run(recorder, [
      { at: { x: 0.85, y: 0.2 } },
      { at: { x: 0.86, y: 0.2 } },
    ], 5000);

    const open = next[next.length - 1].open!;
    expect(open.points.some((p) => p.predicted)).toBe(false);
  });

  it("does not extrapolate the journey between two strokes", () => {
    /**
     * Between strokes the hand travels further and faster than while drawing.
     * A velocity history carried across pen-up would make the first prediction
     * of a new mark an extrapolation of that journey — a hook, pointing at the
     * previous stroke, on the start of every line after the first.
     */
    const recorder = armed();
    line(recorder, 0.5);
    run(recorder, [{ at: { x: 0.40, y: 0.5 }, pinch: OPEN }]);
    // Now far away, and drawing again.
    const second = run(recorder, [
      { at: { x: 0.80, y: 0.2 } },
      { at: { x: 0.81, y: 0.2 } },
      { at: { x: 0.82, y: 0.2 } },
    ]);

    const open = second[second.length - 1].open!;
    const start = open.points[0];
    // The first drawn point of the new stroke is at the finger, not somewhere
    // between the two strokes. (0.81 rather than 0.80: two frames of contact.)
    expect(start.x).toBeCloseTo((1 - penOf({ x: 0.81, y: 0.2 }).x) * 1000, 0);
  });
});

describe("what counts as a mark", () => {
  it("keeps nothing from a pinch too short to be one", () => {
    // One frame of contact cannot be told from a hand closing on its way
    // somewhere else, and a dot is the most common piece of unwanted ink.
    const recorder = armed();
    run(recorder, [
      { at: { x: 0.4, y: 0.5 }, pinch: OPEN },
      { at: { x: 0.4, y: 0.5 } },
      { at: { x: 0.4, y: 0.5 }, pinch: OPEN },
    ]);

    expect(recorder.strokes()).toEqual([]);
    expect(recorder.all()).toEqual([]);
  });

  it("keeps the mark when the tool is put away mid-line", () => {
    /**
     * Disarming while drawing is what people do when they have finished the mark
     * and reached for the mouse. Discarding it because the tool went away would
     * destroy work the researcher had just done.
     */
    const recorder = armed();
    line(recorder);
    recorder.disarm();

    expect(recorder.strokes()).toHaveLength(1);
    expect(recorder.state()).toBe("DISABLED");
  });

  it("draws nothing at all before the tool is armed", () => {
    const recorder = new InkRecorder();
    recorder.setViewport({ width: 1000, height: 800 });
    line(recorder);

    expect(recorder.all()).toEqual([]);
  });

  it("abandons an open stroke when the hand is lost, rather than bridging", () => {
    // Bridging would draw a straight line across whatever the hand did while it
    // was invisible: a mark the researcher never made, in the middle of a figure.
    const recorder = armed();
    line(recorder);
    const before = recorder.all()[0].originalPoints.length;

    for (let i = 0; i < 5; i += 1) {
      recorder.step({ timestamp: 2000 + i * 33, hands: [] } as HandFrame);
    }
    run(recorder, [
      { at: { x: 0.9, y: 0.9 } },
      { at: { x: 0.9, y: 0.9 } },
      { at: { x: 0.9, y: 0.9 } },
    ], 3000);

    const strokes = recorder.strokes();
    expect(strokes[0].originalPoints).toHaveLength(before);
    // Whatever happened after the loss is a separate stroke, not an extension.
    expect(recorder.all().length).toBeGreaterThan(1);
  });

  it("lets you draw again right after a clear, without releasing the pinch", () => {
    /**
     * A claim `docs/TRY_IT.md` now makes to somebody testing this alone, so it
     * is checked rather than hoped for.
     *
     * `clear()` used to drop the open stroke and leave the machine in DRAWING,
     * so every later frame reported `drawing: true` with nowhere to put the
     * points. Ink was dead until the researcher happened to release the pinch —
     * no error, no visible cause, and the natural thing to do after clearing a
     * canvas is to keep drawing.
     */
    const recorder = armed();
    line(recorder);
    recorder.clear();

    // Still pinched, never released.
    const after = run(recorder, [
      { at: { x: 0.50, y: 0.5 } },
      { at: { x: 0.52, y: 0.5 } },
      { at: { x: 0.54, y: 0.5 } },
    ], 5000);

    const open = after[after.length - 1].open;
    expect(open).not.toBeNull();
    expect(open!.originalPoints.length).toBeGreaterThan(0);
  });

  it("undoes the most recent stroke and nothing else", () => {
    const recorder = armed();
    line(recorder, 0.4);
    run(recorder, [{ at: { x: 0.40, y: 0.4 }, pinch: OPEN }]);
    line(recorder, 0.6);
    run(recorder, [{ at: { x: 0.40, y: 0.6 }, pinch: OPEN }]);

    expect(recorder.strokes()).toHaveLength(2);
    const removed = recorder.undo();
    expect(removed).not.toBeNull();
    expect(recorder.strokes()).toHaveLength(1);
    expect(recorder.undo()).not.toBeNull();
    expect(recorder.undo()).toBeNull();
  });
});

describe("a drawn circle selects the right observations", () => {
  /**
   * The end-to-end claim, which is the only one that matters to a researcher:
   * draw a loop round a cluster and get *those* points. Everything above is a
   * way this can be wrong without looking wrong.
   */
  function chartWith(marks: Array<{ id: string; at: ScreenPoint }>)
      : Pick<VisualizationController, "withinPolygon"> {
    return {
      withinPolygon(polygon: ScreenPoint[]): TargetRef[] {
        return marks
          .filter((mark) => containsPoint(polygon, mark.at))
          .map((mark) => ({ id: mark.id, datum: { id: mark.id } }));
      },
    };
  }

  /** A loop drawn in normalised camera space, centred on the frame. */
  function circle(recorder: InkRecorder, centre = { x: 0.5, y: 0.5 }, radius = 0.15) {
    const steps: Step[] = [{ at: { x: centre.x + radius, y: centre.y }, pinch: OPEN }];
    for (let i = 0; i <= 24; i += 1) {
      const t = (i / 24) * Math.PI * 2;
      steps.push({ at: { x: centre.x + Math.cos(t) * radius,
                         y: centre.y + Math.sin(t) * radius } });
    }
    steps.push({ at: { x: centre.x + radius, y: centre.y }, pinch: OPEN });
    return run(recorder, steps);
  }

  it("catches a mark inside the loop and excludes one outside", () => {
    const recorder = armed(1000, 800);
    circle(recorder);
    const [stroke] = recorder.strokes();

    // The loop is centred on the frame, so its centre maps to the viewport
    // centre whichever way x is mirrored.
    const chart = chartWith([
      { id: "inside", at: { x: 500, y: 400 } },
      { id: "outside", at: { x: 60, y: 60 } },
    ]);

    const result = selectWithinStroke(stroke, chart);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targets.map((t) => t.id)).toEqual(["inside"]);
  });

  it("refuses a line as a region, and says why", () => {
    const recorder = armed();
    line(recorder);
    recorder.disarm();

    const result = selectWithinStroke(recorder.strokes()[0],
                                      chartWith([{ id: "a", at: { x: 500, y: 400 } }]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-a-region");
  });

  it("resolves the region against observations, never the predicted tip", () => {
    /**
     * The one that ties the two halves together. If a predicted point reached
     * the polygon, a fast-closing loop would enclose slightly more than the hand
     * did — and the count would be wrong in a way nobody could see.
     */
    const recorder = armed(1000, 800);
    circle(recorder);
    const [stroke] = recorder.strokes();

    expect(observedPoints(stroke)).toHaveLength(stroke.originalPoints.length);
    expect(stroke.originalPoints.some((p) => p.predicted)).toBe(false);
  });
});
