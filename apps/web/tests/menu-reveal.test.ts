/**
 * A control that is hidden until hover must also appear for the keyboard.
 *
 * `.pm-del` — the per-project delete in the switcher — sits at `opacity: 0` and
 * is revealed on interaction. That is a reasonable way to keep a destructive
 * control quiet, and it has one failure mode: if the reveal only answers the
 * mouse, a keyboard user is handed an invisible destructive button.
 *
 * That is not hypothetical here. When the switcher became a Radix menu the
 * reveal was `.pm-row:hover .pm-del, .pm-del:focus-visible`, and it broke:
 * Radix moves focus with a roving tabindex — it calls `.focus()` itself — and a
 * programmatic focus does not reliably satisfy the browser's `:focus-visible`
 * heuristic. Measured in the running app, arrowing onto the control left it
 * focused, correctly labelled "Delete <project>", and at `opacity: 0`.
 *
 * This is a stylesheet test rather than a render test on purpose: the suite
 * runs in happy-dom, which applies no CSS at all, so no amount of rendering
 * could catch it. The rule itself is the thing being checked.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Comments stripped before anything is matched.
 *
 * Not hygiene — the first version of this test passed against the very bug it
 * was written to catch. The rule above it is documented in prose that names
 * `[data-highlighted]` and `:focus`, so the matcher was reading the paragraph
 * explaining the fix rather than the fix, and reverting the CSS to the broken
 * mouse-only reveal changed nothing. `css-classes.test.ts` already strips
 * comments for exactly this reason.
 */
const CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The selector list of the rule that sets `.pm-del` back to `opacity: 1`. */
function revealRule(): string {
  const match = CSS.match(/([^}]*?\.pm-del[^{}]*?)\{\s*opacity:\s*1;?\s*\}/);
  if (!match) throw new Error("no rule reveals .pm-del — it is always invisible");
  return match[1];
}

describe("a hover-revealed control answers the keyboard too", () => {
  it("reveals the project delete for a highlighted menu item", () => {
    /**
     * `[data-highlighted]` is the attribute Radix puts on the active item. It
     * is the reliable signal, because unlike `:focus` it does not depend on the
     * document itself holding focus.
     */
    expect(revealRule()).toContain("[data-highlighted]");
  });

  it("does not rely on :focus-visible alone", () => {
    /**
     * The exact regression. `:focus-visible` may stay unmatched when focus was
     * moved programmatically, which is precisely how a roving tabindex works.
     */
    const rule = revealRule();
    const answersKeyboard =
      rule.includes("[data-highlighted]") || /\.pm-del:focus(?![-\w])/.test(rule);
    expect(answersKeyboard).toBe(true);
  });

  it("still hides it at rest, or the quiet is pointless", () => {
    expect(CSS).toMatch(/\.pm-del\s*\{[^}]*opacity:\s*0/);
  });

  it("can tell when the reveal has gone missing", () => {
    /**
     * The mutation, kept as a test: the matcher above must actually be reading
     * the stylesheet rather than passing on an empty string.
     */
    const withoutReveal = ".pm-del { opacity: 0; }";
    expect(/([^}]*?\.pm-del[^{}]*?)\{\s*opacity:\s*1;?\s*\}/.test(withoutReveal))
      .toBe(false);
  });
});
