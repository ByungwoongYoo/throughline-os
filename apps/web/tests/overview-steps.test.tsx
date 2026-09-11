/**
 * The research loop as a checklist.
 *
 * The Overview calls this "both an explanation of the method and the place you
 * start the next step", and every step is ticked from the project's real
 * counts. The second half of that promise is the one that can quietly stop
 * being true: a step whose link goes somewhere the step cannot be taken reads
 * as a dead end, and the reader is likelier to conclude the product cannot do
 * it than that the button is pointed wrong.
 *
 * "Record a finding" went to the Findings list, which has no way to record one
 * — deliberately, because a finding is recorded *from* a result and a bare
 * "new finding" button invites one written from memory. The placement is
 * right; the link was not.
 *
 * The second half of this file is about the same promise at a smaller scale.
 * Every row here is a `<button>` and none of them looked like one, so on a
 * brand-new project the one thing the researcher came to do had no visible
 * control and no stated destination — the only way to find out where a step
 * led was to take it. So each row now says where it goes, in the rail's own
 * words, and the row the project is on carries a real control that performs
 * the step: the file picker on an empty project, and the connection the
 * server ranks highest once there is one.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Overview } from "@/components/views";
import { SECTIONS, Section } from "@/components/Shell";
import type { Connection, DiscoveryMap } from "@/lib/api";

const MAP = {
  counts: { sources: 3, datasets: 1, analyses: 4, findings: 0, reports: 0 },
  connections: { candidate: 2, exploratory: 1, validated: 1 },
  findings: {},
} as unknown as DiscoveryMap;

const PROJECT = { name: "AMR", research_question: "Does use track resistance?" };

/** The connection the server ranks highest, which steps 4 and 5 act on. */
const TOP = {
  id: "conn_1", left_variable: "consumption_ddd", right_variable: "resistance_pct",
} as unknown as Connection;

function mapWith(over: Partial<DiscoveryMap>): DiscoveryMap {
  return { ...MAP, ...over } as DiscoveryMap;
}

beforeEach(() => { vi.restoreAllMocks(); });

function open(map: DiscoveryMap = MAP) {
  const go = vi.fn();
  const onOpen = vi.fn();
  const add = vi.fn();
  const { container } = render(
    <Overview project={PROJECT} map={map} onGo={go} onOpen={onOpen}
              onAddSources={add} />);
  return { go, onOpen, add, container };
}

/** The row the card marks as the one the project is on. */
function currentRow(container: HTMLElement) {
  return container.querySelector<HTMLElement>('.steps li[data-next="true"]')!;
}

/**
 * A row of the checklist, by the label on it.
 *
 * `screen.getByText` until T139, when the rows gave up their hint sentences:
 * only the row the project is on carries one now, and the other five live in
 * the "What each step is for" fold beneath the list, each beside the step it
 * belongs to. So every label is on the card twice — once as a row and once as
 * the fold's term — and a bare text query is ambiguous. The row is the one
 * inside `.steps`, which is what these tests always meant.
 */
function row(container: HTMLElement, label: string): HTMLElement {
  const steps = container.querySelector<HTMLElement>(".steps")!;
  return within(steps).getByText(label);
}

describe("every step goes where the step is taken", () => {
  it("sends recording a finding to the connections, not to the list of them", () => {
    /*
     * The Findings screen cannot record one, and its empty state says to
     * validate a connection first — which is where this now goes.
     */
    const { go, container } = open();
    row(container, "Record a finding").click();
    expect(go).toHaveBeenCalledWith("connections");
  });

  it("sends destroying a result to the connections too", () => {
    // Both actions live on a connection; that is one screen, not a conflict.
    const { go, container } = open();
    row(container, "Try to destroy what survived").click();
    expect(go).toHaveBeenCalledWith("connections");
  });

  it("sends generating candidates to discovery", () => {
    const { go, container } = open();
    row(container, "Generate and test candidates").click();
    expect(go).toHaveBeenCalledWith("discover");
  });

  it("sends adding sources to the sources", () => {
    const { go, container } = open();
    row(container, "Add sources").click();
    expect(go).toHaveBeenCalledWith("sources");
  });

  it("names no step it cannot send anybody to", () => {
    // A step with no destination is a to-do the product will not help with.
    const { go, container } = open();
    for (const label of ["Add sources", "Profile a dataset",
                         "Generate and test candidates",
                         "Try to destroy what survived", "Record a finding",
                         "Communicate it"]) {
      go.mockClear();
      row(container, label).click();
      expect(go, label).toHaveBeenCalledTimes(1);
    }
  });
});

