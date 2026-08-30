/**
 * Text drawn on the accent has to be readable on the accent.
 *
 * Every primary button in the product used `--n-0` for its text. `--n-0` is
 * the neutral extreme and flips with the theme — white in light, `#0A0C0F` in
 * dark — while `--accent` does not flip at all. So the pairing was chosen for
 * one theme and inherited by the other: white on blue in light (5.17:1) and
 * near-black on the same blue in dark (3.79:1, under the 4.5:1 that normal
 * text needs).
 *
 * It stayed because it was legible *enough* to look deliberate. A ratio is not
 * a matter of taste, so it is checked rather than looked at.
 *
 * The check reads the stylesheet rather than a rendered page: happy-dom has no
 * cascade to speak of, and the bug lives in which token was chosen, which is
 * visible in the source.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Comments stripped before anything is matched.
 *
 * This file scans for `--accent:` declarations, and prose explaining a token
 * quotes it — a comment reading "`--accent: #2563EB` was chosen against a white
 * page" is indistinguishable from a declaration to a regex. When the dark
 * accent gained such a note, the scan found a phantom accent with no
 * `--on-accent` after it and failed on a stylesheet that was correct.
 *
 * The second time a guard in this suite has read its own documentation;
 * `menu-reveal.test.ts` was the first. Both now strip first.
 */
const CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Relative luminance, per WCAG. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const full = value.length === 3
    ? value.split("").map((c) => c + c).join("")
    : value;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every `--accent` declaration, with the `--on-accent` that follows it. */
function pairs(): Array<{ accent: string; onAccent: string | null }> {
  const found: Array<{ accent: string; onAccent: string | null }> = [];
  const accentAt = [...CSS.matchAll(/--accent:\s*(#[0-9a-f]{3,8})/gi)];
  for (const match of accentAt) {
    // The nearest `--on-accent` declared after it and before the next
    // `--accent`, which is the block it belongs to.
    const rest = CSS.slice(match.index! + match[0].length);
    const nextAccent = rest.search(/--accent:\s*#/i);
    const scope = nextAccent === -1 ? rest : rest.slice(0, nextAccent);
    const on = scope.match(/--on-accent:\s*(#[0-9a-f]{3,8})/i);
    found.push({ accent: match[1], onAccent: on ? on[1] : null });
  }
  return found;
}

describe("text on the accent", () => {
  it("finds every accent the stylesheet defines", () => {
    // Three today: the default, and the two the high-contrast remap sets.
    expect(pairs().length).toBeGreaterThanOrEqual(3);
  });

  it("states its own colour wherever the accent changes", () => {
    /*
     * The high-contrast remap sets a *lighter* accent for dark mode, and on
     * that one white is 2.33:1 while near-black is over 9:1. The readable side
     * follows the accent, so a block that changes the accent and inherits the
     * pairing is the bug this file exists for.
     */
    for (const { accent, onAccent } of pairs()) {
      expect(onAccent, `${accent} has no --on-accent in its block`).not.toBeNull();
    }
  });

  it("is readable on it, at the ratio normal text needs", () => {
    for (const { accent, onAccent } of pairs()) {
      const ratio = contrast(accent, onAccent!);
      expect(ratio, `${onAccent} on ${accent} is ${ratio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it("does not paint accent text with the theme's neutral extreme", () => {
    // `--n-0` flips with the theme and the accent does not, so one of the two
    // themes always loses. This is the shape of the original defect.
    const offenders = CSS.split("\n")
      .map((line, i) => ({ line: line.trim(), number: i + 1 }))
      .filter(({ line }) => /background:\s*var\(--accent\)/.test(line)
                         && /color:\s*var\(--n-0\)/.test(line));
    expect(offenders, JSON.stringify(offenders)).toHaveLength(0);
  });
});

describe("nothing paints its own text on the accent", () => {
  /**
   * `--on-accent` only works if the rules that sit on the accent actually use
   * it. Two did not — `.am-avatar` wrote `#fff` and `.cmp-slot` wrote `white` —
   * and both were invisible as defects while the accent was dark, because white
   * happened to be right. Flipping the dark accent to a light blue turned them
   * into 2.35:1 immediately.
   *
   * That is the whole argument for the token: the readable side depends on the
   * accent, so a literal is a guess that survives only until the accent moves.
   */
  it("uses the token wherever the accent is the background", () => {
    const offenders: string[] = [];
    const rules = CSS.matchAll(/([^{}]+)\{([^}]*)\}/g);
    for (const rule of rules) {
      const body = rule[2];
      if (!/background(?:-color)?:\s*var\(--accent\)/.test(body)) continue;
      const colour = body.match(/(?:^|;)\s*color:\s*([^;]+)/);
      if (!colour) continue;                       // no text of its own
      if (/var\(--on-accent\)/.test(colour[1])) continue;
      const selector = rule[1].trim().split("\n").pop()!.trim();
      offenders.push(`${selector} → color: ${colour[1].trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  it("can tell a literal from the token", () => {
    /** The mutation, so this cannot pass by matching nothing. */
    const bad = ".x { background: var(--accent); color: #fff; }";
    const m = bad.match(/([^{}]+)\{([^}]*)\}/)!;
    expect(/background(?:-color)?:\s*var\(--accent\)/.test(m[2])).toBe(true);
    expect(/var\(--on-accent\)/.test(m[2])).toBe(false);
  });
});
