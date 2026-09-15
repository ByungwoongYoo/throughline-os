/**
 * UI_01's one argument: whose words are these.
 *
 * The reasoning master is a layout claim about attribution. The left column is
 * the researcher's own reading, the right is a model's, and the middle is the
 * recorded claim that belongs to neither. Every failure this file guards
 * against looks fine on screen and is a lie about provenance.
 *
 * §09, in order: the human side is explicitly human and the model side is
 * explicitly model-generated with its stored-or-fresh status; a source quote
 * and a model paraphrase must not share an unlabelled quotation treatment; a
 * disabled next step explains why; the centre is not an autosaving text area
 * where no write contract exists; and dataset selection exposes the actual
 * version rather than a name alone.
 *
 * The last one is worth stating plainly: a claim tested against v1 and the
 * same claim tested against v2 are different results, and a screen that says
 * only "neighbourhood_indicators.csv" cannot tell a reader which happened.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

import { ClaimTest } from "@/components/claimtest";
import { api } from "@/lib/api";

const paper = {
  id: "src_paper", title: "heat_and_anxiety.pdf", ingestion_status: "ready",
  dataset: null, object_id: "obj_paper",
} as never;

/** The same paper before ingestion has given it a node in the graph. */
const unrecordedPaper = {
  id: "src_paper", title: "heat_and_anxiety.pdf", ingestion_status: "parsing",
  dataset: null, object_id: null,
} as never;

const dataset = {
  id: "src_data", title: "neighborhood_indicators.csv", ingestion_status: "ready",
  dataset: { dataset_version_id: "dsv_2", version: 2, row_count: 1248,
             column_count: 9 },
} as never;

const CLAIM = {
  claim_id: "clm_14",
  statement: "Higher night-time heat is associated with higher anxiety scores.",
  exposure: "night_heat_z",
  outcome: "anxiety_z",
  direction: "positive",
  claimed_design: "cross_sectional",
  locator: "p. 8, §3",
  source_id: "SRC-014",
};

const JOURNAL = {
  object: { id: "obj_paper", object_type: "paper", title: "heat_and_anxiety.pdf" },
  notes: [
    { id: "note_1", body: "Could income explain the association?",
      author_kind: "human", author: "chen", created_at: "2026-09-01T00:00:00Z" },
    { id: "note_2", body: "The paper reports an association, not causation.",
      author_kind: "model", author: "system", model: "qwen2.5:7b-instruct",
      prompt: "What does this paper establish?",
      created_at: "2026-09-01T00:01:00Z" },
  ],
};

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

/** The stored reading, and the paper's journal, both already on record. */
function onRecord() {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.includes("/claims")) {
      return Promise.resolve({ source_id: "src_paper", claims: [CLAIM] } as never);
    }
    if (path.includes("/journal")) return Promise.resolve(JOURNAL as never);
    return Promise.reject(new Error("unmocked"));
  });
}

function choosePaper() {
  fireEvent.change(screen.getAllByRole("combobox")[0],
                   { target: { value: "src_paper" } });
}

function chooseDataset() {
  fireEvent.change(screen.getAllByRole("combobox")[1],
                   { target: { value: "src_data" } });
}