describe("what the checklist claims is done", () => {
  it("ticks a step from the project's real counts, not from optimism", () => {
    const { go, container } = open();
    // No findings and no reports recorded, so neither is complete.
    expect(row(container, "Record a finding")).toBeTruthy();
    expect(go).not.toHaveBeenCalled();
  });
});

describe("where each row goes, said before it is pressed", () => {
  it("shows every row's destination as visible words", () => {
    /*
     * Six buttons that do not look like buttons, and nothing on any of them
     * naming where it led: the destination was learnable only by pressing and
     * reading the rail afterwards.
     */
    const { container } = open();
    const destinations = [...container.querySelectorAll(".steps .step-go")]
      .map((node) => node.textContent);

    expect(destinations).toHaveLength(6);
    for (const text of destinations) expect(text).toMatch(/^→ \S/);
  });

  it("calls each destination what the rail calls it", () => {
    /*
     * Not a hand-typed name. A row promising "→ Findings" after that entry
     * was renamed is unfalsifiable by eye and looks right in review, so the
     * name comes from `SECTIONS` and this checks the two agree.
     */
    const { container } = open();
    const label = (id: Section) => SECTIONS.find((s) => s.id === id)!.label;
    const destinations = [...container.querySelectorAll(".steps .step-go")]
      .map((node) => node.textContent);

    // The six steps in order, and the section each one is taken on.
    expect(destinations).toEqual([
      `→ ${label("sources")}`, `→ ${label("sources")}`,
      `→ ${label("discover")}`, `→ ${label("connections")}`,
      `→ ${label("connections")}`, `→ ${label("reports")}`,
    ]);
  });
});

