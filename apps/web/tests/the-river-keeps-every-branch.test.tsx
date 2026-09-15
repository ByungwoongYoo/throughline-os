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

/**
 * A connection, which the graph payload does not carry.
 *
 * The screenshots of the running app showed the Connections column reporting
 * "nothing recorded" beside a navigation badge counting six of them. Both were
 * reading truthfully from different places; the column was the one that read
 * as a fact about the project.
 */
const CONNECTIONS = [{
  id: "cnx_1", left_variable: "night_heat_z", right_variable: "anxiety_z",
  lifecycle_status: "validated", analysis_run_id: "arun_7",
}];

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

/**
 * The two things the river reads.
 *
 * The graph payload holds research objects; connections come from their own
 * route, because a connection is a row with a lifecycle rather than an
 * `ObjectType` and only sometimes has an object beside it. Answering by path
 * rather than with one blanket value is what keeps a test from passing while
 * handing the component a graph where it expected a list.
 */
function river(payload: unknown = PAYLOAD, onOpen: (id: string) => void = () => {},
               connections: unknown[] = CONNECTIONS) {
  vi.spyOn(api, "get").mockImplementation((path: string) =>
    Promise.resolve((path.includes("/connections") ? connections : payload) as never));
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

  it("draws a recorded derivation and an asserted link as different lines", async () => {
    /*
     * The distinction at the drawing layer, not only in the detail panel.
     *
     * The stylesheet dashes a line by `data-lineage="false"` and leaves a
     * recorded one solid, which is the whole visual argument of the view: a
     * dotted line that renders solid tells a researcher that an inferred
     * association is provenance. The geometry cannot be asserted here — this
     * environment applies no CSS, so every measured offset is zero — but which
     * flag each edge carries can be, and that is the part a refactor loses.
     */
    river();
    await settle();

    /*
     * By edge, not by count. The river now also draws what it derives — a
     * connection's line to its validation card — so the number of lines is no
     * longer the number of graph edges, and a count would pass or fail for
     * reasons unrelated to the property. The two graph edges must keep their
     * own flags.
     */
    const line = (id: string) =>
      document.querySelector(`.river-line[data-edge="${id}"]`);
    await waitFor(() => expect(line("e_lin")).not.toBeNull());
    expect(line("e_lin")!.getAttribute("data-lineage")).toBe("true");
    expect(line("e_sem")!.getAttribute("data-lineage")).toBe("false");
  });

  it("draws no line to an object the filter is withholding", async () => {
    /* An edge with one end off the canvas has nowhere honest to land. */
    river();
    await settle();
    await waitFor(() => expect(
      document.querySelector('.river-line[data-edge="e_lin"]')).not.toBeNull());

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "validated" } });

    // The dataset and the claim are withheld, so neither of their edges may
    // survive; and no line that does survive may end on a hidden card.
    await waitFor(() => expect(
      document.querySelector('.river-line[data-edge="e_lin"]')).toBeNull());
    expect(document.querySelector('.river-line[data-edge="e_sem"]')).toBeNull();
    const cardTitles = new Set([...document.querySelectorAll(".river-card")]
      .map((c) => c.getAttribute("title")));
    for (const path of document.querySelectorAll(".river-line")) {
      const id = path.getAttribute("data-edge")!;
      if (id.startsWith("checked:")) {
        expect(cardTitles.has(id.slice("checked:".length))).toBe(true);
      }
    }
  });

  it("places a connection in its column, with what produced it", async () => {
    /*
     * The defect the screenshots found: the canvas said "Nothing recorded in
     * this stage" under Connections while the navigation counted six. A
     * connection is not an `ObjectType`, so it never reached the graph payload
     * the column was reading.
     */
    river();
    await settle();

    // The connection's own card, not its validation card, which names the same
    // pair beneath "Survived validation".
    const card = screen.getAllByRole("button", { name: /night_heat_z/ })
      .find((b) => b.textContent?.includes("Connection"))!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Validated");
    // The run that produced it, printed rather than drawn — the canvas lays
    // out objects and this names a run.
    expect(card.textContent).toContain("Produced by arun_7");
  });

  it("shows a validated connection's validation where the column is", async () => {
    /*
     * The column used to hold one sentence — "validation reports are recorded
     * against the connection they checked" — and nothing else, because a
     * report has no research object. The lifecycle is on the page, and it
     * becomes `validated` only when a validation run passes, so a card saying
     * so is a statement the data supports.
     */
    river();
    await settle();
    expect(screen.getByText("Survived validation")).toBeTruthy();
  });

  it("draws an unvalidated connection's validation as an absence, not as a failure", async () => {
    /*
     * An exploratory connection may never have been validated or may have
     * failed one, and this payload cannot tell those apart — so the card says
     * neither "not run" nor "failed", and it is a dashed absence, not a card
     * with a state.
     */
    river(PAYLOAD, () => {}, [{ ...CONNECTIONS[0], id: "conn_x", lifecycle_status: "exploratory" }]);
    await settle();
    const ghost = screen.getByText("Not yet validated").closest(".river-card")!;
    expect(ghost.getAttribute("data-ghost")).toBe("true");
    expect(document.body.textContent).not.toMatch(/validation not run|failed validation/i);
  });

  it("draws the line from a connection to the analysis that produced it", async () => {
    /*
     * Connections came from their own route with no edges, so every line on
     * the canvas ran from the dataset to the analyses and nothing touched a
     * connection. The route names the analysis object, which is a recorded
     * derivation, and it is drawn solid.
     */
    river(PAYLOAD, () => {}, [{ ...CONNECTIONS[0], analysis_object_id: "obj_an" }]);
    await settle();
    const produced = await waitFor(() => {
      const el = document.querySelector('.river-line[data-edge^="produced:"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(produced.getAttribute("data-lineage")).toBe("true");
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
    river(PAYLOAD, (id) => { opened.push(id); });
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /Pearson correlation/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open this object" }));

    expect(opened).toEqual(["obj_an"]);
  });

  it("says a project with nothing in it has nothing, and does not draw six empty columns", async () => {
    /* Empty means empty on both routes: a project with no objects but a
       connection is not a project with nothing in it. */
    river({ nodes: [], edges: [], total_objects: 0, truncated: false },
          () => {}, []);
    await waitFor(() =>
      expect(screen.getByText("No recorded objects yet")).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "River" })).toBeNull();
  });
});

/**
 * The columns stay unpositioned, because the lines are measured from the canvas.
 *
 * Connectors take their ends from each card's `offsetLeft` and `offsetTop`,
 * which are relative to the nearest positioned ancestor. A restyle that made
 * `.river-col` `position: relative` — to hang a hairline in the gutter — moved
 * every card's origin to its own column, and the whole canvas's lines were
 * drawn crammed at the left edge. happy-dom computes no layout, so this reads
 * the stylesheet rather than a rendered offset.
 */
describe("the river's geometry", () => {
  it("never positions a column, so cards measure from the canvas", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
    const rules = [...css.matchAll(/([^{}]*\.river-col[^{}]*)\{([^}]*)\}/g)];
    const positioned = rules
      .filter(([, selector, body]) => !/::?(before|after)/.test(selector)
        && /position\s*:\s*(relative|absolute|sticky|fixed)/.test(body))
      .map(([, selector]) => selector.trim());
    expect(positioned).toEqual([]);
  });
});
