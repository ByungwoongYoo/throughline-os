/**
 * "Take it further" on a finding (plan §4.6.1, Slice 2 item 2.5).
 *
 * The finding detail could do neither of the two things this product exists to
 * do with a finding, while both capabilities sat built and reachable from
 * screens keyed on other objects. Two of these tests are therefore about a
 * *presence* — that both controls are on the object — which is exactly the kind
 * of defect no unit test caught for as long as every unit was right.
 *
 * The third is about the refusal. Principle 7 says an empty downstream slot is
 * an offer or a stated reason and never an absence, and the failure it guards
 * against is the cheap one: rendering nothing when the finding has no tested
 * connection, so a reader cannot tell "there is nothing to draft from" apart
 * from "this screen did not finish loading".
 *
 * The API is stubbed at `fetch` and answers by path, as `workspace-flow.test.tsx`
 * does, because the point of the drafting test is that the *pair* of requests
 * `draftReport` makes both go out — a spy on `api.post` would pass just as
 * happily on a component that had copied only the first one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DraftableConnection, TakeItFurther } from "@/components/takeitfurther";

const TESTED: DraftableConnection = {
  id: "con_1", analysis_run_id: "arun_1",
  left_variable: "consumption_ddd", right_variable: "resistance_pct",
};

const UNTESTED: DraftableConnection = {
  id: "con_2", analysis_run_id: null,
  left_variable: "rainfall", right_variable: "resistance_pct",
};

type Answer = unknown | ((url: string, init?: RequestInit) => unknown);

/** Answers by path; anything unstubbed 404s, so a stray request is visible. */
function serve(routes: Record<string, Answer>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace(/^https?:\/\/[^/]+/, "");
      const path = url.split("?")[0];
      calls.push(`${init?.method ?? "GET"} ${path}`);
      const answer = routes[path];
      if (answer === undefined) {
        return {
          ok: false, status: 404,
          text: async () => JSON.stringify({ detail: `not stubbed: ${path}` }),
        } as Response;
      }
      const value = typeof answer === "function" ? answer(url, init) : answer;
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify(value), json: async () => value,
      } as Response;
    });
  return calls;
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(cleanup);

describe("both ways out of a finding", () => {
  it("offers the figure and the report when the finding has a run and a tested connection", async () => {
    // The whole item in one assertion: before this card, the finding detail
    // offered a library note preview and nothing else.
    serve({});
    render(<TakeItFurther projectId="prj_1" findingId="fnd_1"
                          analysisRunId="arun_1" connection={TESTED}
                          onDrafted={() => {}} />);

    expect(screen.getByRole("button", { name: /Export for publication/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Draft a report from this finding/ }))
      .toBeTruthy();
  });

  it("records the figure against this finding, not only against the run", async () => {
    /*
     * `publish.tsx` has declared `findingId` and passed it to `POST /visuals`
     * since it was written, and no caller ever supplied one — a prop with
     * nowhere to land, on the highest-value object. This is the caller.
     */
    const calls = serve({
      "/api/projects/prj_1/visuals": { visual_id: "vis_1", publishable: true,
                                       critique: { publishable: true, critiques: [] } },
    });
    render(<TakeItFurther projectId="prj_1" findingId="fnd_1"
                          analysisRunId="arun_1" connection={TESTED}
                          onDrafted={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /Export for publication/ }));
    await waitFor(() => expect(calls).toContain("POST /api/projects/prj_1/visuals"));

    const body = JSON.parse(
      String((vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1] as RequestInit).body));
    expect(body).toMatchObject({ analysis_run_id: "arun_1", finding_id: "fnd_1" });
  });
});

