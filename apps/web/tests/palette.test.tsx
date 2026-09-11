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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Connection, Finding, Source } from "@/lib/api";
import { CommandPalette, buildCommands } from "@/components/CommandPalette";
import { PAGES, SECTIONS } from "@/components/Shell";

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

/**
 * What the palette actually indexes (plan §4.3.6, item 2.8).
 *
 * The second half of the same finding the tests above opened with. The palette
 * knew 23 sections and three kinds of object, and the inventory found four
 * more kinds of thing a project accumulates that it could not reach at all:
 * the three standalone pages under "This machine", every analysis run, every
 * report and every saved figure. A researcher with a run id in hand — out of
 * the address bar, out of an error, out of a colleague's message — had nowhere
 * to type it, because nothing here searched an id.
 *
 * These are written against `buildCommands` rather than a hand-made list,
 * because the defect was never in the ranking; it was in what was handed to
 * it.
 */

const SOURCES: Source[] = [];
const CONNECTIONS: Connection[] = [];
const FINDINGS: Finding[] = [];

const ANALYSES = [
  { id: "arun_8f21c4", method: "pearson_correlation",
    left_variable: "consumption", right_variable: "resistance_pct" },
  { id: "arun_0b7d19", method: "kruskal_wallis",
    left_variable: null, right_variable: null },
];

const REPORTS = [
  { id: "art_31aa", title: "Resistance and consumption, 2019-2024",
    artifact_type: "research_report" },
];

const FIGURES = [
  { id: "vis_77b2", title: null, visual_type: "scatter" },
];

function built(open = vi.fn(), go = vi.fn()) {
  return buildCommands({
    sections: SECTIONS,
    pages: PAGES,
    sources: SOURCES,
    connections: CONNECTIONS,
    findings: FINDINGS,
    analyses: ANALYSES,
    reports: REPORTS,
    figures: FIGURES,
    labels: { resistance_pct: "Resistance (%)" },
    go,
    open,
  });
}

/** Type into the open palette and read back the rows it offers. */
async function offers(query: string, list = built()) {
  render(<CommandPalette open onClose={vi.fn()} commands={list} />);
  const input = screen.getByRole("textbox", { name: /Search the project/i });
  await userEvent.type(input, query);
  return screen.queryAllByRole("option").map((row) => row.textContent ?? "");
}

