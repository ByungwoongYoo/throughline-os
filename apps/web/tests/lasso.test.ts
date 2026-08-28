/**
 * One lasso, one answer, across every chart.
 *
 * `insidePolygon` had six copies — five byte-identical and a sixth with the
 * same formula rearranged. Nothing had diverged, which is exactly why it was
 * worth moving: a lasso is one gesture in one command architecture, and the
 * moment two charts answer it differently the difference reaches a researcher
 * as a chart that "feels wrong" rather than as a failing test.
 *
 * It also had no test of its own anywhere.
 */

import { describe, expect, it } from "vitest";
import { insidePolygon } from "@/lib/charts/scene3d";

const SQUARE = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
];

describe("a point in a lasso", () => {
  it("is inside when it is inside", () => {
    expect(insidePolygon(SQUARE, { x: 5, y: 5 })).toBe(true);
  });

  it("is outside on every side", () => {
    for (const point of [{ x: -1, y: 5 }, { x: 11, y: 5 },
                         { x: 5, y: -1 }, { x: 5, y: 11 }]) {
      expect(insidePolygon(SQUARE, point)).toBe(false);
    }
  });

  it("handles a concave lasso, which a hand-drawn one usually is", () => {
    // A C shape: the point in the mouth of the C is outside it.
    const c = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, { x: 4, y: 3 },
      { x: 4, y: 7 }, { x: 10, y: 7 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(insidePolygon(c, { x: 2, y: 5 })).toBe(true);
    expect(insidePolygon(c, { x: 7, y: 5 })).toBe(false);
  });

  it("handles a lasso that crosses itself", () => {
    // A figure of eight. Ray casting gives the odd-even answer, which is the
    // one a reader expects: the crossing does not select the whole shape.
    const eight = [
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 },
    ];
    expect(insidePolygon(eight, { x: 5, y: 2 })).toBe(true);
    expect(insidePolygon(eight, { x: 2, y: 5 })).toBe(false);
  });

  it("selects nothing for a lasso with no area", () => {
    expect(insidePolygon([], { x: 1, y: 1 })).toBe(false);
    expect(insidePolygon([{ x: 0, y: 0 }], { x: 0, y: 0 })).toBe(false);
    expect(insidePolygon([{ x: 0, y: 0 }, { x: 5, y: 5 }], { x: 2, y: 2 }))
      .toBe(false);
  });

  it("is consistent along an edge rather than counting it twice", () => {
    /*
     * A point exactly on a horizontal edge shared by two lassos must belong to
     * one of them, not both and not neither — otherwise two adjacent
     * selections would double-count or drop the boundary between them.
     */
    const lower = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }];
    const upper = [{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const onTheSeam = { x: 5, y: 5 };
    expect([insidePolygon(lower, onTheSeam), insidePolygon(upper, onTheSeam)]
      .filter(Boolean)).toHaveLength(1);
  });
});
