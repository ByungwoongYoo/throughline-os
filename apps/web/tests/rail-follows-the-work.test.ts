/**
 * The rail lists the work in the order the work happens.
 *
 * Every label in this rail carries a reason. The *order* of the Discover group
 * did not, and it ran backwards through its own data model: Connections,
 * Findings, Analyses. A finding is assembled `from_connections`, and every
 * connection joins to an `analysis_run` — so a researcher scanning the rail
 * met the two things a run produces before the run itself.
 *
 * This is a small thing that is felt constantly. The rail is the map of the
 * product, and a map whose steps are out of order teaches the wrong sequence
 * to everybody who reads it before they know better.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTIONS } from "@/components/Shell";

const positionOf = (id: string) => SECTIONS.findIndex((s) => s.id === id);

describe("the order of the rail is the order of the work", () => {
  it("finds the sections, so a broken scan cannot pass", () => {
    expect(SECTIONS.length).toBeGreaterThan(15);
    for (const id of ["analyses", "connections", "findings"]) {
      expect(positionOf(id), id).toBeGreaterThanOrEqual(0);
    }
  });

  it("puts an analysis before the connection it produces", () => {
    expect(positionOf("analyses")).toBeLessThan(positionOf("connections"));
  });

  it("puts a connection before the finding assembled from it", () => {
    /** `findings.create_finding` takes `from_connections` and refuses without
     *  them, so this is the data model's own order. */
    expect(positionOf("connections")).toBeLessThan(positionOf("findings"));
  });

  it("keeps discovery ahead of the analyses it suggests", () => {
    /** A sweep proposes candidates; an analysis tests one of them. */
    expect(positionOf("discover")).toBeLessThan(positionOf("analyses"));
  });

  it("keeps sources ahead of everything that reads them", () => {
    expect(positionOf("sources")).toBeLessThan(positionOf("discover"));
    expect(positionOf("sources")).toBeLessThan(positionOf("figures"));
  });

  it("keeps writing after the work it writes about", () => {
    for (const writing of ["reports", "figures", "notebook"]) {
      expect(positionOf("findings"), writing)
        .toBeLessThan(positionOf(writing));
    }
  });

  it("leaves the spatial catalogue out of the research flow", () => {
    /**
     * Deliberate, and argued where it is defined: the catalogue draws every
     * chart from generated shapes with no project involved, and filing it
     * beside Figures "would read as an alternative way of choosing, which is
     * the habit §10 exists to discourage".
     *
     * Asserted so that a later tidy-up does not move it there in good faith.
     */
    /* Every catalogue entry sits after the last step of real work, so a
       researcher reading top to bottom finishes the job before meeting the
       showroom. "Chart primitives" is a section and belongs there; the
       spatial catalogue is a plain link and is not a section at all. */
    for (const section of SECTIONS) {
      if (/primitives|spatial/i.test(section.label)) {
        expect(positionOf(section.id), section.label)
          .toBeGreaterThan(positionOf("journal"));
      }
      expect(section.id, section.label).not.toContain("charts-3d");
    }
    /* And it is still reachable from somewhere, or this guard would be
       satisfied by deleting the catalogue outright. */
    const shell = readFileSync(
      join(__dirname, "..", "components", "Shell.tsx"), "utf8");
    expect(shell.slice(shell.indexOf("MACHINE_PAGES"))).toContain("/charts-3d");
  });
});
