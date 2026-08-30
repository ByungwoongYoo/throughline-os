/**
 * The count of looks, shown to the person who took them.
 *
 * This is the uncomfortable number on purpose: the same result is worth less
 * after twenty tests than after one, and a system that kept reporting the first
 * figure would flatter the researcher exactly where it should not. What is
 * tested here is that the discomfort arrives without becoming a scold, that
 * none of the four different reasons a test can end up uncorrected are
 * collapsed into each other, and — new, and the reason this screen changed —
 * that the family being corrected is *visible*, *named*, and does not vanish
 * when the tab does.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExplorationLedger } from "@/components/ledger";
import * as useApiModule from "@/lib/useApi";
import * as enquiryModule from "@/lib/enquiry";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const OPEN_ENQUIRY = {
  id: "enq_1",
  project_id: "prj_1",
  name: "Does rainfall predict yield?",
  opened_at: "2026-08-30T09:00:00Z",
  closed_at: null,
  closed_why: null,
  looks: 24,
};

function serve(data: unknown, extra: Record<string, unknown> = {}) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue({
    data, error: null, loading: false, reload: vi.fn(), ...extra,
  } as never);
}

/** The family resolves from the server, not from the browser. */
function withEnquiry(enquiry: unknown = OPEN_ENQUIRY) {
  vi.spyOn(enquiryModule, "currentEnquiry").mockResolvedValue(enquiry as never);
  return enquiry;
}

const BUSY = {
  enquiry_id: "enq_1",
  looks: 24,
  family_size: 21,
  confirmatory: 1,
  uncorrectable: 2,
  surviving: 3,
  note: "24 looks at the data in this line of enquiry.",
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
  it("shows how many looks and how many were corrected together", async () => {
    withEnquiry();
    serve(BUSY);
    render(<ExplorationLedger projectId="prj_1" />);

    expect(await screen.findByText("24")).toBeInTheDocument();
    expect(screen.getByText("corrected together")).toBeInTheDocument();
  });

  it("distinguishes the four reasons a test can end up uncorrected", async () => {
    /**
     * Survives, held back, pre-registered and not correctable are different
     * facts. Collapsing any two of them loses the reason, which is the only
     * part a researcher can act on.
     */
    withEnquiry();
    serve(BUSY);
    render(<ExplorationLedger projectId="prj_1" />);

    const table = await screen.findByRole("table");
    const body = within(table);
    expect(body.getByText("survives")).toBeInTheDocument();
    expect(body.getByText("held back")).toBeInTheDocument();
    expect(body.getByText("pre-registered")).toBeInTheDocument();
    expect(body.getByText("not correctable")).toBeInTheDocument();
  });

  it("counts the looks that produced nothing", async () => {
    /** Dropping them is how a family of twenty gets reported as four. */
    withEnquiry();
    serve(BUSY);
    render(<ExplorationLedger projectId="prj_1" />);

    expect(await screen.findByText("no test statistic")).toBeInTheDocument();
  });

  it("does not scold", async () => {
    /**
     * Exploration is not misconduct. A screen that warns gets closed; a screen
     * that counts gets read.
     */
    withEnquiry();
    serve(BUSY);
    const { container } = render(<ExplorationLedger projectId="prj_1" />);

    await screen.findByRole("table");
    expect(container.textContent).not.toMatch(/too many|warning|excessive|careful/i);
  });
});

