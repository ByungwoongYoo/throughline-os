/**
 * The notebook's health check, labelled, and its findings said in words.
 *
 * The check is the one thing this notebook can do that a plain vault cannot:
 * nobody notices by rereading that a dataset was re-uploaded after they wrote
 * about it. It shipped behind a button reading "Check the notebook" — which
 * names the object and not the question — and returned four collapsed rows
 * whose only label was a lowercase fragment. The capability inventory ranked
 * it sixth among things fully built and effectively invisible
 * (docs/audit/capability-inventory-2026-09-05.md §6), and this file is the
 * guard on the two fixes: the control states what it checks, and each finding
 * kind arrives as a named block carrying the why and the what-to-do the server
 * already returns.
 *
 * The third test is about position rather than words. "Where to start" and the
 * dangling-link list both answer "what should I write next", and both used to
 * follow a list of pages that grows without limit — so on any notebook with a
 * screenful of notes they were below the fold on arrival (plan §4.13.2).
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Notebook } from "@/components/notebook";
import { api } from "@/lib/api";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

const LISTING = {
  notes: [
    { id: "n1", title: "AMR reading", note_kind: "note", note_date: null,
      updated_at: "2026-09-01T10:00:00Z", link_count: 2, backlink_count: 1 },
  ],
  unresolved: [
    { target: "sampling frame", mentions: 3, first_mentioned_in: "AMR reading" },
  ],
};

const INDEX = {
  notes: 1,
  by_kind: { note: 1 },
  entry_points: [{ id: "n1", title: "AMR reading", linked_from: 4 }],
  subjects: [],
  recent: [],
  unwritten: [],
  note: "1 note.",
};

/** A lint result carrying one finding of each kind the domain reports. */
const LINT = {
  notes: 4,
  clean: false,
  by_kind: { stale_evidence: 1, unwritten_page: 1, isolated: 1,
             unsourced_figure: 1 },
  note: "4 things to look at across 4 notes. Nothing has been changed.",
  findings: [
    { kind: "stale_evidence", note_id: "n1", note: "AMR reading",
      object_id: "obj_1", object: "surveillance.csv",
      detail: "'surveillance.csv' has changed since this note was written "
            + "against it.",
      why: "The note may now describe something the source no longer says.",
      do: "Reread the note beside the current source and update or retire it." },
    { kind: "unwritten_page", note: "AMR reading", target: "sampling frame",
      detail: "'sampling frame' is linked from 3 places and has never been "
            + "written.",
      why: "A link written before its page exists is how planning looks.",
      do: "Write 'sampling frame', or reword the links if it is not needed." },
    { kind: "isolated", note_id: "n2", note: "scratch",
      detail: "Nothing links to 'scratch' and it links to nothing.",
      why: "An isolated note is one you will not find again except by "
         + "searching for words you may not remember.",
      do: "Link it from wherever it belongs, or accept it as a scratch page." },
    { kind: "unsourced_figure", note_id: "n3", note: "draft results",
      figures: ["41%"],
      detail: "'draft results' states 41% and links to no source or analysis.",
      why: "A number in a note becomes a number in a report.",
      do: "Link the analysis or source it came from." },
  ],
};

/** Every request the notebook makes on arrival, plus the lint on demand. */
function serve(lint: unknown = LINT) {
  return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.includes("/notebook/lint")) return lint as never;
    if (path.includes("/notebook/index")) return INDEX as never;
    if (path.includes("/knowledge-graph")) return { nodes: [] } as never;
    if (path.includes("/notebook")) return LISTING as never;
    return {} as never;
  });
}

async function opened() {
  render(<Notebook projectId="prj_1" />);
  // The listing resolves before anything below it exists. `findAll`, because
  // the same note is both a hub and a row in the list — which is the point of
  // the hubs.
  await screen.findAllByText("AMR reading");
}

describe("the control says what it checks", () => {
  it("names the four things, not just the notebook", async () => {
    /*
     * The failure guarded: an accessible name of "Check the notebook" leaves
     * pressing it as the only way to find out what it does, on a screen the
     * inventory recorded nobody opening. A researcher cannot decide to run a
     * check whose question they have not been told.
     */
    serve();
    await opened();

    const check = screen.getByRole("button", { name: /stale evidence/i });
    const name = check.textContent ?? "";
    expect(name).toMatch(/stale evidence/i);
    expect(name).toMatch(/unwritten pages/i);
    expect(name).toMatch(/unlinked notes/i);
    expect(name).toMatch(/unsourced figures/i);
  });

  it("does not run on arrival", async () => {
    /*
     * A health check that runs itself becomes a permanent list of complaints
     * beside the writing surface, and the writing surface is the point. This
     * guards the comment at the top of the component against a later reader
     * "fixing" the lint into the load.
     */
    const get = serve();
    await opened();
    expect(get.mock.calls.some(([path]) => String(path).includes("/lint")))
      .toBe(false);
  });
});

