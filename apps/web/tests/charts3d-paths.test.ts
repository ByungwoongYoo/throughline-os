/**
 * Ordered paths through space (§9 lines).
 *
 * Seventeen named visualizations rest on this, so these tests are about the
 * properties all of them share: that a hole in the data stays a hole, that
 * thinning a trajectory keeps its corners, that two paths drawn together stay
 * comparable, and that a line integrated through a field stops for a reason it
 * can name.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PATHS, DEFAULT_STREAM, Path, describePaths, nearestSampler,
  preparePaths, simplify, streamline,
} from "@/lib/charts3d/paths";

const line = (id: string, pts: Array<[number, number, number]>): Path => ({
  id, points: pts.map(([x, y, z]) => ({ x, y, z })),
});

describe("a gap in the data stays a gap", () => {
  it("breaks the line rather than drawing across it", () => {
    /*
     * The defect this whole module is arranged around. A satellite track with
     * a dropout, filtered rather than split, becomes a smooth chord across the
     * gap — a confident straight line through territory the object was never
     * observed in, with nothing in the picture to mark it as invented.
     */
    const track: Path = {
      id: "sat",
      points: [
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
        { x: NaN, y: 0, z: 0 }, { x: NaN, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 }, { x: 6, y: 0, z: 0 },
      ],
    };
    const { lines, breaks, missing } = preparePaths([track]);
    expect(lines[0].runs).toHaveLength(2);
    expect(breaks).toBe(1);
    expect(missing).toBe(2);
  });

  it("says so in words, because the picture cannot", () => {
    // A reader looking at a track with a hole in it cannot tell whether the
    // object stopped being observed or stopped moving.
    const track = {
      id: "s",
      points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 },
               { x: NaN, y: 0, z: 0 },
               { x: 3, y: 3, z: 3 }, { x: 4, y: 4, z: 4 }],
    };
    expect(describePaths(preparePaths([track])))
      .toContain("stops rather than crossing");
  });

  it("refuses to close a path that was broken", () => {
    // The closing join would cross exactly the gap that broke it.
    const orbit: Path = {
      id: "o", closed: true,
      points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
               { x: NaN, y: 0, z: 0 },
               { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }],
    };
    expect(preparePaths([orbit]).lines[0].closed).toBe(false);
  });

  it("keeps a closed path closed when nothing is missing", () => {
    const orbit: Path = {
      id: "o", closed: true,
      points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
               { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }],
    };
    expect(preparePaths([orbit]).lines[0].closed).toBe(true);
  });

  it("drops a run of one point rather than drawing a line to nowhere", () => {
    const track: Path = {
      id: "t",
      points: [{ x: 0, y: 0, z: 0 },
               { x: NaN, y: 0, z: 0 },
               { x: 5, y: 5, z: 5 }, { x: 6, y: 6, z: 6 }],
    };
    const { lines } = preparePaths([track]);
    expect(lines[0].runs).toHaveLength(1);
    expect(lines[0].runs[0]).toHaveLength(2);
  });

  it("reports a path with too few points instead of silently dropping it", () => {
    const { lines, degenerate } = preparePaths([
      line("good", [[0, 0, 0], [1, 1, 1]]),
      { id: "lonely", points: [{ x: 0, y: 0, z: 0 }] },
    ]);
    expect(lines.map((l) => l.id)).toEqual(["good"]);
    expect(degenerate).toEqual(["lonely"]);
    expect(describePaths(preparePaths([{ id: "l", points: [] }])))
      .toContain("fewer than two measured points");
  });
});

