/**
 * What a connection's screen says about whether it survived.
 *
 * `RecordFinding` takes a `validated` flag and, when it is false, says plainly
 * that the connection has not survived a validation run and will sit as a
 * candidate. That component is well tested. Its *caller* was not, and the
 * caller computed the flag from the wrong column.
 *
 * `validation.py` writes `status = 'complete'` whichever way a run goes and
 * records the verdict separately in `passed`, with a summary that begins "Did
 * not pass: " when it failed. Reading `status === "complete"` therefore meant
 * "a validation finished", not "the association survived one" — so a
 * connection whose robustness checks *failed* was presented as validated, and
 * the caveat was suppressed for exactly the results that most need it.
 *
 * The same screen already printed "violated" for that report a few lines
 * further down, so its two halves disagreed, and the one that disagreed in the
 * flattering direction sat next to the record button — which `recordfinding`
 * calls the single easiest place in the product to overclaim.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionDetail, settled } from "@/components/views";
import type { ValidationReport } from "@/lib/api";
import { ApiError, api } from "@/lib/api";

const CONNECTION = {
  id: "conn_1", left_variable: "consumption", right_variable: "resistance",
  method: "pearson_correlation", lifecycle_status: "exploratory",
  estimate: 0.81, p_value: 0.001, q_value: 0.01, effect_size: 0.81,
  effect_size_name: "r", sample_size: 120, evidence_quality: "moderate",
  analysis_run_id: "arun_1", dataset_version_id: "dsv_1",
  discovery_run_id: "drun_1", rank_score: 0.7, rank_components: {},
};

function report(over: Partial<ValidationReport> = {}): ValidationReport {
  return {
    id: "vrep_1", status: "complete", passed: true,
    summary: "All robustness checks passed; the association survived every test applied.",
    created_at: "2026-01-01T00:00:00Z", checks: {}, check_details: [], ...over,
  };
}

function serve(reports: ValidationReport[]) {
  return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.includes("/validations")) return reports as never;
    if (path.includes("/connections")) return [CONNECTION] as never;
    if (path.includes("/variables")) return { labels: {} } as never;
    if (path.includes("/columns")) return [] as never;
    if (path.includes("/plain-summary")) return null as never;
    // The run behind the connection. `assumption_checks` is always present on
    // the real route — `get_run` sets it unconditionally — and a fixture that
    // omits it takes the screen down before any assertion runs.
    if (path.match(/\/api\/analyses\/[^/]+$/)) {
      return { id: "arun_1", status: "completed", assumption_checks: [],
               result: {}, method: "pearson_correlation" } as never;
    }
    return [] as never;
  });
}

const CAVEAT = /has not survived a validation run yet/;

beforeEach(() => { vi.restoreAllMocks(); });

describe("whether the result survived", () => {
  it("keeps the caveat when validation ran and the checks failed", async () => {
    /*
     * The defect. `status` is "complete" for a failure too — the verdict is in
     * `passed` — so reading the status dropped the caveat precisely where it
     * was most needed.
     */
    serve([report({ passed: false, summary: "Did not pass: bootstrap_stability" })]);
    render(<ConnectionDetail connectionId="conn_1" projectId="prj_1" />);

    expect(await screen.findByText(CAVEAT)).toBeTruthy();
  });

  it("drops the caveat only when a validation actually passed", async () => {
    serve([report({ passed: true })]);
    render(<ConnectionDetail connectionId="conn_1" projectId="prj_1" />);

    await screen.findByRole("button", { name: /Record a finding/ });
    expect(screen.queryByText(CAVEAT)).toBeNull();
  });

  it("keeps the caveat while a validation is still running", async () => {
    // `passed` is null until the run finishes, and a validation in flight has
    // not survived anything yet.
    serve([report({ status: "running", passed: null })]);
    render(<ConnectionDetail connectionId="conn_1" projectId="prj_1" />);

    expect(await screen.findByText(CAVEAT)).toBeTruthy();
  });

  it("keeps the caveat when nothing has been validated at all", async () => {
    serve([]);
    render(<ConnectionDetail connectionId="conn_1" projectId="prj_1" />);

    expect(await screen.findByText(CAVEAT)).toBeTruthy();
  });

  it("treats one passed run among several as having survived", async () => {
    // A failed attempt followed by a passing one is a result that survived;
    // requiring every report to pass would punish re-running a check.
    serve([report({ id: "vrep_0", passed: false }), report({ passed: true })]);
    render(<ConnectionDetail connectionId="conn_1" projectId="prj_1" />);

    await screen.findByRole("button", { name: /Record a finding/ });
    expect(screen.queryByText(CAVEAT)).toBeNull();
  });

  it("says the report was violated where it lists it", async () => {
    /*
     * The half that was already right. Pinned so the two halves cannot drift
     * apart again in the other direction.
     */
    serve([report({ passed: false, summary: "Did not pass: bootstrap_stability" })]);
    render(<ConnectionDetail connectionId="conn_1" projectId="prj_1" />);

    await waitFor(() => expect(screen.getByText(/violated/)).toBeTruthy());
  });
});


