/**
 * What a run warned about reaches the researcher (§ computed, stored, discarded).
 *
 * The analysis screen rendered `limitations` and not `warnings`. Both are
 * produced by the runtime, both are stored — `warnings` in its own column and
 * again inside the result — and both arrive at the client on every request.
 * Only one was ever shown.
 *
 * The half that was dropped is the half that matters more. It carries:
 *
 *   * the method being wrong — "Normality is violated. Spearman correlation is
 *     the appropriate alternative", appended by `methods.py` when a Pearson or
 *     a t-test fails its normality check; and
 *   * whatever the statistics library said during the fit, captured by
 *     `entrypoint.py` — a `ConvergenceWarning` means the optimiser never
 *     settled and the estimate may be meaningless.
 *
 * So a researcher could run a Pearson correlation on non-normal data, be told
 * by the system in writing that Spearman was the right test, never see it, and
 * publish the coefficient. "An interesting pattern is not a discovery" is the
 * first sentence of this product's own workspace; a result whose method the
 * system knows is wrong, kept quiet, is the worst available version of that.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { AnalysisDetail } from "@/components/views";
import { api } from "@/lib/api";

const RESULT = {
  method: "pearson_correlation", method_rationale: "two continuous variables",
  sample_size: 60, estimate: 0.42, estimate_name: "r",
  ci_low: 0.2, ci_high: 0.6, confidence_level: 0.95, p_value: 0.0008,
  effect_size: null, limitations: ["Observational; not causal."],
  warnings: [] as string[],
  statistically_significant: true, practical_significance: "moderate",
  evidence_quality: "moderate", interpretation: "A positive association.",
};

const RUN = (over: Record<string, unknown> = {}) => ({
  id: "r1", status: "completed", method: "pearson_correlation",
  research_question: "Does x move with y?", method_rationale: "two continuous",
  variables: {}, result: RESULT, error: null, random_seed: 1,
  dependency_versions: {}, sandbox_policy: {}, input_hashes: {},
  duration_ms: 12, assumption_checks: [], ...over,
});

const show = (run: Record<string, unknown>) => {
  vi.spyOn(api, "get").mockResolvedValue(run);
  render(<AnalysisDetail runId="r1" />);
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("a run that warned about its own method", () => {
  const NORMALITY = "Normality is violated. Spearman correlation is the "
                  + "appropriate alternative.";

  it("says so, rather than showing the coefficient alone", async () => {
    show(RUN({ result: { ...RESULT, warnings: [NORMALITY] } }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain(NORMALITY);
  });

  it("puts the warning above the estimate it qualifies", async () => {
    /*
     * Placement is the substance. A warning that the test was the wrong one
     * changes how the number should be read, so it cannot sit beneath it.
     */
    show(RUN({ result: { ...RESULT, warnings: [NORMALITY] } }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const text = document.body.textContent ?? "";
    /*
     * Against the recorded-result panel's own label. This read lowercase
     * "evidence quality", which was a stat tile's caption; the cockpit's
     * Result view now co-locates the specification and the result (§09) and
     * the grade is a labelled row in the recorded-result panel. The claim is
     * unchanged — the warning stands above the estimate it qualifies — and it
     * is now anchored to text that is on screen.
     */
    const grade = text.indexOf("Evidence quality");
    expect(grade, "the recorded result no longer names the grade")
      .toBeGreaterThan(-1);
    expect(text.indexOf("Normality is violated")).toBeLessThan(grade);
  });

  it("keeps a warning distinct from a limitation", async () => {
    // A limitation qualifies a result that stands; a warning asks whether it
    // stands. Collapsing them would lose exactly that distinction.
    show(RUN({ result: { ...RESULT, warnings: [NORMALITY] } }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).not.toContain("Observational");
    expect(alert).toMatch(/not a limitation/i);
  });
});