describe("thinning keeps the shape, not the spacing", () => {
  it("keeps a sharp corner that a stride would cut", () => {
    /*
     * The corner *is* the data — an orbit's periapsis, the point where a robot
     * arm reverses, a spike in a sensor trace. Each is a single extreme sample
     * among many ordinary ones, which is exactly what a stride is most likely
     * to drop.
     */
    const along: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i <= 20; i += 1) along.push({ x: i / 20, y: 0, z: 0 });
    along.push({ x: 1, y: 1, z: 0 });          // the corner
    for (let i = 1; i <= 20; i += 1) along.push({ x: 1 - i / 20, y: 0, z: 0 });

    const kept = simplify(along, 0.01);
    expect(kept.length).toBeLessThan(along.length);
    expect(kept.some((p) => p.y === 1)).toBe(true);
  });

  it("discards points that lie along the line", () => {
    const straight = Array.from({ length: 50 },
      (_, i) => ({ x: i / 49, y: 0, z: 0 }));
    expect(simplify(straight, 0.01)).toHaveLength(2);
  });

  it("measures to the segment, not to the infinite line", () => {
    /*
     * A path that doubles back has its turn beyond the end of the chord.
     * Every point here is collinear, so measured against the *infinite* line
     * through the ends the overshoot is distance zero and gets discarded — the
     * reversal, which is the only event in the trajectory, silently deleted.
     * Against the segment it is four units past the end and must be kept.
     *
     * An earlier version of this test put the same point at both ends, which
     * makes the chord zero-length and never reaches the clamp at all: it
     * passed with the clamp removed.
     */
    const out = [{ x: 0, y: 0, z: 0 },
                 { x: 5, y: 0, z: 0 },      // the overshoot
                 { x: 1, y: 0, z: 0 }];
    expect(simplify(out, 0.01).some((p) => p.x === 5)).toBe(true);
  });

  it("keeps both ends whatever the tolerance", () => {
    const path = Array.from({ length: 30 },
      (_, i) => ({ x: i, y: Math.sin(i), z: 0 }));
    const kept = simplify(path, 1e9);
    expect(kept).toHaveLength(2);
    expect(kept[0]).toEqual(path[0]);
    expect(kept[1]).toEqual(path[path.length - 1]);
  });

  it("leaves a two-point path alone", () => {
    const two = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }];
    expect(simplify(two, 0.5)).toEqual(two);
  });

  it("does not recurse on a very long path", () => {
    /*
     * The textbook implementation recurses per split, and a hundred thousand
     * points recurse deeper than the stack allows. The failure is a RangeError
     * raised inside a geometry routine, which reads as anything except a limit
     * on how long a trajectory may be.
     */
    const long = Array.from({ length: 100000 },
      (_, i) => ({ x: i / 1000, y: Math.sin(i / 50), z: 0 }));
    expect(() => simplify(long, 0.001)).not.toThrow();
  });

  it("counts what it removed, rather than quietly shrinking", () => {
    const straight = Array.from({ length: 40 },
      (_, i) => ({ x: i, y: 0, z: 0 }));
    const prepared = preparePaths([{ id: "s", points: straight }]);
    expect(prepared.simplified).toBeGreaterThan(30);
    expect(describePaths(prepared)).toContain("the shape is unchanged");
  });

  it("does not simplify at all when told not to", () => {
    const wobbly = Array.from({ length: 20 },
      (_, i) => ({ x: i, y: 0, z: 0 }));
    const prepared = preparePaths([{ id: "s", points: wobbly }],
                                  { ...DEFAULT_PATHS, tolerance: 0 });
    expect(prepared.lines[0].runs[0]).toHaveLength(20);
    expect(prepared.simplified).toBe(0);
  });
});