describe("the row the project is on carries the step", () => {
  it("gives the current row a control naming where it goes", () => {
    /*
     * §123's converse: the one act the card is recommending should look like
     * something that can be pressed, and say what pressing it does.
     *
     * A plain `.btn` since T139, not `.btn-primary`. The step strip above the
     * workspace performs this same act and cannot be scrolled away, so two
     * gold buttons for one action was the duplication the strip exists to end.
     * What is asserted here is the control and its words, which is what this
     * test was always about; the weight is the strip's.
     */
    const { container } = open(mapWith({ recommended_step: "validate",
                                         top_connections: [TOP] }));
    const action = currentRow(container).querySelector(".step-action .btn")!;

    expect(action.classList.contains("btn-primary")).toBe(false);
    expect(action.textContent)
      .toBe("Validate consumption_ddd × resistance_pct →");
  });

  it("opens the connection the recommendation means, not the table of them", () => {
    /*
     * Steps 4 and 5 both act on one connection and the server already ranks
     * them. Landing on a six-row table with nothing saying which row was meant
     * is the friction this closes.
     */
    const { container, onOpen, go } = open(
      mapWith({ recommended_step: "validate", top_connections: [TOP] }));
    (currentRow(container).querySelector(".step-action .btn") as HTMLElement).click();

    expect(onOpen).toHaveBeenCalledWith("connection", "conn_1");
    expect(go).not.toHaveBeenCalled();
  });

  it("still lands on the section when nothing here can open one object", () => {
    /*
     * The workspace may not have passed `onOpen`, and a button that fires an
     * optional callback nobody supplied is a control that does nothing when
     * pressed. It falls back to the section instead — one screen short of the
     * object, never nowhere.
     */
    const go = vi.fn();
    const { container } = render(
      <Overview project={PROJECT} map={mapWith({ recommended_step: "validate",
                                                 top_connections: [TOP] })}
                onGo={go} />);
    (currentRow(container).querySelector(".step-action .btn") as HTMLElement).click();

    expect(go).toHaveBeenCalledWith("connections");
  });

  it("takes the first step from the screen that asks for it", () => {
    /*
     * The screen a researcher with one paper and one CSV actually lands on
     * contained no control for adding them: the loop said "Add sources" and
     * the only way to do it was to find the rail entry. Same handler as the
     * Sources screen, offered where the instruction is given.
     */
    const empty = {
      counts: { sources: 0, datasets: 0, analyses: 0, findings: 0, reports: 0 },
      connections: {}, findings: {},
    } as unknown as DiscoveryMap;
    const { container, add } = open(empty);

    const picker = currentRow(container)
      .querySelector<HTMLInputElement>('.step-action input[type="file"]')!;
    expect(picker).toBeTruthy();
    expect(currentRow(container).querySelector(".step-action")!.textContent)
      .toBe("Add sources");

    const file = new File(["a,b\n1,2\n"], "amr.csv", { type: "text/csv" });
    Object.defineProperty(picker, "files", { value: [file], configurable: true });
    fireEvent.change(picker);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0][0]).toBe(file);
  });

  it("marks the step the server recommends, not the first unticked row", () => {
    /*
     * A finding may legitimately be recorded from a connection nothing has
     * validated, so the earliest gap and the step the project is on are not
     * always the same row. The server's recommendation knows which; a
     * checklist that disagreed with the sentence printed under it would teach
     * a first-timer that the numbers are decoration.
     */
    const { container } = open(mapWith({ recommended_step: "communicate" }));

    expect(currentRow(container).textContent).toContain("Communicate it");
    expect(container.querySelectorAll('.steps li[data-next="true"]'))
      .toHaveLength(1);
  });

  it("says the loop may be taken out of order", () => {
    const { container } = open();
    expect(container.querySelector(".steps-note")!.textContent)
      .toBe("The steps may be taken out of order — this is where the project is now.");
  });
});

describe("the control and the row it sits beside", () => {
  it("never puts a button inside a button", () => {
    /*
     * The row is a button and the step's control is a button, and nesting them
     * is invalid HTML: the two fight over one press, and a keyboard user gets
     * one stop for two actions. The control is a sibling of the row instead.
     */
    const withButton = open().container;
    const withPicker = open({
      counts: { sources: 0, datasets: 0, analyses: 0, findings: 0, reports: 0 },
      connections: {}, findings: {},
    } as unknown as DiscoveryMap).container;

    expect(withButton.querySelector("button button")).toBeNull();
    expect(withPicker.querySelector("button button")).toBeNull();
  });
});

describe("what the first step promises about the data", () => {
  /*
   * This hint is read at the moment a researcher decides whether to hand the
   * tool their data, so it is the sentence that has to be true.
   *
   * It said "Files never leave this machine." — unconditionally, while this
   * same application knows a configuration where that is false: choosing a
   * model that runs elsewhere sends passages of every paper it reads to that
   * service, which the settings screen states in exactly those words before
   * asking permission. Both sentences could not be true at once, and the
   * absolute one was on the screen that matters most.
   */
  it("says where the files stay", () => {
    open();
    const hint = screen.getByText(/Drop a dataset and the papers around it/);
    expect(hint.textContent).toMatch(/stay on this machine/i);
  });

  it("does not promise that nothing ever leaves", () => {
    open();
    const hint = screen.getByText(/Drop a dataset and the papers around it/);
    expect(hint.textContent).not.toMatch(/never leave/i);
  });

  it("names the one choice that changes it", () => {
    // A qualified claim a reader cannot act on is no better than a false one:
    // it has to say which decision sends anything anywhere.
    open();
    const hint = screen.getByText(/Drop a dataset and the papers around it/);
    expect(hint.textContent).toMatch(/model that runs elsewhere/i);
  });
});
