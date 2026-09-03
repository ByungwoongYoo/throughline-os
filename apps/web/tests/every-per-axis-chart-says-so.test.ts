/**
 * Every chart that stretches its axes separately tells the reader.
 *
 * `unitScale` scales each axis into the unit cube on its own, and says why in
 * its own docstring: it makes the three axes comparable in *shape* and
 * incomparable in *distance*, so a diagonal on screen is not a distance in the
 * data. It then says "Every chart using this owes the reader that sentence,
 * and they say it."
 *
 * They did not. Surface and Volume said it, in two separately worded copies.
 * Isosurface3D, Field3D, Lines3D and Network3D scale per axis through their
 * layout modules and said nothing at all — and this was found one chart at a
 * time, which is why the rule is now a test over the whole class rather than a
 * sentence pasted into whichever component was last looked at.
 *
 * The rule is derived, not listed: whatever reaches `unitScale` must render
 * the shared sentence. A new 3D chart that scales per axis fails this until it
 * does.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AXES_SCALED_SEPARATELY } from "@/lib/charts/scene3d";

const WEB = join(__dirname, "..");
const CHARTS = join(WEB, "components", "charts");
const LIB = join(WEB, "lib", "charts3d");

/** Layout modules that scale per axis, and the component that draws each. */
function perAxisModules(): string[] {
  return readdirSync(LIB)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => readFileSync(join(LIB, f), "utf8").includes("unitScale"))
    .map((f) => f.replace(/\.ts$/, ""));
}

function componentsUsing(module: string): string[] {
  return readdirSync(CHARTS)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => readFileSync(join(CHARTS, f), "utf8")
      .includes(`charts3d/${module}"`))
    .map((f) => f.replace(/\.tsx$/, ""));
}

/** Components that call `unitScale` directly. */
function directUsers(): string[] {
  return readdirSync(CHARTS)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => readFileSync(join(CHARTS, f), "utf8").includes("unitScale"))
    .map((f) => f.replace(/\.tsx$/, ""));
}

const OWES = [...new Set([
  ...directUsers(),
  ...perAxisModules().flatMap(componentsUsing),
])].sort();

describe("charts that scale each axis separately", () => {
  it("finds them, so an empty scan cannot pass", () => {
    expect(perAxisModules().length).toBeGreaterThan(2);
    expect(OWES.length).toBeGreaterThanOrEqual(4);
  });

  it("has one sentence, defined once", () => {
    expect(AXES_SCALED_SEPARATELY).toMatch(/axes/i);
    expect(AXES_SCALED_SEPARATELY).toMatch(/not comparable|no.*compar/i);
  });

  it("says it in every one of them", () => {
    /*
     * Inside the caption, not merely imported.
     *
     * The first version of this test searched the whole file for the
     * constant's name, which the `import` line satisfies on its own — so
     * deleting the sentence from a caption left the guard green. That is the
     * defect this codebase keeps naming: a check on a string rather than on
     * what the reader sees. It cost one mutation to find and would have cost
     * a chart.
     */
    const silent = OWES.filter((name) => {
      const source = readFileSync(join(CHARTS, `${name}.tsx`), "utf8");
      const caption = source.slice(source.indexOf("<figcaption"));
      return !caption.includes("AXES_SCALED_SEPARATELY");
    });
    expect(silent, `these stretch their axes and tell the reader nothing: `
      + silent.join(", ")).toEqual([]);
  });

  it("does not leave two hand-written copies of the same sentence", () => {
    /**
     * Surface and Volume each carried their own wording. Two copies drift, and
     * the one nobody edits becomes the one that is wrong.
     */
    const handwritten = readdirSync(CHARTS)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /scaled (independently|to a\s+cube independently)/
        .test(readFileSync(join(CHARTS, f), "utf8")));
    expect(handwritten, "still worded by hand: " + handwritten.join(", "))
      .toEqual([]);
  });
});
