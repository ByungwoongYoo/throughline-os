/**
 * Forking an analysis, and comparing the branches.
 *
 * The lineage panel already showed where a run came from and what was tried
 * from it, and said in its own first line that a sensitivity analysis is the
 * relationship between runs rather than any one of them. That relationship had
 * no screen: nothing could create a branch, and nothing could put the branches
 * side by side — so `compare_runs`'s verdict, *"the conclusion depends on an
 * analytical choice and should be reported as such"*, could not be reached.
 *
 * What is tested here is mostly whether the screen can flatter. A fork that
 * changes nothing, or a comparison that reports agreement it has not
 * established, is worse than the missing screen was.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  CompareBranches, ForkAnalysis, WITHOUT_THE_ASSUMPTION, methodName, show,
} from "@/components/sensitivity";
import { ApiError, api } from "@/lib/api";

const branch = (over: Partial<Record<string, unknown>> = {}) => ({
  run_id: "arun_1", status: "completed", method: "pearson_correlation",
  fork_reason: null, estimate: 0.62, estimate_name: "r",
  ci_low: 0.4, ci_high: 0.8, p_value: 0.001, sample_size: 120,
  statistically_significant: true, ...over,
});

beforeEach(() => { vi.restoreAllMocks(); });

describe("a branch has to change something", () => {
  it("offers the rank-based counterpart of the method", async () => {
    render(<ForkAnalysis runId="arun_1" method="pearson_correlation" />);
    await userEvent.click(screen.getByRole("button", { name: /different way/ }));
    expect(screen.getByText(/spearman correlation/)).toBeTruthy();
  });

  it("warns that an unchanged branch is a re-run, not evidence", async () => {
    /*
     * Two identical runs agree, and a comparison of them reports a stable
     * conclusion. That is flattery: nothing was tested.
     */
    render(<ForkAnalysis runId="arun_1" method="pearson_correlation" />);
    await userEvent.click(screen.getByRole("button", { name: /different way/ }));
    expect(screen.getByText(/would be flattery rather than evidence/)).toBeTruthy();

    await userEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(screen.queryByText(/flattery rather than evidence/)).toBeNull());
  });

  it("says so plainly when it has no alternative to offer", async () => {
    // Rather than silently producing a duplicate run.
    render(<ForkAnalysis runId="arun_1" method="linear_regression" />);
    await userEvent.click(screen.getByRole("button", { name: /different way/ }));
    expect(screen.getByText(/re-run the same analysis unchanged/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("pairs only methods that take the same variables", () => {
    /*
     * A fork copies the parent's variables, so a method needing different roles
     * is refused by the server. `chi_square` takes an x and a y like a
     * correlation does, and is still not an alternative to one — it is a test
     * for categorical data.
     */
    expect(WITHOUT_THE_ASSUMPTION.pearson_correlation).toBe("spearman_correlation");
    expect(WITHOUT_THE_ASSUMPTION.t_test).toBe("mann_whitney");
    expect(WITHOUT_THE_ASSUMPTION.anova).toBe("kruskal_wallis");
    expect(WITHOUT_THE_ASSUMPTION.chi_square).toBeUndefined();
    // Every pairing works in both directions, or half of them are unreachable.
    for (const [from, to] of Object.entries(WITHOUT_THE_ASSUMPTION)) {
      expect(WITHOUT_THE_ASSUMPTION[to]).toBe(from);
    }
  });

  it("will not fork without a recorded reason", async () => {
    // Reporting only the branch that worked is what this exists to expose, and
    // a branch with no reason cannot be read afterwards.
    const post = vi.spyOn(api, "post").mockResolvedValue({ analysis_run_id: "arun_2" });
    render(<ForkAnalysis runId="arun_1" method="pearson_correlation" />);
    await userEvent.click(screen.getByRole("button", { name: /different way/ }));
    await userEvent.click(screen.getByRole("button", { name: /Run the branch/ }));
    expect(post).not.toHaveBeenCalled();
  });

  it("sends the reason, and the swapped method only when asked", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ analysis_run_id: "arun_2" });
    render(<ForkAnalysis runId="arun_1" method="pearson_correlation" />);
    await userEvent.click(screen.getByRole("button", { name: /different way/ }));
    await userEvent.type(screen.getByRole("textbox"), "The outcome is skewed.");
    await userEvent.click(screen.getByRole("button", { name: /Run the branch/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual(
      { reason: "The outcome is skewed.", method: null });

    await userEvent.click(screen.getByRole("button", { name: /different way/ }));
    await userEvent.type(screen.getByRole("textbox"), "Skewed.");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /Run the branch/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toMatchObject({ method: "spearman_correlation" });
  });

  it("reports what the server said when the fork is refused", async () => {
    vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(422, "spearman_correlation requires variables x and y."));
    render(<ForkAnalysis runId="arun_1" method="pearson_correlation" />);
    await userEvent.click(screen.getByRole("button", { name: /different way/ }));
    await userEvent.type(screen.getByRole("textbox"), "Skewed.");
    await userEvent.click(screen.getByRole("button", { name: /Run the branch/ }));
    expect(await screen.findByText(/requires variables x and y/)).toBeTruthy();
  });
});

describe("comparing the branches", () => {
  it("asks the server about every run in the family", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(
      { runs: [branch()], conclusion_stable: true, note: "All agree." });
    render(<CompareBranches projectId="prj_1" runIds={["arun_1", "arun_2"]} />);
    await userEvent.click(screen.getByRole("button", { name: /Compare these 2 runs/ }));

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls[0][0]).toBe(
      "/api/projects/prj_1/analyses/compare?run_id=arun_1&run_id=arun_2");
  });

  it("does not offer a comparison of one run with itself", () => {
    const { container } = render(
      <CompareBranches projectId="prj_1" runIds={["arun_1"]} />);
    expect(container.textContent).toBe("");
  });

  it("leads with the verdict, and marks disagreement as something to read", async () => {
    /*
     * The sentence this whole path exists to deliver. Under the table it would
     * be left to the reader to derive from seven columns of numbers.
     */
    vi.spyOn(api, "get").mockResolvedValue({
      runs: [branch(), branch({ run_id: "arun_2", p_value: 0.21,
                               statistically_significant: false })],
      conclusion_stable: false,
      note: "Branches disagree on significance — the conclusion depends on an "
          + "analytical choice and should be reported as such.",
    });
    render(<CompareBranches projectId="prj_1" runIds={["arun_1", "arun_2"]} />);
    await userEvent.click(screen.getByRole("button", { name: /Compare/ }));

    const verdict = await screen.findByRole("alert");
    expect(verdict.textContent).toContain("depends on an analytical choice");
    // Marked visually too, not only for a screen reader: a reader scanning the
    // panel sees the style before they read the sentence.
    expect(verdict.className).toBe("notice");
  });

  it("does not raise an alarm when the branches agree", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      runs: [branch(), branch({ run_id: "arun_2" })],
      conclusion_stable: true,
      note: "All completed branches agree on statistical significance.",
    });
    render(<CompareBranches projectId="prj_1" runIds={["arun_1", "arun_2"]} />);
    await userEvent.click(screen.getByRole("button", { name: /Compare/ }));

    const verdict = await screen.findByText(/All completed branches agree/);
    expect(verdict.className).toBe("note");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a branch is unfinished rather than leaving the cell empty", async () => {
    // A blank estimate reads as a branch that found nothing, which is a
    // different claim from one that has not run.
    vi.spyOn(api, "get").mockResolvedValue({
      runs: [branch(), branch({ run_id: "arun_2", status: "running",
                               estimate: null, p_value: null })],
      conclusion_stable: true, note: "All agree.",
    });
    render(<CompareBranches projectId="prj_1" runIds={["arun_1", "arun_2"]} />);
    await userEvent.click(screen.getByRole("button", { name: /Compare/ }));
    expect(await screen.findByText(/not finished \(running\)/)).toBeTruthy();
  });

  it("names the original rather than leaving its reason blank", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      runs: [branch({ fork_reason: null })], conclusion_stable: true, note: "n",
    });
    render(<CompareBranches projectId="prj_1" runIds={["arun_1", "arun_2"]} />);
    await userEvent.click(screen.getByRole("button", { name: /Compare/ }));
    expect(await screen.findByText("the original analysis")).toBeTruthy();
  });
});

describe("numbers as a reader wants them", () => {
  it("keeps a very small p-value legible instead of rounding it to zero", () => {
    // 0.000 reads as impossible; it is merely small.
    expect(show(0.0000004, 4)).toBe("4.0e-7");
    expect(show(0.62)).toBe("0.62");
    expect(show(0)).toBe("0");
    expect(show(null)).toBe("—");
    expect(show(Number.NaN)).toBe("—");
  });

  it("writes a method as words", () => {
    expect(methodName("spearman_correlation")).toBe("spearman correlation");
  });
});
