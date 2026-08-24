/**
 * The pages a researcher can actually reach (§1, §109).
 *
 * `/gesture-check` and `/air-ink` existed for a long time and nothing linked to
 * them — not the rail, not the landing page, not the workspace. Between them
 * they are the largest and most carefully engineered part of this codebase, and
 * a researcher could only arrive by typing the URL, which nobody does.
 *
 * That is what these tests are guarding: not that the pages work, but that a
 * person can get to them. A capability nobody can find is indistinguishable
 * from one that was never built, and the way this regressed the first time was
 * silence — no test failed, because no test asked.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Shell } from "@/components/Shell";

function shell() {
  return render(
    <Shell
      section="overview"
      onSection={vi.fn()}
      map={null}
      inspector={null}
      onCommand={vi.fn()}
      projectName="A project"
      crumbs={[]}
      onDropFiles={vi.fn()}
    >
      <p>content</p>
    </Shell>,
  );
}

describe("the hand-tracking pages are reachable from the product", () => {
  it("links to the tracking check", () => {
    shell();
    const link = screen.getByRole("link", { name: /check hand tracking/i });
    expect(link).toHaveAttribute("href", "/gesture-check");
  });

  it("links to drawing in the air", () => {
    shell();
    expect(screen.getByRole("link", { name: /draw in the air/i }))
      .toHaveAttribute("href", "/air-ink");
  });

  it("uses real links, so they can be opened in a new tab", () => {
    /*
     * A button that navigated would look identical and would quietly take away
     * middle-click, cmd-click and "copy link address" — the three things
     * somebody does when they want to keep a diagnostic page open beside their
     * work, which is exactly how these pages get used.
     */
    shell();
    for (const name of [/check hand tracking/i, /draw in the air/i]) {
      expect(screen.getByRole("link", { name }).tagName).toBe("A");
    }
  });

  it("files them under the machine rather than among the research steps", () => {
    /*
     * They answer "does this camera see my hands", which is a question about
     * the machine. Listing them between Findings and Reports would say they
     * were a step in doing research, and they are not.
     */
    shell();
    const link = screen.getByRole("link", { name: /check hand tracking/i });
    const group = link.closest(".rail-group");
    expect(group?.textContent).toContain("This machine");
    expect(group?.textContent).toContain("Settings");
  });

  it("says what each one is for", () => {
    // A rail item whose label is a noun tells somebody what it is called, not
    // whether it is the thing they want.
    shell();
    expect(screen.getByRole("link", { name: /check hand tracking/i }))
      .toHaveAttribute("title", expect.stringMatching(/camera/i));
  });
});
