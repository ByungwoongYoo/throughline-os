/**
 * The project switcher, reachable without a mouse.
 *
 * §30 and Rule 5 make keyboard parity a law here, and this component was
 * breaking it in the way that is hardest to notice: it *claimed* compliance.
 * The markup declared `role="menu"` and `role="menuitem"`, which tells a screen
 * reader that arrow keys move through a list of choices. Nothing in the file
 * handled an arrow key. Focus never entered the popup when it opened, never
 * returned to the trigger when it closed, and the delete control — sitting
 * inside `role="menu"` as a plain button — could not be reached by keyboard at
 * all.
 *
 * A promise the implementation does not keep is this codebase's signature
 * defect in accessibility clothing, and it is exactly what a test asserting
 * "the menu renders" would never catch. These assert the behaviour the role
 * promises, so the promise cannot come loose again.
 *
 * Checked rather than assumed: run against the hand-rolled version that
 * preceded this, eight of the nine fail. The one that passes is the last —
 * `aria-haspopup="menu"` on the trigger — which is the whole point in one
 * line. The claim was always present and correct; every test of the behaviour
 * that claim promises failed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectMenu } from "@/components/ProjectMenu";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const PROJECTS = [
  { id: "prj_1", name: "Resistance", research_question: "Does it hold?" },
  { id: "prj_2", name: "Stewardship" },
];

function mount(onSelect = vi.fn(), onCreate = vi.fn()) {
  render(<ProjectMenu projects={PROJECTS} currentId="prj_1"
                      onSelect={onSelect} onChanged={vi.fn()}
                      onCreate={onCreate} />);
  return document.querySelector<HTMLElement>(".pm-trigger")!;
}

describe("the switcher answers a keyboard", () => {
  it("opens from the keyboard and puts focus inside", async () => {
    /**
     * The failure that made the rest unreachable. Opening used to leave focus
     * on the trigger, so the first arrow key went nowhere and there was no way
     * into the list without a mouse.
     */
    const trigger = mount();
    trigger.focus();
    await userEvent.keyboard("{Enter}");

    const items = await screen.findAllByRole("menuitemradio");
    expect(items.length).toBeGreaterThan(0);
    expect(document.activeElement).not.toBe(trigger);
  });

  it("moves through the choices with the arrow keys", async () => {
    /**
     * The promise `role="menu"` makes. It was not kept by a single line of the
     * previous implementation.
     */
    const trigger = mount();
    await userEvent.click(trigger);
    await screen.findAllByRole("menuitemradio");

    await userEvent.keyboard("{ArrowDown}");
    const first = document.activeElement;
    await userEvent.keyboard("{ArrowDown}");

    expect(document.activeElement).not.toBe(first);
  });

  it("chooses a project with the keyboard alone", async () => {
    /**
     * The arrow order is row-interleaved — Resistance, Delete Resistance,
     * Stewardship, Delete Stewardship — because each row contributes two menu
     * items. Two downs from the first project therefore reaches the second,
     * and this test says so explicitly rather than assuming projects are
     * adjacent, which is what an earlier version of it got wrong.
     */
    const onSelect = vi.fn();
    const trigger = mount(onSelect);
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findAllByRole("menuitemradio");

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenCalledWith("prj_2");
  });

  it("cannot destroy a project with a stray keystroke", async () => {
    /**
     * The cost of interleaving delete into the arrow order: one press past a
     * project is its delete control. That is only acceptable because of what
     * sits behind it — a confirmation that opens with focus on Cancel and
     * stays disabled until the project's name is typed exactly. So the worst a
     * misplaced Enter can do is open a dialog, which is the same standard
     * `ConfirmDialog` already sets for the mouse.
     *
     * If that ever stops being true, this fails.
     */
    const trigger = mount();
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findAllByRole("menuitemradio");

    await userEvent.keyboard("{ArrowDown}{Enter}");

    // A dialog, not a deletion — and the safe answer is the one in hand.
    await screen.findByText(/Delete Resistance\?/);
    expect(screen.getByRole("button", { name: "Delete permanently" }))
      .toBeDisabled();
  });

  it("says which project is the current one, rather than only drawing a tick", async () => {
    /**
     * The tick was already saying "one of these is selected" to anyone who
     * could see it. `menuitemradio` with `aria-checked` says the same thing to
     * someone who cannot, which is the half that was missing.
     */
    const trigger = mount();
    await userEvent.click(trigger);

    const checked = await screen.findByRole("menuitemradio", { checked: true });
    expect(checked).toHaveTextContent("Resistance");
  });

  it("lets the keyboard reach the delete control", async () => {
    /**
     * It was a plain `<button>` inside `role="menu"`. Radix moves focus with a
     * roving tabindex and closes on Tab, so anything in the popup that is not a
     * menu item is unreachable — which is what this was.
     */
    const trigger = mount();
    await userEvent.click(trigger);

    expect(await screen.findByRole("menuitem", { name: "Delete Resistance" }))
      .toBeInTheDocument();
  });

  it("offers 'New project' as a member of the menu it sits in", async () => {
    const trigger = mount();
    await userEvent.click(trigger);

    expect(await screen.findByRole("menuitem", { name: /New project/ }))
      .toBeInTheDocument();
  });

  it("closes on Escape and hands focus back to the trigger", async () => {
    /**
     * Where focus goes on close is not a detail: a keyboard user who dismisses
     * a menu and lands on `<body>` has lost their place in the page entirely
     * and has to tab from the top to get back.
     */
    const trigger = mount();
    await userEvent.click(trigger);
    await screen.findAllByRole("menuitemradio");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("tells assistive technology the trigger controls a menu", async () => {
    const trigger = mount();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});

/**
 * "New project" is not behind the caret (plan §4.16.2, C25).
 *
 * The capability inventory counted this topbar at 8 capabilities, 2 visible
 * and **6 behind_menu** — the class the brief forbids outright. Creating a
 * project is the first thing anybody does with this product, and it was behind
 * a control whose label and tooltip both said *switch*: somebody who had never
 * opened the caret had no way to learn a project could be made at all.
 *
 * The menu keeps its copy. Two doors onto one room is this plan's pattern; a
 * person who opened the list looking for a project they have not got should
 * find the way to make one there too.
 */
describe("creating a project is visible without opening anything", () => {
  it("offers a control in the topbar itself", () => {
    mount();
    expect(screen.getByRole("button", { name: /new project/i }))
      .toBeInTheDocument();
  });

  it("sits beside the project name, not somewhere else on the page", () => {
    const trigger = mount();
    const button = screen.getByRole("button", { name: /new project/i });
    expect(button.closest(".pm")).toBe(trigger.closest(".pm"));
  });

  it("creates without the menu ever being opened", async () => {
    const onCreate = vi.fn();
    mount(vi.fn(), onCreate);

    await userEvent.click(screen.getByRole("button", { name: /new project/i }));

    expect(onCreate).toHaveBeenCalled();
    // And nothing was expanded on the way — this is the whole claim.
    expect(document.querySelector(".pm-trigger"))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("still answers a keyboard, like every other control here", async () => {
    /** §30. A button reached only by pointer would be the same defect this
     *  file was written for, one control further along. */
    const onCreate = vi.fn();
    mount(vi.fn(), onCreate);

    screen.getByRole("button", { name: /new project/i }).focus();
    await userEvent.keyboard("{Enter}");

    expect(onCreate).toHaveBeenCalled();
  });

  it("keeps it in the menu as well", async () => {
    // The list is where somebody who is switching looks; the topbar is where
    // somebody who has just arrived looks. Removing either is a regression.
    const trigger = mount();
    await userEvent.click(trigger);

    expect(await screen.findByRole("menuitem", { name: /New project/ }))
      .toBeInTheDocument();
  });
});
