/**
 * The count of looks, shown to the person who took them.
 *
 * This is the uncomfortable number on purpose: the same result is worth less
 * after twenty tests than after one, and a system that kept reporting the first
 * figure would flatter the researcher exactly where it should not. What is
 * tested here is that the discomfort arrives without becoming a scold, and that
 * none of the four different reasons a test can end up uncorrected are
 * collapsed into each other.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ExplorationLedger } from "@/components/ledger";
import * as useApiModule from "@/lib/useApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function serve(data: unknown, extra: Record<string, unknown> = {}) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue({
    data, error: null, loading: false, reload: vi.fn(), ...extra,
  } as never);
}

const BUSY = {
  session_id: "ses_1",
  looks: 24,
  family_size: 21,
  confirmatory: 1,
  uncorrectable: 2,
  surviving: 3,
  note: "24 looks at the data in this session.",
  tests: [
    { id: "t1", verb: "discovery", description: "consumption × resistance",
      p_value: 0.0004, confirmatory: false, q_value: 0.0084, survives: true },
    { id: "t2", verb: "claim_test", description: "the paper's claim",
      p_value: 0.04, confirmatory: false, q_value: 0.42, survives: false },
    { id: "t3", verb: "compatibility", description: "refused: no shared measure",
      p_value: null, confirmatory: false, q_value: null, survives: null },
    { id: "t4", verb: "claim_test", description: "registered beforehand",
      p_value: 0.03, confirmatory: true, q_value: null, survives: null },
  ],
};

describe("the cost of having looked", () => {
  it("shows how many looks and how many were corrected together", () => {
    serve(BUSY);
    render(<ExplorationLedger projectId="prj_1" sessionId="ses_1" />);

    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("corrected together")).toBeInTheDocument();
  });

  it("distinguishes the four reasons a test can end up uncorrected", () => {
    /**
     * Survives, held back, pre-registered and not correctable are different
     * facts. Collapsing any two of them loses the reason, which is the only
     * part a researcher can act on.
     */
    serve(BUSY);
    render(<ExplorationLedger projectId="prj_1" sessionId="ses_1" />);

    // Scoped to the table: "pre-registered" is also a summary count above it,
    // and an unscoped query would pass on the summary while the per-test
    // outcome column was wrong.
    const rows = within(screen.getByRole("table"));
    expect(rows.getByText("survives")).toBeInTheDocument();
    expect(rows.getByText("held back")).toBeInTheDocument();
    expect(rows.getByText("pre-registered")).toBeInTheDocument();
    expect(rows.getByText("not correctable")).toBeInTheDocument();
  });

  it("writes a missing p-value as an em dash, never as zero", () => {
    /** A zero would be read as a p-value of zero, which is a strong claim. */
    serve(BUSY);
    render(<ExplorationLedger projectId="prj_1" sessionId="ses_1" />);

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("counts the looks that produced no statistic", () => {
    /** Dropping them is how a family of twenty gets reported as four. */
    serve(BUSY);
    render(<ExplorationLedger projectId="prj_1" sessionId="ses_1" />);

    expect(screen.getByText("no test statistic")).toBeInTheDocument();
  });

  it("does not scold", () => {
    /**
     * Exploration is not misconduct — looking is how research works, and the
     * dishonest version is looking without counting. A screen that warns gets
     * closed; a screen that counts gets read.
     */
    serve(BUSY);
    const { container } = render(
      <ExplorationLedger projectId="prj_1" sessionId="ses_1" />);

    const text = container.textContent?.toLowerCase() ?? "";
    for (const word of ["warning", "too many", "excessive", "caution"]) {
      expect(text).not.toContain(word);
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("when there is nothing to count", () => {
  it("says the first result needs no correction", () => {
    serve({ ...BUSY, looks: 0, tests: [], family_size: 0, surviving: 0,
            confirmatory: 0, uncorrectable: 0 });
    render(<ExplorationLedger projectId="prj_1" sessionId="ses_1" />);

    expect(screen.getByText(/The twentieth does/)).toBeInTheDocument();
  });

  it("explains a browser that cannot store a session rather than showing zero", () => {
    /**
     * Private windows refuse storage. A zero would read as "you have not tested
     * anything", which is a different and wrong statement.
     */
    serve(null);
    render(<ExplorationLedger projectId="prj_1" sessionId={null} />);

    expect(screen.getByText(/not counting looks/)).toBeInTheDocument();
    expect(screen.getByText(/corrected within each run/)).toBeInTheDocument();
  });
});

describe("loading and failure", () => {
  it("says what it is counting", () => {
    serve(null, { loading: true });
    render(<ExplorationLedger projectId="prj_1" sessionId="ses_1" />);
    expect(screen.getByText(/Counting this session/)).toBeInTheDocument();
  });

  it("reports a failure rather than an empty session", () => {
    /** An empty ledger reads as "you have looked once"; the truth is nobody could count. */
    serve(null, { error: new Error("unreachable"), loading: false });
    render(<ExplorationLedger projectId="prj_1" sessionId="ses_1" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing tested yet/)).not.toBeInTheDocument();
  });
});
