/**
 * The figures that ask whether a screen should be believed.
 *
 * These three are the product's own first sentence — "an interesting pattern is
 * not a discovery" — expressed as arithmetic, so most of these tests are about
 * the ways such a figure can quietly mislead rather than about whether it
 * draws.
 *
 * The one that matters most is the volcano's grouping. A volcano drawn against
 * an uncorrected threshold is the exact picture that manufactures false
 * discoveries: on two hundred tests, ten points clear p = 0.05 by chance and
 * look identical to the real one.
 */

import { describe, expect, it } from "vitest";
import {
  SMALLEST_P, Tested, funnel, nullDiagonal, quantileQuantile, readAs,
  significance, standardErrorOf, volcano,
} from "@/lib/diagnostics";

function tested(over: Partial<Tested> = {}): Tested {
  return {
    id: "c1", label: "sleep and reaction time",
    estimate: 0.42, pValue: 0.001, qValue: 0.01,
    ciLow: 0.2, ciHigh: 0.64, ...over,
  };
}

describe("significance", () => {
  it("is -log10 of the p-value", () => {
    expect(significance(0.01)).toBeCloseTo(2, 10);
    expect(significance(0.05)).toBeCloseTo(1.301, 3);
  });

  it("survives a p-value that underflowed to zero", () => {
    /*
     * Not hypothetical: a correlation of 0.9 across a few hundred points
     * underflows routinely. Uncapped, one such point sends the axis to infinity
     * and flattens every other result onto the baseline — so the figure showing
     * the strongest finding is the figure that hides all the others.
     */
    expect(Number.isFinite(significance(0))).toBe(true);
    expect(significance(0)).toBe(significance(SMALLEST_P));
  });
});

