/**
 * Whether a fingertip is steady enough to write with.
 *
 * The complaint that produced this file came from a hand, not a test: the line
 * moved too fast to write with. So these tests measure the two quantities that
 * complaint is actually about — how much of the tracker's tremor reaches the
 * page, and how far the pen travels for a given movement — rather than
 * asserting that a filter was called.
 *
 * The numbers are deliberately comparative. An absolute jitter figure would be
 * a tuning constant pinned in a test, and would have to be rewritten every time
 * the tuning legitimately changed. A *ratio* between the stabilisation levels,
 * and between stabilised and raw, is a claim about the design that stays true.
 */

import { describe, expect, it } from "vitest";
import { InkStabilisation, STABILISATION, Stabiliser } from "@/lib/ink/stabilise";
import { DEFAULT_ONE_EURO } from "@/lib/spatial/filter";
import { InkRecorder } from "@/lib/ink/recorder";
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

/**
 * A hand trying to hold still, with the tremor a real one has.
 *
 * Deterministic rather than random: a test whose verdict depends on a seed is a
 * test that fails for somebody else on a Tuesday.
 */
function tremor(i: number) {
  return {
    x: 0.5 + Math.sin(i * 2.399) * 0.004 + Math.sin(i * 7.13) * 0.0015,
    y: 0.5 + Math.cos(i * 3.117) * 0.004 + Math.cos(i * 5.77) * 0.0015,
  };
}

/** Total path length of a series — the thing tremor inflates. */
function pathLength(points: Array<{ x: number; y: number }>) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function runStabiliser(settings: InkStabilisation,
                       samples: Array<{ x: number; y: number }>) {
  const s = new Stabiliser(settings);
  const out: Array<{ x: number; y: number }> = [];
  samples.forEach((p, i) => {
    const r = s.push(p, i * 33);
    if (r) out.push(r);
  });
  return out;
}

describe("a hand held still produces a still pen", () => {
  const samples = Array.from({ length: 90 }, (_, i) => tremor(i));

  it("removes most of the tremor the tracker reports", () => {
    const raw = pathLength(samples);
    const steady = pathLength(runStabiliser(STABILISATION.steady, samples));

    // The complaint, quantified: a hand trying to hold still should not draw.
    expect(steady).toBeLessThan(raw * 0.35);
  });

  it("gets steadier at each level, in the order the levels claim", () => {
    const natural = pathLength(runStabiliser(STABILISATION.natural, samples));
    const steady = pathLength(runStabiliser(STABILISATION.steady, samples));
    const writing = pathLength(runStabiliser(STABILISATION.handwriting, samples));

    expect(steady).toBeLessThan(natural);
    expect(writing).toBeLessThan(steady);
  });

  it("is steadier than the settings it inherited from the gesture layer", () => {
    /**
     * The defect this file exists for, as a comparison rather than a claim. The
     * pen used `DEFAULT_ONE_EURO` with no dead zone at all, because it was
     * sharing a configuration written for rotating a scene.
     */
    const inheritedConfig = {
      ...STABILISATION.steady, filter: DEFAULT_ONE_EURO, gain: 1, deadZone: 0,
    };
    const inherited = pathLength(runStabiliser(inheritedConfig, samples));
    const own = pathLength(runStabiliser(STABILISATION.steady, samples));

    expect(own).toBeLessThan(inherited * 0.2);
  });
});

