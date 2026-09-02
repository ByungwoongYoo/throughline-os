/**
 * A reader who asks for less motion gets less motion.
 *
 * §81 was recorded as `unreviewed` while sixteen `prefers-reduced-motion`
 * blocks sat in the stylesheet — implemented, and guarded by nothing. That is
 * the worse half of the pair: an unrecorded feature can at least be found by
 * reading the code, while an untested one can be removed by anyone without a
 * single test going red.
 *
 * The setting is not a preference about taste. Vestibular disorders make
 * large or sustained motion genuinely unpleasant, and a researcher who has
 * turned it on at the operating system has already told every application
 * what they need.
 *
 * **What this checks is coverage, not absence.** Reduced motion does not mean
 * no motion — an instant state change can be *harder* to follow than a short
 * one, and the guidance is to reduce, not to forbid. So the test asks that
 * every animated class is *named* in a reduced-motion block, which is the
 * checkable part of having thought about it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  join(__dirname, "..", "app", "globals.css"), "utf8");

/** The `@media (prefers-reduced-motion: reduce)` blocks, as text. */
function reducedBlocks(): string[] {
  const blocks: string[] = [];
  const marker = "@media (prefers-reduced-motion: reduce)";
  let from = CSS.indexOf(marker);
  while (from !== -1) {
    // Balance braces from the block's opening one, so a nested rule is kept.
    let depth = 0;
    let i = CSS.indexOf("{", from);
    const start = i;
    for (; i < CSS.length; i += 1) {
      if (CSS[i] === "{") depth += 1;
      else if (CSS[i] === "}") { depth -= 1; if (depth === 0) break; }
    }
    blocks.push(CSS.slice(start, i + 1));
    from = CSS.indexOf(marker, i);
  }
  return blocks;
}

/**
 * Properties whose change is *movement*, as against a change of appearance.
 *
 * The distinction is the whole of this test. "Reduce motion" is not "remove
 * transitions": a colour or opacity fade carries no motion at all, and
 * removing it can make a state change harder to follow rather than easier —
 * the guidance is to reduce movement, not to make the interface snap.
 *
 * A first version of this flagged every transition, which put twenty-two
 * colour fades on a list of accessibility defects. A guard that is wrong about
 * correct code is the kind that gets turned off, and it would have taken the
 * real findings with it.
 */
const MOVES = /(transform|translate|scale|rotate|\btop\b|\bleft\b|\bright\b|\bbottom\b|margin|\bwidth\b|\bheight\b|inset)/;

/** Selectors that actually move under a transition or a keyframe animation. */
function animatedSelectors(): string[] {
  const found = new Set<string>();
  // Rule bodies, with their selector, outside any media block we care about.
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(CSS)) !== null) {
    const [, selector, body] = match;
    if (!/\b(transition|animation)\s*:/.test(body)) continue;
    if (/\b(transition|animation)\s*:\s*none\b/.test(body)) continue;
    const declaration = /\b(?:transition|animation)\s*:([^;]*)/.exec(body)?.[1] ?? "";
    // A keyframe animation is movement unless it is named otherwise; a
    // transition is movement only if it names a property that moves.
    const moves = /\banimation\s*:/.test(body) || MOVES.test(declaration)
      || /\ball\b/.test(declaration);
    if (!moves) continue;
    for (const part of selector.split(",")) {
      const name = /\.([a-z0-9-]+)/i.exec(part.trim());
      if (name) found.add(name[1]);
    }
  }
  return [...found];
}

/**
 * Animated properties that are technically size and not movement.
 *
 * Declared rather than discovered, on the reasoning `test_vocabularies_agree`
 * gives: a rule that decided this for itself would keep re-deciding it, and
 * the day it decided wrongly the whole guard would be turned off. Each entry
 * is a claim that a reader with a vestibular disorder is not affected by it.
 */
const NOT_MOVEMENT: Record<string, string> = {
  "ribbon-link":
    "stroke-width only — a ribbon thickens where it is, and travels nowhere.",
  "gc-gauge-fill":
    "an 80ms linear width change, which reads as a value updating rather than "
    + "as something moving across the screen.",
};

describe("the stylesheet answers a request for less motion", () => {
  it("has reduced-motion blocks at all", () => {
    /** D021: a scan that matched nothing would pass for ever. */
    expect(reducedBlocks().length).toBeGreaterThan(5);
  });

  it("finds the animated classes it is checking", () => {
    expect(animatedSelectors().length).toBeGreaterThan(10);
  });

  it("keeps its exemptions honest", () => {
    /** An exemption for a class that no longer animates is a note about
     *  nothing, and it hides the next one that matters. */
    const animated = new Set(animatedSelectors());
    const stale = Object.keys(NOT_MOVEMENT).filter((n) => !animated.has(n));
    expect(stale, `exempted but no longer animated: ${stale.join(", ")}`)
      .toEqual([]);
  });

  it("names every animated class in a reduced-motion block", () => {
    const covered = reducedBlocks().join("\n");
    const uncovered = animatedSelectors()
      .filter((name) => !covered.includes(`.${name}`))
      .filter((name) => !(name in NOT_MOVEMENT));

    expect(uncovered,
      "animated, and never mentioned under prefers-reduced-motion:\n  ."
      + uncovered.join("\n  ."))
      .toEqual([]);
  });
});