describe("the volcano", () => {
  it("puts direction on x and evidence on y", () => {
    const [point] = volcano([tested({ estimate: -0.8, pValue: 0.0001 })]);
    expect(point.x).toBe(-0.8);
    expect(point.y).toBeCloseTo(4, 10);
  });

  it("groups by the corrected value, not the raw one", () => {
    /*
     * The whole point of the figure. A result at p = 0.01 on a screen of two
     * hundred tests is unremarkable, and a volcano that coloured it as
     * significant would be manufacturing exactly the false discovery this
     * product exists to prevent.
     */
    const [passes] = volcano([tested({ pValue: 0.01, qValue: 0.03, survived: true })]);
    const [fails] = volcano([tested({ pValue: 0.01, qValue: 0.4, survived: false })]);
    expect(passes.group).toBe("survives correction");
    expect(fails.group).toBe("does not survive");
  });

  it("colours by the server's verdict, not by a threshold of its own (T176)", () => {
    // A run corrected at 0.10 promoted q = 0.08; one corrected at 0.01 left
    // q = 0.03 behind. Re-deriving with `q <= 0.05` inverted both.
    const [promoted] = volcano([tested({ qValue: 0.08, survived: true })]);
    const [leftBehind] = volcano([tested({ qValue: 0.03, survived: false })]);
    expect(promoted.group).toBe("survives correction");
    expect(leftBehind.group).toBe("does not survive");
    // A q-value with no verdict beside it is not a survivor.
    const [unknown] = volcano([tested({ qValue: 0.001, survived: undefined })]);
    expect(unknown.group).toBe("does not survive");
  });

  it("says when nothing was corrected at all", () => {
    // "Not corrected" and "did not survive correction" are different facts.
    // Collapsing them lets an uncorrected screen present itself as one where
    // nothing passed, which is a flattering lie.
    const [point] = volcano([tested({ qValue: null })]);
    expect(point.group).toBe("not corrected");
  });

  it("drops results with no effect or no p-value", () => {
    const points = volcano([
      tested({ id: "a" }),
      tested({ id: "b", estimate: null }),
      tested({ id: "c", pValue: null }),
      tested({ id: "d", pValue: 1.4 }),
    ]);
    expect(points.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("the quantile–quantile plot", () => {
  it("puts a screen with nothing in it on the diagonal", () => {
    /*
     * The honest case, and the one worth being exact about. Uniform p-values
     * are what "nothing here is real" looks like, and they must land on the
     * line rather than near it — otherwise every screen looks slightly
     * inflated and the figure cries wolf.
     */
    const uniform: Tested[] = Array.from({ length: 200 }, (_, i) => tested({
      id: `t${i}`, pValue: (i + 0.5) / 200, qValue: 1,
    }));
    for (const point of quantileQuantile(uniform)) {
      expect(point.y).toBeCloseTo(point.x, 6);
    }
  });

  it("bends above the line when there is signal", () => {
    const withSignal: Tested[] = [
      ...Array.from({ length: 50 }, (_, i) => tested({
        id: `n${i}`, pValue: (i + 0.5) / 50 })),
      ...Array.from({ length: 10 }, (_, i) => tested({
        id: `s${i}`, pValue: 1e-8 })),
    ];
    const points = quantileQuantile(withSignal);
    // The smallest observed p-values sit far above what chance would give.
    expect(points[0].y).toBeGreaterThan(points[0].x + 2);
  });

  it("does not send the first point off the top of the chart", () => {
    /*
     * The (i + 0.5)/n plotting position rather than i/n. The latter starts at
     * exactly zero, whose -log10 is infinite, so every screen ever drawn would
     * have one point at infinity.
     */
    const points = quantileQuantile([tested(), tested({ id: "b", pValue: 0.5 })]);
    expect(points.every((p) => Number.isFinite(p.x))).toBe(true);
  });

  it("sorts, so the order results arrived in cannot change the figure", () => {
    const shuffled = [0.9, 0.01, 0.5, 0.2].map((p, i) =>
      tested({ id: `t${i}`, pValue: p }));
    const ys = quantileQuantile(shuffled).map((p) => p.y);
    expect([...ys].sort((a, b) => b - a)).toEqual(ys);
  });

  it("has a diagonal to be read against", () => {
    const points = quantileQuantile([tested(), tested({ id: "b", pValue: 0.4 })]);
    const line = nullDiagonal(points);
    expect(line).toHaveLength(2);
    expect(line[0]).toMatchObject({ x: 0, y: 0 });
    // Reaches the far corner, so the eye compares against the whole range
    // rather than a line that stops short of the interesting points.
    expect(line[1].x).toBeGreaterThanOrEqual(Math.max(...points.map((p) => p.y)));
  });

  it("has no diagonal for no points", () => {
    expect(nullDiagonal([])).toEqual([]);
  });
});

describe("the funnel", () => {
  it("recovers the standard error from the interval", () => {
    // A 95% normal interval is 2 x 1.96 standard errors wide.
    expect(standardErrorOf(tested({ ciLow: -1.96, ciHigh: 1.96 })))
      .toBeCloseTo(1, 4);
  });

  it("puts precise results at the top", () => {
    const points = funnel([
      tested({ id: "precise", ciLow: 0.40, ciHigh: 0.44 }),
      tested({ id: "vague", ciLow: -0.5, ciHigh: 1.3 }),
    ]);
    const precise = points.find((p) => p.id === "precise")!;
    const vague = points.find((p) => p.id === "vague")!;
    expect(precise.y).toBeGreaterThan(vague.y);
  });

  it("drops a result with no interval rather than guessing one", () => {
    /*
     * A point placed at an invented height is indistinguishable from a measured
     * one, and this is a figure people read for asymmetry — so a guess here
     * does not blur the answer, it fabricates one.
     */
    expect(funnel([tested({ ciLow: null, ciHigh: null })])).toEqual([]);
    expect(funnel([tested({ ciLow: 0.5, ciHigh: 0.5 })])).toEqual([]);
  });

  it("drops an interval that runs backwards", () => {
    // A negative width would give a negative precision and hang the point
    // below the chart, where it reads as an extreme rather than as broken.
    expect(funnel([tested({ ciLow: 1, ciHigh: -1 })])).toEqual([]);
  });
});

describe("what each figure says in words", () => {
  it("counts what survived, when there was a correction", () => {
    const points = volcano([
      tested({ id: "a", qValue: 0.01, survived: true }),
      tested({ id: "b", qValue: 0.9, survived: false }),
    ]);
    expect(readAs("volcano", points)).toContain("1 still stand");
  });

  it("says plainly when nothing was corrected", () => {
    const points = volcano([tested({ qValue: null })]);
    expect(readAs("volcano", points)).toContain("not been corrected");
  });

  it("says so when there is nothing to draw", () => {
    // Rather than an empty frame, which reads as a chart that failed to load.
    expect(readAs("qq", [])).toContain("Nothing here");
  });

  it("explains the diagonal without assuming the reader knows the figure", () => {
    // Most people meet a Q–Q plot for the first time in a reviewer's comment.
    const words = readAs("qq", [{ id: "a", x: 1, y: 1 }]);
    expect(words).toMatch(/diagonal/i);
    expect(words).toMatch(/chance/i);
  });
});
