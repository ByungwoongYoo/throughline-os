/**
 * A colour written as a literal in the light theme is restated in the dark one.
 *
 * The dark theme was built to inherit: light said `--ink: var(--n-800)`, dark
 * flipped the neutral ramp, and every role token followed. Adopting the
 * package's workspace palette wrote five of those roles as literal colours —
 * the package ships values, not a ramp — and the dark theme silently kept
 * them. Near-black ink on a near-black ground: every heading, panel name and
 * card title invisible, the wordmark gone, and 3615 tests green, because none
 * of them applies CSS.
 *
 * The rule this holds is the shape of that defect, not its five instances: a
 * role token that light pins to a literal colour cannot be inherited by dark,
 * so dark must say what it is — in both the `prefers-color-scheme` block and
 * the stamped `[data-theme="dark"]` block, which `css-tokens` already requires
 * to agree.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

/** The first `:root { … }` block, which is the light theme. */
function lightRoot(css: string): string {
  const start = css.indexOf(":root {");
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  return "";
}

/** The body of the first block that opens with `opener`. */
function block(css: string, opener: string): string {
  const start = css.indexOf(opener);
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  return "";
}

const declared = (body: string) => new Set(
  [...body.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));

/**
 * Tokens that are the same in both themes by design, and why.
 *
 * Named here rather than filtered by pattern, so an exemption is an argument
 * someone wrote down and not a regex that quietly widens.
 */
const THEME_INDEPENDENT: Record<string, string> = {
  "--gate-page": "The sign-in screen is dark in both themes; globals.css says so beside it.",
  "--gate-ink": "The sign-in screen's ink, for the same reason.",
};

/** Role tokens light pins to a literal colour. The neutral ramp itself is
 *  exempt: it is the thing dark redefines wholesale. */
function literalColoursInLight(): string[] {
  return [...lightRoot(CSS).matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))\s*;/gim)]
    .map((m) => m[1])
    .filter((token) => !/^--n-\d+$/.test(token))
    .filter((token) => !(token in THEME_INDEPENDENT));
}

describe("the dark theme states every colour light pins", () => {
  const media = block(CSS, '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"])');
  const stamped = block(CSS, ':root[data-theme="dark"]');

  it("finds the light literals, so an empty scan cannot pass", () => {
    const literals = literalColoursInLight();
    expect(literals.length).toBeGreaterThan(15);
    expect(literals).toContain("--ink");
    expect(literals).toContain("--panel");
  });

  it("restates each of them in the prefers-color-scheme block", () => {
    const inDark = declared(media);
    const missing = literalColoursInLight().filter((t) => !inDark.has(t));
    expect(missing, `pinned in light, inherited by dark: ${missing.join(", ")}`).toEqual([]);
  });

  it("restates each of them in the stamped dark block", () => {
    const inDark = declared(stamped);
    const missing = literalColoursInLight().filter((t) => !inDark.has(t));
    expect(missing, `pinned in light, inherited by dark: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no stale exemption", () => {
    const light = lightRoot(CSS);
    for (const token of Object.keys(THEME_INDEPENDENT)) {
      expect(light, `${token} is exempt but no longer defined`).toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it("would have caught the defect it was written for", () => {
    /** The mutation: drop `--ink` from a dark block and the rule must see it. */
    const withoutInk = media.replace(/^\s*--ink:\s*[^;]+;/m, "");
    expect(declared(withoutInk).has("--ink")).toBe(false);
  });
});
