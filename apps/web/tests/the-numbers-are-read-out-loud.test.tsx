/**
 * The cockpit's measurement row, said in words (T188, D207).
 *
 * The three assertions that matter are not about wording but about what the
 * sentence is allowed to claim: a p-value is not the probability that the
 * result is chance, a confidence interval is not a 95% probability of holding
 * the truth, and a correlation never licenses "affects". Each of those is the
 * standard way a plain-English statistics sentence becomes false, so each has
 * a test rather than a comment.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlainReading, readingOf } from "@/components/plainreading";

afterEach(cleanup);

const CORRELATION = {
  method: "pearson_correlation",
  estimateName: "pearson_r",
  estimate: 0.6013,
  ciLow: 0.4989,
  ciHigh: 0.6934,
  confidenceLevel: 0.95,
  pValue: 4.461e-19,
  sampleSize: 180,
  practicalSignificance: "large",
  variables: { x: "yield_t_ha", y: "fertiliser_kg" },
};

describe("reading a correlation out loud", () => {
  it("names both columns and which way they move", () => {
    const text = readingOf(CORRELATION).join(" ");
    expect(text).toContain("yield_t_ha");
    expect(text).toContain("fertiliser_kg");
    expect(text).toMatch(/the higher .*, the higher .* tends to be/);
  });

  it("reads a negative coefficient as moving the other way", () => {
    const text = readingOf({ ...CORRELATION, estimate: -0.1822 }).join(" ");
    expect(text).toMatch(/the higher .*, the lower .* tends to be/);
  });

  it("states the p-value as a frequency under no relationship, not as a chance of being wrong", () => {
    const text = readingOf(CORRELATION).join(" ");
    expect(text).toContain("If there were no relationship here at all");
    expect(text).toContain("less than once in a thousand samples");
    // The two readings that would make the sentence false.
    expect(text).not.toMatch(/probability that (the|this) result/i);
    expect(text).not.toMatch(/\bchance that\b/i);
    expect(text).not.toMatch(/\b\d+% (sure|certain|likely) (it|the)\b/i);
  });

  it("says a weak p-value is not evidence rather than saying nothing", () => {
    const text = readingOf({ ...CORRELATION, pValue: 0.31 }).join(" ");
    expect(text).toContain("about once in every 3 samples");
    expect(text).toContain("not evidence of one");
  });

  it("describes the interval as a procedure, never as a probability the truth is inside it", () => {
    const text = readingOf(CORRELATION).join(" ");
    expect(text).toContain("ranges like it hold the true value 95 times in 100");
    expect(text).not.toMatch(/95% (probability|chance) .*(true|real) value/i);
    expect(text).not.toMatch(/the true value is (probably|likely) between/i);
  });

  it("refuses to let any correlation imply cause", () => {
    for (const estimate of [0.99, 0.6013, -0.95]) {
      const text = readingOf({ ...CORRELATION, estimate }).join(" ");
      expect(text, String(estimate)).toContain("None of that says one causes the other");
      expect(text, String(estimate)).not.toMatch(/\b(causes|affects|drives|leads to) (the |a )?\w+ by\b/i);
    }
  });
});

describe("reading other methods", () => {
  it("reads a regression coefficient as movement per unit, with the adjustments named", () => {
    const text = readingOf({
      method: "linear_regression",
      estimateName: "beta[fertiliser_kg]",
      estimate: 17.52,
      pValue: 0.001,
      sampleSize: 180,
      variables: { outcome: "yield_t_ha", predictor: "fertiliser_kg", covariate: "rainfall_mm" },
    }).join(" ");
    expect(text).toContain("each extra unit of fertiliser_kg");
    expect(text).toContain("17.52 more yield_t_ha");
    expect(text).toContain("holding rainfall_mm");
    // Adjustment is not causal identification, and the sentence says so.
    expect(text).toContain("does not make this causal");
  });

  it("does not invent a size for a method that recorded none", () => {
    const text = readingOf({
      method: "anova", estimate: null, pValue: 0.906, sampleSize: 180,
      variables: { group: "region", value: "yield_t_ha" },
    }).join(" ");
    expect(text).toContain("recorded no single size");
    expect(text).not.toContain("NaN");
  });

  it("says nothing at all when the run recorded nothing to say", () => {
    expect(readingOf({ method: "anova", estimate: null, variables: {} })).toEqual([]);
    expect(readingOf({})).toEqual([]);
  });
});

describe("the rendered reading", () => {
  it("is visible text on the page, not a tooltip", () => {
    const { container } = render(<PlainReading {...CORRELATION} />);
    expect(screen.getByText(/In plain words/)).toBeInTheDocument();
    expect(screen.getByText(/None of that says one causes the other/)).toBeInTheDocument();
    expect(container.querySelector("[title]")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
  });

  it("renders nothing when there is nothing true to say", () => {
    const { container } = render(<PlainReading method="anova" variables={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