describe("two paths drawn together stay comparable", () => {
  it("normalises across all paths, not each to its own extent", () => {
    /*
     * Scaled separately, a short orbit and a long one both fill the cube and
     * look the same size — destroying the one comparison a reader makes when
     * two trajectories are drawn in one frame.
     */
    const { lines } = preparePaths([
      line("small", [[0, 0, 0], [1, 0, 0]]),
      line("large", [[0, 0, 0], [10, 0, 0]]),
    ]);
    const width = (id: string) => {
      const run = lines.find((l) => l.id === id)!.runs[0];
      return Math.abs(run[run.length - 1].x - run[0].x);
    };
    expect(width("small")).toBeCloseTo(width("large") / 10, 6);
  });

  it("fills the unit cube the rest of the charts use", () => {
    const { lines } = preparePaths([line("a", [[0, 0, 0], [4, 8, 2]])]);
    const pts = lines[0].runs.flat();
    for (const p of pts) {
      for (const v of [p.x, p.y, p.z]) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("puts a planar path in the middle of the flat axis", () => {
    // A planar orbit, or a trajectory through two parameters, is ordinary —
    // and its zero extent divides to NaN if nothing guards it.
    const { lines } = preparePaths([line("flat", [[0, 0, 5], [1, 1, 5]])]);
    expect(lines[0].runs[0].every((p) => p.z === 0)).toBe(true);
    expect(lines[0].runs[0].every((p) => Number.isFinite(p.x))).toBe(true);
  });

  it("says plainly when there is nothing", () => {
    expect(describePaths(preparePaths([]))).toBe("No paths to draw.");
  });
});

describe("a budget that cannot be exceeded", () => {
  it("thins to the limit across every path", () => {
    const many: Path[] = Array.from({ length: 5 }, (_, k) => ({
      id: `p${k}`,
      points: Array.from({ length: 4000 },
        (_, i) => ({ x: i, y: Math.sin(i / 7) * (k + 1), z: k })),
    }));
    const prepared = preparePaths(many, { tolerance: 0, maxPoints: 1000 });
    const total = prepared.lines.reduce(
      (n, l) => n + l.runs.reduce((m, r) => m + r.length, 0), 0);
    expect(total).toBeLessThanOrEqual(1000);
  });

  it("keeps the last point, so a thinned orbit still closes", () => {
    // A stride that does not divide the length would otherwise stop short, and
    // a closed path drawn to a point short of its start has a visible notch.
    const orbit: Path = {
      id: "o", closed: true,
      points: Array.from({ length: 999 }, (_, i) => ({
        x: Math.cos((i / 999) * Math.PI * 2),
        y: Math.sin((i / 999) * Math.PI * 2), z: 0 })),
    };
    const prepared = preparePaths([orbit], { tolerance: 0, maxPoints: 100 });
    const run = prepared.lines[0].runs[0];
    const source = orbit.points[orbit.points.length - 1];
    expect(run[run.length - 1].x).toBeCloseTo(source.x, 6);
  });

  it("never thins a path below its two ends", () => {
    const paths: Path[] = Array.from({ length: 60 }, (_, k) => ({
      id: `p${k}`,
      points: [{ x: k, y: 0, z: 0 }, { x: k, y: 1, z: 0 }],
    }));
    const prepared = preparePaths(paths, { tolerance: 0, maxPoints: 10 });
    for (const l of prepared.lines) expect(l.runs[0].length).toBeGreaterThanOrEqual(2);
  });
});

describe("a line integrated through a field", () => {
  /** A rotation about z: circular flow, no source and no sink. */
  const vortex = (x: number, y: number) => ({ u: -y, v: x, w: 0 });

  it("keeps a circular flow circular", () => {
    /*
     * The reason for RK4 rather than Euler, and it is visible rather than
     * academic: Euler leaves the curve along its tangent at every step and
     * never returns, turning a rotation into an outward spiral. A reader shown
     * that spiral sees a source which is not in the field.
     */
    const { points } = streamline(vortex, { x: 0.5, y: 0, z: 0 },
                                  { ...DEFAULT_STREAM, maxSteps: 300 });
    const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
    const drift = Math.abs(radius(points[points.length - 1]) - 0.5);
    expect(drift).toBeLessThan(0.01);
  });

  it("stops at a stagnation point instead of spending its whole budget", () => {
    // A fixed point of the integration: without a floor the solver takes ten
    // thousand steps that go nowhere and draws a dot at the end of a line.
    const still = () => ({ u: 0, v: 0, w: 0 });
    const line = streamline(still, { x: 0, y: 0, z: 0 });
    expect(line.ended).toBe("stalled");
    expect(line.points.length).toBeLessThan(5);
  });

  it("stops when it leaves the field, and says which", () => {
    const bounded = (x: number) =>
      Math.abs(x) < 1 ? { u: 1, v: 0, w: 0 } : null;
    const line = streamline(bounded, { x: 0, y: 0, z: 0 });
    expect(line.ended).toBe("left the field");
  });

  it("reports running out of steps rather than implying it arrived", () => {
    const line = streamline(vortex, { x: 0.5, y: 0, z: 0 },
                            { ...DEFAULT_STREAM, maxSteps: 5 });
    expect(line.ended).toBe("ran out of steps");
    expect(line.points).toHaveLength(6);
  });

  it("steps a fixed distance regardless of the field's magnitude", () => {
    /*
     * A field measured in millions would leave the cube in one step; one
     * measured in millionths would never move. The step is a distance, so the
     * same picture comes out of the same shape of flow whatever its units.
     */
    const fast = () => ({ u: 1e6, v: 0, w: 0 });
    const slow = () => ({ u: 1e-3, v: 0, w: 0 });
    const a = streamline(fast, { x: 0, y: 0, z: 0 }, { ...DEFAULT_STREAM, maxSteps: 10 });
    const b = streamline(slow, { x: 0, y: 0, z: 0 }, { ...DEFAULT_STREAM, maxSteps: 10 });
    expect(a.points[10].x).toBeCloseTo(b.points[10].x, 9);
  });

  it("begins at the seed it was given", () => {
    const { points } = streamline(vortex, { x: 0.25, y: 0.1, z: 0 });
    expect(points[0]).toEqual({ x: 0.25, y: 0.1, z: 0 });
  });
});

describe("sampling a field that is only measurements", () => {
  const samples = [
    { x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 },
    { x: 1, y: 0, z: 0, u: 0, v: 1, w: 0 },
  ];

  it("answers with the nearest measurement", () => {
    const at = nearestSampler(samples);
    expect(at(0.1, 0, 0)).toEqual({ u: 1, v: 0, w: 0 });
    expect(at(0.9, 0, 0)).toEqual({ u: 0, v: 1, w: 0 });
  });

  it("answers null outside the sampled region rather than zero", () => {
    /*
     * A sampler returning zero out there would leave every line *stalled* at
     * the boundary, indistinguishable from a real stagnation point — which is
     * a finding. Null makes it "left the field", which is the truth.
     */
    const at = nearestSampler(samples, 0.25);
    expect(at(9, 9, 9)).toBeNull();
    expect(streamline(at, { x: 9, y: 9, z: 9 }).ended).toBe("left the field");
  });
});

describe("the settings are a decision, not a magic number", () => {
  it("simplifies below what a reader could see anyway", () => {
    // Roughly half a pixel at a typical figure size.
    expect(DEFAULT_PATHS.tolerance).toBeGreaterThan(0);
    expect(DEFAULT_PATHS.tolerance).toBeLessThan(0.01);
  });

  it("integrates in steps small enough to follow a curve", () => {
    // The cube is two units across, so a step of a fiftieth of that resolves
    // a circular flow rather than cutting across it.
    expect(DEFAULT_STREAM.step).toBeLessThan(0.05);
    expect(DEFAULT_STREAM.maxSteps).toBeGreaterThan(100);
  });
});
