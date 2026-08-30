/**
 * A tab strip that behaves like the widget it says it is.
 *
 * Four screens — Compare, Patterns, Notebook and the note graph — each wrote
 * this by hand, in markup identical down to the class names, and all four were
 * wrong the same two ways.
 *
 * **`role="tablist"` with no arrow keys.** The role tells a screen reader
 * "tab, 2 of 5" and promises that the arrows move between them. Not one of the
 * four handled an arrow key, and every tab was separately tabbable, so reaching
 * the content behind an eight-tab strip meant eight presses of Tab.
 *
 * **Nothing was a tab panel.** No `role="tabpanel"`, no `aria-controls`, no
 * `aria-labelledby`. The relationship between the choice and the thing it
 * changes was on the screen and absent from the accessibility tree.
 *
 * Same defect as the project switcher's `role="menu"` and the command bar's
 * `aria-modal`: a claim the implementation did not support. That is three
 * separate places now, which is why this one is a shared component rather than
 * a fourth hand-rolled copy.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { TabPanel, ViewTabs } from "@/components/ViewTabs";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const OPTIONS = [
  ["one", "First"],
  ["two", "Second"],
  ["three", "Third"],
] as const;

type Id = (typeof OPTIONS)[number][0];

/** A live strip, so selection and focus can be observed together. */
function Strip({ onChange }: { onChange?: (v: Id) => void }) {
  const [value, setValue] = useState<Id>("one");
  return (
    <>
      <ViewTabs
        name="t" label="What to look at" value={value}
        onChange={(next) => { setValue(next); onChange?.(next); }}
        options={OPTIONS}
      />
      <TabPanel name="t" value={value}>content for {value}</TabPanel>
    </>
  );
}

const tabs = () => screen.getAllByRole("tab");
const selected = () => screen.getByRole("tab", { selected: true });

describe("the arrows move between tabs", () => {
  it("moves to the next tab on ArrowRight", async () => {
    render(<Strip />);
    tabs()[0].focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(selected()).toHaveTextContent("Second");
  });

  it("moves to the previous tab on ArrowLeft", async () => {
    render(<Strip />);
    tabs()[0].focus();

    await userEvent.keyboard("{ArrowRight}{ArrowLeft}");

    expect(selected()).toHaveTextContent("First");
  });

  it("wraps at both ends rather than dead-ending", async () => {
    render(<Strip />);
    tabs()[0].focus();

    await userEvent.keyboard("{ArrowLeft}");
    expect(selected()).toHaveTextContent("Third");

    await userEvent.keyboard("{ArrowRight}");
    expect(selected()).toHaveTextContent("First");
  });

  it("jumps to the ends with Home and End", async () => {
    render(<Strip />);
    tabs()[0].focus();

    await userEvent.keyboard("{End}");
    expect(selected()).toHaveTextContent("Third");

    await userEvent.keyboard("{Home}");
    expect(selected()).toHaveTextContent("First");
  });

  it("takes focus with it", async () => {
    /**
     * Otherwise the highlight moves and focus stays behind, and the *next*
     * arrow key starts again from wherever focus actually was — which reads as
     * the strip randomly jumping back.
     */
    render(<Strip />);
    tabs()[0].focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(selected());
  });
});

describe("the strip is one stop in the tab order", () => {
  it("gives only the selected tab a tabindex of 0", () => {
    /**
     * The roving tabindex. Without it every tab is separately tabbable, and
     * Compare's eight choices sit between the researcher and the content.
     */
    render(<Strip />);
    const stops = tabs().filter((tab) => tab.tabIndex === 0);

    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(selected());
  });

  it("moves the single stop with the selection", async () => {
    render(<Strip />);
    tabs()[0].focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(tabs()[0].tabIndex).toBe(-1);
    expect(tabs()[1].tabIndex).toBe(0);
  });

  it("leaves Tab itself alone", async () => {
    /**
     * Only the keys it handles are prevented. A blanket `preventDefault` would
     * trap focus inside the strip — the opposite of the bug being fixed.
     */
    render(<Strip />);
    tabs()[0].focus();

    await userEvent.tab();

    expect(document.activeElement).not.toBe(tabs()[0]);
  });
});

describe("a tab controls something", () => {
  it("points at a panel that exists", () => {
    render(<Strip />);
    const controls = selected().getAttribute("aria-controls");

    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toBeInTheDocument();
  });

  it("gives the panel the tab's own name back", () => {
    /** `aria-labelledby` is how the panel is announced as belonging to it. */
    render(<Strip />);
    const panel = screen.getByRole("tabpanel");

    expect(panel).toHaveAttribute("aria-labelledby", selected().id);
  });

  it("keeps the pairing as the selection moves", async () => {
    render(<Strip />);
    tabs()[0].focus();

    await userEvent.keyboard("{ArrowRight}");

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", selected().id);
    expect(selected().getAttribute("aria-controls")).toBe(panel.id);
  });

  it("reports the change to the screen that owns the state", async () => {
    const onChange = vi.fn();
    render(<Strip onChange={onChange} />);
    tabs()[0].focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("two");
  });
});
