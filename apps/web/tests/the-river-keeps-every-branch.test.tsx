/**
 * The river's promises, which are claims about a project and not about a layout.
 *
 * Three of them can be broken without anything looking wrong on screen, which
 * is why they are tested rather than reviewed.
 *
 * **A filter must not delete objects.** §09 says so directly. Narrowing the
 * state filter is a change to what is drawn, never to what exists, and the
 * screen has to keep saying how much it is withholding — otherwise a
 * researcher filtering to "validated" sees a project that went straight from
 * question to answer, which is the false clean path the master forbids.
 *
 * **An asserted link must not read as provenance.** Recorded lineage and an
 * asserted relationship are different claims, and the only thing separating
 * them in the detail panel is which list they land in. Putting an asserted
 * edge under "Produced by" would state that something was computed from
 * something it was not.
 *
 * **An unrecognised type must not be filed under a guess.** `stageOf` answers
 * null for a type the vocabulary does not know, and the screen has to show
 * that gap rather than defaulting it into Sources.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { River } from "@/components/river";
import { api } from "@/lib/api";

const NODES = [
  { id: "obj_src", title: "Heat and anxiety cohort", object_type: "dataset", status: null },
  { id: "obj_cl", title: "Heat exposure is associated with anxiety",
    object_type: "claim", status: "exploratory" },
  { id: "obj_an", title: "Pearson correlation", object_type: "analysis", status: "validated" },
  { id: "obj_rej", title: "Income-only explanation", object_type: "claim", status: "rejected" },
  { id: "obj_odd", title: "A thing nobody classified", object_type: "moon_rock", status: null },
];

const EDGES = [
  // Recorded: the analysis really was computed from the dataset.
  { id: "e_lin", source_object_id: "obj_src", target_object_id: "obj_an",
    relationship_type: "derived_from", confidence: null, status: "recorded",
    edge_kind: "lineage" as const },
  // Asserted: something proposed that the claim relates to the analysis.
  { id: "e_sem", source_object_id: "obj_cl", target_object_id: "obj_an",
    relationship_type: "relates_to", confidence: 0.4, status: "candidate",
    edge_kind: "semantic" as const },
];

const PAYLOAD = {
  nodes: NODES, edges: EDGES, total_objects: NODES.length, truncated: false,
};

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

function river(payload: unknown = PAYLOAD, onOpen = () => {}) {
  vi.spyOn(api, "get").mockResolvedValue(payload as never);
  render(<River projectId="prj_1" onOpenObject={onOpen} />);
}

async function settle() {
  await waitFor(() =>
    expect(screen.getByText("Pearson correlation")).toBeTruthy());
}

describe("the research river", () => {
  it("places each object in the stage its recorded type names", async () => {
    river();
    await settle();

    // The six stages are on screen, in the master's order.
    const names = screen.getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(names.slice(0, 6)).toEqual([
      "Sources", "Claims", "Connections", "Analyses", "Validation", "Findings",
    ]);
  });

  it("shows an unrecognised type as unplaced rather than filing it", async () => {
    river();
    await settle();

    const unplaced = screen.getByText("Recorded, not placed").closest("section");
    expect(unplaced, "nothing said the object could not be placed").toBeTruthy();
    expect(within(unplaced as HTMLElement).getByText("A thing nobody classified"))
      .toBeTruthy();
  });

  it("keeps a rejected branch on the canvas", async () => {
    /* Its absence would imply a clean path to success. */
    river();
    await settle();
    expect(screen.getByText("Income-only explanation")).toBeTruthy();
  });

  it("says how much a filter is withholding, and keeps it in the table", async () => {
    river();
    await settle();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "validated" } });

    // The canvas narrows...
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Income-only explanation/ })).toBeNull());
    // ...and says so, rather than letting the objects vanish quietly.
    expect(screen.getByText(/hidden by the current filter/)).toBeTruthy();

    // The object table still lists every object in the project.
    fireEvent.click(screen.getByRole("tab", { name: "Object table" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    const table = screen.getByRole("table");
    expect(within(table).getByText("Income-only explanation")).toBeTruthy();
    expect(within(table).getByText("Heat and anxiety cohort")).toBeTruthy();
  });

  it("separates recorded derivation from an asserted relationship", async () => {
    river();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /Pearson correlation/ }));

    const produced = await screen.findByText("Produced by");
    const fromCell = produced.parentElement!.querySelector("dd")!;
    // The lineage edge, and only it.
    expect(fromCell.textContent).toContain("Heat and anxiety cohort");
    expect(fromCell.textContent).not.toContain("Heat exposure is associated");

    const related = screen.getByText("Related context").parentElement!
      .querySelector("dd")!;
    expect(related.textContent).toContain("Heat exposure is associated");
  });

  it("says on its face that the columns are not a chronology", async () => {
    /* The master puts this sentence on the canvas, not in a tooltip: a caveat
       nobody opens is a caveat nobody reads. */
    river();
    await settle();
    expect(screen.getByText("Stage placement does not imply execution order."))
      .toBeTruthy();
  });

  it("offers an object table as a real alternative to the canvas", async () => {
    river();
    await settle();

    fireEvent.click(screen.getByRole("tab", { name: "Object table" }));
    const table = await screen.findByRole("table");

    // Every object, with the stage and the derivation spelled out in text.
    for (const node of NODES) {
      expect(within(table).getByText(node.title)).toBeTruthy();
    }
    expect(within(table).getByText("Not placed — unrecorded type")).toBeTruthy();
  });

  it("opens the object the researcher chose", async () => {
    const opened: string[] = [];
    river(PAYLOAD, (id: string) => opened.push(id));
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /Pearson correlation/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open this object" }));

    expect(opened).toEqual(["obj_an"]);
  });

  it("says a project with nothing in it has nothing, and does not draw six empty columns", async () => {
    river({ nodes: [], edges: [], total_objects: 0, truncated: false });
    await waitFor(() =>
      expect(screen.getByText("No recorded objects yet")).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "River" })).toBeNull();
  });
});
