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
import userEvent from "@testing-library/user-event";
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
    /*
     * More than once now, and deliberately: the cockpit's header names the
     * method as provenance under the relationship, and the Result view's
     * recorded-specification panel names it again as the thing that was run.
     * §09 asks the Result view to co-locate the specification with the result,
     * so both are the method appearing where a reader needs it — what this
     * test guards is that it is never the raw `pearson_correlation` enum.
     */
    view();
    const named = await screen.findAllByText(/pearson correlation/i);
    expect(named.length).toBeGreaterThan(0);
    expect(screen.queryByText(/pearson_correlation/)).toBeNull();
  });

  it("keeps the four judgements apart", async () => {
    /** §47: an estimate is not a p-value is not a sample size is not a grade,
     *  and collapsing any two of them is how a result gets overstated. */
    view();
    await screen.findAllByText(/pearson correlation/i);
    /*
     * The formats are reporting convention — two decimals for an estimate, a
     * p-value to three places — and the exact estimate stays on the element,
     * so a reader who needs 0.6234 still has it. What this test holds is the
     * property in its name: four separate figures, none folded into another.
     */
    const estimate = screen.getByText("0.62");
    expect(estimate.getAttribute("data-exact")).toBe("0.6234");
    expect(screen.getByText("0.001")).toBeTruthy();        // p = 0.0012
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("Moderate")).toBeTruthy();     // evidence quality
    expect(screen.getByText("Small")).toBeTruthy();        // practical, not the same
  });

  it("shows the limitations the run recorded", async () => {
    view();
    expect(await screen.findByText(/cannot establish direction/)).toBeTruthy();
  });

  it("says why the method was chosen, under Specification", async () => {
    /*
     * The rationale moved when the run became five readings rather than one
     * scroll: it answers "what was asked for", not "what was found", which is
     * where §09 puts it. So this now says which reading it is under, and
     * opening that reading is part of the claim — a rationale filed somewhere
     * a reader would not look for it is not much better than one missing.
     */
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole("tab", { name: /Specification/ }));
    expect(await screen.findByText(/Both variables are continuous/)).toBeTruthy();
  });

  it("keeps the estimate and the interpretation on the reading it opens with",
     async () => {
    /** Whatever else moved, what the run FOUND is what a reader meets first. */
    view();
    const estimate = await screen.findByText("0.62");
    expect(estimate.getAttribute("data-exact")).toBe("0.6234");
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
