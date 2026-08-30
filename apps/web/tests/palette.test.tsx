/**
 * The command bar — 283 lines of keyboard surface that had no tests at all.
 *
 * That absence is the first finding. This is the one control in the product
 * whose entire purpose is to be driven without a mouse, it carries several
 * fixes for subtle bugs recorded in its own comments, and nothing was holding
 * any of it in place.
 *
 * The second is what the tests found once written: the palette declared
 * `role="dialog"` and `aria-modal="true"` on a plain `<div>`. `aria-modal`
 * tells assistive technology that everything outside is inert, and nothing
 * here kept that promise — no Tab trap, so focus walked out of the palette into
 * a page the user could no longer see; no focus restore, so dismissing it left
 * focus on `<body>`; and a background that stayed scrollable. Same defect as
 * the switcher claiming `role="menu"` and answering no arrow key.
 *
 * It is a real `<dialog showModal()>` now, which is where the trap, the inert
 * background, the top-layer stacking and Escape come from — the argument
 * `ConfirmDialog` already makes in this codebase.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "@/components/CommandPalette";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function commands() {
  return [
    { id: "overview", label: "Overview", group: "Research", run: vi.fn() },
    { id: "findings", label: "Findings", group: "Discover", run: vi.fn() },
    { id: "figures", label: "Figures", group: "Communicate", run: vi.fn() },
  ];
}

function palette(open = true, list = commands(), onClose = vi.fn()) {
  const view = render(
    <CommandPalette open={open} onClose={onClose} commands={list} />);
  return { view, list, onClose };
}

const dialog = () => document.querySelector<HTMLDialogElement>(".palette-dialog");

describe("the palette is a real modal", () => {
  it("is a dialog element, not a div wearing the role", () => {
    /**
     * The fix, stated as a property. A `<div role="dialog" aria-modal="true">`
     * asserts something the browser is not enforcing; a `<dialog>` opened with
     * `showModal()` is the thing that actually makes it true.
     */
    palette();
    expect(dialog()?.tagName).toBe("DIALOG");
  });

  it("is open when it is meant to be, and closed when it is not", () => {
    palette(true);
    expect(dialog()?.open).toBe(true);

    cleanup();
    palette(false);
    expect(dialog()?.open).toBe(false);
  });

  it("does not repeat the roles the element already carries", () => {
    /**
     * A modal `<dialog>` is announced as a modal dialog on its own. Restating
     * `role` and `aria-modal` by hand is how the markup drifts out of step with
     * what the element is doing — which is exactly what had happened.
     */
    palette();
    expect(dialog()).not.toHaveAttribute("role");
    expect(dialog()).not.toHaveAttribute("aria-modal");
    expect(dialog()).toHaveAttribute("aria-label", "Command bar");
  });
});

describe("it can be driven entirely from the keyboard", () => {
  it("moves through matches with the arrow keys", async () => {
    palette();
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowDown}");

    expect(screen.getAllByRole("option")[1])
      .toHaveAttribute("aria-selected", "true");
  });

  it("wraps around rather than stopping at the end", async () => {
    /** Wrapping is deliberate here; a list that dead-ends feels broken. */
    palette();
    await screen.findAllByRole("option");

    await userEvent.keyboard("{ArrowUp}");

    const options = screen.getAllByRole("option");
    expect(options[options.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("also answers the emacs bindings it advertises", async () => {
    palette();
    await screen.findAllByRole("option");

    await userEvent.keyboard("{Control>}n{/Control}");

    expect(screen.getAllByRole("option")[1])
      .toHaveAttribute("aria-selected", "true");
  });

  it("runs the highlighted command on Enter", async () => {
    const { list, onClose } = palette();
    await screen.findAllByRole("option");

    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(list[1].run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("points assistive technology at the highlighted row", async () => {
    /**
     * `aria-activedescendant` is the reason focus can stay in the input while
     * the selection moves. Without it a screen reader follows focus and never
     * hears the list change.
     */
    palette();
    const input = screen.getByRole("textbox", { name: /Search the project/i });
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-overview");

    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-findings");
  });

  it("closes on Escape through the element's own cancel event", async () => {
    /**
     * Routed through `onClose` rather than letting the browser close the
     * element directly: a native close would leave React's `open` still true,
     * so the palette would be invisible while its parent believed it was
     * showing, and the next toggle would appear to do nothing.
     */
    const { onClose } = palette();
    dialog()!.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("it says when it has nothing", () => {
  it("names the query it could not match", async () => {
    /** §123 — absence is never silent, and a blank list is an absence. */
    palette();
    const input = screen.getByRole("textbox", { name: /Search the project/i });
    await userEvent.type(input, "zzzzz");

    expect(await screen.findByText(/Nothing in this project matches/))
      .toBeInTheDocument();
    expect(screen.getByText(/zzzzz/)).toBeInTheDocument();
  });

  it("filters to what actually matches", async () => {
    palette();
    const input = screen.getByRole("textbox", { name: /Search the project/i });
    await userEvent.type(input, "find");

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Findings");
  });
});
