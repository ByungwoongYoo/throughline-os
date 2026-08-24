/**
 * Drawing a straight line with an unsupported arm (§182).
 *
 * The problem is not tremor, which smoothing removes. It is that an arm rotates
 * about a shoulder while the researcher believes they are moving it sideways, so
 * the line bows — and a bowed axis marker or trend line is wrong in a way a
 * wobbly annotation is not.
 */

import { describe, expect, it } from "vitest";
import {
  MAGNETIC_TOLERANCE, STRAIGHTEDGE_HELP, STRAIGHTEDGE_LABEL, Straightedge,
  constrain, headingOf,
} from "@/lib/ink/straightedge";
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

const ORIGIN = { x: 100, y: 100 };

describe("the constraints themselves", () => {
  it("holds a level line level however the hand drifts", () => {
    const drifted = constrain(ORIGIN, { x: 300, y: 160 }, "horizontal", null);
    expect(drifted).toEqual({ x: 300, y: 100 });
  });

  it("holds an upright line upright", () => {
    expect(constrain(ORIGIN, { x: 170, y: 400 }, "vertical", null))
      .toEqual({ x: 100, y: 400 });
  });

  it("snaps to the nearest 45 degrees", () => {
    // 50 degrees becomes 45, not 90.
    const at50 = { x: 100 + Math.cos(0.87) * 200, y: 100 + Math.sin(0.87) * 200 };
    const snapped = constrain(ORIGIN, at50, "diagonal", null);
    const angle = Math.atan2(snapped.y - 100, snapped.x - 100);
    expect(angle).toBeCloseTo(Math.PI / 4, 6);
  });

  it("holds the direction the stroke set off in", () => {
    /**
     * The general case, and the one that matters most: a researcher drawing a
     * trend line wants *a* straight line, not a level one.
     */
    const heading = 0.4;
    const wandered = { x: 400, y: 90 };
    const held = constrain(ORIGIN, wandered, "line", heading);
    const angle = Math.atan2(held.y - 100, held.x - 100);

    expect(angle).toBeCloseTo(heading, 6);
  });

  it("does nothing at all when it is off", () => {
    const point = { x: 271, y: 383 };
    expect(constrain(ORIGIN, point, "off", 0.4)).toEqual(point);
  });
});

describe("magnetic means near, not nearest", () => {
  it("pulls a nearly level line onto level", () => {
    const nearlyLevel = 0.08;                       // about five degrees
    const held = constrain(ORIGIN, { x: 400, y: 124 }, "magnetic", nearlyLevel);
    expect(held.y).toBeCloseTo(100, 6);
  });

  it("leaves a deliberately oblique line alone", () => {
    /**
     * The failure a hard snap-to-nearest would cause. Every line drawn at thirty
     * degrees would jump to forty-five, and the researcher would be fighting the
     * tool rather than using it — worse than no constraint at all.
     */
    const oblique = 0.52;                           // thirty degrees
    const point = { x: 400, y: 273 };
    expect(constrain(ORIGIN, point, "magnetic", oblique)).toEqual(point);
  });

  it("has a tolerance wide enough to aim at and narrow enough to mean something", () => {
    // About twelve degrees: reachable without precision, not so wide that
    // thirty degrees is read as forty-five.
    expect(MAGNETIC_TOLERANCE).toBeGreaterThan(0.1);
    expect(MAGNETIC_TOLERANCE).toBeLessThan(Math.PI / 8);
  });

  it("does nothing before the stroke has a direction", () => {
    const point = { x: 104, y: 103 };
    expect(constrain(ORIGIN, point, "magnetic", null)).toEqual(point);
  });
});

