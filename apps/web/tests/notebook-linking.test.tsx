/**
 * `[[` link completion, reachable past the first suggestion.
 *
 * The autocomplete offered up to eight suggestions and Enter always took
 * `suggestions[0]`. There were no arrow keys, so the other seven were
 * mouse-only — visible, clickable, and unreachable by anyone working from the
 * keyboard, which in a *note editor* is everyone who is mid-sentence.
 *
 * `aria-selected={index === 0}` was hardcoded, and that is the part worth
 * naming: it was not a missing implementation but an accurate description of a
 * broken one. The first row really was the only one Enter could reach, so the
 * markup and the behaviour agreed with each other and both were wrong.
 *
 * This is the fourth place in the interface with a role that promised keyboard
 * behaviour nothing implemented — after `role="menu"`, `aria-modal` and
 * `role="tablist"`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Editor } from "@/components/notebook";
import { api } from "@/lib/api";

const TARGETS = ["Antimicrobial resistance", "Antibiotic consumption",
                 "Antarctic survey"];

beforeEach(() => {
  vi.spyOn(api, "get").mockImplementation((path: string) =>
    Promise.resolve(
      path.includes("knowledge-graph")
        ? { nodes: [] }
        : { notes: TARGETS.map((title) => ({ title })) }) as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Live, so the caret and the suggestion list behave as they do in the app. */
function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Editor
      projectId="prj_1"
      value={value}
      onChange={(next) => { setValue(next); onChange?.(next); }}
    />
  );
}

/*
 * `[[[[` types `[[`.
 *
 * `userEvent.type` reads `[` as the start of a key descriptor, so a literal
 * bracket is written `[[` — and the trigger this editor listens for is two of
 * them. Typing `"see [[Ant"` puts `see [Ant` in the box and no popup appears,
 * which looks exactly like the feature being broken.
 */
async function openSuggestions() {
  render(<Harness />);
  const box = await screen.findByLabelText("Note");
  await userEvent.type(box, "see [[[[Ant");
  await waitFor(() => expect(screen.getAllByRole("option").length)
    .toBeGreaterThan(1));
  return box;
}

describe("every suggestion can be reached from the keyboard", () => {
  it("starts on the first one", async () => {
    await openSuggestions();
    expect(screen.getByRole("option", { selected: true }))
      .toHaveTextContent(TARGETS[0]);
  });

  it("moves down the list with the arrow keys", async () => {
    /** There were no arrow keys at all: this is the whole defect. */
    await openSuggestions();

    await userEvent.keyboard("{ArrowDown}");

    expect(screen.getByRole("option", { selected: true }))
      .toHaveTextContent(TARGETS[1]);
  });

  it("wraps from the first back to the last", async () => {
    await openSuggestions();

    await userEvent.keyboard("{ArrowUp}");

    const options = screen.getAllByRole("option");
    expect(options[options.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("completes the highlighted suggestion, not always the first", async () => {
    /**
     * The functional half. Enter took `suggestions[0]` regardless of anything,
     * so seven of eight offers could not be accepted without a mouse.
     */
    const seen: string[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);
    const box = await screen.findByLabelText("Note");
    await userEvent.type(box, "see [[[[Ant");
    await waitFor(() => expect(screen.getAllByRole("option").length)
      .toBeGreaterThan(1));

    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(seen[seen.length - 1]).toContain(`[[${TARGETS[1]}]]`);
  });

  it("tells assistive technology which one is highlighted", async () => {
    /**
     * `aria-activedescendant` is what lets the selection move while focus stays
     * in the textarea — and focus has to stay there, because the researcher is
     * in the middle of a sentence and the caret goes with it.
     */
    const box = await openSuggestions();
    expect(box).toHaveAttribute("aria-activedescendant", "nb-suggest-0");

    await userEvent.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", "nb-suggest-1");
  });

  it("says the list is open, and what it controls", async () => {
    const box = await openSuggestions();
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(box).toHaveAttribute("aria-controls", "nb-suggest");
  });

  it("is a combobox, which is what makes those attributes mean anything",
     async () => {
    /**
     * A `<textarea>` is implicitly a `textbox`, and `textbox` does not support
     * `aria-expanded` or `aria-activedescendant`. All three attributes were
     * set and every one of them was inert: the sighted reader watched a list
     * appear under the caret and a screen reader was told nothing at all.
     * Asserting the attributes — which the two tests above do — passed the
     * whole time, because an attribute that is present is not an attribute
     * that is honoured.
     *
     * Queried by role rather than by attribute, so the assertion fails if the
     * role is dropped and the attributes are left behind.
     */
    const box = await openSuggestions();
    expect(box).toBe(screen.getByRole("combobox", { expanded: true }));
  });
});

describe("the selection cannot outlive the list it belongs to", () => {
  it("returns to the first suggestion when the list is rebuilt", async () => {
    /**
     * The crash this prevents: arrow down to the third suggestion, type one
     * more character so only one matches, press Enter — and without the reset
     * `suggestions[active]` is `undefined`, which writes `[[undefined]]` into
     * the researcher's note.
     */
    const seen: string[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);
    const box = await screen.findByLabelText("Note");
    await userEvent.type(box, "see [[[[Ant");
    await waitFor(() => expect(screen.getAllByRole("option").length)
      .toBeGreaterThan(1));

    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    // Narrow the list under the selection.
    await userEvent.type(box, "arctic");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));

    await userEvent.keyboard("{Enter}");

    const written = seen[seen.length - 1];
    expect(written).toContain("[[Antarctic survey]]");
    expect(written).not.toContain("undefined");
  });
});

describe("the list is shaped the way its role requires", () => {
  it("owns its options directly", async () => {
    /**
     * It was `<ul role="listbox"><li><button role="option">`, which puts a
     * `listitem` between the listbox and the things it owns.
     */
    await openSuggestions();
    const listbox = screen.getByRole("listbox");

    for (const option of screen.getAllByRole("option")) {
      expect(option.parentElement).toBe(listbox);
    }
  });

  it("marks exactly one option selected", async () => {
    await openSuggestions();
    const chosen = screen.getAllByRole("option")
      .filter((o) => o.getAttribute("aria-selected") === "true");

    expect(chosen).toHaveLength(1);
  });
});

describe("when the list of pages could not be loaded", () => {
  /*
   * The suggester matched against a list that was empty because the request
   * failed, and the empty state says "Nothing called '<query>' yet — finish
   * the link and it becomes a page waiting to be written." That is a definite
   * claim that no such page exists, made when nothing had found out, and it
   * invites the researcher to write a second page for a note they already
   * have. A missing suggestion is a small loss; a split note is not.
   */
  async function typeALink() {
    render(<Harness />);
    const box = await screen.findByLabelText("Note");
    await userEvent.type(box, "see [[[[Ant");
    return box;
  }

  it("does not claim the page does not exist", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("notebook unreachable"));

    await typeALink();

    await waitFor(() =>
      expect(screen.getByText(/could not be loaded/)).toBeTruthy());
    expect(screen.queryByText(/yet — finish the link/)).toBeNull();
  });

  it("still says a name is free when the list was read and holds nothing",
     async () => {
    // The other half: "nothing called that yet" has to keep meaning that, and
    // it only does if the case where nobody found out reads differently.
    vi.spyOn(api, "get").mockImplementation((path: string) =>
      Promise.resolve(path.includes("knowledge-graph")
        ? { nodes: [] } : { notes: [] }) as never);

    await typeALink();

    await waitFor(() =>
      expect(screen.getByText(/yet/)).toBeTruthy());
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });
});
