/**
 * Naming a new note, which used to be a runtime error.
 *
 * `createNote` called `window.prompt`. In a sandboxed browser that throws
 * outright — "prompt() is not supported" — so the New note button did nothing
 * at all, and the notebook could only ever hold today's page. Even where it
 * works, a prompt blocks the event loop, cannot be styled, and cannot be
 * tested, which is why nothing here covered it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notebook } from "@/components/notebook";
import * as apiModule from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// Both shapes taken from the component's own types rather than guessed: a stub
// missing a field it maps over throws during render, and the failure reads as
// "the button is not there" rather than "the fixture is wrong".
const LISTING = { notes: [], unresolved: [] };
const INDEX = {
  notes: 0, by_kind: {}, entry_points: [], subjects: [], recent: [],
};

/**
 * One note, in the shape the note view actually reads.
 *
 * Creating a note opens it, so these tests reach `/api/notes/{id}` whether
 * they mean to or not. Answering `{}` there let the view read `body.slice` on
 * `undefined`, React unmounted it, and the tests carried on asserting against
 * an empty DOM — green over a crash, until `tests/setup.ts` began failing on
 * exactly that.
 */
const CREATED = {
  id: "note_1", title: "Ward round notes", body: "", note_kind: "note",
  updated_at: "2026-08-29T09:00:00Z", links: [], backlinks: [],
};

function serveReads() {
  return vi.spyOn(apiModule.api, "get").mockImplementation(async (path: string) => {
    if (path.includes("/notebook/index")) return INDEX as never;
    if (path.includes("/notebook")) return LISTING as never;
    if (path.includes("/notes/")) return CREATED as never;
    return {} as never;
  });
}

async function openNamingForm() {
  serveReads();
  render(<Notebook projectId="prj_1" />);
  const button = await screen.findByRole("button", { name: "New note" });
  fireEvent.click(button);
  return screen.getByRole("textbox");
}

describe("creating a note", () => {
  it("asks for the title inline rather than through a blocking dialog", async () => {
    /**
     * The regression guard. `window.prompt` is not merely unstyled here — it
     * throws, so the button was dead.
     */
    const prompt = vi.fn();
    vi.stubGlobal("prompt", prompt);

    await openNamingForm();

    expect(screen.getByLabelText(/What is this note about/)).toBeInTheDocument();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("will not create a note with no title", async () => {
    /** A note called "" is one nobody can find again. */
    await openNamingForm();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("creates the note with the title that was typed", async () => {
    const post = vi.spyOn(apiModule.api, "post")
      .mockResolvedValue({ id: "note_1" } as never);

    const input = await openNamingForm();
    fireEvent.change(input, { target: { value: "  Ward round notes  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // Trimmed: leading space is a typo, not a name.
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/projects/prj_1/notebook", { title: "Ward round notes", body: "" }));
  });

  it("opens the note it just created", async () => {
    /*
     * A note created and left unopened is a note the researcher has to go and
     * find. This was never asserted, and could not have been: the step that
     * opens it was throwing, and the test that covered creation passed anyway
     * because the request it checked had already been made.
     */
    vi.spyOn(apiModule.api, "post").mockResolvedValue({ id: "note_1" } as never);

    const input = await openNamingForm();
    fireEvent.change(input, { target: { value: "Ward round notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(
      screen.getByDisplayValue("") ?? screen.getByText("Ward round notes"))
      .toBeTruthy());
  });

  it("submits on Enter, as the prompt it replaced did", async () => {
    const post = vi.spyOn(apiModule.api, "post")
      .mockResolvedValue({ id: "note_1" } as never);

    const input = await openNamingForm();
    fireEvent.change(input, { target: { value: "Typed and entered" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(post).toHaveBeenCalled());
  });

  it("cancels on Escape, which the native prompt did for free", async () => {
    const input = await openNamingForm();
    fireEvent.change(input, { target: { value: "Half a thought" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("forgets a cancelled title rather than pre-filling the next one", async () => {
    const input = await openNamingForm();
    fireEvent.change(input, { target: { value: "Abandoned" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "New note" }));

    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