describe("smoothing harder makes a letter worse, which is why it is not the lever", () => {
  /**
   * The measurement that redirected this whole module, kept as a test because
   * the intuition it contradicts is a strong one.
   *
   * "Slow movement wants more stabilisation" (§154) reads as an instruction to
   * lower the filter's cutoff. Measured against a letter drawn by a hand with
   * tremor, that is wrong: a low cutoff is lag, and lag on a shape drawn in a
   * second is a phase shift that reads as the shape being drawn wrongly. Every
   * smoothing setting costs shape accuracy and none buys any back — so the
   * tremor is removed by a dead zone, which costs no lag at all, and the cutoff
   * stays high. §153's "avoid over-smoothing" is the operative rule.
   */
  const RADIUS = 0.042;                       // a 60px letter on a 720px canvas
  const letter = Array.from({ length: 30 }, (_, i) => {
    const t = (i / 30) * Math.PI * 2;
    return { x: 0.5 + Math.cos(t) * RADIUS, y: 0.5 + Math.sin(t) * RADIUS };
  }).map((p, i) => ({ x: p.x + Math.sin(i * 7.13) * 0.003,
                      y: p.y + Math.cos(i * 5.77) * 0.003 }));

  /** How far the drawn points sit from the circle that was intended, in px. */
  function shapeError(points: Array<{ x: number; y: number }>) {
    const e = points.slice(5)                 // the filter's warm-up, common to all
      .map((p) => Math.abs(Math.hypot(p.x - 0.5, p.y - 0.5) - RADIUS));
    return Math.sqrt(e.reduce((t, v) => t + v * v, 0) / e.length) * 720;
  }

  it("draws a letter more accurately than a heavily smoothed pen would", () => {
    const heavy: InkStabilisation = {
      ...STABILISATION.steady,
      filter: { minCutoff: 0.3, beta: 1.0, derivativeCutoff: 1.0 },
      gain: 1,
    };
    const mine: InkStabilisation = { ...STABILISATION.handwriting, gain: 1 };

    expect(shapeError(runStabiliser(mine, letter)))
      .toBeLessThan(shapeError(runStabiliser(heavy, letter)) * 0.6);
  });

  it("keeps the handwriting level from being the laggiest one", () => {
    // The trap this guards: a level named "handwriting" invites somebody to
    // lower its cutoff, which is the one change that would damage handwriting.
    expect(STABILISATION.handwriting.filter.minCutoff)
      .toBeGreaterThanOrEqual(STABILISATION.steady.filter.minCutoff);
  });
});

describe("a deliberate mark still arrives", () => {
  /** A straight sweep, the speed of a quick arrow. */
  const sweep = Array.from({ length: 30 }, (_, i) => ({ x: 0.2 + i * 0.02, y: 0.5 }));

  it("follows a fast movement without swallowing it", () => {
    const out = runStabiliser(STABILISATION.natural, sweep);
    const travelled = out[out.length - 1].x - out[0].x;
    const asked = sweep[sweep.length - 1].x - sweep[0].x;

    // Some lag at the tail is inherent to any causal filter; losing the mark is
    // not. §154: quick marks must not feel delayed.
    expect(travelled).toBeGreaterThan(asked * 0.8);
  });

  it("keeps a corner rather than rounding it away", () => {
    // Over-smoothing is its own failure: §153 says fast sharp marks stay sharp.
    const corner = [
      ...Array.from({ length: 12 }, (_, i) => ({ x: 0.3 + i * 0.02, y: 0.4 })),
      ...Array.from({ length: 12 }, (_, i) => ({ x: 0.54, y: 0.4 + i * 0.02 })),
    ];
    const out = runStabiliser(STABILISATION.steady, corner);
    const turn = out[out.length - 1].y - out[0].y;

    expect(turn).toBeGreaterThan(0.1);
  });
});

describe("glitches never reach the page", () => {
  it("drops a jump no hand could have made", () => {
    const samples = [
      { x: 0.50, y: 0.5 }, { x: 0.51, y: 0.5 }, { x: 0.52, y: 0.5 },
      { x: 0.95, y: 0.1 },                       // the tracker finding a face
      { x: 0.53, y: 0.5 }, { x: 0.54, y: 0.5 },
    ];
    const s = new Stabiliser(STABILISATION.steady);
    const out = samples.map((p, i) => s.push(p, i * 33));

    expect(out[3]).toBeNull();
    expect(s.spikesRejected()).toBe(1);
    // And nothing after it was dragged toward the glitch.
    expect(out[5]!.x).toBeLessThan(0.6);
  });

  it("recovers rather than rejecting the rest of the stroke", () => {
    /**
     * The subtle half. If the rejected frame became the reference, every
     * subsequent real frame would be a large jump *from the glitch* and would
     * also be rejected — one bad frame would end drawing until the pen was
     * lifted, which is worse than the glitch.
     */
    const s = new Stabiliser(STABILISATION.steady);
    s.push({ x: 0.5, y: 0.5 }, 0);
    s.push({ x: 0.95, y: 0.1 }, 33);
    const after = s.push({ x: 0.51, y: 0.5 }, 66);

    expect(after).not.toBeNull();
    expect(s.spikesRejected()).toBe(1);
  });
});

