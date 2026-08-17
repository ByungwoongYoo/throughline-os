/**
 * Disagreements between a project's own results (§55).
 *
 * The overview's Contradictions meter read from a table nothing ever wrote to,
 * so it showed zero for every project that has ever existed — and zero reads as
 * "nothing here disagrees" rather than "nobody checked".
 *
 * These tests are about the two ways displaying it could still mislead: drawing
 * an explanation nobody examined as though it had been ruled out, and letting a
 * contradiction be closed without a reason, which turns a scientific act into
 * clearing a badge.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Contradictions } from "@/components/contradictions";
import * as useApiModule from "@/lib/useApi";
import * as apiModule from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function serve(data: unknown, extra: Record<string, unknown> = {}) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue({
    data, error: null, loading: false, reload: vi.fn(), ...extra,
  } as never);
}

const ITEM = {
  id: "con_1",
  description: "use and resistance: one result is positive, the other is negative.",
  status: "open",
  resolved_note: "",
  left_ref_id: "con_a",
  right_ref_id: "con_b",
  explanations: [
    { rank: 1, code: "F10", state: "ruled_out",
      explanation: "Stale — a source changed since the run" },
    { rank: 2, code: "F8", state: "ruled_out",
      explanation: "Incommensurable — different lifecycle stage" },
    { rank: 3, code: "F7", state: "the_explanation",
      explanation: "Contradiction likely from your own multiplicity" },
  ],
};

const LEDGER = {
  contradictions: [ITEM],
  open: 1,
  note: "1 disagreement survived every check the record supports.",
};

describe("the meter that could never move", () => {
  it("shows a recorded disagreement", () => {
    serve(LEDGER);
    render(<Contradictions projectId="prj_1" />);

    expect(screen.getByText(/one result is positive/)).toBeInTheDocument();
  });

  it("says nobody has looked rather than that nothing disagrees", () => {
    /**
     * The original defect in one line. An empty table before a sweep means
     * nobody checked, and the reassuring reading was the one on screen for
     * every project that has ever existed.
     */
    serve({ contradictions: [], open: 0,
            note: "Nothing has been recorded here. That is only meaningful "
                  + "after a sweep has run — an empty list before then means "
                  + "nobody has looked, not that nothing disagrees." });
    render(<Contradictions projectId="prj_1" />);

    expect(screen.getByText(/nobody has looked/)).toBeInTheDocument();
  });

  it("offers the sweep rather than running it on load", () => {
    /** It compares every pair of results; a read should not write. */
    serve(LEDGER);
    const post = vi.spyOn(apiModule.api, "post").mockResolvedValue({} as never);
    render(<Contradictions projectId="prj_1" />);

    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Compare results now/ }));
    expect(post).toHaveBeenCalledWith(
      "/api/projects/prj_1/contradictions/sweep", {});
  });
});

describe("ruled out is not the same as never examined", () => {
  it("separates an unexamined explanation from an excluded one", () => {
    /**
     * The single most misleading thing this screen could do. The adjudicator
     * stops at the first check that fires, so anything below it was never
     * evaluated — and presenting that as excluded tells a researcher the
     * system considered a possibility it did not.
     */
    serve({
      ...LEDGER,
      contradictions: [{
        ...ITEM,
        explanations: [
          { rank: 1, code: "F10", state: "the_explanation",
            explanation: "Stale — a source changed since the run" },
          { rank: 2, code: "F8", state: "not_examined",
            explanation: "Incommensurable — different lifecycle stage" },
        ],
      }],
    });
    render(<Contradictions projectId="prj_1" />);

    expect(screen.getByText(/Not examined, because the explanation above/))
      .toBeInTheDocument();
    expect(screen.queryByText(/different lifecycle stage — checked/))
      .not.toBeInTheDocument();
  });

  it("marks the explanation that actually holds", () => {
    serve(LEDGER);
    render(<Contradictions projectId="prj_1" />);

    expect(screen.getByText(/this is the one that holds/)).toBeInTheDocument();
  });

  it("says an excluded explanation was actually checked", () => {
    serve(LEDGER);
    render(<Contradictions projectId="prj_1" />);

    expect(screen.getAllByText(/checked, does not apply/).length).toBe(2);
  });
});

describe("closing one is a scientific act", () => {
  it("will not close without a reason", () => {
    /**
     * A contradiction closed with a reason is research; one closed without is a
     * badge being cleared. A button that can be pressed and then fails teaches
     * people the reason is a formality.
     */
    serve(LEDGER);
    render(<Contradictions projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Close this" })).toBeDisabled();
  });

  it("closes with the reason once one is given", () => {
    serve(LEDGER);
    const post = vi.spyOn(apiModule.api, "post").mockResolvedValue({} as never);
    render(<Contradictions projectId="prj_1" />);

    fireEvent.change(screen.getByRole("textbox"),
                     { target: { value: "Both ran on the pre-correction extract." } });

    const button = screen.getByRole("button", { name: "Close this" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    expect(post).toHaveBeenCalledWith(
      "/api/projects/prj_1/contradictions/con_1",
      { status: "resolved", note: "Both ran on the pre-correction extract." });
  });

  it("shows the reason a closed one was closed", () => {
    serve({
      ...LEDGER, open: 0,
      contradictions: [{ ...ITEM, status: "resolved",
                         resolved_note: "Different pre-processing, now aligned." }],
    });
    render(<Contradictions projectId="prj_1" />);

    expect(screen.getByText(/Different pre-processing/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("restraint", () => {
  it("never offers to pick which result is right", () => {
    /**
     * A contradiction under multiplicity says how much looking produced these
     * results, not which to keep. A "use this one" control would be the
     * software inventing the most useful-looking answer.
     */
    serve(LEDGER);
    const { container } = render(<Contradictions projectId="prj_1" />);

    const text = container.textContent?.toLowerCase() ?? "";
    for (const phrase of ["use this one", "discard", "correct result",
                          "prefer"]) {
      expect(text).not.toContain(phrase);
    }
  });
});

describe("loading and failure", () => {
  it("says what it is reading", () => {
    serve(null, { loading: true });
    render(<Contradictions projectId="prj_1" />);
    expect(screen.getByText(/Reading recorded disagreements/)).toBeInTheDocument();
  });

  it("reports a failure rather than an empty ledger", () => {
    /** An empty ledger reads as "nothing disagrees" — the original defect. */
    serve(null, { error: new Error("unreachable"), loading: false });
    render(<Contradictions projectId="prj_1" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/nobody has looked/)).not.toBeInTheDocument();
  });
});