describe("the palette indexes everything the project has", () => {
  it("offers a standalone page by name", async () => {
    /**
     * `/air-ink` is a route, not a section, so it was in neither the palette's
     * section list nor any object list — reachable only from a rail row that
     * falls below the fold on a 900px laptop, which is the same defect the
     * pinned footer was written to fix from the other end.
     */
    const rows = await offers("air");
    expect(rows.join(" | ")).toMatch(/Draw in the air/);
  });

  it("navigates to a page rather than changing section", async () => {
    /**
     * §123 — a control does what it appears to do. The workspace navigates by
     * `pushState` within one page, so calling `go` for `/air-ink` would close
     * the palette and leave the researcher where they were. This is the one
     * command in the list that must be a real page load.
     */
    const assign = vi.fn();
    const go = vi.fn();
    // Restored by hand rather than by `restoreAllMocks`: `window.location` is
    // not a mock, it is a redefined property, and leaving a stub behind would
    // break whatever ran next in this file.
    const original = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true, value: { assign },
    });
    try {
      const page = built(vi.fn(), go).find((c) => c.label === "Draw in the air");
      page!.run();

      expect(assign).toHaveBeenCalledWith("/air-ink");
      expect(go).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window, "location", original);
    }
  });

  it("finds an analysis by the id somebody is holding", async () => {
    /**
     * The failure this closes: `arun_8f21c4` appears in the address bar and in
     * every server error about that run, and pasting it into the palette
     * matched nothing at all, because only labels were searched and no label
     * contains an id.
     */
    const rows = await offers("arun_8f21c4");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/pearson correlation/);
  });

  it("opens the analysis it matched, in the section that shows a run", async () => {
    const open = vi.fn();
    const list = built(open);
    render(<CommandPalette open onClose={vi.fn()} commands={list} />);
    const input = screen.getByRole("textbox", { name: /Search the project/i });

    await userEvent.type(input, "arun_8f21c4{Enter}");

    expect(open).toHaveBeenCalledWith("analyses", "analysis", "arun_8f21c4");
  });

  it("matches an id from its front, and never in the middle", async () => {
    /**
     * Ids are hex. The subsequence rule that makes `rsp` find `resistance_pct`
     * would, applied to `arun_8f21c4`, match on almost any query — so an id is
     * matched literally and by prefix only, which are the two shapes that
     * happen: pasted whole, or typed from the start.
     */
    expect((await offers("arun_")).length).toBe(2);
    cleanup();
    // A fragment out of the middle of an id is not a search anybody performs,
    // and treating it as one is what buries the labels.
    expect(await offers("8f21c4")).toHaveLength(0);
  });

  it("does not let a one-letter query become a list of ids", async () => {
    /**
     * Every analysis id starts `arun_`, so matching ids on one character would
     * put the whole run table above the section somebody was typing towards.
     * The list is capped at 40; a flood is a hide.
     */
    const rows = await offers("a");
    expect(rows[0]).toMatch(/Analyses|Activity/);
  });

  it("names an analysis by what it tested, not by its method alone", async () => {
    /**
     * The rule `nameOf` follows in the analyses list: a swept run is known by
     * its pair. Approved labels are used, because a palette full of raw column
     * names is unsearchable — which is why `labels` existed here already.
     */
    const rows = await offers("consumption");
    expect(rows.join(" | ")).toMatch(/consumption × Resistance \(%\)/);
  });

  it("falls back to the method when a run belongs to no pair", async () => {
    // A specified run has no left/right pair, and `kruskal_wallis` with its
    // underscores is a database value, not a name.
    const rows = await offers("kruskal");
    expect(rows.join(" | ")).toMatch(/kruskal wallis/);
  });

  it("offers reports and figures, which nothing indexed before", async () => {
    const open = vi.fn();
    const list = built(open);
    expect(list.find((c) => c.id === "art:art_31aa")?.group).toBe("Report");
    list.find((c) => c.id === "art:art_31aa")!.run();
    expect(open).toHaveBeenCalledWith("reports", "artifact", "art_31aa");

    list.find((c) => c.id === "fig:vis_77b2")!.run();
    expect(open).toHaveBeenCalledWith("figures", "artifact", "vis_77b2");
  });

  it("gives an untitled figure the name the figures list gives it", async () => {
    // `savedfigures.tsx` prints "Untitled scatter"; a palette row reading only
    // "" is one nobody can pick, and two names for one figure is worse.
    const rows = await offers("untitled");
    expect(rows.join(" | ")).toMatch(/Untitled scatter/);
  });

  it("says what it indexes, in the box you type into", async () => {
    /**
     * The placeholder listed four of the seven kinds it now searches. A
     * control that under-describes itself is the mirror of §123: nobody types
     * an analysis id into a box that never claimed to know one.
     */
    render(<CommandPalette open onClose={vi.fn()} commands={built()} />);
    const input = screen.getByRole("textbox", { name: /Search the project/i });

    for (const kind of
         ["section", "source", "connection", "finding", "analysis", "report",
          "figure", "page"]) {
      expect(input.getAttribute("placeholder"), kind).toContain(kind);
    }
  });
});

describe("reopening the palette", () => {
  it("starts empty, rather than appending to the last question", () => {
    /**
     * The palette kept its query across a close and a reopen, so a second
     * search was typed onto the first — "air" then an id became "airarun_…"
     * and offered nothing, which reads as the object not existing (T136).
     */
    const { rerender } = render(
      <CommandPalette open onClose={() => {}} commands={[]} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "air" } });
    expect(input.value).toBe("air");
    rerender(<CommandPalette open={false} onClose={() => {}} commands={[]} />);
    rerender(<CommandPalette open onClose={() => {}} commands={[]} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });
});
