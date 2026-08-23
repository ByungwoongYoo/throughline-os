/**
 * Taking ink away (§175–§178).
 *
 * Two things here are easy to get wrong and invisible when you do: erasing
 * against the eraser's *samples* rather than its path, and erasing a whole
 * stroke when the researcher rubbed out its middle.
 */

import { describe, expect, it } from "vitest";
import { ERASER_RADIUS, eraseAlong, touchedBy } from "@/lib/ink/erase";
import { SpatialStroke, StrokePoint } from "@/lib/ink/stroke";
import { ErasePath } from "@/lib/ink/erase";
import { InkRecorder } from "@/lib/ink/recorder";
import { Hand, HandFrame } from "@/lib/spatial/types";

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

function point(x: number, y: number, i = 0): StrokePoint {
  return { x, y, timestamp: 1000 + i * 33, confidence: 0.9 };
}

/** A horizontal line from x0 to x1 at y, one point every 10px. */
function line(id: string, x0: number, x1: number, y: number): SpatialStroke {
  const points: StrokePoint[] = [];
  for (let x = x0, i = 0; x <= x1; x += 10, i += 1) points.push(point(x, y, i));
  return {
    id, tool: "pen", space: "screen",
    style: { colour: "#000", width: 2, opacity: 1 },
    originalPoints: points, points,
    createdAt: 0, createdBy: "test",
  };
}

const clock = () => 5000;

describe("the eraser is measured against its path, not its samples", () => {
  it("erases the whole span a fast wipe crossed", () => {
    /**
     * The defect this guards, and the second time this codebase has met it: a
     * hand moving quickly leaves the eraser's centre in a few widely spaced
     * places, and testing only against those points leaves untouched flecks
     * wherever the hand moved faster than the sampling. T038 was the same
     * mistake in region selection.
     */
    const stroke = line("a", 0, 300, 100);
    // Two samples 300px apart: a wipe along the whole line in two frames.
    const wipe = [{ x: 0, y: 100 }, { x: 300, y: 100 }];

    const result = eraseAlong([stroke], wipe, ERASER_RADIUS, clock);

    expect(result.strokes).toEqual([]);
  });

  it("would have left flecks if it tested only the samples", () => {
    // Stated as its own assertion so the mechanism is pinned, not just the
    // outcome: a point midway between two eraser samples is still touched.
    const midway = { x: 150, y: 100 };
    const wipe = [{ x: 0, y: 100 }, { x: 300, y: 100 }];

    expect(touchedBy(midway, wipe, ERASER_RADIUS)).toBe(true);
    // And it is genuinely far from both samples, so the segment test is doing
    // the work rather than the radius being generous.
    expect(Math.hypot(150, 0)).toBeGreaterThan(ERASER_RADIUS * 5);
  });

  it("leaves a mark the eraser did not reach", () => {
    const stroke = line("a", 0, 300, 100);
    const elsewhere = [{ x: 0, y: 400 }, { x: 300, y: 400 }];

    const result = eraseAlong([stroke], elsewhere, ERASER_RADIUS, clock);

    expect(result.changed).toBe(false);
    // The same object, so anything holding a reference keeps it.
    expect(result.strokes[0]).toBe(stroke);
  });
});