describe("what the check found, in words", () => {
  it("names each kind as a block rather than a lowercase fragment", async () => {
    /*
     * The failure guarded: four `<details>` labelled "evidence changed", "not
     * written", "unlinked", "no source". Each is a fragment of a sentence
     * nobody outside this codebase would complete the same way, and the label
     * was the summary of a closed disclosure — so the kinds were invisible
     * until pressed, one at a time.
     */
    serve();
    await opened();
    await userEvent.click(screen.getByRole("button", { name: /stale evidence/i }));

    expect(await screen.findByText(/Evidence changed after the note was written/))
      .toBeTruthy();
    expect(screen.getByText(/Linked to, but never written/)).toBeTruthy();
    expect(screen.getByText(/Nothing links to it, and it links to nothing/))
      .toBeTruthy();
    expect(screen.getByText(/States a number with no source behind it/))
      .toBeTruthy();
  });

  it("shows the why and the what-to-do without a second press", async () => {
    /*
     * A lint entry that only names a problem gets ignored; the server returns
     * both sentences and they used to sit behind the disclosure. Nothing is
     * hidden (principle 4): the layer may exist, the only label may not be in
     * it.
     */
    serve();
    await opened();
    await userEvent.click(screen.getByRole("button", { name: /stale evidence/i }));

    expect(await screen.findByText(/no longer says/)).toBeTruthy();
    expect(screen.getByText(/Reread the note beside the current source/))
      .toBeTruthy();
  });

  it("counts each kind with the server's number", async () => {
    /** Nothing is computed in the browser: the heading's count is `by_kind`. */
    serve({ ...LINT, by_kind: { ...LINT.by_kind, stale_evidence: 7 } });
    await opened();
    await userEvent.click(screen.getByRole("button", { name: /stale evidence/i }));

    const heading = await screen.findByText(
      /Evidence changed after the note was written/);
    expect(heading.textContent).toContain("7");
  });

  it("still shows a finding of a kind this build has never heard of", async () => {
    /*
     * The domain can add a fifth check. Rendering only the four known kinds
     * would make a notebook look clean because the interface is old, which is
     * the one failure a health check must not have.
     */
    serve({
      ...LINT, by_kind: { orphaned_figure: 1 },
      findings: [{ kind: "orphaned_figure", detail: "A figure with no note.",
                   why: "Because.", do: "Write about it." }],
    });
    await opened();
    await userEvent.click(screen.getByRole("button", { name: /stale evidence/i }));

    expect(await screen.findByText("A figure with no note.")).toBeTruthy();
    expect(screen.getByText("Write about it.")).toBeTruthy();
  });
});

describe("what to write next comes before the list of pages", () => {
  it("puts the hubs and the dangling links above the page list", async () => {
    /*
     * The failure guarded: both blocks followed a `<ul>` of every note in the
     * project, so the two things that answer "what next" moved further down
     * the column with every page written. Asserted as DOM order rather than
     * geometry, which is what a unit test can hold honestly — C23 in the plan
     * measures the fold.
     */
    serve();
    await opened();

    const aside = screen.getByText("Where to start").closest("aside");
    expect(aside).toBeTruthy();
    const order = [...aside!.querySelectorAll("h3, ul.nb-index")];
    const names = order.map((el) =>
      el.tagName === "H3" ? el.textContent : "the list of pages");

    expect(names.indexOf("Where to start"))
      .toBeLessThan(names.indexOf("the list of pages"));
    expect(names.indexOf("Written about, not yet written"))
      .toBeLessThan(names.indexOf("the list of pages"));
  });

  it("still lists the pages themselves", async () => {
    /** Moving two blocks must not lose the thing they sit above. */
    serve();
    await opened();
    const list = document.querySelector("ul.nb-index");
    await waitFor(() =>
      expect(within(list as HTMLElement).getByText("AMR reading")).toBeTruthy());
  });
});
