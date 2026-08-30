/**
 * The shell dividers are wide enough to put a pointer on.
 *
 * `react-resizable-panels` writes `flex: 0 0 auto` as an **inline** style on
 * every separator, and an inline declaration beats a stylesheet whatever its
 * specificity. So `.shell-divider { flex: 0 0 9px }` was discarded in full and
 * both dividers computed to **zero width** — measured in the running app, with
 * rail 232 + workspace 808 + inspector 360 accounting for the entire 1400px
 * window and nothing left over.
 *
 * They still took focus and still answered the arrow keys, so every keyboard
 * test passed and the panels measured exactly as intended. What was missing was
 * anything a mouse could grab: the feature was keyboard-only and nobody could
 * see it. It survived a browser verification pass because that pass measured
 * the panels rather than the thing between them.
 *
 * With the library's `flex-basis: auto`, the used basis is the width — so the
 * rule has to set `width` rather than a `flex` shorthand the library overwrites.
 * This asserts that in the stylesheet, because the suite runs in happy-dom and
 * happy-dom does no layout: nothing that renders the Shell can measure a
 * zero-width element.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Comments stripped: this file's own prose names the properties it checks. */
const CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the `.shell-divider` rule, without the nested pseudo-elements. */
function dividerRule(): string {
  const match = CSS.match(/\.shell-divider\s*\{([^}]*)\}/);
  if (!match) throw new Error("`.shell-divider` has no rule at all");
  return match[1];
}

describe("a divider can be grabbed", () => {
  it("sets an explicit width", () => {
    const rule = dividerRule();
    const width = rule.match(/(?:^|;)\s*width:\s*([^;]+)/);

    expect(width, "no width: the library's inline flex-basis:auto wins and "
                + "the divider computes to zero").not.toBeNull();
    expect(parseFloat(width![1])).toBeGreaterThanOrEqual(6);
  });

  it("does not try to size itself with a flex shorthand", () => {
    /**
     * The exact regression. `flex: 0 0 9px` looks correct, is what the first
     * version used, and is overwritten by the library's inline style — so the
     * declaration reads as if it works while doing nothing at all.
     */
    expect(dividerRule()).not.toMatch(/(?:^|;)\s*flex:/);
  });

  it("still keeps the pointer affordance", () => {
    expect(dividerRule()).toMatch(/cursor:\s*col-resize/);
  });

  it("can tell a zero-width rule from a real one", () => {
    /**
     * The mutation, kept as a test, so this cannot pass by reading nothing.
     *
     * A rule *body*, matching what `dividerRule` returns — the first version
     * of this passed the whole rule including its opening brace, and the
     * anchors (`^` or `;`) then had nothing to bind to, so it failed against a
     * string it was meant to reject for the wrong reason entirely.
     */
    const broken = " flex: 0 0 9px; cursor: col-resize; ";
    expect(broken.match(/(?:^|;)\s*width:\s*([^;]+)/)).toBeNull();
    expect(broken).toMatch(/(?:^|;)\s*flex:/);
  });
});
