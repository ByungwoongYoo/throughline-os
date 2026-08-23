/**
 * Preparing a vector field (§9 fields).
 *
 * Twenty-six named visualizations are this primitive, so these tests are about
 * the properties all twenty-six depend on rather than about any picture: that
 * a field too dense to draw is thinned evenly and says so, that one outlier
 * cannot squash the rest to invisibility, and that a vector still points where
 * it pointed after every transformation applied to it.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIELD, Sample, describeField, percentile, prepareField,
  sampleFunction,
} from "@/lib/charts3d/field";

/** A lattice of `n³` samples, all pointing the same way. */
const lattice = (n: number, vector = [1, 0, 0]): Sample[] => {
  const out: Sample[] = [];
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j < n; j += 1)
      for (let k = 0; k < n; k += 1)
        out.push({ x: i, y: j, z: k,
                   u: vector[0], v: vector[1], w: vector[2] });
  return out;
};

describe("a vector still points where it pointed", () => {
  it("keeps the direction through normalisation", () => {
    /*
     * The mistake this exists to prevent: normalising the vector components
     * per axis the way positions are normalised. Positions are three
     * independent measurements and may be stretched separately; a vector is
     * one quantity with a direction, and stretching its components separately
     * points it somewhere it does not point — a wind field that says
     * north-east when the wind is east.
     */
    const field = prepareField([
      { x: 0, y: 0, z: 0, u: 1, v: 1, w: 0 },
      { x: 10, y: 1, z: 0, u: 1, v: 1, w: 0 },
    ]);
    const [g] = field.glyphs;
    // The tail-to-head vector still has equal x and y components.
    expect(g.hx - g.x).toBeCloseTo(g.hy - g.y, 9);
  });

  it("keeps a still point instead of dropping it", () => {
    /*
     * A stagnation point in a flow, or a null in a magnetic field, is exactly
     * what a researcher is looking for. Dropping it because it has no
     * direction to draw erases the finding and leaves a gap that reads as
     * missing data.
     */
    const field = prepareField([
      { x: 0, y: 0, z: 0, u: 0, v: 0, w: 0 },
      { x: 1, y: 0, z: 0, u: 2, v: 0, w: 0 },
    ]);
    expect(field.glyphs).toHaveLength(2);
    const still = field.glyphs[0];
    expect(still.hx).toBe(still.x);
    expect(still.hy).toBe(still.y);
    expect(still.hz).toBe(still.z);
  });

  it("refuses a sample it cannot read rather than drawing NaN", () => {
    // A NaN position renders nothing while reporting no error, which is the
    // worst of both — the reader sees a sparse field and believes it.
    const field = prepareField([
      { x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 },
      { x: NaN, y: 0, z: 0, u: 1, v: 0, w: 0 },
      { x: 1, y: 0, z: 0, u: Infinity, v: 0, w: 0 },
    ]);
    expect(field.glyphs).toHaveLength(1);
    expect(field.invalid).toBe(2);
  });
});