describe("gain buys precision without losing the start of the mark", () => {
  it("begins the stroke exactly under the fingertip", () => {
    // Gain compresses travel *from the anchor*, so the first point is not moved.
    const s = new Stabiliser(STABILISATION.handwriting);
    const first = s.push({ x: 0.42, y: 0.61 }, 0)!;

    expect(first.x).toBeCloseTo(0.42, 6);
    expect(first.y).toBeCloseTo(0.61, 6);
  });

  it("moves the pen less than the hand, so a letter is drawable", () => {
    const samples = Array.from({ length: 40 }, (_, i) => ({ x: 0.3 + i * 0.005, y: 0.5 }));
    const natural = runStabiliser(STABILISATION.natural, samples);
    const writing = runStabiliser(STABILISATION.handwriting, samples);

    const travel = (o: Array<{ x: number; y: number }>) => o[o.length - 1].x - o[0].x;
    expect(travel(writing)).toBeLessThan(travel(natural) * 0.75);
  });
});

describe("what the recorder does with it", () => {
  function draw(recorder: InkRecorder, points: Array<{ x: number; y: number }>) {
    recorder.setViewport({ width: 720, height: 520 });
    recorder.arm();
    const steps = [{ at: points[0], pinch: OPEN },
                   ...points.map((at) => ({ at, pinch: PINCHED }))];
    steps.forEach((s, i) => recorder.step({
      timestamp: 1000 + i * 33, hands: [hand(s.at, s.pinch)],
    } as HandFrame));
    return recorder;
  }

  it("records the line that was drawn, not the raw fingertip", () => {
    /**
     * Load-bearing for accuracy rather than for feel. Once gain is applied the
     * ink is no longer the raw fingertip path, and the researcher draws against
     * what they can see. Recording the raw landmark would resolve a drawn loop
     * against a different, larger loop than the one on screen — the selection
     * would disagree with the picture, silently.
     */
    const points = Array.from({ length: 30 }, (_, i) => ({ x: 0.3 + i * 0.01, y: 0.5 }));
    const geared = draw(new InkRecorder({ stabilisation: "handwriting" }), points);
    const oneToOne = draw(new InkRecorder({ stabilisation: "natural" }), points);
    geared.disarm();
    oneToOne.disarm();

    const span = (r: InkRecorder) => {
      const xs = r.strokes()[0].originalPoints.map((p) => p.x);
      return Math.abs(xs[xs.length - 1] - xs[0]);
    };
    // The record follows the gain, because the record is what was drawn.
    expect(span(geared)).toBeLessThan(span(oneToOne) * 0.8);
  });

  it("predicts nothing at the handwriting level", () => {
    // 29 pixels of extrapolation on a letter is not latency compensation.
    const points = Array.from({ length: 20 }, (_, i) => ({ x: 0.3 + i * 0.01, y: 0.5 }));
    const recorder = draw(new InkRecorder({ stabilisation: "handwriting" }), points);

    expect(recorder.openStroke()!.points.some((p) => p.predicted)).toBe(false);
  });

  it("still predicts at the natural level, where marks are fast", () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ x: 0.3 + i * 0.02, y: 0.5 }));
    const recorder = draw(new InkRecorder({ stabilisation: "natural" }), points);

    expect(recorder.openStroke()!.points.some((p) => p.predicted)).toBe(true);
  });

  it("drops a glitched frame from the record entirely", () => {
    const recorder = new InkRecorder({ stabilisation: "steady" });
    recorder.setViewport({ width: 720, height: 520 });
    recorder.arm();
    const path = [{ x: 0.50, y: 0.5 }, { x: 0.50, y: 0.5 }, { x: 0.51, y: 0.5 },
                  { x: 0.52, y: 0.5 }, { x: 0.97, y: 0.05 }, { x: 0.53, y: 0.5 }];
    path.forEach((at, i) => recorder.step({
      timestamp: 1000 + i * 33,
      hands: [hand(at, i === 0 ? OPEN : PINCHED)],
    } as HandFrame));

    const xs = recorder.openStroke()!.originalPoints.map((p) => p.x);
    // Everything recorded sits within the range the hand actually drew in.
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(spread).toBeLessThan(100);
  });
});