const column = (name: RegExp | string) =>
  screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("the reasoning master", () => {
  it("names each side for what wrote it", async () => {
    onRecord();
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
    choosePaper();

    await screen.findByText(/Higher night-time heat/);
    expect(within(column("Your judgment")).getByText(/Human/)).toBeTruthy();
    expect(within(column(/Throughline/)).getByText(/Model-generated/)).toBeTruthy();
  });

  it("says whether the model's reading is stored or fresh", async () => {
    /* Two readings of one paper can disagree. A reader has to know whether
       they are looking at a record or at something just produced. */
    onRecord();
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
    choosePaper();

    expect(await within(column(/Throughline/)).findByText(/stored reading/))
      .toBeTruthy();
  });

  it("keeps the researcher's notes and the model's notes in different columns", async () => {
    onRecord();
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
    choosePaper();

    await screen.findByText("Could income explain the association?");

    // The human note is on the human side and nowhere else.
    expect(within(column("Your judgment"))
      .getByText("Could income explain the association?")).toBeTruthy();
    expect(within(column(/Throughline/))
      .queryByText("Could income explain the association?")).toBeNull();

    // The model's note is on the model side, and says a model wrote it.
    const modelNote = within(column(/Throughline/))
      .getByText("The paper reports an association, not causation.");
    expect(modelNote).toBeTruthy();
    expect(within(column(/Throughline/)).getByText(/written by a model/)).toBeTruthy();
  });

  it("quotes the paper once, under a label, with its anchor", async () => {
    onRecord();
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
    choosePaper();

    fireEvent.click(await screen.findByRole("button", { name: "Work with this claim" }));

    // Exactly one copy of the paper's sentence, so the anchored copy is the
    // one the reader is looking at.
    await waitFor(() => expect(
      screen.getAllByText(/Higher night-time heat is associated/)).toHaveLength(1));
    expect(screen.getByText("Quoted from the paper")).toBeTruthy();
    expect(screen.getByText(/p\. 8, §3/)).toBeTruthy();
  });

  it("explains why the check cannot be run yet, rather than greying out in silence", async () => {
    onRecord();
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
    choosePaper();
    fireEvent.click(await screen.findByRole("button", { name: "Work with this claim" }));

    const check = screen.getByRole("button", { name: "Check testability" });
    expect(check.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Choose a dataset to check the claim against."))
      .toBeTruthy();

    chooseDataset();
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Check testability" }).hasAttribute("disabled"),
    ).toBe(false));
  });

  it("says the check computes nothing, beside the control that runs it", async () => {
    /* §09: this requests compatibility and does not execute an analysis. A
       researcher who thinks it ran one will read the verdict as a result. */
    onRecord();
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
    choosePaper();
    chooseDataset();
    fireEvent.click(await screen.findByRole("button", { name: "Work with this claim" }));

    expect(await screen.findByText(/No analysis has run/)).toBeTruthy();
  });

  it("shows the dataset's actual version, not only its name", async () => {
    onRecord();
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
    chooseDataset();

    expect(await screen.findByText(/v2 · 1,248 rows/)).toBeTruthy();
  });

  it("offers no note control on a paper with no node to hang one on", async () => {
    /* The journal is addressed by research-object id. A source that ingestion
       has not recorded yet has none, and a control that would 404 is worse
       than a sentence saying why it is absent. */
    vi.mocked(api.get).mockResolvedValue(
      { source_id: "src_paper", claims: [CLAIM] } as never);
    render(<ClaimTest projectId="prj" sources={[unrecordedPaper, dataset]} />);
    choosePaper();

    await screen.findByText(/Higher night-time heat/);
    expect(screen.queryByRole("button", { name: "Append note" })).toBeNull();
    expect(screen.getByText(/no entry in the research graph yet/)).toBeTruthy();
  });

  it("appends a note to the paper's own node, append-only", async () => {
    onRecord();
    vi.mocked(api.post).mockResolvedValue({
      id: "note_3", body: "Compare the same population and time window.",
      author_kind: "human", author: "chen", created_at: "2026-09-02T00:00:00Z",
    } as never);
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
    choosePaper();

    const box = await screen.findByLabelText("Add a thought");
    fireEvent.change(box, {
      target: { value: "Compare the same population and time window." } });
    fireEvent.click(screen.getByRole("button", { name: "Append note" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/api/projects/prj/objects/obj_paper/journal",
      { body: "Compare the same population and time window.",
        object_type: "paper" }));

    // And it joins the human column.
    expect(await within(column("Your judgment"))
      .findByText("Compare the same population and time window.")).toBeTruthy();
  });

  it("walks the three steps from real state, not from a counter", async () => {
    onRecord();
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);

    const stateOf = (label: string) =>
      screen.getByText(label).closest("li")!.getAttribute("data-state");

    choosePaper();
    await screen.findByText(/Higher night-time heat/);
    expect(stateOf("Choose claim")).toBe("here");

    fireEvent.click(screen.getByRole("button", { name: "Work with this claim" }));
    await waitFor(() => expect(stateOf("Match dataset")).toBe("here"));
    expect(stateOf("Choose claim")).toBe("done");

    chooseDataset();
    await waitFor(() => expect(stateOf("Review testability")).toBe("here"));
  });
});