describe("a field too dense to draw", () => {
  it("thins to the limit and says how much it dropped", () => {
    const field = prepareField(lattice(20), { maxGlyphs: 500, reach: 0.9 });
    expect(field.glyphs.length).toBeLessThanOrEqual(500);
    expect(field.dropped).toBe(8000 - field.glyphs.length);
  });

  it("thins evenly rather than taking a corner", () => {
    /*
     * Taking the first N samples of a lattice is one face of the cube shown as
     * though it were the whole field. A stride keeps the survivors spread, so
     * the thinned picture is the same field at lower resolution rather than a
     * different, smaller one.
     */
    const field = prepareField(lattice(12), { maxGlyphs: 200, reach: 0.9 });
    const xs = field.glyphs.map((g) => g.x);
    // Spanning the full cube, not a slab at one end of it.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.8);
    /*
     * And *populating* it: a span alone cannot tell the two apart, because
     * positions used to be normalised over the survivors, so a corner was
     * stretched to fill the cube and measured as a full span. Counting the
     * distinct depths the survivors occupy is what separates a thinned field
     * from a slab of one.
     */
    expect(new Set(xs.map((x) => x.toFixed(4))).size).toBeGreaterThan(6);
  });

  it("does not expand to fill the gap left by a dropped extreme", () => {
    /*
     * Positions are measured over every usable sample rather than over the
     * survivors. If the stride happens to drop the sample at the far edge —
     * as it does here, five samples thinned to two — normalising over the
     * survivors would stretch the remainder to fill the cube, and the field
     * would appear to extend to a place nothing was measured.
     */
    const line: Sample[] = Array.from({ length: 5 }, (_, i) => ({
      x: i, y: 0, z: 0, u: 1, v: 0, w: 0 }));
    const field = prepareField(line, { maxGlyphs: 2, reach: 0.9 });

    expect(field.dropped).toBeGreaterThan(0);
    const furthest = Math.max(...field.glyphs.map((g) => g.x));
    // Short of the cube's edge, because the sample at the edge is not here.
    expect(furthest).toBeLessThan(0.99);
  });

  it("keeps everything when there is room", () => {
    const field = prepareField(lattice(4));
    expect(field.glyphs).toHaveLength(64);
    expect(field.dropped).toBe(0);
  });

  it("says the field is denser than it looks", () => {
    const field = prepareField(lattice(20), { maxGlyphs: 100, reach: 0.9 });
    expect(describeField(field)).toContain("denser than it looks");
  });
});

describe("one outlier does not own the scale", () => {
  it("keeps the ordinary vectors visible beside a huge one", () => {
    /*
     * Scaled against the maximum, a field with one vector a hundred times the
     * rest draws that one at full length and every other as a dot — a picture
     * of the outlier rather than of the field. This is the specific reason the
     * reference is a percentile.
     */
    const samples: Sample[] = Array.from({ length: 40 }, (_, i) => ({
      x: i, y: 0, z: 0, u: 1, v: 0, w: 0 }));
    samples.push({ x: 40, y: 0, z: 0, u: 100, v: 0, w: 0 });

    const field = prepareField(samples);
    const ordinary = field.glyphs[0];
    const longest = Math.max(...field.glyphs.map((g) => g.hx - g.x));
    // The ordinary arrows are a large share of the longest drawn, rather than
    // a rounding error beside it.
    expect((ordinary.hx - ordinary.x) / longest).toBeGreaterThan(0.5);
  });

  it("clamps the outlier and reports it", () => {
    const samples: Sample[] = Array.from({ length: 40 }, (_, i) => ({
      x: i, y: 0, z: 0, u: 1, v: 0, w: 0 }));
    samples.push({ x: 40, y: 0, z: 0, u: 100, v: 0, w: 0 });

    const field = prepareField(samples);
    expect(field.clamped).toBeGreaterThan(0);
    expect(describeField(field)).toContain("read those by colour");
  });

  it("still carries the clamped magnitude in colour", () => {
    /*
     * The clamp costs length, so the level that drives colour is taken against
     * the true range rather than the clamped one. Otherwise the outlier is
     * both the same length *and* the same colour as its neighbours, and the
     * chart has silently deleted it.
     */
    const samples: Sample[] = Array.from({ length: 40 }, (_, i) => ({
      x: i, y: 0, z: 0, u: 1, v: 0, w: 0 }));
    samples.push({ x: 40, y: 0, z: 0, u: 100, v: 0, w: 0 });

    const field = prepareField(samples);
    const outlier = field.glyphs.find((g) => g.magnitude === 100)!;
    expect(outlier.level).toBe(1);
    expect(field.glyphs[0].level).toBeLessThan(0.1);
  });

  it("clamps nothing when the field is uniform", () => {
    const field = prepareField(lattice(4));
    expect(field.clamped).toBe(0);
    expect(describeField(field)).not.toContain("shortened");
  });
});

