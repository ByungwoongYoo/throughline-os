/**
 * Two spatial charts that rendered invisibly on a dark page.
 *
 * Found by sampling the canvases in a browser and computing contrast against
 * the page behind them, which is the only way either would have been found:
 * both *look* like charts, and neither raises an error.
 *
 * The density volume's brightest pixel anywhere reached 1.51:1 — nothing on
 * the canvas was even at 2:1. The globe was worse in one way: it measured
 * 1.03:1 across the body, because the sphere was painted in `--panel`, which
 * is what the page is made of.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { volumeColour } from "@/components/charts/VoxelVolume";
import { DEFAULT_VOLUME } from "@/lib/charts3d/voxels";

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: [number, number, number], b: [number, number, number]) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** The page, in each theme. */
const DARK_PAGE: [number, number, number] = [10, 12, 15];
const LIGHT_PAGE: [number, number, number] = [255, 255, 255];

/** A mark at `alpha` over `page`, as the canvas composites it. */
function over(mark: [number, number, number], alpha: number,
              page: [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((i) => mark[i] * alpha + page[i] * (1 - alpha)) as
    [number, number, number];
}

describe("the density volume shows up on the page it is drawn on", () => {
  it("puts its dense end where the page is not", () => {
    /**
     * One ramp cannot serve both backgrounds. Running dark to light, the
     * *dense* end vanishes on white; running light to dark, the *sparse* end
     * vanishes on black. The high end has to contrast with the page.
     */
    expect(contrast(volumeColour(1, true), DARK_PAGE)).toBeGreaterThan(10);
    expect(contrast(volumeColour(1, false), LIGHT_PAGE)).toBeGreaterThan(6);
  });

  it("keeps the sparse end quiet, which is what makes it a volume", () => {
    // A volume is mostly translucent. If the low end shouted, accumulation
    // would carry no information.
    expect(contrast(volumeColour(0, true), DARK_PAGE)).toBeLessThan(3);
    expect(contrast(volumeColour(0, false), LIGHT_PAGE)).toBeLessThan(3);
  });

  it("orders by lightness in both directions", () => {
    // Monotonic in |t| either way, so the ordering survives without colour.
    for (const dark of [true, false]) {
      const steps = [0, 0.25, 0.5, 0.75, 1].map((t) => luminance(volumeColour(t, dark)));
      const rising = steps.every((v, i) => i === 0 || v >= steps[i - 1] - 1e-9);
      const falling = steps.every((v, i) => i === 0 || v <= steps[i - 1] + 1e-9);
      expect(rising || falling, `dark=${dark}`).toBe(true);
    }
  });

  it("accumulates enough opacity for a core to be legible", () => {
    /**
     * Measured, not chosen: the busiest pixel of a real volume accumulated
     * 0.23 at the old 0.06 and the brightest thing on the canvas reached
     * 1.51:1. A core needs about 0.4 accumulated to clear 3:1, and four or
     * five overlapping splats at this opacity get there — 0.52 when
     * re-measured in the browser.
     */
    const overlaps = 4;
    const accumulated = 1 - (1 - DEFAULT_VOLUME.opacity) ** overlaps;
    expect(accumulated).toBeGreaterThan(0.4);
    expect(contrast(over(volumeColour(1, true), accumulated, DARK_PAGE),
                    DARK_PAGE)).toBeGreaterThanOrEqual(3);
  });

  it("leaves a single voxel nearly transparent", () => {
    // The property the low value exists for: one voxel is not a shape.
    expect(DEFAULT_VOLUME.opacity).toBeLessThan(0.25);
  });
});

describe("the globe is an object in front of the page", () => {
  const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

  it("has a colour of its own rather than the page's", () => {
    /**
     * It was `--panel`, which is what the page is made of — the land was
     * there and could not be seen.
     */
    expect(css).toMatch(/--sphere:\s*var\(--n-500\)/);
  });

  it("is drawn with it", () => {
    const globe = readFileSync(
      join(__dirname, "..", "components", "charts", "Globe3D.tsx"), "utf8");
    expect(globe).toContain("--sphere");
  });

  it("clears three to one against the page in both themes", () => {
    /**
     * `--n-400` reaches only 2.60 on dark, which is how this was chosen
     * rather than eyeballed.
     */
    const n500Dark: [number, number, number] = [0x6e, 0x77, 0x87];
    const n500Light: [number, number, number] = [0x6b, 0x6b, 0x66];
    expect(contrast(n500Dark, DARK_PAGE)).toBeGreaterThanOrEqual(3);
    expect(contrast(n500Light, LIGHT_PAGE)).toBeGreaterThanOrEqual(3);
  });
});