describe("drafting a report from the finding", () => {
  it("drafts and checks the citations, through the one shared routine", async () => {
    /*
     * Two requests, not one. A caller that copied only the draft would produce
     * a report that looked drafted and was never checked, and the export gate
     * on the Reports screen reads that check's verdict — so the document would
     * arrive unexportable with nothing on screen saying why.
     */
    const calls = serve({
      "/api/projects/prj_1/artifacts/draft": { artifact_id: "art_9" },
      "/api/artifacts/art_9/check-citations": { ok: true },
    });
    render(<TakeItFurther projectId="prj_1" findingId="fnd_1"
                          analysisRunId="arun_1" connection={TESTED}
                          onDrafted={() => {}} />);

    await userEvent.click(
      screen.getByRole("button", { name: /Draft a report from this finding/ }));

    await waitFor(() => expect(calls).toEqual([
      "POST /api/projects/prj_1/artifacts/draft",
      "POST /api/artifacts/art_9/check-citations",
    ]));
  });

  it("opens the report it just made", async () => {
    // Creating a document and staying on the finding is how a button comes to
    // look broken: the work happened and nothing on screen changed.
    serve({
      "/api/projects/prj_1/artifacts/draft": { artifact_id: "art_9" },
      "/api/artifacts/art_9/check-citations": { ok: true },
    });
    const drafted = vi.fn();
    render(<TakeItFurther projectId="prj_1" findingId="fnd_1"
                          analysisRunId="arun_1" connection={TESTED}
                          onDrafted={drafted} />);

    await userEvent.click(
      screen.getByRole("button", { name: /Draft a report from this finding/ }));
    await waitFor(() => expect(drafted).toHaveBeenCalledWith("art_9"));
  });

  it("says what the server said when it refuses, and opens nothing", async () => {
    // §104. A refusal that reads "something went wrong" tells the researcher
    // nothing and tells whoever they report it to less.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false, status: 400,
      text: async () => JSON.stringify({ detail: "That connection has no result to cite." }),
    } as Response);
    const drafted = vi.fn();
    render(<TakeItFurther projectId="prj_1" findingId="fnd_1"
                          analysisRunId="arun_1" connection={TESTED}
                          onDrafted={drafted} />);

    await userEvent.click(
      screen.getByRole("button", { name: /Draft a report from this finding/ }));
    expect(await screen.findByText(/no result to cite/)).toBeTruthy();
    expect(drafted).not.toHaveBeenCalled();
  });
});

describe("where a capability cannot act, it says so in place", () => {
  it("states why no report can be drafted from an untested connection", async () => {
    // Principle 7: an empty downstream slot is a stated reason, never an
    // absence. `canDraftReport` is asked here rather than assumed of the
    // caller, so a caller that stops filtering cannot produce a control that
    // posts a draft the server will reject.
    serve({});
    render(<TakeItFurther projectId="prj_1" findingId="fnd_1"
                          analysisRunId="arun_1" connection={UNTESTED}
                          onDrafted={() => {}} />);

    expect(screen.queryByRole("button", { name: /Draft a report/ })).toBeNull();
    expect(screen.getByText(/no recorded analysis run/)).toBeTruthy();
    expect(screen.getByText(/written from something that was tested/)).toBeTruthy();
  });

  it("states why there is nothing to draft when no connection came through at all", async () => {
    serve({});
    render(<TakeItFurther projectId="prj_1" findingId="fnd_1"
                          analysisRunId="arun_1" connection={null}
                          onDrafted={() => {}} />);

    expect(screen.getByText(/no result for a report to cite/)).toBeTruthy();
  });

  it("states why there is no figure when the finding has no run", async () => {
    /*
     * A finding written by hand carries no analysis. Rendering the export
     * control anyway would offer a figure recorded against nothing, which is
     * the DOM-export failure the whole publish path exists to prevent.
     */
    serve({});
    render(<TakeItFurther projectId="prj_1" findingId="fnd_1"
                          analysisRunId={null} connection={TESTED}
                          onDrafted={() => {}} />);

    expect(screen.queryByRole("button", { name: /Export for publication/ })).toBeNull();
    expect(screen.getByText(/No analysis run is attached to this finding/)).toBeTruthy();
    // And the other half of the card is unaffected — one missing input does
    // not take the whole offer away.
    expect(screen.getByRole("button", { name: /Draft a report from this finding/ }))
      .toBeTruthy();
  });
});