describe("an arrow does not reach into its neighbour", () => {
  it("keeps the longest arrow inside the gap between samples", () => {
    /*
     * A field of arrows that cross reads as turbulence that is not in the
     * data. The gap is estimated from the count, so this holds for a lattice
     * of any density rather than only the one it was tuned on.
     */
    for (const n of [3, 5, 8]) {
      const field = prepareField(lattice(n));
      const spacing = 2 / Math.cbrt(field.glyphs.length);
      const longest = Math.max(
        ...field.glyphs.map((g) => Math.hypot(g.hx - g.x, g.hy - g.y, g.hz - g.z)));
      expect(longest).toBeLessThanOrEqual(spacing);
    }
  });

  it("draws shorter arrows in a denser field", () => {
    const sparse = prepareField(lattice(3));
    const dense = prepareField(lattice(9));
    const reach = (f: typeof sparse) =>
      Math.max(...f.glyphs.map((g) => Math.hypot(g.hx - g.x, g.hy - g.y)));
    expect(reach(dense)).toBeLessThan(reach(sparse));
  });
});

describe("a field with nothing to place", () => {
  it("puts a single sample in the middle rather than nowhere", () => {
    // Every axis is degenerate, and a span of zero divided by itself is NaN.
    const [only] = prepareField(
      [{ x: 5, y: 5, z: 5, u: 1, v: 0, w: 0 }]).glyphs;
    expect(Number.isFinite(only.x + only.y + only.z)).toBe(true);
    expect(only).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it("handles a field sampled on a plane", () => {
    // An ordinary case, not an error: a slice through a flow.
    const flat = prepareField([
      { x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 },
      { x: 1, y: 1, z: 0, u: 0, v: 1, w: 0 },
    ]);
    expect(flat.glyphs.every((g) => Number.isFinite(g.z))).toBe(true);
    expect(flat.glyphs[0].z).toBe(0);
  });

  it("says plainly when there is nothing", () => {
    expect(describeField(prepareField([]))).toBe("No vectors to draw.");
  });

  it("draws a field of nothing but still points without dividing by zero", () => {
    const field = prepareField(lattice(3, [0, 0, 0]));
    expect(field.glyphs.every((g) => Number.isFinite(g.hx))).toBe(true);
  });
});

describe("sampling a function that has no measurements", () => {
  it("covers the bounds at both ends", () => {
    const samples = sampleFunction((x, y, z) => [x, y, z], 4,
                                   { min: -2, max: 2 });
    const xs = samples.map((s) => s.x);
    expect(Math.min(...xs)).toBe(-2);
    expect(Math.max(...xs)).toBe(2);
    expect(samples).toHaveLength(64);
  });

  it("asks for the vector at the position it reports", () => {
    // A lattice whose vectors were evaluated at different points than the
    // positions they are drawn at is a field of the wrong function.
    const samples = sampleFunction((x, y, z) => [x * 2, y * 3, z * 4], 3);
    for (const s of samples) {
      expect(s.u).toBeCloseTo(s.x * 2, 9);
      expect(s.w).toBeCloseTo(s.z * 4, 9);
    }
  });

  it("refuses to make a lattice of one point", () => {
    // With one step per axis there is no extent, and the division that spaces
    // the lattice is by zero.
    const samples = sampleFunction(() => [1, 0, 0], 1);
    expect(samples.length).toBeGreaterThan(1);
    expect(samples.every((s) => Number.isFinite(s.x))).toBe(true);
  });
});

describe("the percentile that sets the scale", () => {
  it("takes a value that is actually in the data", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
  });

  it("takes the largest at the top", () => {
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
  });

  it("takes the smallest at the bottom rather than falling off the end", () => {
    expect(percentile([5, 1, 3], 0)).toBe(1);
  });

  it("does not depend on the order it was given", () => {
    expect(percentile([9, 1, 5, 3], 0.5)).toBe(percentile([1, 3, 5, 9], 0.5));
  });

  it("is zero for nothing at all", () => {
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe("the settings are a decision, not a magic number", () => {
  it("stops short of where arrows become a texture", () => {
    expect(DEFAULT_FIELD.maxGlyphs).toBeLessThanOrEqual(5000);
    expect(DEFAULT_FIELD.maxGlyphs).toBeGreaterThan(100);
  });

  it("keeps an arrow inside its own cell", () => {
    // At or above 1 an arrow reaches its neighbour's position, and the field
    // reads as a tangle rather than as a direction at each point.
    expect(DEFAULT_FIELD.reach).toBeLessThan(1);
  });
});
