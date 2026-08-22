/**
 * Air Ink, where it can be judged without a hand.
 *
 * The subsystem's own claims are testable even though the drawing is not: that
 * ink requires two deliberate acts, that prediction never becomes evidence, and
 * that a circle becomes the right set of observations. Those are the parts that
 * would be wrong silently.
 */

import { describe, expect, it } from "vitest";
import { InkStateMachine } from "@/lib/ink/machine";
import { DEFAULT_PREDICT, predictAhead, velocityBetween } from "@/lib/ink/predict";
import {
  DEFAULT_STYLE, containsPoint, isClosed, newStrokeId, observedPoints, resample,
  SpatialStroke, StrokePoint,
} from "@/lib/ink/stroke";
import { describeSelection, selectWithinStroke } from "@/lib/ink/select";
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

function frames(machine: InkStateMachine, hands: Hand[][], startAt = 0) {
  const results = hands.map((set, i) =>
    machine.step({ timestamp: startAt + i * 33, hands: set } as HandFrame));
  return { results, events: results.flatMap((r) => r.events),
           drawn: results.filter((r) => r.drawing), last: results[results.length - 1] };
}

describe("ink takes two deliberate acts", () => {
  it("draws nothing at all until the tool is armed", () => {
    /**
     * The stricter half of §139. A stray rotation is undone by rotating back; a
     * stray mark on a colleague's figure is something somebody has to notice.
     * So pointing, pinching and moving produce no ink while the pen is away.
     */
    const machine = new InkStateMachine();

    const { drawn, events } = frames(machine, [
      [hand({ x: 0.4, y: 0.5 }, 0.02)],
      [hand({ x: 0.5, y: 0.5 }, 0.02)],
      [hand({ x: 0.6, y: 0.5 }, 0.02)],
    ]);

    expect(drawn).toEqual([]);
    expect(events).toEqual([]);
  });

  it("still draws nothing when armed but not pinched", () => {
    /** A pointing finger is what people use while they talk. */
    const machine = new InkStateMachine();
    machine.arm();

    const { drawn } = frames(machine, [
      [hand({ x: 0.4, y: 0.5 }, 0.25)],
      [hand({ x: 0.5, y: 0.5 }, 0.25)],
      [hand({ x: 0.6, y: 0.5 }, 0.25)],
    ]);

    expect(drawn).toEqual([]);
  });

  it("draws once armed and pinched", () => {
    const machine = new InkStateMachine();
    machine.arm();

    const { events, drawn } = frames(machine, [
      [hand({ x: 0.4, y: 0.5 }, 0.25)],
      [hand({ x: 0.4, y: 0.5 }, 0.02)],
      [hand({ x: 0.45, y: 0.5 }, 0.02)],
      [hand({ x: 0.5, y: 0.5 }, 0.02)],
    ]);

    expect(events).toContain("penDown");
    expect(drawn.length).toBeGreaterThan(0);
  });

  it("ignores a pinch too brief to be a mark", () => {
    /**
     * One frame registers a pinch and cannot distinguish it from a hand closing
     * on its way somewhere else. A dot is the most common piece of unwanted ink.
     */
    const machine = new InkStateMachine();
    machine.arm();

    const { events, drawn } = frames(machine, [
      [hand({ x: 0.4, y: 0.5 }, 0.25)],
      [hand({ x: 0.4, y: 0.5 }, 0.02)],   // one frame only
      [hand({ x: 0.4, y: 0.5 }, 0.25)],
    ]);

    expect(drawn).toEqual([]);
    expect(events).toContain("strokeCancelled");
    expect(events).not.toContain("penDown");
  });

  it("lifts the pen when the pinch opens", () => {
    const machine = new InkStateMachine();
    machine.arm();

    const { events } = frames(machine, [
      [hand({ x: 0.4, y: 0.5 }, 0.25)],
      [hand({ x: 0.4, y: 0.5 }, 0.02)],
      [hand({ x: 0.45, y: 0.5 }, 0.02)],
      [hand({ x: 0.5, y: 0.5 }, 0.25)],
    ]);

    expect(events).toContain("penUp");
  });

  it("holds the pen down through the hysteresis band", () => {
    /** §27. A pen that lifted whenever the pinch drifted would draw dashes. */
    const machine = new InkStateMachine();
    machine.arm();

    const { events } = frames(machine, [
      [hand({ x: 0.4, y: 0.5 }, 0.25)],
      [hand({ x: 0.4, y: 0.5 }, 0.02)],
      [hand({ x: 0.45, y: 0.5 }, 0.02)],
      [hand({ x: 0.5, y: 0.5 }, 0.045)],   // inside the band
    ]);

    expect(events.filter((e) => e === "penUp")).toEqual([]);
  });
});

