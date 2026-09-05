/**
 * An object's history, mounted where the object is (plan §4.6 item 2).
 *
 * Restore-forward is the one recovery path a research object has, and it was
 * mounted inside `NodeJournal`, which the Research graph mounts and nothing
 * else does (`graphview.tsx:152`) — so it was absent from the finding, the
 * source, the analysis and the board's card, every screen that shows the
 * object being versioned. Inventory §6 rank 7.
 *
 * Two things are guarded here and they are different in kind. The first is
 * behaviour: the section names itself, so it can be found on a screen it is
 * one part of. The second is structure: `objectversions.tsx` has exactly one
 * import site under `components/`. That second one is the whole point of the
 * word "extracted" — a second mount is how one panel becomes two that drift,
 * and it is the failure this file exists to make loud.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ObjectHistory } from "@/components/objecthistory";
import { api } from "@/lib/api";

const JOURNAL = {
  object: { id: "obj_1", object_type: "analysis", title: "Sleep and reaction time",
            summary: "", created_by: "usr_1", created_at: "2026-03-01T10:00:00Z" },
  derived_from: [{ id: "obj_0", title: "Sleep dataset", type: "dataset",
                   relation: "derived_from" }],
  used_by: [],
  notes: [
    { id: "nt_1", body: "Held up against the 2019 cohort.", author_kind: "human",
      author: "usr_1", created_at: "2026-03-02T10:00:00Z" },
    { id: "nt_2", body: "The effect is not linear.", author_kind: "model",
      author: "model", model: "local", prompt: "What is odd here?",
      created_at: "2026-03-03T10:00:00Z" },
  ],
};

/** Two versions, because one version is not a history and renders nothing. */
const CHAIN = {
  current: "obj_2",
  versions: [
    { id: "obj_1", title: "First", description: null, version: 1,
      status: "superseded", created_by: "usr_1",
      created_at: "2026-03-01T10:00:00Z" },
    { id: "obj_2", title: "Second", description: null, version: 2,
      status: "active", created_by: "usr_1",
      created_at: "2026-03-02T10:00:00Z" },
  ],
};