describe("finding the direction a stroke set off in", () => {
  it("waits until the stroke has gone far enough to have one", () => {
    /**
     * The first samples of any stroke are a hand accelerating from rest and
     * their direction is mostly noise. Locking a ruler to that would produce a
     * perfectly straight line pointing somewhere nobody intended — a worse
     * failure than a line that bows, because it looks deliberate.
     */
    expect(headingOf(ORIGIN, [{ x: 102, y: 101 }, { x: 105, y: 103 }])).toBeNull();
  });

  it("reports it once the stroke is long enough", () => {
    const heading = headingOf(ORIGIN, [{ x: 110, y: 105 }, { x: 200, y: 100 }]);
    expect(heading).not.toBeNull();
    expect(heading!).toBeCloseTo(0, 1);
  });

  it("measures from the anchor rather than between samples", () => {
    // A direction taken between consecutive samples is tremor; taken from the
    // start of the stroke it is where the hand has actually gone.
    const heading = headingOf(ORIGIN, [{ x: 100, y: 200 }]);
    expect(heading!).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("what a hand actually draws with it on", () => {
  /** A hand sweeping right while drifting downward, as an arm does. */
  function bowedSweep(recorder: InkRecorder) {
    let clock = 1000;
    const steps = [
      { at: { x: 0.30, y: 0.50 }, pinch: 0.2 },
      ...Array.from({ length: 18 }, (_, i) => ({
        at: { x: 0.30 + i * 0.012, y: 0.50 + Math.sin(i / 18 * Math.PI) * 0.05 },
        pinch: 0.02,
      })),
      { at: { x: 0.52, y: 0.50 }, pinch: 0.2 },
    ];
    for (const step of steps) {
      recorder.step({ timestamp: clock,
                      hands: [hand(step.at, step.pinch)] } as HandFrame);
      clock += 33;
    }
    return recorder.strokes()[0];
  }

  function armed(mode: Straightedge) {
    const recorder = new InkRecorder({ now: () => 5000 });
    recorder.setViewport({ width: 720, height: 520 });
    recorder.arm();
    recorder.setStraightedge(mode);
    return recorder;
  }

  function bow(stroke: { originalPoints: Array<{ x: number; y: number }> }) {
    const ys = stroke.originalPoints.map((p) => p.y);
    return Math.max(...ys) - Math.min(...ys);
  }

  it("bows without it, which is the problem", () => {
    expect(bow(bowedSweep(armed("off")))).toBeGreaterThan(15);
  });

  it("does not bow with it", () => {
    expect(bow(bowedSweep(armed("horizontal")))).toBeLessThan(0.001);
  });

  it("holds the line straight in whatever direction it began", () => {
    const stroke = bowedSweep(armed("line"));
    const first = stroke.originalPoints[0];
    const last = stroke.originalPoints[stroke.originalPoints.length - 1];
    // Every point on the line through the ends.
    for (const p of stroke.originalPoints) {
      const dx = last.x - first.x, dy = last.y - first.y;
      const away = Math.abs((p.x - first.x) * dy - (p.y - first.y) * dx)
                 / Math.hypot(dx, dy);
      expect(away).toBeLessThan(0.001);
    }
  });

  it("applies to the record, so a constrained line is what was drawn", () => {
    /**
     * A ruler is a tool, not an interpretation. What the researcher drew *with a
     * ruler in hand* is the straight line — unlike a shape offer, which changes
     * the drawn copy and leaves the record alone (§174). Getting this backwards
     * would mean a lasso or a measurement resolved against the bowed path the
     * hand took rather than the line on screen.
     */
    const stroke = bowedSweep(armed("horizontal"));
    expect(bow({ originalPoints: stroke.points })).toBeLessThan(0.001);
    expect(bow(stroke)).toBeLessThan(0.001);
  });
});

describe("every setting explains itself", () => {
  it("has a label and a sentence for each", () => {
    const modes: Straightedge[] =
      ["off", "line", "horizontal", "vertical", "diagonal", "magnetic"];
    for (const mode of modes) {
      expect(STRAIGHTEDGE_LABEL[mode].length).toBeGreaterThan(0);
      expect(STRAIGHTEDGE_HELP[mode].length).toBeGreaterThan(20);
    }
  });
});