// ---------------------------------------------------------------------------
// Waiting for the validation that was just asked for
// ---------------------------------------------------------------------------
//
// The wait asked "is any report not running", and the list holds every report
// a connection has ever had. So the *second* time anybody validated one, the
// old completed report answered yes on the first poll: two seconds later the
// spinner stopped and the screen reloaded showing the previous verdict while
// the new run was still going. If the new run went the other way, nobody would
// see it without reloading by hand.

const running = (id: string) =>
  report({ id, status: "running", passed: null, summary: "" });
const done = (id: string) => report({ id, passed: true });

describe("knowing the new validation has finished", () => {
  it("keeps waiting while an old report is complete and the new one runs", () => {
    // The defect, stated directly.
    expect(settled(["vrep_old"], [running("vrep_new"), done("vrep_old")], 0))
      .toBe(false);
  });

  it("does not treat a previous verdict as this one", () => {
    // Nothing new has appeared yet — the worker has not written the row.
    expect(settled(["vrep_old"], [done("vrep_old")], 0)).toBe(false);
  });

  it("finishes when a report that was not there before completes", () => {
    expect(settled(["vrep_old"], [done("vrep_new"), done("vrep_old")], 0))
      .toBe(true);
  });

  it("finishes the first time a connection is validated at all", () => {
    expect(settled([], [done("vrep_1")], 0)).toBe(true);
  });

  it("stops waiting for a run the server deduplicated away", () => {
    /*
     * A repeat of the same request is deduplicated by idempotency key, so no
     * new report will ever appear. Waiting for one would spin until the
     * timeout and then report nothing.
     */
    expect(settled(["vrep_old"], [done("vrep_old")], 2)).toBe(true);
  });

  it("does not call a run deduplicated while it is still going", () => {
    expect(settled(["vrep_old"], [running("vrep_old")], 9)).toBe(false);
  });
});

describe("the explanation behind an evidence grade", () => {
  /*
   * §47 grades evidence from the assumptions the method needed rather than
   * from the p-value, so an association can read r = 0.90 at q = 5e-66 and
   * still be graded weak. That is the screen's most confusing moment, and the
   * section explaining it is what stops a researcher distrusting the tool
   * instead of the result.
   *
   * It returned `null` when the request for those checks failed — the same
   * empty space it shows when nothing was violated. The two are opposite
   * answers rendered identically: one says the assumptions held, the other
   * says nobody knows. Silence is the answer this screen cannot give.
   */
  function serveWithRun(run: (path: string) => unknown) {
    return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
      if (path.includes("/validations")) return [] as never;
      if (path.includes("/connections")) return [CONNECTION] as never;
      if (path.includes("/variables")) return { labels: {} } as never;
      if (path.includes("/columns")) return [] as never;
      if (path.includes("/plain-summary")) return null as never;
      if (path.match(/\/api\/analyses\/[^/]+$/)) return run(path) as never;
      return [] as never;
    });
  }

  it("says the checks could not be read rather than showing nothing",
     async () => {
    serveWithRun(() => { throw new ApiError(503, "The analysis store is down."); });

    render(<ConnectionDetail connectionId="conn_1" projectId="proj_1" />);

    await waitFor(() =>
      expect(screen.getByText(/analysis store is down/)).toBeTruthy());
    // Recoverable, so the researcher is offered the retry.
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeTruthy();
  });

  it("stays silent when the checks were read and nothing was violated",
     async () => {
    // The other half: an empty space here must mean the assumptions held, and
    // it only means that if a failure looks different.
    serveWithRun(() => ({
      id: "arun_1", status: "completed", assumption_checks: [],
      result: {}, method: "pearson_correlation",
    }));

    render(<ConnectionDetail connectionId="conn_1" projectId="proj_1" />);

    // Waiting on the checks having *finished* loading, not merely on the page
    // appearing: asserting an absence before the request settles would pass
    // whatever the component then did.
    await waitFor(() =>
      expect(screen.queryByLabelText(/Reading the assumption checks/)).toBeNull());
    await waitFor(() => expect(screen.getAllByText(/consumption/).length)
      .toBeGreaterThan(0));
    expect(screen.queryByText(/Why the evidence is graded/)).toBeNull();
  });

  it("explains the grade when an assumption was violated", async () => {
    serveWithRun(() => ({
      id: "arun_1", status: "completed", method: "pearson_correlation",
      result: {},
      assumption_checks: [
        { name: "normality", outcome: "violated",
          detail: "The residuals are not normal." },
      ],
    }));

    render(<ConnectionDetail connectionId="conn_1" projectId="proj_1" />);

    await waitFor(() =>
      expect(screen.getByText(/Why the evidence is graded/)).toBeTruthy());
    expect(screen.getByText(/residuals are not normal/)).toBeTruthy();
  });
});
