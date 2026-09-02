/**
 * Far marks are paler, and none of them disappears.
 *
 * The network's only depth cue was back-to-front drawing, which says something
 * about two marks *where they overlap* and nothing anywhere else. The failure
 * of the obvious fix is what these tests pin: fading is easy to write in a way
 * that erases the far half of the graph, which is the same lie as an
 * unlabelled hemisphere and worse, because nothing counts what went missing.
 */

import { describe, expect, it } from "vitest";
import { FAREST, NEAREST, depthRange, hazeFor } from "@/lib/charts/depth";

describe("haze puts distance on an unused channel", () => {
  it("makes the near mark strongest and the far mark weakest", () => {
    expect(hazeFor(1, 1, -1)).toBeCloseTo(NEAREST, 10);
    expect(hazeFor(-1, 1, -1)).toBeCloseTo(FAREST, 10);
    expect(hazeFor(0, 1, -1)).toBeGreaterThan(FAREST);
    expect(hazeFor(0, 1, -1)).toBeLessThan(NEAREST);
  });

  it("is monotonic, so nearer never reads as further", () => {
    let previous = -Infinity;
    for (let d = -1; d <= 1.0001; d += 0.1) {
      const haze = hazeFor(d, 1, -1);
      expect(haze).toBeGreaterThanOrEqual(previous);
      previous = haze;
    }
  });

  it("never fades a mark out of existence", () => {
    /**
     * The floor is the point. A node at zero opacity has been deleted from the
     * reader's view without being counted anywhere.
     */
    for (const d of [-100, -1, 0, 1, 100]) {
      expect(hazeFor(d, 1, -1)).toBeGreaterThanOrEqual(FAREST);
      expect(FAREST).toBeGreaterThan(0.3);
    }
  });

  it("clamps a mark outside the measured range rather than overshooting", () => {
    expect(hazeFor(50, 1, -1)).toBeLessThanOrEqual(NEAREST);
    expect(hazeFor(-50, 1, -1)).toBeGreaterThanOrEqual(FAREST);
  });

  it("leaves a flat scene alone instead of dividing by zero", () => {
    /**
     * One plane of marks is not far away, it is flat. Fading it would be a
     * claim about depth the data does not make — and `(d - far) / 0` is NaN,
     * which canvas silently treats as no drawing at all.
     */
    expect(hazeFor(3, 3, 3)).toBe(NEAREST);
    expect(Number.isFinite(hazeFor(3, 3, 3))).toBe(true);
  });
});

describe("the range comes from the marks on screen", () => {
  it("finds the nearest and furthest", () => {
    expect(depthRange([-2, 0.5, 3, -7])).toEqual({ near: 3, far: -7 });
  });

  it("survives an empty scene", () => {
    /** A chart with nothing in it must not paint NaN over everything. */
    expect(depthRange([])).toEqual({ near: 0, far: 0 });
    expect(hazeFor(0, 0, 0)).toBe(NEAREST);
  });

  it("normalises per scene, so a compact graph is not uniformly flat", () => {
    const tight = depthRange([0.10, 0.12, 0.14]);
    expect(hazeFor(0.14, tight.near, tight.far)).toBeCloseTo(NEAREST, 10);
    expect(hazeFor(0.10, tight.near, tight.far)).toBeCloseTo(FAREST, 10);
  });
});
