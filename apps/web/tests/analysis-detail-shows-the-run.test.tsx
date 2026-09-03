/**
 * The screen a researcher reads a result on.
 *
 * `AnalysisDetail` is what the Analyses section renders when a run is
 * selected, and no web test named it. It is where the four judgements §47
 * insists on being kept apart are shown apart — estimate, p-value, sample
 * size and evidence quality — and where a failed run has to say so instead of
 * showing an empty frame that looks like a result.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisDetail } from "@/components/views";
import { api } from "@/lib/api";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

const RESULT = {
  estimate: 0.6234, estimate_name: "r", p_value: 0.0012, sample_size: 120,
  evidence_quality: "moderate", interpretation: "The two move together.",
  // Deliberately different from evidence_quality: they are separate
  // judgements, and a fixture that gave them the same word could not tell
  // the difference between showing both and showing one twice.
  statistically_significant: true, practical_significance: "small",
  limitations: ["Observational data cannot establish direction."],
  ci_low: 0.48, ci_high: 0.74, effect_size: 0.62, effect_size_name: "r",
  confidence_level: 0.95, test_statistic: 8.6, degrees_of_freedom: 118,
  warnings: [], adjustments: [], assumptions: [], method: "pearson_correlation",
  method_rationale: "Both variables are continuous.",
};

function run(over: Record<string, unknown> = {}) {
  return {
    id: "arun_1", status: "completed", method: "pearson_correlation",
    research_question: "Does consumption track resistance?",
    method_rationale: "Both variables are continuous.",
    variables: { x: "consumption", y: "resistance" },
    result: RESULT, error: null, random_seed: 0, dependency_versions: {},
    sandbox_policy: {}, input_hashes: {}, duration_ms: 42,
    assumption_checks: [], ...over,
  };
}

function view(over: Record<string, unknown> = {}) {
  vi.spyOn(api, "get").mockResolvedValue(run(over) as never);
  render(<AnalysisDetail runId="arun_1" />);
}

describe("reading one analysis", () => {
  it("names the method in words", async () => {
    view();
    expect(await screen.findByText(/pearson correlation/i)).toBeTruthy();
  });

  it("keeps the four judgements apart", async () => {
    /** §47: an estimate is not a p-value is not a sample size is not a grade,
     *  and collapsing any two of them is how a result gets overstated. */
    view();
    await screen.findByText(/pearson correlation/i);
    expect(screen.getByText("0.6234")).toBeTruthy();
    expect(screen.getByText(/1\.20e-3/)).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("moderate")).toBeTruthy();   // evidence quality
    expect(screen.getByText("small")).toBeTruthy();      // practical, not the same
  });

  it("shows the limitations the run recorded", async () => {
    view();
    expect(await screen.findByText(/cannot establish direction/)).toBeTruthy();
  });

  it("says why the method was chosen", async () => {
    view();
    expect(await screen.findByText(/Both variables are continuous/)).toBeTruthy();
  });

  it("says a failed run failed instead of showing a blank result", async () => {
    view({ status: "failed", result: null,
           error: "The sandbox ran out of memory." });
    expect(await screen.findByText(/ran out of memory/)).toBeTruthy();
    expect(screen.queryByText("0.6234")).toBeNull();
  });

  it("says a queued run is not a result", async () => {
    view({ status: "queued", result: null, error: null });
    expect(await screen.findByText(/this run is queued/i)).toBeTruthy();
  });

  it("reports the method upward so the fork panel agrees with the screen",
     async () => {
    /** Reported rather than fetched twice, deliberately — a second hook on
     *  the same run could drift from the one being displayed. */
    const seen: string[] = [];
    vi.spyOn(api, "get").mockResolvedValue(run() as never);
    render(<AnalysisDetail runId="arun_1" onMethod={(m) => seen.push(m)} />);
    await waitFor(() => expect(seen).toContain("pearson_correlation"));
  });

  it("offers a retry rather than a blank screen when the read fails", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("the server said no"));
    render(<AnalysisDetail runId="arun_1" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /try again|retry/i })).toBeTruthy());
  });
});