describe("a warning the statistics library raised during the fit", () => {
  it("shows it, because it is about whether the estimate means anything", async () => {
    const converge = "ConvergenceWarning: Maximum Likelihood optimization "
                   + "failed to converge.";
    show(RUN({ result: { ...RESULT, warnings: [converge] } }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("failed to converge");
  });
});

describe("where the warnings are read from", () => {
  it("reads the run's own column as well as the result's copy", async () => {
    // One value written to two places. An older run may carry only one.
    show(RUN({ warnings: ["From the run column."] }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("From the run column.");
  });

  it("says a thing once when both places carry it", async () => {
    const line = "Normality is violated.";
    show(RUN({ warnings: [line], result: { ...RESULT, warnings: [line] } }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const shown = screen.getByRole("alert").textContent ?? "";
    expect(shown.split("Normality is violated.").length - 1).toBe(1);
  });

  it("counts what it found", async () => {
    show(RUN({ result: { ...RESULT, warnings: ["One.", "Two."] } }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/warned about 2 things/);
  });
});

describe("a run with nothing to warn about", () => {
  it("says nothing at all", async () => {
    /*
     * An empty panel reading "no warnings" would train a reader to skim past
     * the place a real one appears.
     */
    show(RUN());
    await waitFor(() => expect(screen.getByText(/A positive association/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores blank strings rather than showing an empty bullet", async () => {
    show(RUN({ result: { ...RESULT, warnings: ["", "   "] } }));
    await waitFor(() => expect(screen.getByText(/A positive association/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a run that failed", () => {
  /*
   * `error` is what the runtime could say; `logs` is what the sandbox actually
   * wrote to stderr, capped at 8000 characters and stored on every run. The
   * screen showed the first and dropped the second, so a failure whose `error`
   * is the fallback string "Analysis failed" gave the researcher nothing to act
   * on — and the traceback that would have explained it was in the database the
   * whole time.
   */
  const FAILED = (over: Record<string, unknown> = {}) => RUN({
    status: "failed", result: null, error: "Analysis failed",
    logs: "Traceback (most recent call last):\n  ValueError: not enough data",
    ...over,
  });

  it("still leads with the sentence, not the stack trace", async () => {
    show(FAILED());
    await waitFor(() =>
      expect(screen.getByText("Analysis failed")).toBeTruthy());
    const text = document.querySelector(".error")?.textContent ?? "";
    expect(text).toBe("Analysis failed");
  });

  it("offers what the sandbox reported", async () => {
    show(FAILED());
    await waitFor(() =>
      expect(document.querySelector(".run-logs")).toBeTruthy());
    expect(document.querySelector(".run-logs")?.textContent)
      .toContain("ValueError: not enough data");
  });

  it("folds it away rather than printing it", async () => {
    // A stack trace above the fold makes an ordinary failure look like a crash
    // in the product.
    show(FAILED());
    await waitFor(() =>
      expect(document.querySelector(".run-logs")).toBeTruthy());
    expect(document.querySelector(".run-logs")?.tagName).toBe("DETAILS");
    expect(document.querySelector(".run-logs")?.hasAttribute("open")).toBe(false);
  });

  it("says nothing when the sandbox said nothing", async () => {
    show(FAILED({ logs: "" }));
    await waitFor(() =>
      expect(screen.getByText("Analysis failed")).toBeTruthy());
    expect(document.querySelector(".run-logs")).toBeNull();
  });

  it("says nothing when the field is absent", async () => {
    const run = FAILED();
    delete (run as Record<string, unknown>).logs;
    show(run);
    await waitFor(() =>
      expect(screen.getByText("Analysis failed")).toBeTruthy());
    expect(document.querySelector(".run-logs")).toBeNull();
  });

  it("does not show logs for a run that succeeded", async () => {
    // A completed run has nothing to diagnose, and stderr from a successful
    // fit is noise dressed as a problem.
    show(RUN({ logs: "some chatter from the fit" }));
    await waitFor(() =>
      expect(screen.getByText(/A positive association/)).toBeTruthy());
    expect(document.querySelector(".run-logs")).toBeNull();
  });
});