describe("the family is visible", () => {
  it("names the line of enquiry being corrected", async () => {
    /**
     * The whole reason this screen changed. The family used to be a UUID in
     * `sessionStorage` — a researcher could not see what was being corrected
     * together, so they could not tell us it was wrong.
     */
    withEnquiry();
    serve(BUSY);
    render(<ExplorationLedger projectId="prj_1" />);

    expect(await screen.findByText("Does rainfall predict yield?")).toBeInTheDocument();
  });

  it("lets a researcher name the question", async () => {
    withEnquiry();
    serve(BUSY);
    const rename = vi.spyOn(enquiryModule, "renameEnquiry")
      .mockResolvedValue({ ...OPEN_ENQUIRY, name: "Rainfall and yield" } as never);
    render(<ExplorationLedger projectId="prj_1" />);

    await userEvent.click(await screen.findByText("Does rainfall predict yield?"));
    const field = screen.getByLabelText(/Name this line of enquiry/);
    await userEvent.clear(field);
    await userEvent.type(field, "Rainfall and yield");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(rename).toHaveBeenCalledWith("prj_1", "enq_1", "Rainfall and yield");
  });

  it("can start a new family, which is what bounds the correction", async () => {
    /**
     * This used to happen by accident when a tab closed. Making it deliberate
     * is what lets the ledger distinguish an ending that was chosen from one
     * that was assumed.
     */
    withEnquiry();
    serve(BUSY);
    const opened = vi.spyOn(enquiryModule, "openEnquiry")
      .mockResolvedValue({ ...OPEN_ENQUIRY, id: "enq_2", name: "New", looks: 0 } as never);
    render(<ExplorationLedger projectId="prj_1" />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Start a new line of enquiry/ }));

    expect(opened).toHaveBeenCalledWith("prj_1");
  });

  it("reaches the work that used to disappear with the tab", async () => {
    /**
     * These rows were always in the database. Nothing could read them, because
     * the only key was an identifier a closed tab had taken with it.
     */
    withEnquiry();
    serve(BUSY);
    vi.spyOn(enquiryModule, "listEnquiries").mockResolvedValue([
      OPEN_ENQUIRY,
      { ...OPEN_ENQUIRY, id: "enq_0", name: "Last month's question",
        closed_at: "2026-07-02T10:00:00Z", closed_why: "idle", looks: 9 },
    ] as never);
    render(<ExplorationLedger projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Earlier work" }));

    expect(await screen.findByText("Last month's question")).toBeInTheDocument();
    expect(screen.getByText("9 looks")).toBeInTheDocument();
  });

  it("says when an ending was assumed rather than chosen", async () => {
    /**
     * §123. An idle close is an inference we made on the researcher's behalf,
     * and a reader of the ledger needs to be able to discount it.
     */
    withEnquiry();
    serve(BUSY);
    vi.spyOn(enquiryModule, "listEnquiries").mockResolvedValue([
      OPEN_ENQUIRY,
      { ...OPEN_ENQUIRY, id: "enq_0", name: "Abandoned",
        closed_at: "2026-07-02T10:00:00Z", closed_why: "idle", looks: 2 },
    ] as never);
    render(<ExplorationLedger projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Earlier work" }));

    expect(await screen.findByText(/Closed automatically/)).toBeInTheDocument();
  });
});

describe("loading and failure", () => {
  it("says what it is counting", async () => {
    withEnquiry();
    serve(null, { loading: true });
    render(<ExplorationLedger projectId="prj_1" />);
    expect(await screen.findByText(/Counting the tests/)).toBeInTheDocument();
  });

  it("reports a failure rather than an empty line of enquiry", async () => {
    /** An empty ledger reads as "you have looked once"; the truth is nobody could count. */
    withEnquiry();
    serve(null, { error: new Error("unreachable"), loading: false });
    render(<ExplorationLedger projectId="prj_1" />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing tested yet/)).not.toBeInTheDocument();
  });

  it("reports a family it could not resolve, rather than counting from zero", async () => {
    /**
     * Replaces the old "this browser is not counting" state, which existed
     * because storage could be refused in a private window. The family no
     * longer lives in the browser, so that failure mode is gone — but the
     * server can still be unreachable, and a zero would read as "you have not
     * tested anything", which is a different and wrong statement.
     */
    vi.spyOn(enquiryModule, "currentEnquiry").mockRejectedValue(new Error("offline"));
    serve(BUSY);
    render(<ExplorationLedger projectId="prj_1" />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("24")).not.toBeInTheDocument();
  });
});
