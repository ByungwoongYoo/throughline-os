/**
 * The numbers on the spatial-charts page account for the catalogue exactly.
 *
 * The page opens with an arithmetic claim: 216 have a renderer here, "a
 * further" 26 need a specialist library, 4 more are built and not shown. A
 * reader takes those as a partition — that is what "a further" means — and
 * they were not one. Seven entries sat in both the first count and the second:
 * a CT volume draws as voxels here *and* properly in niivue from a scan, and
 * both statements are true.
 *
 * Nothing was wrong with the data. The wrong thing was a word implying the
 * sets were disjoint, and no test could see it because each number was
 * separately correct. So this checks the property the sentence asserts rather
 * than the numbers it prints.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGUE } from "@/lib/charts3d/registry";
import { exampleFor } from "@/lib/charts3d/examples";

const drawable = () => CATALOGUE.filter((v) => exampleFor(v) !== null);
const withStatus = (status: string) =>
  CATALOGUE.filter((v) => v.status === status);

describe("every entry is accounted for exactly once", () => {
  it("partitions the catalogue by status", () => {
    /** Status is the partition that really is one — every entry has exactly
     *  one, so these five must sum to the whole catalogue. */
    const counted = ["built", "configuration", "specialist", "needs-library",
                     "primitive-missing"]
      .reduce((total, status) => total + withStatus(status).length, 0);
    expect(counted).toBe(CATALOGUE.length);
  });

  it("knows that drawable and specialist genuinely overlap", () => {
    /**
     * Guards the correction rather than the defect: if this ever returns zero,
     * the sets *have* become disjoint and the page may say "a further" again.
     * Recording it as a fact stops the next person restoring the wrong word.
     */
    const both = drawable().filter((v) => v.status === "specialist");
    expect(both.length).toBeGreaterThan(0);
    expect(both.map((v) => v.name)).toContain("CT volume");
  });

  it("does not call the specialist entries a further set", () => {
    const source = readFileSync(
      join(__dirname, "..", "app", "charts-3d", "page.tsx"), "utf8");
    expect(source).not.toMatch(/A further \{onDemand\.length\}/);
  });

  it("counts the primitives it names, rather than saying a number", () => {
    /**
     * The sentence read "The three below" while the list beside it named six
     * primitives and seven figures were on the page. A count typed into prose
     * is one that goes stale silently — the same rule this product enforces on
     * a drafted report, where a literal number is refused outright.
     */
    const source = readFileSync(
      join(__dirname, "..", "app", "charts-3d", "page.tsx"), "utf8");
    expect(source).not.toContain("The three below are the primitives");
    expect(source).toContain("PRIMITIVES_SHOWN");
    expect(source).toContain("{inWords}");
  });
});
