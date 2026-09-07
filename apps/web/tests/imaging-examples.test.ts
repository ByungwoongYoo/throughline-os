/**
 * Worked examples outside medicine (§ a profile nobody can see working).
 *
 * The screen shipped with a synthetic radiology case and nothing else, while
 * telling the reader that medicine was one field among several. A microscopist
 * had to take that on trust and load their own files to check it, which is the
 * thing this project's own principle says they should not have to do.
 *
 * These tests assert the property that makes an example worth having: that it
 * exercises the refusals, not only the agreements. A set that always agreed
 * would demonstrate the least interesting thing the engine does, and would look
 * like a working example while showing nothing.
 */

import { describe, expect, it } from "vitest";
import { assess, partition } from "@/lib/imaging/comparability";
import { figureExample, microscopyExample } from "@/lib/imaging/examples";

const verdicts = (examples: ReturnType<typeof microscopyExample>) => {
  const [head, ...rest] = examples;
  return rest.map((e) => assess(head.study, e.study).verdict);
};

describe("the microscopy example", () => {
  it("produces every verdict the engine can reach", () => {
    const seen = new Set(verdicts(microscopyExample()));
    expect(seen).toContain("DIRECTLY_COMPARABLE");
    expect(seen).toContain("COMPARABLE_AFTER_HARMONIZATION");
    expect(seen).toContain("CONCEPTUALLY_COMPARABLE");
    expect(seen).toContain("RELATED_BUT_NOT_COMPARABLE");
    expect(seen).toContain("NOT_MEANINGFULLY_COMPARABLE");
  });

  it("refuses the other channel, and says which axis did it", () => {
    const set = microscopyExample();
    const verdict = assess(set[0].study, set[2].study);
    expect(verdict.verdict).toBe("RELATED_BUT_NOT_COMPARABLE");
    expect(verdict.blocking).toContain("channel");
  });

  it("refuses widefield against confocal outright", () => {
    const set = microscopyExample();
    const verdict = assess(set[0].study, set[3].study);
    expect(verdict.verdict).toBe("NOT_MEANINGFULLY_COMPARABLE");
    expect(verdict.blocking).toContain("technique");
  });

  it("asks for resampling rather than refusing the coarser image", () => {
    const set = microscopyExample();
    const verdict = assess(set[0].study, set[4].study);
    expect(verdict.verdict).toBe("COMPARABLE_AFTER_HARMONIZATION");
    expect(verdict.harmonization.join(" ")).toMatch(/pixel size|aperture/i);
  });

  it("draws something a window control can act on", () => {
    // A flat image would make the panel look broken and the window pointless.
    for (const { raster } of microscopyExample()) {
      expect(raster.max).toBeGreaterThan(raster.min);
      expect(raster.width * raster.height).toBe(raster.values.length);
    }
  });

  it("is the same set every time", () => {
    // Seeded, not random: two people comparing notes about this screen have to
    // be looking at the same pictures.
    const a = microscopyExample()[0].raster.values;
    const b = microscopyExample()[0].raster.values;
    expect(Array.from(a.slice(0, 64))).toEqual(Array.from(b.slice(0, 64)));
  });
});

describe("the figure example", () => {
  it("produces every verdict the engine can reach", () => {
    const seen = new Set(verdicts(figureExample()));
    expect(seen).toContain("RELATED_BUT_NOT_COMPARABLE");
    expect(seen).toContain("COMPARABLE_AFTER_HARMONIZATION");
    expect(seen).toContain("CONCEPTUALLY_COMPARABLE");
    expect(seen).toContain("NOT_MEANINGFULLY_COMPARABLE");
  });

  it("refuses a log axis against a linear one", () => {
    const set = figureExample();
    const verdict = assess(set[0].study, set[1].study);
    expect(verdict.verdict).toBe("RELATED_BUT_NOT_COMPARABLE");
    expect(verdict.blocking).toContain("yScale");
  });

  it("names the sample size when asked to reconcile SEM with SD", () => {
    // The conflation this profile exists for. SEM is smaller than SD by root n,
    // so the conversion is impossible without n — and the advice says so.
    const set = figureExample();
    const verdict = assess(set[0].study, set[3].study);
    expect(verdict.verdict).toBe("COMPARABLE_AFTER_HARMONIZATION");
    expect(verdict.harmonization.join(" ")).toContain("sample size");
  });

  it("refuses a different quantity outright", () => {
    const set = figureExample();
    const verdict = assess(set[0].study, set[4].study);
    expect(verdict.verdict).toBe("NOT_MEANINGFULLY_COMPARABLE");
    expect(verdict.blocking).toContain("quantity");
  });

  it("draws a chart with ink on it, not a blank plate", () => {
    for (const { raster } of figureExample()) {
      const values = Array.from(raster.values);
      const dark = values.filter((v) => v < 100).length;
      // Axes and bars, but not a page of ink.
      expect(dark).toBeGreaterThan(200);
      expect(dark).toBeLessThan(values.length / 2);
    }
  });

  it("draws the log figure differently from the linear one", () => {
    /*
     * The point the profile argues. If both were drawn identically the example
     * would refuse a comparison between two pictures that look the same, and a
     * reader would reasonably conclude the engine was being pedantic.
     */
    const set = figureExample();
    const linear = Array.from(set[0].raster.values);
    const log = Array.from(set[1].raster.values);
    const differing = linear.filter((v, i) => v !== log[i]).length;
    expect(differing).toBeGreaterThan(100);
  });
});

describe("what a set of examples is for", () => {
  it("sorts into more than one group, in both disciplines", () => {
    // A worked example that all landed in one bucket would show the reader the
    // partition without showing them that it partitions.
    for (const set of [microscopyExample(), figureExample()]) {
      const [head, ...rest] = set;
      const groups = partition(head.study, rest.map((e) => e.study));
      const populated = [groups.comparable, groups.afterHarmonization,
                         groups.uncertain, groups.refused]
        .filter((g) => g.length > 0).length;
      expect(populated).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps every example in exactly one group", () => {
    const set = microscopyExample();
    const [head, ...rest] = set;
    const groups = partition(head.study, rest.map((e) => e.study));
    const seen = [...groups.comparable, ...groups.afterHarmonization,
                  ...groups.uncertain, ...groups.refused].map((g) => g.study.id);
    expect(seen.sort()).toEqual(rest.map((e) => e.study.id).sort());
  });
});
