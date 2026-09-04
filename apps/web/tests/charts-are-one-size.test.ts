/**
 * Two things that made the gallery look like fourteen unrelated products.
 *
 * **Every chart was stretched by a different factor.** Each SVG is
 * `width="100%"` with a viewBox, so it scales to its container — and each has
 * a different design width, so each scaled differently. Measured in a browser,
 * an 11px tick label rendered between 9.5px and 32.1px across the gallery. No
 * single chart looked wrong; together they had no typography at all.
 *
 * **A link was drawn at border weight.** A border is a hairline meant to be
 * barely there; a link in a node-link graph is data, and the caption counts
 * them. On the dark canvas the edge colour came out at about 1.4:1 against the
 * background, so "6 objects · 6 links" was a figure showing six objects.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { neutral, palette } from "@/lib/tokens";

const CHARTS = join(__dirname, "..", "components", "charts");

describe("every chart is drawn at the size it was designed at", () => {
  it("caps each chart at its own design width", () => {
    /**
     * Without the cap a chart designed at 242px wide renders at 707 and
     * everything in it — type, strokes, marks — comes out at 2.9x, beside a
     * neighbour at 1.1x.
     */
    const offenders: string[] = [];
    for (const name of readdirSync(CHARTS)) {
      if (!name.endsWith(".tsx")) continue;
      const source = readFileSync(join(CHARTS, name), "utf8");
      // Only the SVG charts scale this way; a canvas is sized in pixels.
      let at = source.indexOf('className="chart-svg"');
      while (at !== -1) {
        const window = source.slice(at, at + 260);
        if (!window.includes("maxWidth")) {
          offenders.push(`${name} (at ${at})`);
        }
        at = source.indexOf('className="chart-svg"', at + 1);
      }
    }
    expect(offenders, "these charts stretch past their design width")
      .toEqual([]);
  });
});

/** Relative luminance, per WCAG. */
function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("a link is data, not a divider", () => {
  it("is legible against the canvas in both themes", () => {
    /**
     * Three to one is the threshold for a graphical object carrying meaning.
     * The border colour this replaced managed about 1.4 on the dark canvas,
     * which is not quiet — it is absent.
     */
    for (const dark of [true, false]) {
      const theme = palette(dark);
      expect(contrast(theme.link, theme.canvas),
             `link on canvas, dark=${dark}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("is quieter than the text, so nodes still lead", () => {
    // Legible is not the same as loud. An edge as strong as a label would
    // make the graph read as a mesh with dots in it.
    for (const dark of [true, false]) {
      const theme = palette(dark);
      expect(contrast(theme.link, theme.canvas))
        .toBeLessThan(contrast(theme.text, theme.canvas));
    }
  });

  it("is not the border colour, which is what it was", () => {
    for (const dark of [true, false]) {
      const theme = palette(dark);
      expect(theme.link).not.toBe(theme.border);
    }
  });

  it("shows what the old colour actually did", () => {
    /**
     * Held open so the reason survives: this is the measurement that made the
     * change, not a preference about how edges should look.
     */
    const dark = palette(true);
    expect(contrast(neutral.dark[200], dark.canvas)).toBeLessThan(1.6);
  });
});
