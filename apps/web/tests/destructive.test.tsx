/**
 * The delete path, and the safeguards on it.
 *
 * Everything else in this interface is recoverable. Deleting a project is not:
 * there is no archive and no trash, and the sources, analyses, findings and
 * notebook go with it. So the properties tested here are not about rendering —
 * they are the four ways a confirmation dialog quietly stops being a safeguard.
 *
 *   Focus must not land on the destructive button, or a dialog that appears
 *   under a finger already moving toward Enter deletes a corpus.
 *
 *   The typed confirmation must arm on an exact match and nothing looser.
 *
 *   Escape must not dismiss while the request is in flight, or the researcher
 *   is left not knowing whether it happened.
 *
 *   And a failed delete must leave the project visibly present. An optimistic
 *   removal that fails is the interface claiming something is gone which is
 *   still in the database — the one lie it must never tell.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ProjectMenu } from "@/components/ProjectMenu";
import { AccountMenu } from "@/components/AccountMenu";
import { api } from "@/lib/api";

// happy-dom does not implement the top-layer dialog methods. They are stubbed
// to track open state so the component's own logic is what is under test.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const PROJECTS = [
  { id: "prj_1", name: "Resistance", research_question: "Does it hold?" },
  { id: "prj_2", name: "Stewardship" },
];

/**
 * The switcher's trigger.
 *
 * Selected by class rather than by accessible name: the name comes from the
 * project it is showing, so a name query is really a query for "whichever
 * project happens to be current" and breaks the moment the fixture changes.
 */
/*
 * Opened with `userEvent`, not `fireEvent.click`. The switcher is a Radix
 * dropdown now and opens on `pointerdown`; a synthetic `click` alone never
 * reaches it, so a `fireEvent` version of these tests would fail for a reason
 * that has nothing to do with what they are checking.
 *
 * The rows are queried as `menuitem` rather than `button` — which is the point
 * of the change. The markup always claimed `role="menu"`, and the rows inside
 * it were plain buttons that no arrow key could reach. Querying by the role
 * the markup actually promises is what makes these tests notice if that
 * regresses.
 */
function openMenu(): HTMLElement {
  const trigger = document.querySelector<HTMLElement>(".pm-trigger");
  if (!trigger) throw new Error("the project switcher did not render");
  return trigger;
}

function openDialog(extra = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      destructive
      title="Delete Resistance?"
      body="This removes the project and everything inside it."
      consequences={["12 sources", "4 analysis runs"]}
      confirmLabel="Delete permanently"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...extra}
    />);
  return { onConfirm, onCancel };
}

