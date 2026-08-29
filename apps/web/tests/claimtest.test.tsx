/**
 * The claim test screen.
 *
 * The backend is careful to distinguish "checked and passed" from "not
 * checked", because merging them is a lie by omission about the system's own
 * diligence. That distinction is only worth anything if it survives to the
 * screen, and it is exactly the kind of thing that gets flattened by a
 * well-meaning simplification of a ternary.
 *
 * So the tests here are about which of the four steps is marked, with what, and
 * whether the paper's words are ever paraphrased.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { ClaimTest } from "@/components/claimtest";
import { api } from "@/lib/api";

const paper = {
  id: "src_paper", title: "consumption_resistance.md",
  ingestion_status: "ready", dataset: null,
} as never;

const dataset = {
  id: "src_data", title: "amr_surveillance.csv", ingestion_status: "ready",
  dataset: { dataset_version_id: "dsv_1", row_count: 160, column_count: 4 },
} as never;

describe("choosing a paper", () => {
  it("asks for both a paper and a dataset before offering anything", () => {
    render(<ClaimTest projectId="prj" sources={[paper]} />);

    expect(screen.getByText(/A paper and a dataset are needed/)).toBeVisible();
  });

  it("says plainly that a refusal is the point", () => {
    render(<ClaimTest projectId="prj" sources={[paper]} />);

    expect(screen.getByText(/says plainly when it could not/)).toBeVisible();
  });

  it("lists only papers as papers", () => {
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);

    expect(screen.getByText("consumption_resistance.md")).toBeVisible();
    expect(screen.queryByText("amr_surveillance.csv")).toBeNull();
  });
});

describe("located claims", () => {
  const located = {
    source_title: "consumption_resistance.md",
    model: "qwen2.5:7b-instruct",
    prompt: "locate_claims v1",
    note: "",
    claims: [{
      claim_id: "clm_1",
      statement: "Antibiotic consumption is positively associated with "
        + "resistance prevalence (r = 0.72, p < 0.001).",
      exposure: "antibiotic consumption",
      outcome: "resistance prevalence",
      direction: "positive",
      claimed_design: "cross-sectional",
      source_id: "src_paper",
    }],
  };

  it("quotes the paper rather than paraphrasing it", async () => {
    // LAW 4. The statement is stored verbatim precisely so a verdict about it
    // can be checked against the source, and a summary here would break that.
    vi.mocked(api.post).mockResolvedValueOnce(located as never);
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);

    screen.getByText("consumption_resistance.md").click();

    const quote = await screen.findByText(new RegExp("r = 0\\.72"));
    expect(quote.tagName.toLowerCase()).toBe("blockquote");
  });

  it("attributes the reading to the model that made it", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(located as never);
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);

    screen.getByText("consumption_resistance.md").click();

    expect(await screen.findByText(/qwen2\.5:7b-instruct/)).toBeVisible();
    expect(screen.getByText(/they are not findings/)).toBeVisible();
  });

  it("reports a paper with no locatable claim rather than showing nothing", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      ...located, claims: [],
      note: "No testable empirical claim was found.",
    } as never);
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);

    screen.getByText("consumption_resistance.md").click();

    expect(await screen.findByText(/No testable claim found/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Reading the record before re-reading the paper
//
// Selecting a paper used to re-read it every time — a model call per
// selection, and, the part that matters, a reading that can quietly change the
// claims a comparison already rested on. `GET /sources/{id}/claims` exists for
// exactly this and had no caller: "reading the record and re-reading the paper
// are different acts, and only one of them can change what every downstream
// comparison rests on."
// ---------------------------------------------------------------------------

const STORED_CLAIM = {
  claim_id: "clm_1",
  statement: "Higher consumption is associated with higher resistance.",
  exposure: "consumption_ddd",
  outcome: "resistance_pct",
  direction: "positive",
  claimed_design: "cross-sectional",
  model: "claude-3",
  prompt_name: "locate_claims",
  prompt_version: 4,
};

async function pick() {
  render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
  const choice = await screen.findByText("consumption_resistance.md");
  fireEvent.click(choice);
}

describe("what the paper already says", () => {
  beforeEach(() => { vi.mocked(api.get).mockReset(); vi.mocked(api.post).mockReset(); });

  it("shows the recorded claims without asking a model", async () => {
    vi.mocked(api.get).mockResolvedValue(
      { source_id: "src_paper", claims: [STORED_CLAIM] } as never);
    await pick();

    expect(await screen.findByText(/Higher consumption is associated/)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("names the model that read it, because two readings can disagree", async () => {
    /*
     * A different model, or the same one at a different prompt, locates
     * different claims. When two readings disagree the difference has to be
     * attributable rather than argued about.
     */
    vi.mocked(api.get).mockResolvedValue(
      { source_id: "src_paper", claims: [STORED_CLAIM] } as never);
    await pick();

    // In the note about the record specifically: the model is shown elsewhere
    // too, and matching either would not prove this reading was attributed.
    const note = (await screen.findByText(/Read once already/)).closest("p")!;
    expect(note.textContent).toContain("claude-3");
    expect(note.textContent).toContain("locate_claims v4");
  });

  it("says what re-reading would cost, beside the button that does it", async () => {
    // Not that it costs money — that anything already tested against these
    // claims rested on this reading.
    vi.mocked(api.get).mockResolvedValue(
      { source_id: "src_paper", claims: [STORED_CLAIM] } as never);
    await pick();

    expect(await screen.findByText(/rested on this reading/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Read it again/ })).toBeTruthy();
  });

  it("re-reads only when asked", async () => {
    vi.mocked(api.get).mockResolvedValue(
      { source_id: "src_paper", claims: [STORED_CLAIM] } as never);
    vi.mocked(api.post).mockResolvedValue(
      { source_title: "p", claims: [STORED_CLAIM], note: "", model: "claude-3",
        prompt: "locate_claims v4" } as never);
    await pick();

    fireEvent.click(await screen.findByRole("button", { name: /Read it again/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/api/sources/src_paper/claims?project_id=prj", {}));
  });

  it("reads a paper nobody has read, without making it a second step", async () => {
    // There is nothing to show, and reading it is plainly what choosing it
    // meant.
    vi.mocked(api.get).mockResolvedValue(
      { source_id: "src_paper", claims: [] } as never);
    vi.mocked(api.post).mockResolvedValue(
      { source_title: "p", claims: [STORED_CLAIM], note: "", model: "claude-3",
        prompt: "locate_claims v4" } as never);
    await pick();

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    // And it is not then labelled as a record of an earlier reading.
    expect(screen.queryByText(/Read once already/)).toBeNull();
  });

  it("reads the paper when there is no record to read", async () => {
    // A 404 is the ordinary answer for a paper nobody has read, not a failure
    // worth showing.
    vi.mocked(api.get).mockRejectedValue(new Error("404"));
    vi.mocked(api.post).mockResolvedValue(
      { source_title: "p", claims: [STORED_CLAIM], note: "", model: "m",
        prompt: "p v1" } as never);
    await pick();

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(screen.queryByText(/could not/i)).toBeNull();
  });
});
