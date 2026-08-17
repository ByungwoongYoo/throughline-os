/**
 * The high-contrast modes are wired to the things they have to reach.
 *
 * T004 shipped `prefers-contrast: more` and `forced-colors: active` with a
 * stated caveat: neither is exercised, because the suite renders with happy-dom
 * and happy-dom applies no CSS. A media query nothing evaluates is a block
 * nobody can prove does anything.
 *
 * A test asserting the strings are present would be worth nothing — that is
 * exactly the check that passes while the block targets classes the charts
 * stopped using. So this walks the same kind of chain `fonts.test.ts` walks:
 * the class names the forced-colors block overrides must be classes the chart
 * primitives actually render, and the tokens the contrast block remaps must be
 * tokens the stylesheet actually defines and uses.
 *
 * What it still cannot prove is the *result* — that the contrast is sufficient
 * for a reader who needs it. That needs a real browser in that mode, and saying
 * so here is better than implying this test is more than it is.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..");
const css = readFileSync(join(WEB_ROOT, "app/globals.css"), "utf8");

/** The body of an `@media (<query>)` block, brace-matched rather than regexed. */
function mediaBlock(query: string): string {
  const start = css.indexOf(`@media (${query})`);
  expect(start, `no @media (${query}) block in globals.css`).toBeGreaterThan(-1);

  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces in @media (${query})`);
}

/**
 * Every class the chart primitives put into the DOM.
 *
 * Walks `components/` recursively. The first version read only the top level
 * and reported all eleven targeted classes as orphaned, because the thirteen
 * primitives live in `components/charts/` — a scanner that misses the directory
 * it exists to check reads as a total failure of the thing under test, which is
 * the most misleading way for a guard to be wrong.
 */
function chartClasses(dir = join(WEB_ROOT, "components")): Set<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const cls of chartClasses(path)) found.add(cls);
      continue;
    }
    if (!entry.name.endsWith(".tsx")) continue;
    const source = readFileSync(path, "utf8");
    // Matches `className="chart-line"` and the template-literal forms the
    // primitives use, e.g. className={`chart-point ${active}`}.
    for (const match of source.matchAll(/(?:chart|raster)-[a-z-]+/g)) {
      found.add(match[0]);
    }
  }
  return found;
}

describe("prefers-contrast: more", () => {
  const block = mediaBlock("prefers-contrast: more");

  it("remaps tokens rather than individual rules", () => {
    /**
     * Overriding rules one at a time reaches only the components somebody
     * remembered. Remapping the tokens reaches every component at once, which
     * is the difference between an accessibility feature and a list of
     * exceptions.
     */
    expect(block).toMatch(/:root\s*\{/);
    for (const token of ["--line", "--ink-faint", "--ink"]) {
      expect(block, `${token} is not remapped`).toContain(`${token}:`);
    }
  });

  it("only remaps tokens the stylesheet actually defines", () => {
    /**
     * A token invented here — a typo, or a rename that missed this block —
     * remaps nothing and looks exactly like it worked.
     *
     * The definition is looked for *outside* this block. Searching the whole
     * stylesheet includes the block itself, so every remap defines its own
     * token and the assertion can never fail: the first version passed with
     * `--ink-fainter` substituted in, which is precisely the defect it claims
     * to catch.
     */
    const elsewhere = css.replace(block, "");
    for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      const token = match[1];
      const defined = new RegExp(`${token}\\s*:`).test(elsewhere);
      expect(defined, `${token} is remapped but defined nowhere else`).toBe(true);
    }
  });

  it("carries a dark-scheme branch, since the quiet defaults differ there", () => {
    expect(block).toContain("prefers-color-scheme: dark");
  });
});

describe("forced-colors: active", () => {
  const block = mediaBlock("forced-colors: active");

  it("overrides classes the charts really render", () => {
    /**
     * The failure this guards is silent and total: the browser replaces the
     * palette but never touches SVG `fill`/`stroke`, so a chart whose classes
     * drifted keeps its own colours on an inverted ground and the marks become
     * invisible. Nothing about that shows up in a normal-mode test.
     */
    const rendered = chartClasses();
    expect(rendered.size).toBeGreaterThan(4);

    const targeted = [...block.matchAll(/\.((?:chart|raster)-[a-z-]+)/g)]
      .map((m) => m[1]);
    expect(targeted.length).toBeGreaterThan(4);

    const orphaned = [...new Set(targeted)].filter((cls) => !rendered.has(cls));
    expect(orphaned, `these are overridden but nothing renders them: ${orphaned}`)
      .toEqual([]);
  });

  it("uses system colour keywords, not the palette it is replacing", () => {
    /** A hex value here is the one thing this mode exists to stop. */
    expect(block).toMatch(/CanvasText|Canvas|LinkText|HighlightText/);
    expect(block, "a literal colour survives into forced-colors")
      .not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
