/**
 * The tester walkthrough names screens that exist (D208).
 *
 * `docs/TRY_IT.md` §2b used to describe a five-step first pass whose step one
 * was the rail's step two, which never mentioned Discovery, and which sent the
 * reader to a screen that had since moved groups. A document maintaining a
 * second, divergent navigation is worse than none, because a tester who
 * follows it concludes the product is broken rather than the doc stale. This
 * holds §2b to the rail and the pages as they actually are.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGES, SECTIONS } from "@/components/Shell";

const doc = readFileSync(join(__dirname, "..", "..", "..", "docs", "TRY_IT.md"), "utf8");

function section2b(): string {
  const start = doc.indexOf("## 2b.");
  expect(start).toBeGreaterThan(0);
  const rest = doc.slice(start);
  const end = rest.indexOf("\n---\n");
  return end > 0 ? rest.slice(0, end) : rest;
}

describe("TRY_IT.md §2b", () => {
  it("names only screens and pages the rail has", () => {
    /** Every **bold** name in the section is a rail label, a page label, or a
     *  word the section uses for something that is not a screen ("The loop"). */
    const labels = new Set([
      ...SECTIONS.map((s) => s.label),
      ...PAGES.map((p) => p.label),
      "The loop", "This machine",
    ]);
    const named = [...section2b().matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(2);
    for (const name of named) expect(labels, name).toContain(name);
  });

  it("sends the reader to the loop rather than to a list of screens", () => {
    const text = section2b();
    expect(text).toMatch(/Overview/);
    expect(text).toMatch(/The loop/);
    // The old numbered five-step tour is gone; the loop is the tour.
    expect(text).not.toMatch(/^\s*[1-5]\.\s+\*\*/m);
  });

  it("explains the placements the loop's order cannot", () => {
    /*
     * Two things in this product are not steps of the loop, and a reader who
     * meets them in the rail has no way to work out why they are where they
     * are. The doc has to say.
     *
     * "This machine" is no longer one of them. It held the chart catalogue,
     * which needed explaining because a catalogue of chart kinds filed beside
     * Settings is a puzzle; the catalogue is a view of Figures now, and the
     * group is Settings alone, which explains itself.
     */
    const text = section2b();
    expect(text).toMatch(/Workboard/);
    expect(text).toMatch(/Chart primitives/);
    expect(text).toMatch(/Figures/);
  });
});
