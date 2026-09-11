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

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { CardDetail, countReads } from "@/components/board/CardDetail";
import { ApiError, api } from "@/lib/api";

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

/** An empty node journal and an unedited object, so the history section renders. */
const JOURNAL = {
  object: { id: "obj1", object_type: "analysis", title: "Sleep and reaction time",
            created_by: "usr_1", created_at: "2026-03-01T10:00:00Z" },
  derived_from: [], used_by: [], notes: [],
};

/**
 * Everything the projection can reach, at any depth (plan §4.7 item 3).
 *
 * Undirected, as `graph_projection.reachable` is — the ancestor is in here on
 * purpose, because that is what the query returns and what the panel has to be
 * honest about.
 */
const REACH = {
  objects: [
    { id: "o2", title: "Figure 2", object_type: "figure" },
    { id: "o9", title: "Sleep dataset", object_type: "dataset" },
  ],
  count: 2, depth: 5, staleness: null, store: "neo4j",
};

function serve(over: Record<string, unknown> = {}) {
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    const url = String(path);
    if (url.includes("/impact")) return (over.impact ?? IMPACT) as never;
    if (url.includes("/mentions")) return (over.mentions ?? MENTIONS) as never;
    if (url.includes("/graph/reachable")) {
      if (over.reach instanceof Error) throw over.reach;
      return (over.reach ?? REACH) as never;
    }
    if (url.includes("/journal")) return (over.journal ?? JOURNAL) as never;
    if (url.includes("/versions")) {
      return (over.versions ?? { current: "obj1", versions: [] }) as never;
    }
    throw new Error(`no mock for ${url}`);
  });
}

const open = (onOpen?: (kind: string, id: string) => void) => render(
  <CardDetail projectId="prj_1" objectId="obj1" title="Sleep and reaction time"
              objectType="analysis" status="complete" onClose={() => {}}
              onOpen={onOpen as never} />);

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
    // The clause, not the word: `/rest/` also matches "not the rest of your
    // project" in the journal's model-scope sentence, which arrived with the
    // history section and has nothing to do with evidence.
    expect(screen.queryByText(/finding[s]? rest[s]? on it as evidence/)).toBeNull();
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
    render(<CardDetail projectId="prj_1" objectId="obj1" title="T"
                       objectType="analysis" status="complete"
                       onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});


describe("following what is built on this", () => {
  /**
   * Plan §4.7 item 2. Dependents rendered as `<span>` and mentions as `<b>`:
   * the one place in the product where a relationship could be seen and not
   * followed, which breaks the single navigation rule `lib/place.ts` holds
   * (D195).
   */
  it("opens a dependent through the host, as a research object", async () => {
    /*
     * `object` and not `analysis`, and this is the whole of the decision: the
     * ids in this payload are `obj_…` research-object ids, and an analysis
     * object's id is not the `arun_…` run id the analysis detail reads. Sending
     * one there is the D195 defect `page.tsx:826-834` records making once.
     */
    const onOpen = vi.fn();
    serve();
    open(onOpen);

    await userEvent.click(await screen.findByRole("button", { name: "Figure 2" }));
    expect(onOpen).toHaveBeenCalledWith("object", "o2");
  });

  it("renders a dependent as text when the host cannot open anything", async () => {
    // §123's converse — a control that fires a callback its mounting site never
    // passed is this repository's own named recurring defect.
    serve();
    open();
    expect(await screen.findByText("Figure 2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Figure 2" })).toBeNull();
  });

  it("leaves a mention as text and says why", async () => {
    /*
     * Notes are `note_…` ids and no section takes a note in the address, so
     * `placeFor` has nowhere to send one. A dead button is worse than plain
     * text, and an unexplained absence is worse than both.
     */
    const onOpen = vi.fn();
    serve();
    open(onOpen);

    expect(await screen.findByText("Reading notes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reading notes" })).toBeNull();
    expect(screen.getByText(/opened on the Notebook screen/)).toBeTruthy();
  });
});

describe("everything connected to this, at any depth", () => {
  /**
   * Plan §4.7 item 3 — `GET /projects/{id}/graph/reachable`, which had no
   * caller anywhere in `apps/web`.
   */
  it("asks nothing of the projection until it is asked to", async () => {
    // The projection is an optional store and this panel opens on every card
    // press. A query per press would spend it on nobody's question.
    serve();
    open();
    await screen.findByText(/3 artifacts come/);
    const asked = vi.mocked(api.get).mock.calls
      .filter((c) => String(c[0]).includes("/graph/reachable"));
    expect(asked).toHaveLength(0);
  });

  it("lists what the projection reaches, under the list it deepens", async () => {
    serve();
    open();
    await userEvent.click(await screen.findByRole("button",
      { name: /everything connected to it/i }));
    expect(await screen.findByText(/2 objects are connected to this one/))
      .toBeTruthy();
    expect(screen.getByText("Sleep dataset")).toBeTruthy();
  });

  it("does not call it downstream, because the query is not directed", async () => {
    /*
     * `MATCH (a)-[:RELATES*1..n]-(m)` is undirected and the route's own summary
     * says "derived from, **or contributing to**". A control labelled
     * "downstream" would be naming something the server does not answer.
     */
    serve();
    const { container } = open();
    await screen.findByText(/3 artifacts come/);
    expect(container.textContent).not.toMatch(/downstream/i);
  });

  it("states the reduced feature set in the server's words, keeping the control", async () => {
    /*
     * ADR 0002: PostgreSQL holds the record and Neo4j answers four traversal
     * queries when it is there. Absence is a capability statement, never a
     * failure and never a vanished control — a capability that disappears with
     * its store teaches that something is broken.
     */
    serve({ reach: new ApiError(503,
      "No graph projection is configured. Provenance, evidence graphs and "
      + "search work exactly as normal; path-finding, influence ranking and "
      + "clustering need Neo4j.") });
    open();

    const control = await screen.findByRole("button",
      { name: /everything connected to it/i });
    await userEvent.click(control);

    expect(await screen.findByText(/work exactly as normal/)).toBeTruthy();
    expect(screen.getByRole("button",
      { name: /everything connected to it/i })).toBeTruthy();
  });
});

describe("the object's own history", () => {
  it("ends the panel with the notes and the versions", async () => {
    // Plan §4.7 item 4: restore-forward was mounted only inside the Research
    // graph's node panel, and absent from every screen showing the object it
    // versions.
    serve();
    open();
    expect(await screen.findByRole("heading", { name: /history|versions/i }))
      .toBeTruthy();
  });
});
