/**
 * What is behind a card on the board.
 *
 * `Board.tsx` recorded that opening a card was impossible — "there is nowhere
 * in this workspace that shows a research object on its own yet, and a
 * callback the host cannot satisfy is dead surface" — which left the central
 * operating surface as a place where things can be arranged and never looked
 * into. Two routes had been waiting for it: `/objects/{id}/impact` and
 * `/objects/{id}/mentions`, neither called by anything.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { CardDetail, countReads } from "@/components/board/CardDetail";
import { api } from "@/lib/api";

const IMPACT = {
  object_id: "obj1",
  dependent_artifacts: 3,
  by_type: { figure: 2, report: 1 },
  findings_losing_evidence: 2,
  artifacts: [
    { id: "o2", object_type: "figure", title: "Figure 2" },
    { id: "o3", object_type: "figure", title: "Figure 3" },
    { id: "o4", object_type: "report", title: "Draft" },
  ],
};

const MENTIONS = [
  { id: "n1", title: "Reading notes", note_kind: "note",
    excerpt: "Worth checking [[Sleep and reaction time]] against the 2019 cohort." },
];

function serve(over: Record<string, unknown> = {}) {
  vi.spyOn(api, "get").mockImplementation(async (path: string) =>
    (String(path).includes("/impact")
      ? (over.impact ?? IMPACT)
      : (over.mentions ?? MENTIONS)) as never);
}

const open = () => render(
  <CardDetail objectId="obj1" title="Sleep and reaction time"
              objectType="analysis" status="complete" onClose={() => {}} />);

beforeEach(() => { vi.restoreAllMocks(); });

describe("what has been built on this", () => {
  it("counts the artifacts that come from it", async () => {
    serve();
    open();
    expect(await screen.findByText(/3 artifacts come/)).toBeTruthy();
  });

  it("says separately how many findings rest on it as evidence", async () => {
    /*
     * An artifact can be remade. A finding that loses its evidence is a claim
     * about the world with nothing under it, which is a different kind of
     * consequence and does not belong inside the same number.
     */
    serve();
    open();
    expect(await screen.findByText(/2 findings rest/)).toBeTruthy();
  });

  it("does not mention evidence when no finding rests on it", async () => {
    serve({ impact: { ...IMPACT, findings_losing_evidence: 0 } });
    open();
    await screen.findByText(/3 artifacts come/);
    expect(screen.queryByText(/rest/)).toBeNull();
  });

  it("says plainly when nothing has been built on it", async () => {
    serve({ impact: { ...IMPACT, dependent_artifacts: 0, artifacts: [],
                      findings_losing_evidence: 0 } });
    open();
    expect(await screen.findByText(/Nothing has been built on this yet/))
      .toBeTruthy();
  });

  it("says the list is a sample when it is one", async () => {
    // The count is the whole truth; a list that trails off without saying so
    // invites the reader to take it for the whole set.
    const many = Array.from({ length: 20 }, (_, i) => (
      { id: `o${i}`, object_type: "figure", title: `Figure ${i}` }));
    serve({ impact: { ...IMPACT, dependent_artifacts: 20, artifacts: many } });
    open();

    expect(await screen.findByText(/Showing 12 of 20/)).toBeTruthy();
    expect(screen.getAllByText(/^Figure \d+$/)).toHaveLength(12);
  });

  it("does not describe any of this as a deletion", async () => {
    /*
     * The route's own summary is "what a deletion would destroy, before it is
     * destroyed", and nothing in this product deletes a research object.
     * Borrowing that framing would describe an operation that does not exist.
     */
    serve();
    const { container } = open();
    await screen.findByText(/3 artifacts come/);
    expect(container.textContent).not.toMatch(/delet|destroy|remove/i);
  });
});

describe("notes that mention it", () => {
  it("shows the sentence, not only the note's title", async () => {
    serve();
    open();
    expect(await screen.findByText(/Worth checking/)).toBeTruthy();
    expect(screen.getByText("Reading notes")).toBeTruthy();
  });

  it("says when no note mentions it", async () => {
    serve({ mentions: [] });
    open();
    expect(await screen.findByText(/No note mentions this yet/)).toBeTruthy();
  });

  it("shows a note that has no quotable line without an empty paragraph", async () => {
    serve({ mentions: [{ id: "n2", title: "Bare", note_kind: "note", excerpt: "" }] });
    open();
    const item = (await screen.findByText("Bare")).closest("li")!;
    expect(item.querySelector("p")).toBeNull();
  });
});

describe("counting in words", () => {
  it("agrees with the noun it is counting", () => {
    expect(countReads(1, "artifact comes", "artifacts come")).toBe("1 artifact comes");
    expect(countReads(3, "artifact comes", "artifacts come")).toBe("3 artifacts come");
    expect(countReads(0, "artifact comes", "artifacts come")).toBe("0 artifacts come");
  });
});

describe("closing", () => {
  it("tells the board it is done", async () => {
    serve();
    const onClose = vi.fn();
    render(<CardDetail objectId="obj1" title="T" objectType="analysis"
                       status="complete" onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