describe("tracking loss ends the stroke", () => {
  it("lifts the pen rather than bridging the gap", () => {
    /**
     * Rule 23. Resuming when the hand returns would draw a straight line across
     * whatever it did while invisible — a mark nobody made, in the middle of a
     * figure.
     */
    const machine = new InkStateMachine();
    machine.arm();

    const { events } = frames(machine, [
      [hand({ x: 0.4, y: 0.5 }, 0.25)],
      [hand({ x: 0.4, y: 0.5 }, 0.02)],
      [hand({ x: 0.45, y: 0.5 }, 0.02)],
      [], [], [],
    ]);

    expect(events).toContain("penUp");
    expect(events).toContain("trackingLost");
  });

  it("comes back armed rather than drawing", () => {
    const machine = new InkStateMachine();
    machine.arm();
    frames(machine, [
      [hand({ x: 0.4, y: 0.5 }, 0.02)], [hand({ x: 0.45, y: 0.5 }, 0.02)],
      [], [], [],
    ]);

    const after = frames(machine, [[hand({ x: 0.5, y: 0.5 }, 0.02)]], 1000);

    expect(after.events).toContain("trackingRecovered");
    expect(after.drawn).toEqual([]);
  });
});

describe("prediction hides latency without inventing evidence", () => {
  it("extends a steady movement", () => {
    const path = [
      { x: 0.30, y: 0.5, timestamp: 0 },
      { x: 0.34, y: 0.5, timestamp: 33 },
      { x: 0.38, y: 0.5, timestamp: 66 },
    ];

    const ahead = predictAhead(path);

    expect(ahead).not.toBeNull();
    expect(ahead!.x).toBeGreaterThan(0.38);
    expect(ahead!.y).toBeCloseTo(0.5, 3);
  });

  it("gives up at a corner rather than rounding it off", () => {
    /**
     * The corners are usually the part a researcher drew deliberately — the
     * elbow of an arrow, the vertex of a bracket. Extrapolating through one
     * smooths away the intent.
     */
    const corner = [
      { x: 0.30, y: 0.50, timestamp: 0 },
      { x: 0.36, y: 0.50, timestamp: 33 },
      { x: 0.36, y: 0.56, timestamp: 66 },   // sharp right turn
    ];

    expect(predictAhead(corner)).toBeNull();
  });

  it("predicts nothing for a hand that is almost still", () => {
    /** At rest the velocity is tracker noise, and extrapolated noise is a
     * twitching tail on a stationary pen. */
    const still = [
      { x: 0.400, y: 0.500, timestamp: 0 },
      { x: 0.4005, y: 0.4998, timestamp: 33 },
      { x: 0.4002, y: 0.5001, timestamp: 66 },
    ];

    expect(predictAhead(still)).toBeNull();
  });

  it("never predicts further than its ceiling", () => {
    /** A tracking spike would otherwise throw the line across the frame. */
    const spike = [
      { x: 0.10, y: 0.5, timestamp: 0 },
      { x: 0.30, y: 0.5, timestamp: 16 },
      { x: 0.50, y: 0.5, timestamp: 32 },
    ];

    const ahead = predictAhead(spike)!;

    expect(ahead.x - 0.50).toBeLessThanOrEqual(DEFAULT_PREDICT.maxStep + 1e-9);
  });

  it("survives two samples sharing a timestamp", () => {
    /** Batched trackers do this, and dividing by a zero interval puts the point
     * at the far edge of the universe. */
    expect(velocityBetween({ x: 0, y: 0, timestamp: 5 },
                           { x: 1, y: 1, timestamp: 5 })).toBeNull();
  });

  it("keeps predicted points out of the evidence", () => {
    /**
     * The rule that lets prediction exist at all: it may change how a line
     * looks and never what it claims. A selection bounded partly by a guess
     * would contain observations the hand never enclosed.
     */
    const stroke = makeStroke([
      { x: 0, y: 0, predicted: false }, { x: 1, y: 0, predicted: false },
      { x: 2, y: 0, predicted: true },
    ]);

    expect(observedPoints(stroke)).toHaveLength(2);
  });
});

