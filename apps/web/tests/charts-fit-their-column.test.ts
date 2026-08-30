/**
 * A chart is as wide as the column it lands in, never a fixed number of pixels.
 *
 * `Binned.tsx` drew itself with `width={width}` and no `viewBox`, so it rendered
 * at a flat 620px whatever it was placed in. Measured on the chart primitives
 * screen at a 700px window: it spilled 126px out of a 468px workspace, and it
 * was the only one of thirteen charts there that did. Every other chart in the
 * folder already used `viewBox` with `width="100%"`.
 *
 * That is worse now than when it was written. Since the shell's edges became
 * draggable the workspace can be narrow at any window size — with both panels
 * open on a 1400px screen it is already 741px — so a fixed pixel width is not a
 * width, it is a guess about a layout that no longer holds still.
 *
 * A source-level guard because the suite runs in happy-dom, which does no
 * layout at all: nothing that renders these components can measure a chart
 * spilling out of a column. What *can* be checked is the property that makes
 * the spill impossible, and that is cheap and exact.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CHARTS = join(__dirname, "..", "components", "charts");

/**
 * Charts that render into a fixed-size surface rather than a flowing column.
 *
 * Each needs a reason. A list that grows without them stops being a record of
 * what is exempt and becomes a way to silence the guard.
 */
const NOT_FLOWED = new Set([
  // WebGL and canvas surfaces size themselves from a measured container rather
  // than from SVG layout, so they have no `viewBox` to carry.
  "Volume.tsx", "VoxelVolume.tsx", "Isosurface3D.tsx", "Field3D.tsx",
  "Network3D.tsx", "Bars3D.tsx", "Lines3D.tsx", "Surface.tsx",
  // Not charts: a table, and the shared interaction helpers.
  "ChartTable.tsx", "interaction.tsx",
]);

function chartFiles(): string[] {
  return readdirSync(CHARTS)
    .filter((f) => f.endsWith(".tsx") && !NOT_FLOWED.has(f));
}

describe("every chart fits the column it is given", () => {
  it("sizes its svg by viewBox and a fluid width", () => {
    const fixed: string[] = [];

    for (const file of chartFiles()) {
      const src = readFileSync(join(CHARTS, file), "utf8");
      // Only files that actually draw an <svg> are in scope.
      if (!/<svg/.test(src)) continue;

      const hasViewBox = /viewBox=/.test(src);
      // `width="100%"` — a literal percentage rather than a pixel expression.
      const fluid = /width="100%"/.test(src);

      if (!hasViewBox || !fluid) {
        fixed.push(`${file} (viewBox: ${hasViewBox}, fluid width: ${fluid})`);
      }
    }

    expect(fixed).toEqual([]);
  });

  it("can tell a fixed-width chart from a fluid one", () => {
    /**
     * The mutation, kept as a test. `Binned.tsx` before the fix looked exactly
     * like the first of these, and the whole suite passed.
     */
    const before = `<svg width={width} height={height} role="img">`;
    const after = `<svg viewBox={\`0 0 \${width} \${height}\`} width="100%" height={height}>`;

    expect(/viewBox=/.test(before) && /width="100%"/.test(before)).toBe(false);
    expect(/viewBox=/.test(after) && /width="100%"/.test(after)).toBe(true);
  });

  it("is actually reading the chart folder", () => {
    /** A guard over an empty list passes for the wrong reason. */
    expect(chartFiles().length).toBeGreaterThan(5);
  });
});
