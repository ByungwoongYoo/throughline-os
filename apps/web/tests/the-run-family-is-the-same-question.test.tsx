/**
 * The cockpit's sensitivity panel lists the same question asked other ways.
 *
 * It was one sentence explaining what a run family would be, while the project
 * already held one for every validated pair: the robustness suite re-runs the
 * pair resampled and as a regression adjusted for the other measured columns.
 * Those runs sat in the list with nothing saying they asked the same question.
 *
 * Two properties are held. A run is in the family only if its variables are
 * this run's pair. And an estimate keeps its own name, because r and a
 * regression coefficient are not the same quantity and a column that lined
 * them up would imply they were.
 */

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunFamily } from "@/components/views";
import { api, type AnalysisRun, type AnalysisRunRow } from "@/lib/api";

const row = (over: Partial<AnalysisRunRow>): AnalysisRunRow => ({
  id: "arun_0000", status: "completed", error: null, created_at: "2026-09-01T00:00:00Z",
  origin: "discovery", method: "pearson_correlation", variables: {},
  research_question: "", fork_reason: "", forked_from_run_id: null,
  left_variable: null, right_variable: null, estimate: null, estimate_name: null,
  p_value: null, sample_size: 180, ...over,
});

const THIS = row({ id: "arun_aaaa", variables: { x: "yield", y: "fertiliser" },
                   estimate: 0.6, estimate_name: "pearson_r" });
const RUNS: AnalysisRunRow[] = [
  THIS,
  // The same pair, resampled — and in the other order, which is the same question.
  row({ id: "arun_bbbb", method: "bootstrap_correlation",
        variables: { x: "fertiliser", y: "yield" }, estimate: 0.61, estimate_name: "pearson_r" }),
  // The same pair, adjusted: one regressed on the other with the rest beside it.
  row({ id: "arun_cccc", method: "linear_regression",
        variables: { outcome: "yield", predictors: ["fertiliser", "rainfall"] },
        estimate: 17.5, estimate_name: "beta[fertiliser]" }),
  // The trap: the same columns, but the coefficient reported is rainfall's.
  // It belongs to the rainfall family, and its estimate says nothing about
  // fertiliser once adjusted.
  row({ id: "arun_eeee", method: "linear_regression",
        variables: { outcome: "yield", predictors: ["rainfall", "fertiliser"] },
        estimate: 0.004, estimate_name: "beta[rainfall]" }),
  // A different question entirely.
  row({ id: "arun_dddd", variables: { x: "rainfall", y: "yield" }, estimate: 0.59,
        estimate_name: "pearson_r" }),
];

const run = { id: "arun_aaaa", variables: { x: "yield", y: "fertiliser" } } as unknown as AnalysisRun;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "get").mockResolvedValue(RUNS as never);
});

describe("the run family", () => {
  it("lists the runs that ask this run's question, and no others", async () => {
    render(<RunFamily projectId="prj" run={run} />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(table.textContent).not.toContain("AN-dddd");
    // A regression whose coefficient is another variable's is not this question.
    expect(table.textContent).not.toContain("AN-eeee");
  });

  it("says how each differs", async () => {
    render(<RunFamily projectId="prj" run={run} />);
    await screen.findByRole("table");
    expect(screen.getByText("This run")).toBeTruthy();
    expect(screen.getByText(/Resampled/)).toBeTruthy();
    expect(screen.getByText("Adjusted for rainfall")).toBeTruthy();
  });

  it("keeps each estimate's own name rather than lining them up", async () => {
    render(<RunFamily projectId="prj" run={run} />);
    const table = await screen.findByRole("table");
    const adjusted = within(table).getByText("Adjusted for rainfall").closest("tr")!;
    expect(adjusted.textContent).toContain("17.50");
    // The coefficient names its predictor, and is never called an effect size.
    expect(adjusted.textContent).toContain("β(fertiliser)");
    expect(adjusted.textContent).not.toContain("η²");
    const original = within(table).getByText("This run").closest("tr")!;
    expect(original.textContent).toContain("r");
  });

  it("opens another run of the family, but not the one on screen", async () => {
    const onOpenRun = vi.fn();
    render(<RunFamily projectId="prj" run={run} onOpenRun={onOpenRun} />);
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "AN-aaaa" })).toBeNull();
    screen.getByRole("button", { name: "AN-bbbb" }).click();
    expect(onOpenRun).toHaveBeenCalledWith("arun_bbbb");
  });

  it("leads with the run on screen", async () => {
    vi.spyOn(api, "get").mockResolvedValue([...RUNS].reverse() as never);
    render(<RunFamily projectId="prj" run={run} />);
    const table = await screen.findByRole("table");
    const first = within(table).getAllByRole("row")[1];
    expect(first.textContent).toContain("This run");
  });

  it("says so when this run is alone", async () => {
    vi.spyOn(api, "get").mockResolvedValue([THIS] as never);
    render(<RunFamily projectId="prj" run={run} />);
    expect(await screen.findByText(/Only this run asks this question so far/)).toBeTruthy();
  });
});
