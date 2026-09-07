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
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

import { ClaimTest } from "@/components/claimtest";
import { api } from "@/lib/api";

/*
 * Reset before every test in this file, not only inside one block.
 *
 * The mocks here are module-level and some are set with `mockResolvedValue`
 * rather than `mockResolvedValueOnce`, so they persist until something clears
 * them. Only the third block cleared them, and only before its own tests — so
 * these tests passed because of the order they are written in.
 *
 * The failure that hides behind that is specific rather than cosmetic. The
 * stored-claims block mocks `api.get` to return a recorded reading; with that
 * mock still installed, the "located claims" tests take the *read the record*
 * path instead of the *re-read the paper* path, render the stored claim, and
 * never post at all. Those are two different acts — the whole point of the
 * block below — so a test that silently exercises the wrong one is worse than
 * a failing one.
 *
 * Reproduced with `--sequence.shuffle.tests --sequence.seed=3`: three failures,
 * all in "located claims", every one of them the stored reading appearing
 * where the fresh one belonged.
 */
beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.put).mockReset();
});

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


/**
 * Recording what the dataset is a study of.
 *
 * The backend refuses at the design step whenever a dataset's `study_design`
 * is unrecorded — which, until the route behind this form existed, was every
 * dataset the product could produce: ingestion writes rows and columns and
 * nothing writes the study context. The refusal's own remedy is "Record the
 * study design and this check will run", so the control has to be *on this
 * screen*, attached to that refusal. A remedy that sends a researcher
 * elsewhere is a remedy most researchers do not carry out.
 */
describe("recording what the dataset observes", () => {
  const claim = {
    claim_id: "clm_1",
    statement: "Consumption is associated with resistance.",
    exposure: "antibiotic_consumption",
    outcome: "resistance_prevalence",
    direction: "positive",
    claimed_design: "cross_sectional",
    source_id: "src_paper",
  };

  const refusedForDesign = {
    verdict: {
      outcome: "D14", outcome_name: "Design unstated",
      family: "undetermined", family_label: "Undetermined", tone: "neutral",
      sentence: "amr_surveillance.csv's study design is not recorded.",
      guidance: "Record it and this check will run.",
      reason_code: "design_unstated", confidence: 0.9,
      evidence_refs: [], transform_log: [], caveats: [],
      remedies: ["Record the study design and this check will run."],
      still_possible: [], state: "complete", method: "deterministic",
      pair: "claim ↔ dataset",
    },
    claim,
    dataset: { id: "dsv_1", name: "amr_surveillance.csv", design: "unknown",
               rows: 160 },
    testable: false,
    exposure_column: "ddd",
    outcome_column: "res_pct",
    unchecked: [],
  };

  async function refuse(result: unknown = refusedForDesign) {
    vi.mocked(api.get).mockResolvedValue(
      { source_id: "src_paper", claims: [claim] } as never);
    vi.mocked(api.post).mockResolvedValue(result as never);
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
    fireEvent.click(await screen.findByText("consumption_resistance.md"));
    fireEvent.click(await screen.findByRole("button",
      { name: "amr_surveillance.csv" }));
    await screen.findByText(/study design is not recorded/);
  }

  it("offers the control from the refusal that asked for it", async () => {
    await refuse();

    expect(await screen.findByRole("button",
      { name: /Record amr_surveillance\.csv's study design/ })).toBeVisible();
  });

  it("does not offer it when the design is already on record", async () => {
    await refuse({
      ...refusedForDesign,
      verdict: { ...refusedForDesign.verdict, outcome: "P9",
                 sentence: "amr_surveillance.csv's study design is not recorded." },
      dataset: { ...refusedForDesign.dataset, design: "cross_sectional" },
    });

    expect(screen.queryByRole("button", { name: /^Record / })).toBeNull();
  });

  it("asks the paper's side of a scope gap of the paper, not of the data",
     async () => {
    // "not recorded on the paper." means the dataset already states its
    // population. Offering to record the dataset's would send the researcher
    // to fix the half that is not broken.
    await refuse({
      ...refusedForDesign,
      dataset: { ...refusedForDesign.dataset, design: "cross_sectional" },
      unchecked: ["Population scope was not checked — it is not recorded on "
                  + "the paper."],
    });

    expect(screen.queryByRole("button", { name: /^Record / })).toBeNull();
  });

  it("records what was typed and tests again with it", async () => {
    await refuse();

    // The designs come from the server, so the picker cannot offer a value the
    // comparison would reject.
    vi.mocked(api.get).mockResolvedValue({
      study_design: "unknown", population: "", period_start: null,
      period_end: null, designs: ["cohort", "cross_sectional"],
    } as never);
    fireEvent.click(await screen.findByRole("button", { name: /^Record / }));

    const select = await screen.findByLabelText("Study design");
    await waitFor(() => expect(
      screen.getByRole("option", { name: "cohort" })).toBeVisible());
    fireEvent.change(select, { target: { value: "cohort" } });
    fireEvent.change(screen.getByLabelText("Population observed"),
                     { target: { value: "Danish adults" } });

    vi.mocked(api.put).mockResolvedValue({} as never);
    fireEvent.click(screen.getByRole("button", { name: /Record and test again/ }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      "/api/dataset-versions/dsv_1/study-context",
      { study_design: "cohort", population: "Danish adults",
        period_start: null, period_end: null }));
    // And the claim is put back through the check, rather than leaving the
    // researcher looking at the refusal they just answered.
    await waitFor(() => expect(vi.mocked(api.post).mock.calls.filter(
      (c) => String(c[0]).endsWith("/claim-test")).length).toBe(2));
  });

  it("says an empty field is recorded as not stated", async () => {
    await refuse();
    vi.mocked(api.get).mockResolvedValue({
      study_design: "unknown", population: "", period_start: null,
      period_end: null, designs: ["cohort"],
    } as never);
    fireEvent.click(await screen.findByRole("button", { name: /^Record / }));

    expect(await screen.findByText(/never that they passed/)).toBeVisible();
  });
});
