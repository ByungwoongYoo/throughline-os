/**
 * Level curves of a height field.
 *
 * A contour and a filled surface are the same numbers answering different
 * questions, and the catalogue names both — "3D contour", "3D filled contour",
 * "Level curves" — while drawing one picture for all of them.
 */

import { describe, expect, it } from "vitest";
import { contourSegments, levelsFor } from "@/lib/charts3d/contour";

/** A plane z = x, so every contour is a straight line at a known place. */
function plane(n = 5) {
  const axis = Array.from({ length: n }, (_, i) => i);
  const z: Array<Array<number | null>> = axis.map(() => axis.map((x) => x));
  return { x: axis, y: axis, z };
}

describe("choosing the levels", () => {
  it("picks round numbers a reader can name", () => {
    // "12 to 18 by 1", not "12.43 to 17.61 in eight steps".
    expect(levelsFor(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("stays inside the range it was given", () => {
    for (const v of levelsFor(3.2, 7.9)) {
      expect(v).toBeGreaterThanOrEqual(3.2);
      expect(v).toBeLessThanOrEqual(7.9);
    }
  });

  it("returns nothing for a field with no range to cut", () => {
    // A flat field has no contours, and inventing some would draw structure
    // that is not there.
    expect(levelsFor(5, 5)).toEqual([]);
    expect(levelsFor(NaN, 1)).toEqual([]);
  });

  it("does not accumulate a fractional error onto an axis", () => {
    // 0.1 + 0.2 is the classic way a round level becomes unreadable.
    for (const v of levelsFor(0, 1, 10)) {
      expect(String(v).length).toBeLessThan(8);
    }
  });
});

describe("where a level crosses", () => {
  it("puts the crossing where the corner heights say it is", () => {
    // On z = x, the level 2.5 crosses exactly half way between x = 2 and 3.
    const segments = contourSegments(plane(), [2.5]);
    expect(segments.length).toBeGreaterThan(0);
    for (const s of segments) {
      expect(s.a.x).toBeCloseTo(2.5, 6);
      expect(s.b.x).toBeCloseTo(2.5, 6);
      expect(s.level).toBe(2.5);
    }
  });

  it("carries the level as the segment's own height", () => {
    // A contour drawn on a surface sits at the height it represents; drawing
    // it flat would put the line somewhere the field never is.
    for (const s of contourSegments(plane(), [1.5])) {
      expect(s.a.z).toBe(1.5);
      expect(s.b.z).toBe(1.5);
    }
  });

  it("draws nothing where the field never reaches the level", () => {
    expect(contourSegments(plane(), [99])).toEqual([]);
  });

  it("refuses to interpolate across a gap in a fit", () => {
    /*
     * A fitted surface declines to predict in places. A contour drawn through
     * the gap would invent the one thing the fit refused to say.
     */
    const holed = plane();
    holed.z[2][2] = null;
    const through = contourSegments(holed, [2.5]);
    const whole = contourSegments(plane(), [2.5]);
    expect(through.length).toBeLessThan(whole.length);
  });

  it("handles a cell whose corners are equal without dividing by zero", () => {
    const flat = { x: [0, 1], y: [0, 1], z: [[2, 2], [2, 2]] };
    expect(() => contourSegments(flat, [2])).not.toThrow();
  });
});
