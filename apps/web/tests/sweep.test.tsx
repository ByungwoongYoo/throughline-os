/**
 * What a discovery sweep did.
 *
 * `discovery_runs` records the denominator — pairs considered, pairs dropped
 * and why, tests run, the correction and its rate — and `GET /discoveries/{id}`
 * returned it to nobody. The screen showed the connections that came out and
 * nothing about the search that produced them.
 *
 * The tests turn on why that matters here rather than on layout: a q-value
 * means nothing without the number of tests it was corrected across, and a
 * column dropped before the search is not a pair that failed it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatTheSweepDid, exclusions } from "@/components/sweep";
import type { Sweep } from "@/components/sweep";
import { api } from "@/lib/api";

const SWEEP: Sweep = {
  id: "drun_1",
  status: "complete",
  candidates_considered: 45,
  candidates_excluded: 3,
  tests_run: 12,
  exclusion_reasons: {
    constant_col: "every value is the same",
    patient_id: "an identifier, not a measurement",
  },
  correction_method: "benjamini_hochberg",
  false_discovery_rate: 0.05,
  error: null,
};

function serve(over: Partial<Sweep> = {}) {
  return vi.spyOn(api, "get").mockResolvedValue({ ...SWEEP, ...over } as never);
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("the denominator", () => {
  it("says how many pairs were tested, not only how many survived", async () => {
    serve();
    render(<WhatTheSweepDid runId="drun_1" />);
    expect(await screen.findByText(/45 pairs considered/)).toBeTruthy();
    expect(screen.getByText(/12 tested/)).toBeTruthy();
  });

  it("names the correction the survivors were judged against", async () => {
    serve();
    render(<WhatTheSweepDid runId="drun_1" />);
    expect(await screen.findByText(/benjamini hochberg/)).toBeTruthy();
    expect(screen.getByText(/false discovery rate of 0.05/)).toBeTruthy();
  });

  it("says why the number matters, rather than leaving it to be inferred", async () => {
    /*
     * A result that survives four tests and one that survives forty are not
     * the same result, and a reader shown only the survivors cannot tell which
     * they are looking at.
     */
    serve();
    render(<WhatTheSweepDid runId="drun_1" />);
    expect(await screen.findByText(/worth less in a larger family/)).toBeTruthy();
  });

  it("does not invent a correction that was not recorded", async () => {
    // An older run may carry no method. Naming one would attribute a
    // correction nobody applied.
    serve({ correction_method: null, false_discovery_rate: null });
    render(<WhatTheSweepDid runId="drun_1" />);
    await screen.findByText(/45 pairs considered/);
    expect(screen.queryByText(/corrected together/)).toBeNull();
  });
});

describe("columns that were never candidates", () => {
  it("names each one and why it was dropped", async () => {
    serve();
    render(<WhatTheSweepDid runId="drun_1" />);
    expect(await screen.findByText("constant_col")).toBeTruthy();
    expect(screen.getByText("every value is the same")).toBeTruthy();
    expect(screen.getByText("patient_id")).toBeTruthy();
  });

  it("says they were dropped before any test ran", async () => {
    // Reporting them beside failures would inflate what was actually tried.
    serve();
    render(<WhatTheSweepDid runId="drun_1" />);
    expect(await screen.findByText(/no pair involving them was ever a candidate/))
      .toBeTruthy();
  });

  it("still names the columns when a run recorded them as a bare list", () => {
    // Older runs stored a list. The column is the part a researcher acts on,
    // so it is shown rather than dropped for being the wrong shape.
    expect(exclusions(["a", "b"])).toEqual([["a", ""], ["b", ""]]);
    expect(exclusions({ a: "constant" })).toEqual([["a", "constant"]]);
    expect(exclusions(null)).toEqual([]);
  });

  it("shows no heading when nothing was dropped", async () => {
    serve({ exclusion_reasons: {}, candidates_excluded: 0 });
    render(<WhatTheSweepDid runId="drun_1" />);
    await screen.findByText(/45 pairs considered/);
    expect(screen.queryByText(/Columns not searched/)).toBeNull();
  });
});

describe("a run that has not finished", () => {
  it("does not report a half-written denominator as a finished search", async () => {
    /*
     * A partial count reads as a search that tested very little, which is a
     * claim about the evidence rather than about the clock.
     */
    serve({ status: "running", tests_run: 2, candidates_considered: 45 });
    render(<WhatTheSweepDid runId="drun_1" />);
    expect(await screen.findByText(/still running/)).toBeTruthy();
    expect(screen.queryByText(/2 tested/)).toBeNull();
  });

  it("says what stopped it when it failed", async () => {
    serve({ status: "failed", error: "The dataset version disappeared." });
    render(<WhatTheSweepDid runId="drun_1" />);
    expect(await screen.findByText(/The dataset version disappeared/)).toBeTruthy();
  });

  it("asks the server for the run it was given", async () => {
    const get = serve();
    render(<WhatTheSweepDid runId="drun_7" />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/discoveries/drun_7"));
  });
});
