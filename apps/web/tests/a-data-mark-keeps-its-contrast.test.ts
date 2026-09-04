/**
 * A data mark may not buy softness with contrast.
 *
 * Measured in a browser against the dark page, five marks across four charts
 * were under the 3:1 a graphical object carrying meaning needs — and every
 * one of them was a *colour that passes* dimmed by an opacity that took it
 * below. The categorical blue reaches 3.78:1 at full strength: 2.89 at 0.82,
 * 2.80 at 0.8, and 1.40 at 0.34.
 *
 * One of the five was mine, added two commits earlier on the evidence of a
 * preview that turned out to be rendering dark-theme tokens on a forced white
 * background. That is why this is a test and not a note: the mistake is easy,
 * invisible in review, and looks like good taste.
 *
 * Where a mark should recede, it is made smaller or thinner. Where a *region*
 * should recede — a background track, a "not in this set" cell — it may be
 * faint, because it is not carrying a value.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CHARTS = join(__dirname, "..", "components", "charts");

/**
 * Faint marks that are not data, and why.
 *
 * An entry here is a claim somebody can argue with. Keeping it short is the
 * point: every line is a mark a reader might mistake for a value.
 */
const NOT_A_VALUE: Record<string, string> = {
  "Radial.tsx:0.18":
    "The background track a radial bar is drawn against — it shows the "
    + "extent of the scale, not a value on it.",
};

/** Below this, the categorical palette stops clearing 3:1 on the dark page. */
const FLOOR = 0.9;

describe("a data mark keeps its contrast", () => {
  it("has no faint data marks that are not accounted for", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(CHARTS)) {
      if (!name.endsWith(".tsx")) continue;
      const source = readFileSync(join(CHARTS, name), "utf8");
      const pattern = /(fillOpacity|strokeOpacity)=\{([0-9.]+)\}/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const value = Number(match[2]);
        if (value >= FLOOR) continue;
        if (NOT_A_VALUE[`${name}:${value}`]) continue;
        offenders.push(`${name} sets ${match[1]}=${value}`);
      }
    }
    expect(offenders,
      "a mark carrying a value must not be dimmed below the contrast floor")
      .toEqual([]);
  });

  it("keeps the exemption list from outliving its entries", () => {
    // A list nobody prunes becomes a list of things that used to be true.
    const stale: string[] = [];
    for (const key of Object.keys(NOT_A_VALUE)) {
      const [file, value] = key.split(":");
      const source = readFileSync(join(CHARTS, file), "utf8");
      if (!source.includes(`Opacity={${value}}`)) stale.push(key);
    }
    expect(stale, "these are excused but no longer present").toEqual([]);
  });

  it("still notices a mark dimmed below the floor", () => {
    /**
     * Held open deliberately: a scanner that has stopped matching and a
     * codebase with nothing to find look identical from outside.
     */
    const pattern = /(fillOpacity|strokeOpacity)=\{([0-9.]+)\}/g;
    const found = [...'<circle fillOpacity={0.5} />'.matchAll(pattern)];
    expect(found).toHaveLength(1);
    expect(Number(found[0][2])).toBeLessThan(FLOOR);
  });
});