function makeStroke(
  points: Array<{ x: number; y: number; predicted?: boolean }>): SpatialStroke {
  const full: StrokePoint[] = points.map((p, i) => ({
    x: p.x, y: p.y, timestamp: i * 33, confidence: 0.95, predicted: p.predicted,
  }));
  return {
    id: newStrokeId(), tool: "lasso", space: "screen", style: DEFAULT_STYLE,
    originalPoints: full, points: full, createdAt: 0, createdBy: "test",
  };
}

/** A closed loop, as a hand would draw one: not quite meeting. */
function loop(cx: number, cy: number, r: number, n = 28): Array<{ x: number; y: number }> {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 1.94;   // stops just short of closing
    return { x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r };
  });
}

describe("a circle becomes a set of observations", () => {
  it("selects what is inside it", () => {
    const stroke = makeStroke(loop(100, 100, 40));
    const marks = [
      { id: "a", at: { x: 100, y: 100 } },
      { id: "b", at: { x: 110, y: 95 } },
      { id: "c", at: { x: 300, y: 300 } },   // well outside
    ];
    const probe = (at: { x: number; y: number }) => {
      const hit = marks.find((m) => Math.hypot(m.at.x - at.x, m.at.y - at.y) < 8);
      return hit ? { id: hit.id, label: hit.id } : null;
    };

    const result = selectWithinStroke(stroke, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targets.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("counts each observation once, however many samples hit it", () => {
    /** The count is the number a researcher reads and quotes. */
    const stroke = makeStroke(loop(100, 100, 40));
    const probe = () => ({ id: "same", label: "one mark" });

    const result = selectWithinStroke(stroke, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targets).toHaveLength(1);
    expect(describeSelection(result)).toBe("1 observation is inside that region.");
  });

  it("refuses a stroke that is not a region, and says why", () => {
    /** A line through a scatter is a proposed trend, not a selection. */
    const line = makeStroke(Array.from({ length: 20 },
                                       (_, i) => ({ x: i * 10, y: 50 })));

    const result = selectWithinStroke(line, () => ({ id: "x", label: "x" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-a-region");
    expect(result.message).toMatch(/closed region/i);
  });

  it("says when a region caught nothing, rather than returning silence", () => {
    /**
     * An empty selection returned quietly is indistinguishable from a cluster
     * that happens to be empty — and one of those is a missed circle while the
     * other is a finding.
     */
    const stroke = makeStroke(loop(100, 100, 20));

    const result = selectWithinStroke(stroke, () => null);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("nothing-inside");
    expect(result.message).toMatch(/drawing a little wider/i);
  });

  it("bounds the region with observed points only", () => {
    /** A predicted overshoot must not enlarge what was selected. */
    const points = loop(100, 100, 30).map((p) => ({ ...p, predicted: false }));
    points.push({ x: 400, y: 400, predicted: true });   // a wild prediction
    const stroke = makeStroke(points);

    const probe = (at: { x: number; y: number }) =>
      Math.hypot(at.x - 380, at.y - 380) < 10 ? { id: "far", label: "far" } : null;

    const result = selectWithinStroke(stroke, probe);

    // The far mark sits inside the predicted overshoot and outside the circle.
    expect(result.ok).toBe(false);
  });
});

describe("stroke geometry", () => {
  it("knows a loop from a line", () => {
    expect(isClosed(loop(0, 0, 10).map((p, i) =>
      ({ ...p, timestamp: i, confidence: 1 })))).toBe(true);
    expect(isClosed(Array.from({ length: 20 }, (_, i) =>
      ({ x: i, y: 0, timestamp: i, confidence: 1 })))).toBe(false);
  });

  it("thins points a still hand piled up, and keeps the last one", () => {
    /** The end of a stroke is where the hand stopped; moving it moves the end
     * of a region somewhere the researcher did not put it. */
    const dense: StrokePoint[] = Array.from({ length: 40 }, (_, i) => ({
      x: i * 0.05, y: 0, timestamp: i, confidence: 1,
    }));

    const thinned = resample(dense);

    expect(thinned.length).toBeLessThan(dense.length);
    expect(thinned[thinned.length - 1]).toBe(dense[dense.length - 1]);
  });

  it("puts a point inside or outside a polygon correctly", () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
                    { x: 0, y: 10 }];
    expect(containsPoint(square, { x: 5, y: 5 })).toBe(true);
    expect(containsPoint(square, { x: 15, y: 5 })).toBe(false);
  });
});
