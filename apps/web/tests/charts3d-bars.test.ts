/**
 * Bars standing in a room (§9 bars, §10).
 *
 * All four catalogue entries here are `framed` rather than inherently spatial,
 * so these tests are largely about the chart admitting what the third dimension
 * costs it: what is hidden behind what, and how much perspective has already
 * changed the heights a reader is comparing by eye.
 *
 * The axis test is the one that matters most. A bar chart whose vertical axis
 * does not include zero exaggerates differences, and in three dimensions the
 * reader cannot see where the floor is to notice.
 */

import { describe, expect, it } from "vitest";
import {
  Bar, DEFAULT_BARS, describeBars, hiddenCount, perspectiveStretch,
  prepareBars,
} from "@/lib/charts3d/bars";

const grid = (values: number[][]): Bar[] =>
  values.flatMap((row, r) => row.map((value, c) => ({ row: r, column: c, value })));

describe("the axis includes zero", () => {
  it("puts the floor at zero even when every value is far above it", () => {
    /*
     * The classic misleading bar chart starts its axis at the smallest value,
     * which turns a 2% difference into a doubling. In three dimensions it is
     * worse: the floor is receding, so a reader cannot see where it is to
     * notice it has moved.
     */
    const bars = prepareBars(grid([[100, 102, 104]]));
    expect(bars.range.min).toBe(0);
    expect(bars.zero).toBe(-1);
    // The tallest bar is at the top and the shortest is nearly as tall — which
    // is the truth about these numbers.
    const heights = bars.bars.map((b) => b.top - b.base);
    expect(heights[0] / heights[2]).toBeGreaterThan(0.9);
  });

  it("runs bars both ways when values cross zero", () => {
    const bars = prepareBars(grid([[-5, 0, 10]]));
    const [down, none, up] = bars.bars;
    expect(down.top).toBeLessThan(down.base);
    expect(up.top).toBeGreaterThan(up.base);
    expect(none.top).toBeCloseTo(none.base, 9);
  });

  it("keeps every bar inside the cube", () => {
    for (const b of prepareBars(grid([[3, -7, 12], [0, 5, -2]])).bars) {
      for (const v of [b.x, b.z, b.top, b.base]) {
        expect(v).toBeGreaterThanOrEqual(-1.0001);
        expect(v).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it("survives every value being the same", () => {
    // A zero span divided by itself is NaN, and a chart of NaN renders nothing
    // while reporting no error.
    const bars = prepareBars(grid([[4, 4, 4]]));
    expect(bars.bars.every((b) => Number.isFinite(b.top + b.base))).toBe(true);
  });
});

describe("where a bar stands", () => {
  it("spreads rows and columns across the floor", () => {
    const bars = prepareBars(grid([[1, 2], [3, 4]]));
    expect(new Set(bars.bars.map((b) => b.x)).size).toBe(2);
    expect(new Set(bars.bars.map((b) => b.z)).size).toBe(2);
  });

  it("puts a lone bar in the middle rather than in a corner", () => {
    // Dividing by a count of one is a division by zero, and placing it at the
    // edge would leave one bar in the corner of an empty room.
    const [only] = prepareBars([{ row: 0, column: 0, value: 5 }]).bars;
    expect(only.x).toBe(0);
    expect(only.z).toBe(0);
  });

  it("leaves a gap between neighbours", () => {
    /*
     * At full width the grid becomes a solid block and the individual bars stop
     * being readable — which is the failure this chart is already nearest to.
     */
    // `[[1, 2, 3]]` is one row of three columns, so the bars are spread along
    // z rather than x — an earlier version of this measured the axis they do
    // not vary on and read a spacing of zero.
    const bars = prepareBars(grid([[1, 2, 3]]));
    const spacing = Math.abs(bars.bars[1].z - bars.bars[0].z);
    expect(spacing).toBeGreaterThan(0);
    expect(bars.bars[0].half * 2).toBeLessThan(spacing);
  });

  it("refuses a value it cannot read rather than placing it at zero", () => {
    const bars = prepareBars([
      { row: 0, column: 0, value: 5 },
      { row: 1, column: 0, value: NaN },
      { row: 2, column: 0, value: 3 },
    ]);
    expect(bars.bars).toHaveLength(2);
    expect(bars.invalid).toBe(1);
  });

  it("says plainly when there is nothing", () => {
    expect(describeBars(prepareBars([]), 0, 1)).toBe("No bars to draw.");
  });
});

describe("the chart admits what depth costs it", () => {
  it("counts bars hidden behind nearer ones", () => {
    /*
     * The number §10 asks for. Occlusion is the price of the third dimension,
     * and a reader comparing two bars needs to know that a third is behind one
     * of them.
     */
    const bars = prepareBars(grid([[1, 2], [3, 4]]));
    // A projection that puts everything at one point: all but the nearest are
    // hidden.
    const stacked = (_: unknown, i = 0) => ({ x: 0, y: 0, depth: i });
    let n = 0;
    const hidden = hiddenCount(bars.bars, () => stacked(null, n++), 10);
    expect(hidden).toBe(bars.bars.length - 1);
  });

  it("counts none when nothing overlaps", () => {
    const bars = prepareBars(grid([[1, 2], [3, 4]]));
    let n = 0;
    const spread = () => ({ x: (n += 100), y: 0, depth: n });
    expect(hiddenCount(bars.bars, spread, 10)).toBe(0);
  });

  it("does not count a bar as hidden behind a farther one", () => {
    // Overlap alone is not occlusion; the other bar has to be in front.
    const bars = prepareBars(grid([[1, 2]]));
    let n = 0;
    // Both at one point, but depth decreasing — so each is in front of the next.
    const hidden = hiddenCount(bars.bars, () => ({ x: 0, y: 0, depth: -(n++) }), 10);
    expect(hidden).toBe(1);
  });

  it("measures how much perspective stretches the near row", () => {
    /*
     * The distortion is invisible unless measured: the picture looks correct,
     * and the reader compares heights the projection has already changed.
     */
    const bars = prepareBars(grid([[1, 2, 3]]));
    let n = 0;
    const scales = [1.0, 1.1, 1.2];
    expect(perspectiveStretch(bars.bars, () => scales[n++])).toBeCloseTo(1.2, 9);
  });

  it("reports no stretch for an empty chart rather than dividing by nothing", () => {
    expect(perspectiveStretch([], () => 1)).toBe(1);
  });

  it("ignores a scale that is not a usable number", () => {
    const bars = prepareBars(grid([[1, 2]]));
    expect(perspectiveStretch(bars.bars, () => NaN)).toBe(1);
  });
});

describe("what the reader is told", () => {
  it("names how many bars cannot be read from here", () => {
    const text = describeBars(prepareBars(grid([[1, 2, 3]])), 2, 1);
    expect(text).toContain("2 are behind another");
    expect(text).toContain("turn the chart, or read the table");
  });

  it("reports the perspective stretch as a percentage", () => {
    const text = describeBars(prepareBars(grid([[1, 2]])), 0, 1.18);
    expect(text).toContain("18% larger");
  });

  it("does not mention a stretch too small to matter", () => {
    // A caveat on every chart is a caveat nobody reads.
    expect(describeBars(prepareBars(grid([[1, 2]])), 0, 1.01))
      .not.toContain("larger than the far one");
  });

  it("says the third axis is the room, not the data", () => {
    /*
     * §10's position, stated on the chart rather than in a document nobody
     * opens. A reader deciding whether to trust a comparison made by eye is
     * better served by being told the flat version exists than by being
     * flattered.
     */
    const text = describeBars(prepareBars(grid([[1, 2]])), 0, 1);
    expect(text).toContain("the room, not the data");
    expect(text).toContain("flat version");
  });

  it("counts the values it could not read", () => {
    const bars = prepareBars([
      { row: 0, column: 0, value: 1 }, { row: 1, column: 0, value: Infinity }]);
    expect(describeBars(bars, 0, 1)).toContain("could not be read");
  });
});

describe("the settings are a decision, not a magic number", () => {
  it("leaves a gap wide enough to tell two bars apart", () => {
    expect(DEFAULT_BARS.fill).toBeLessThan(1);
    expect(DEFAULT_BARS.fill).toBeGreaterThan(0.4);
  });
});
