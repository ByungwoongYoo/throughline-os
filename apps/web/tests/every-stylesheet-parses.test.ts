/**
 * A stylesheet that does not close a rule takes everything after it with it.
 *
 * `.acct-theme-option[data-state="checked"]` lost its closing brace in a merge
 * on 2026-09-06, and from then until it was found the browser read the next
 * comment and the next selector as more of that rule's body, gave up at the
 * following `}`, and discarded **116 class rules** — every rule written after
 * that line for five days. `.case-declare`, `.withdrawn`, `.run-logs` and the
 * two master layouts built on top of them were all inert.
 *
 * Nothing caught it, and the two guards that look like they should have both
 * have honest reasons.
 *
 * `css-classes.test.ts` asks whether a class *appears* in a stylesheet, which
 * it does: the text is there, it is simply inside another rule's body. And the
 * suite renders into happy-dom, which applies no CSS at all — so every
 * component test passed against a page that would have been unstyled in a
 * browser. The defect was found by screenshotting the running app, which is
 * the only thing that was ever going to find it.
 *
 * So this is the cheap mechanical guard that closes the gap: parse each sheet,
 * count depth, and refuse a file that ends anywhere but at zero. It is deaf to
 * everything else about CSS, which is the point — it has one job and cannot
 * drift.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Every stylesheet the app loads, as `css-classes.test.ts` lists them. */
const STYLESHEETS = [
  "app/globals.css", "app/density.css", "app/sky.css",
  "app/entrance.css", "app/fonts.css",
];

type Unclosed = { line: number; text: string };

/**
 * Brace depth through a stylesheet, skipping comments and quoted strings.
 *
 * Both exist in these files and both can hold a brace: `content: "{"` is legal
 * and a commented-out rule is common, so a naive count would report a fault
 * where there is none — which is how a guard like this gets deleted.
 */
function scan(css: string): { depth: number; unclosed: Unclosed[]; extra: number[] } {
  const lineStarts: number[] = [];
  const open: number[] = [];
  const extra: number[] = [];
  let depth = 0;
  let line = 1;
  let i = 0;

  while (i < css.length) {
    const c = css[i];

    if (c === "\n") { line++; i++; continue; }

    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      for (let k = i; k < stop; k++) if (css[k] === "\n") line++;
      i = stop;
      continue;
    }

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) {
        if (css[j] === "\\") j++;
        j++;
      }
      for (let k = i; k < j; k++) if (css[k] === "\n") line++;
      i = j + 1;
      continue;
    }

    if (c === "{") { depth++; open.push(line); lineStarts.push(i); }
    else if (c === "}") {
      depth--;
      if (depth < 0) { extra.push(line); depth = 0; }
      open.pop(); lineStarts.pop();
    }
    i++;
  }

  const lines = css.split("\n");
  return {
    depth,
    extra,
    unclosed: open.map((n) => ({ line: n, text: (lines[n - 1] ?? "").trim() })),
  };
}

describe("every stylesheet parses", () => {
  for (const sheet of STYLESHEETS) {
    it(`${sheet} closes every rule it opens`, () => {
      const css = readFileSync(join(__dirname, "..", sheet), "utf8");
      const { depth, unclosed, extra } = scan(css);

      expect(extra, `${sheet} has a stray } at line ${extra.join(", ")}`)
        .toEqual([]);
      expect(
        depth,
        unclosed.length
          ? `${sheet} never closes the rule opened at line ${unclosed[0].line}`
            + ` (${unclosed[0].text}). Everything after it is swallowed into`
            + " that rule's body and discarded by the browser."
          : `${sheet} ends at depth ${depth}`,
      ).toBe(0);
    });
  }
});

describe("the scan itself", () => {
  /*
   * The guard is only worth having if it fails on the real shape of the
   * defect, so the defect is reproduced here in miniature: a rule missing its
   * brace, followed by a comment and another rule — which is exactly what made
   * the original look plausible on the screen.
   */
  it("catches a rule that was never closed", () => {
    const broken = `.a {\n  color: red;\n/* a note */\n.b { color: blue; }\n`;
    const { depth, unclosed } = scan(broken);
    expect(depth).toBe(1);
    expect(unclosed[0].line).toBe(1);
  });

  it("is not fooled by a brace inside a comment", () => {
    expect(scan(`/* .a { */\n.b { color: red; }\n`).depth).toBe(0);
  });

  it("is not fooled by a brace inside a string", () => {
    expect(scan(`.a::before { content: "{"; }\n`).depth).toBe(0);
  });

  it("passes a sheet that is simply correct", () => {
    expect(scan(`.a { color: red; }\n@media (min-width: 10px) { .b { top: 0; } }\n`)
      .depth).toBe(0);
  });
});