function serve(over: Record<string, unknown> = {}) {
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    const url = String(path);
    if (url.includes("/versions")) return (over.versions ?? CHAIN) as never;
    if (url.includes("/journal")) return (over.journal ?? JOURNAL) as never;
    throw new Error(`no mock for ${url}`);
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe("the history section names itself", () => {
  it("renders a heading a reader can find it by", async () => {
    /*
     * Inside the graph the panel *is* the screen and needs no title. On a
     * detail screen it is one section among five, and a section with no
     * heading is one that gets scrolled past — which is how a capability
     * mounted everywhere still reaches nobody.
     */
    serve();
    render(<ObjectHistory projectId="prj_1" objectId="obj_1" />);
    // All of them, not one: the version chain beneath carries "Earlier
    // versions" and a single-match query would race the two fetches.
    expect((await screen.findAllByRole("heading", { name: /history|versions/i })).length)
      .toBeGreaterThan(0);
  });

  it("takes the heading level its host's outline needs", async () => {
    // The detail screens head sections with h2 under a page h1; the board's
    // card panel heads them with h3 under the card's h2. An outline that skips
    // a level is a screen reader's only map, broken.
    serve();
    const { rerender } = render(
      <ObjectHistory projectId="prj_1" objectId="obj_1" />);
    expect((await screen.findByRole("heading", { name: "History and versions" }))
      .tagName).toBe("H2");

    rerender(<ObjectHistory projectId="prj_1" objectId="obj_1" level={3} />);
    expect((await screen.findByRole("heading", { name: "History and versions" }))
      .tagName).toBe("H3");
  });

  it("is not a second landmark inside the page's own region", async () => {
    /*
     * `NodeJournal` is an `<aside>` where the graph mounts it, because there it
     * is a complementary region of its own. Nested inside a titled section of a
     * detail screen it must not be: two complementary landmarks where the page
     * has one is a worse map than no map.
     */
    serve();
    render(<ObjectHistory projectId="prj_1" objectId="obj_1" />);
    await screen.findByText(/Held up against the 2019 cohort/);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("what travels with it", () => {
  it("keeps the notes append-only, with no way to edit one", async () => {
    // Not an omission: what somebody believed at the time is evidence about how
    // they reached a conclusion. You correct a note by writing another.
    serve();
    render(<ObjectHistory projectId="prj_1" objectId="obj_1" />);
    await screen.findByText(/Held up against the 2019 cohort/);
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  it("marks a model's note as a model's, with the question above the answer", async () => {
    /*
     * `NodeJournal.tsx:11-17`'s rule, which the extraction had to carry: if a
     * model's note and a person's ever blur, the journal stops being a record
     * of what the researcher thought and becomes a record of what something
     * told them.
     */
    serve();
    const { container } = render(
      <ObjectHistory projectId="prj_1" objectId="obj_1" />);
    await screen.findByText(/The effect is not linear/);

    const model = container.querySelector('[data-kind="model"]')!;
    const person = container.querySelector('[data-kind="human"]')!;
    expect(model).not.toBeNull();
    expect(person).not.toBeNull();
    expect(model.textContent).toMatch(/written by a model/);
    expect(model.textContent).toMatch(/What is odd here\?/);
  });

  it("offers to restore forward, never to revert", async () => {
    /*
     * A control labelled "revert" invites the belief that the record now reads
     * as though the change never happened, which is exactly what a research
     * record must not say.
     */
    serve();
    const { container } = render(
      <ObjectHistory projectId="prj_1" objectId="obj_1" />);
    expect(await screen.findByRole("button", { name: /Restore this/ }))
      .toBeTruthy();
    expect(container.textContent).not.toMatch(/revert/i);
  });

  it("renders a lineage name as text when the host cannot open it", async () => {
    // §123 — a name that opens nothing is not rendered as a button.
    serve();
    render(<ObjectHistory projectId="prj_1" objectId="obj_1" />);
    expect(await screen.findByText("Sleep dataset")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sleep dataset" })).toBeNull();
  });

  it("opens a lineage name where the host can", async () => {
    const onOpenObject = vi.fn();
    serve();
    render(<ObjectHistory projectId="prj_1" objectId="obj_1"
                          onOpenObject={onOpenObject} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Sleep dataset" }));
    expect(onOpenObject).toHaveBeenCalledWith("obj_0");
  });

  it("does not take Escape from the screen it is embedded in", async () => {
    /*
     * The graph's panel closes on Escape and must. Embedded in a detail screen
     * there is nothing to close, and a second window-level listener would eat
     * the key the workspace uses to close the detail this section sits inside
     * (`page.tsx:280-303`, D194–D199).
     */
    serve();
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    render(<ObjectHistory projectId="prj_1" objectId="obj_1" />);
    await screen.findByText(/Held up against the 2019 cohort/);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(onKey).toHaveBeenCalled());
    // Still there: nothing closed it, because nothing was listening for it.
    expect(screen.getByRole("heading", { name: "History and versions" }))
      .toBeTruthy();
    window.removeEventListener("keydown", onKey);
  });
});

describe("one panel, not two", () => {
  /** Every `.tsx`/`.ts` under `components/`, relative to it. */
  function sources(dir: string, prefix = ""): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { out.push(...sources(full, `${prefix}${entry}/`)); continue; }
      if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(`${prefix}${entry}`);
    }
    return out;
  }

  it("leaves objectversions.tsx with exactly one import site", () => {
    /*
     * The failure this catches is the one the extraction exists to prevent: a
     * screen that wants version history importing `<ObjectVersions>` straight,
     * so restore-forward is mounted in two places, ordered differently, and
     * only one of them keeps the rule that the notes come first.
     *
     * One site today, and it is `NodeJournal.tsx` — the panel `<ObjectHistory>`
     * composes. A detail screen mounts `<ObjectHistory>`; nothing else mounts
     * the versions.
     */
    const components = join(__dirname, "..", "components");
    const importers = sources(components).filter((file) =>
      /from\s+["'][^"']*\bobjectversions["']/.test(
        readFileSync(join(components, file), "utf8")));
    expect(importers).toEqual(["NodeJournal.tsx"]);
  });

  it("is what the card panel mounts, rather than the versions directly", () => {
    // The board's card detail is one of the four screens §4.6.2 names. If it
    // ever reaches past `<ObjectHistory>` this assertion is how it is noticed.
    const card = readFileSync(
      join(__dirname, "..", "components", "board", "CardDetail.tsx"), "utf8");
    expect(card).toMatch(/<ObjectHistory/);
    expect(card).not.toMatch(/from\s+["'][^"']*objectversions["']/);
  });
});