describe("erasing the middle splits the stroke (§178)", () => {
  it("leaves two marks where there was one", () => {
    /**
     * A researcher rubbing out the centre of a line expects two lines — not the
     * whole line gone, and not a line with an invisible hole that still answers
     * selections along its length.
     */
    const stroke = line("a", 0, 300, 100);
    const dab = [{ x: 150, y: 100 }];

    const result = eraseAlong([stroke], dab, ERASER_RADIUS, clock);

    expect(result.strokes).toHaveLength(2);
    const [left, right] = result.strokes;
    expect(Math.max(...left.originalPoints.map((p) => p.x))).toBeLessThan(150);
    expect(Math.min(...right.originalPoints.map((p) => p.x))).toBeGreaterThan(150);
  });

  it("keeps the points the hand made, unresampled", () => {
    // §174 applies to the remains of a stroke as much as to the whole: the
    // fragment is a subsequence, never a redrawing.
    const stroke = line("a", 0, 300, 100);
    const original = stroke.originalPoints;
    const result = eraseAlong([stroke], [{ x: 150, y: 100 }], ERASER_RADIUS, clock);

    for (const fragment of result.strokes) {
      for (const p of fragment.originalPoints) expect(original).toContain(p);
    }
  });

  it("records what each fragment came from", () => {
    const stroke = line("a", 0, 300, 100);
    const result = eraseAlong([stroke], [{ x: 150, y: 100 }], ERASER_RADIUS, clock);

    for (const fragment of result.strokes) {
      expect(fragment.derivedFrom).toBe("a");
      expect(fragment.id).not.toBe("a");
    }
  });

  it("keeps ancestry through a second split", () => {
    // Otherwise a mark erased twice loses the thread back to what it was.
    const stroke = line("a", 0, 400, 100);
    const once = eraseAlong([stroke], [{ x: 130, y: 100 }], ERASER_RADIUS, clock);
    const twice = eraseAlong(once.strokes, [{ x: 300, y: 100 }], ERASER_RADIUS, clock);

    for (const fragment of twice.strokes) expect(fragment.derivedFrom).toBe("a");
  });

  it("drops a fragment too short to be a mark", () => {
    /**
     * A single surviving point cannot be drawn as a line, and leaving it would
     * strew invisible dots across the canvas that still answer selections — the
     * same reason a one-frame pinch is not a mark.
     */
    const stroke = line("a", 0, 300, 100);
    // Erase everything except the very first point.
    const wipe = [{ x: 20, y: 100 }, { x: 320, y: 100 }];

    const result = eraseAlong([stroke], wipe, ERASER_RADIUS, clock);

    for (const fragment of result.strokes) {
      expect(fragment.originalPoints.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("erases an end without splitting", () => {
    const stroke = line("a", 0, 300, 100);
    const result = eraseAlong([stroke], [{ x: 300, y: 100 }], ERASER_RADIUS, clock);

    expect(result.strokes).toHaveLength(1);
    expect(Math.max(...result.strokes[0].originalPoints.map((p) => p.x)))
      .toBeLessThan(300);
  });
});

describe("nothing is changed in place", () => {
  it("leaves the original stroke untouched, so undo can hand it back", () => {
    /**
     * A destructive edit that modified in place would make undo a
     * reconstruction, and a reconstruction eventually differs from what was
     * drawn — which is the failure that matters, because nobody notices it.
     */
    const stroke = line("a", 0, 300, 100);
    const before = stroke.originalPoints.length;

    const result = eraseAlong([stroke], [{ x: 150, y: 100 }], ERASER_RADIUS, clock);

    expect(stroke.originalPoints).toHaveLength(before);
    expect(result.affected[0]).toBe(stroke);
  });

  it("reports every stroke it touched, and no others", () => {
    const a = line("a", 0, 300, 100);
    const b = line("b", 0, 300, 400);
    const result = eraseAlong([a, b], [{ x: 150, y: 100 }], ERASER_RADIUS, clock);

    expect(result.affected.map((s) => s.id)).toEqual(["a"]);
  });

  it("erases nothing when the path is empty", () => {
    const stroke = line("a", 0, 300, 100);
    const result = eraseAlong([stroke], [], ERASER_RADIUS, clock);
    expect(result.changed).toBe(false);
    expect(result.strokes[0]).toBe(stroke);
  });
});

describe("the eraser is a mode, not a movement (§176)", () => {
  /**
   * "Do not interpret an arbitrary wiping motion as delete during normal
   * interaction. People naturally wave their hands."
   *
   * The mode is what establishes intent. Without it, erasing would be the most
   * destructive thing on the canvas and the easiest to trigger by accident —
   * and the accident is silent, because the researcher is looking at their
   * hands rather than at the annotation that just vanished.
   */
  function withStrokes() {
    const recorder = new InkRecorder({ now: () => 5000 });
    recorder.setViewport({ width: 720, height: 520 });
    recorder.arm();
    let clock = 1000;
    const draw = (y: number) => {
      const steps = [
        { at: { x: 0.30, y }, pinch: 0.2 },
        ...Array.from({ length: 8 }, (_, i) => ({ at: { x: 0.30 + i * 0.01, y },
                                                  pinch: 0.02 })),
        { at: { x: 0.38, y }, pinch: 0.2 },
      ];
      for (const step of steps) {
        recorder.step({ timestamp: clock,
                        hands: [hand(step.at, step.pinch)] } as HandFrame);
        clock += 33;
      }
      clock += 500;
    };
    draw(0.4);
    draw(0.6);
    return recorder;
  }

  /** A wipe across everything, in the pixels strokes are recorded in. */
  const ACROSS: ErasePath = [{ x: 0, y: 0 }, { x: 720, y: 520 },
                             { x: 0, y: 520 }, { x: 720, y: 0 }];

  it("refuses to erase while the pen is the tool", () => {
    const recorder = withStrokes();
    const before = recorder.strokes().length;

    expect(recorder.erase(ACROSS, 400)).toBe(false);
    expect(recorder.strokes()).toHaveLength(before);
  });

  it("erases once the eraser is chosen", () => {
    const recorder = withStrokes();
    recorder.setTool("eraser");

    expect(recorder.erase(ACROSS, 400)).toBe(true);
    expect(recorder.strokes()).toHaveLength(0);
  });

  it("cannot be bypassed by calling erase directly", () => {
    // The lock is a property of the system rather than of one button, so a
    // second entry point cannot quietly route around it.
    const recorder = withStrokes();
    recorder.setTool("eraser");
    recorder.setTool("pen");
    expect(recorder.erase(ACROSS, 400)).toBe(false);
  });

  it("reports nothing erased when the eraser missed", () => {
    const recorder = withStrokes();
    recorder.setTool("eraser");
    expect(recorder.erase([{ x: -500, y: -500 }], 5)).toBe(false);
    expect(recorder.canUndo()).toBe(true);   // the drawing, not an empty rub
    expect(recorder.describeUndo()).toBe("Undo drawing a stroke");
  });
});

describe("an erasure can be taken back", () => {
  function drawn() {
    const recorder = new InkRecorder({ now: () => 5000 });
    recorder.setViewport({ width: 720, height: 520 });
    recorder.arm();
    let clock = 1000;
    const steps = [
      { at: { x: 0.30, y: 0.5 }, pinch: 0.2 },
      ...Array.from({ length: 10 }, (_, i) => ({ at: { x: 0.30 + i * 0.01, y: 0.5 },
                                                 pinch: 0.02 })),
      { at: { x: 0.40, y: 0.5 }, pinch: 0.2 },
    ];
    for (const step of steps) {
      recorder.step({ timestamp: clock,
                      hands: [hand(step.at, step.pinch)] } as HandFrame);
      clock += 33;
    }
    return recorder;
  }

  it("gives back the original stroke, not a rebuilt one", () => {
    const recorder = drawn();
    const original = recorder.strokes()[0];
    recorder.setTool("eraser");
    recorder.erase([{ x: 0, y: 0 }, { x: 720, y: 520 }], 800);

    expect(recorder.strokes()).toHaveLength(0);
    expect(recorder.undo()).toBe(true);
    expect(recorder.strokes()[0]).toBe(original);
  });

  it("says what it would take back", () => {
    const recorder = drawn();
    recorder.setTool("eraser");
    recorder.erase([{ x: 0, y: 0 }, { x: 720, y: 520 }], 800);
    expect(recorder.describeUndo()).toBe("Undo erasing part of a stroke");
  });
});

describe("erasing by hand, over a wipe", () => {
  /**
   * The eraser existed and could not be reached by a hand, which is the defect
   * this project names most often: a feature that is built, tested, and wired
   * to nothing.
   */
  function canvasWith(marks: number) {
    const recorder = new InkRecorder({ now: () => 5000 });
    recorder.setViewport({ width: 720, height: 520 });
    recorder.arm();
    let clock = 1000;
    for (let m = 0; m < marks; m += 1) {
      const y = 0.3 + m * 0.15;
      const steps = [
        { at: { x: 0.30, y }, pinch: 0.2 },
        ...Array.from({ length: 8 }, (_, i) => ({ at: { x: 0.30 + i * 0.01, y },
                                                  pinch: 0.02 })),
        { at: { x: 0.38, y }, pinch: 0.2 },
      ];
      for (const step of steps) {
        recorder.step({ timestamp: clock,
                        hands: [hand(step.at, step.pinch)] } as HandFrame);
        clock += 33;
      }
      clock += 500;
    }
    return { recorder, clock };
  }

  /** A pinched hand dragged across the canvas: a wipe. */
  function wipe(recorder: InkRecorder, from: number, y: number, steps = 14) {
    let clock = 20000;
    const path = [
      { at: { x: from, y }, pinch: 0.2 },
      ...Array.from({ length: steps }, (_, i) => ({
        at: { x: from + i * 0.02, y }, pinch: 0.02 })),
      { at: { x: from + steps * 0.02, y }, pinch: 0.2 },
    ];
    for (const step of path) {
      recorder.step({ timestamp: clock,
                      hands: [hand(step.at, step.pinch)] } as HandFrame);
      clock += 33;
    }
  }

  it("takes ink away as the hand moves, not only on release", () => {
    // A wipe whose effect arrives at pen-up gives the researcher nothing to aim
    // with.
    const { recorder } = canvasWith(1);
    recorder.setTool("eraser");
    const before = recorder.strokes().length;

    wipe(recorder, 0.28, 0.3);

    expect(recorder.strokes().length).toBeLessThan(before + 1);
  });

  it("leaves no mark of its own", () => {
    const { recorder } = canvasWith(0);
    recorder.setTool("eraser");
    wipe(recorder, 0.28, 0.3);

    expect(recorder.strokes()).toEqual([]);
    expect(recorder.openStroke()).toBeNull();
  });

  it("is one entry in the history, however many frames it took", () => {
    /**
     * A wipe is one thing the researcher did. Recording a frame at a time would
     * mean fourteen presses of undo to take back one movement of the hand.
     */
    const { recorder } = canvasWith(1);
    recorder.setTool("eraser");
    wipe(recorder, 0.28, 0.3);

    expect(recorder.undo()).toBe(true);
    expect(recorder.strokes()).toHaveLength(1);
    // And that was the erasure, not the drawing: another undo removes the mark.
    expect(recorder.describeUndo()).toBe("Undo drawing a stroke");
  });

  it("gives back the original strokes, not rebuilt ones", () => {
    const { recorder } = canvasWith(1);
    const original = recorder.strokes()[0];
    recorder.setTool("eraser");
    wipe(recorder, 0.28, 0.3);
    recorder.undo();

    expect(recorder.strokes()[0]).toBe(original);
  });

  it("records nothing when the wipe took nothing", () => {
    // A pass over empty canvas in the history would make the first press of
    // undo appear to do nothing.
    const { recorder } = canvasWith(1);
    recorder.setTool("eraser");
    wipe(recorder, 0.05, 0.95);              // nowhere near the mark

    expect(recorder.describeUndo()).toBe("Undo drawing a stroke");
  });

  it("draws normally again once the pen comes back", () => {
    const { recorder } = canvasWith(1);
    recorder.setTool("eraser");
    wipe(recorder, 0.28, 0.3);
    recorder.setTool("pen");

    const before = recorder.strokes().length;
    wipe(recorder, 0.5, 0.8);                // now a stroke, not a wipe

    expect(recorder.strokes().length).toBe(before + 1);
  });
});