describe("the confirmation before something irreversible", () => {
  it("puts focus on the safe choice, never the destructive one", async () => {
    openDialog();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  it("states what will be destroyed in counts, not adjectives", () => {
    openDialog();
    expect(screen.getByText("12 sources")).toBeInTheDocument();
    expect(screen.getByText("4 analysis runs")).toBeInTheDocument();
  });

  it("keeps the destructive button disabled until the name is typed exactly", () => {
    openDialog({ requireTyped: "Resistance" });
    const confirm = screen.getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();

    const field = screen.getByLabelText("Type Resistance to confirm");
    fireEvent.change(field, { target: { value: "Resistan" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(field, { target: { value: "Resistance" } });
    expect(confirm).not.toBeDisabled();
  });

  it("does not arm on a different project's name", () => {
    openDialog({ requireTyped: "Resistance" });
    fireEvent.change(screen.getByLabelText("Type Resistance to confirm"),
                     { target: { value: "Stewardship" } });
    expect(screen.getByRole("button", { name: "Delete permanently" }))
      .toBeDisabled();
  });

  it("cannot be dismissed while the request is in flight", () => {
    const { onCancel } = openDialog({ busy: true });
    // Escape and the close control both do nothing: a dialog that vanishes
    // mid-request leaves the researcher not knowing whether it happened.
    fireEvent(document.querySelector("dialog")!, new Event("cancel"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows the server's own error rather than a generic failure", () => {
    openDialog({ error: "Project is referenced by a published report." });
    expect(screen.getByRole("alert"))
      .toHaveTextContent("referenced by a published report");
  });
});

describe("deleting a project", () => {
  it("refetches rather than removing the row optimistically", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      counts: { sources: 3, analyses: 1 }, findings: { validated: 2 },
    } as never);
    const del = vi.spyOn(api, "del").mockResolvedValue({} as never);
    const onChanged = vi.fn();

    render(<ProjectMenu projects={PROJECTS} currentId="prj_1"
                        onSelect={vi.fn()} onChanged={onChanged}
                        onCreate={vi.fn()} />);

    await userEvent.click(openMenu());
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete Resistance" }));

    await screen.findByText(/Delete Resistance\?/);
    fireEvent.change(screen.getByLabelText("Type Resistance to confirm"),
                     { target: { value: "Resistance" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/projects/prj_1"));
    // The list is reloaded from the server; nothing is removed locally.
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("leaves the project present when the delete fails", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ counts: {}, findings: {} } as never);
    vi.spyOn(api, "del").mockRejectedValue(new Error("Database is unreachable."));
    const onChanged = vi.fn();

    render(<ProjectMenu projects={PROJECTS} currentId="prj_1"
                        onSelect={vi.fn()} onChanged={onChanged}
                        onCreate={vi.fn()} />);

    await userEvent.click(openMenu());
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete Resistance" }));
    await screen.findByText(/Delete Resistance\?/);
    fireEvent.change(screen.getByLabelText("Type Resistance to confirm"),
                     { target: { value: "Resistance" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    // The error is shown and the list is never told to refetch, so the row
    // stays exactly where it was.
    await screen.findByText(/Database is unreachable/);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("counts findings from the map's own object, not from counts", async () => {
    // `counts` carries sources and analyses; findings live in their own object
    // keyed by lifecycle. Reading counts.findings printed "undefined findings"
    // into a confirmation for an irreversible delete.
    vi.spyOn(api, "get").mockResolvedValue({
      counts: { sources: 3, analyses: 1 },
      findings: { validated: 2, exploratory: 5 },
    } as never);

    render(<ProjectMenu projects={PROJECTS} currentId="prj_1"
                        onSelect={vi.fn()} onChanged={vi.fn()}
                        onCreate={vi.fn()} />);
    await userEvent.click(openMenu());
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete Resistance" }));

    expect(await screen.findByText(/7 findings/)).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("still offers the delete when the contents cannot be counted", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("timeout"));

    render(<ProjectMenu projects={PROJECTS} currentId="prj_1"
                        onSelect={vi.fn()} onChanged={vi.fn()}
                        onCreate={vi.fn()} />);
    await userEvent.click(openMenu());
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete Resistance" }));

    // Says it could not check, rather than claiming there is nothing to lose.
    expect(await screen.findByText(/could not be counted/)).toBeInTheDocument();
  });
});

describe("signing out", () => {
  it("ends the session locally even when the server does not answer", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new Error("network"));
    const assign = vi.fn();
    Object.defineProperty(window, "location",
                          { value: { assign }, writable: true });

    render(<AccountMenu user={{ id: "u1", email: "a@b.c",
                                display_name: "Ada Lovelace" }} />);
    // `userEvent`, not `fireEvent.click`: the account menu is a Radix dropdown
    // now and opens on `pointerdown`, so a synthetic click never reaches it.
    await userEvent.click(screen.getByRole("button", { name: /Account/ }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /Sign out/ }));

    // A full navigation, not a state reset: it drops the whole heap, so no
    // previous user's data can survive a switch. And it happens regardless of
    // the request, because staying signed in because the network failed is the
    // wrong way to be careful.
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/workspace"));
  });
});
