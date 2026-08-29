/**
 * The project's analyses.
 *
 * This screen listed `connections` that carried an `analysis_run_id` — a list
 * of what discovery produced, which was the only thing that produced analyses.
 * Now that a researcher can specify one, a run they asked for would be queued,
 * executed, recorded, and never shown.
 *
 * The tests are about that invisibility, and about the distinction a flat list
 * would destroy: a swept run was corrected inside a family of tests and a
 * specified one was not, and the flattened version is the more flattering one.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { AnalysisList, ORIGIN_NOTE, nameOf } from "@/components/analyses";
import type { AnalysisRunRow } from "@/lib/api";
import { api } from "@/lib/api";

function run(over: Partial<AnalysisRunRow> = {}): AnalysisRunRow {
  return {
    id: "arun_1", status: "completed", error: null,
    created_at: "2026-01-01T00:00:00Z", origin: "discovery",
    method: "pearson_correlation", variables: { x: "consumption", y: "resistance" },
    research_question: "Does consumption track resistance?", fork_reason: "",
    forked_from_run_id: null, left_variable: "consumption",
    right_variable: "resistance", estimate: 0.81, estimate_name: "r",
    p_value: 0.001, sample_size: 120, ...over,
  };
}

function serve(runs: AnalysisRunRow[]) {
  return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.includes("/analyses")) return runs as never;
    // The specify-an-analysis form sits on this screen. Closed, it asks for
    // nothing — which is the point of the assertion below — but a payload
    // missing its `analysis` block must not take the screen down with it.
    return {} as never;
  });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("which runs appear", () => {
  it("asks for the project's runs rather than deriving them from connections", async () => {
    /*
     * The whole defect. A run that belongs to no connection — anything a
     * researcher specified — was invisible by construction.
     */
    const get = serve([run()]);
    render(<AnalysisList projectId="prj_1" onSelect={() => {}} />);
    await waitFor(() => expect(get)
      .toHaveBeenCalledWith("/api/projects/prj_1/analyses?limit=200"));
    expect(get.mock.calls.some(([p]) => String(p).includes("/connections")))
      .toBe(false);
  });

  it("asks for nothing on behalf of a form nobody has opened", async () => {
    // The specify-an-analysis form sits on this screen. Closed, it is a button,
    // and a button should not cost the capabilities payload and the source list
    // on every visit to a screen that is mostly read.
    const get = serve([run()]);
    render(<AnalysisList projectId="prj_1" onSelect={() => {}} />);
    await screen.findByText(/consumption × resistance/);
    expect(get.mock.calls.map(([p]) => String(p)))
      .toEqual(["/api/projects/prj_1/analyses?limit=200"]);
  });

  it("lists a run that belongs to no connection", async () => {
    serve([run({ id: "arun_2", origin: "specified", left_variable: null,
                 right_variable: null })]);
    render(<AnalysisList projectId="prj_1" onSelect={() => {}} />);
    expect(await screen.findByText(/consumption · resistance/)).toBeTruthy();
  });

  it("opens the run that was clicked", async () => {
    const selected = vi.fn();
    serve([run({ id: "arun_7" })]);
    render(<AnalysisList projectId="prj_1" onSelect={selected} />);
    await userEvent.click(await screen.findByText(/consumption × resistance/));
    expect(selected).toHaveBeenCalledWith("arun_7");
  });
});

describe("where a run came from", () => {
  it("says a swept run was corrected across the whole search", async () => {
    /*
     * The same p-value is worth less in a larger family. A list that showed the
     * estimate and not the origin would let a swept result read as a standalone
     * one, which is the flattering direction.
     */
    serve([run({ origin: "discovery" })]);
    render(<AnalysisList projectId="prj_1" onSelect={() => {}} />);
    expect(await screen.findByText(/corrected across every test in that search/))
      .toBeTruthy();
  });

  it("says a fork is a variant rather than an independent look", async () => {
    serve([run({ origin: "fork", fork_reason: "without the outlier",
                 forked_from_run_id: "arun_0" })]);
    render(<AnalysisList projectId="prj_1" onSelect={() => {}} />);
    expect(await screen.findByText(/not an independent look/)).toBeTruthy();
    expect(screen.getByText(/without the outlier/)).toBeTruthy();
  });

  it("distinguishes the three rather than describing them alike", () => {
    expect(new Set(Object.values(ORIGIN_NOTE)).size).toBe(3);
  });
});

describe("what a row says about a run", () => {
  it("names a swept run by the pair it tested", () => {
    expect(nameOf(run())).toBe("consumption × resistance");
  });

  it("names a specified run by the columns it used", () => {
    // It belongs to no pair, and `arun_8f21…` tells a reader nothing.
    expect(nameOf(run({ origin: "specified", left_variable: null,
                        right_variable: null,
                        variables: { outcome: "resistance",
                                     predictors: ["consumption", "gdp"] } })))
      .toBe("resistance · consumption · gdp");
  });

  it("falls back to the method when a run named no columns", () => {
    expect(nameOf(run({ left_variable: null, right_variable: null,
                        variables: {}, method: "kruskal_wallis" })))
      .toBe("kruskal wallis");
  });

  it("shows a status rather than an estimate while a run is still queued", async () => {
    // An absent estimate is not a zero one, and a zero estimate is a finding.
    serve([run({ status: "queued", estimate: null, estimate_name: null })]);
    render(<AnalysisList projectId="prj_1" onSelect={() => {}} />);
    await screen.findByText(/consumption × resistance/);
    expect(screen.getByText(/queued/)).toBeTruthy();
  });

  it("shows the estimate of a finished run whatever the status is called", async () => {
    /*
     * `analysis_runs` finishes as "completed" and `discovery_runs` finishes as
     * "complete". A component that tests for one word is wrong about the other
     * and shows a status badge where the result belongs — which is what this
     * one did, for every finished run, until a round trip through the real
     * server said the word out loud.
     */
    serve([run({ status: "completed" })]);
    render(<AnalysisList projectId="prj_1" onSelect={() => {}} />);
    expect(await screen.findByText(/0\.81/)).toBeTruthy();
    expect(screen.queryByText(/^completed$/)).toBeNull();
  });

  it("shows a failed run with what stopped it", async () => {
    /*
     * Dropping failures would make the search look more successful than it was
     * — the same distortion the correction exists to prevent, one level up.
     */
    serve([run({ status: "failed", estimate: null,
                 error: "The dataset version disappeared." })]);
    render(<AnalysisList projectId="prj_1" onSelect={() => {}} />);
    expect(await screen.findByRole("alert"))
      .toHaveTextContent(/dataset version disappeared/);
  });
});

describe("an empty project", () => {
  it("offers both ways of producing an analysis", async () => {
    // The old empty state said "Run discovery to generate them", which was the
    // only way there was.
    serve([]);
    render(<AnalysisList projectId="prj_1" onSelect={() => {}} />);
    expect(await screen.findByText(/No analyses yet/)).toBeTruthy();
    expect(screen.getByText(/or specify one yourself/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Specify an analysis/ })).toBeTruthy();
  });
});
