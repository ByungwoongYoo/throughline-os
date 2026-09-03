/**
 * The rail says what the screen says.
 *
 * A researcher clicks a name and arrives somewhere. If the heading is a
 * different name they have to work out whether they are in the right place, and
 * the doubt is worse than the wasted second — it teaches them not to trust the
 * navigation.
 *
 * Three had drifted. "Evidence graph" opened a screen titled "Research graph",
 * and an evidence graph genuinely existed elsewhere. "Discovery map" promised a
 * picture and opened "Discovery", which is where a sweep is started. And the
 * workboard had no heading at all — the screen §4 calls the central operating
 * surface was the one that never said what it was.
 *
 * This reads the source rather than the rendered page: happy-dom can render a
 * section, but only with a project, an API and a selection behind it, and a
 * guard that needs all three to check a name is a guard that gets deleted.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");
const shell = readFileSync(join(WEB, "components", "Shell.tsx"), "utf8");

/** Every section in the rail, with the label a reader sees. */
function railItems(): Array<{ id: string; label: string }> {
  return [...shell.matchAll(/\{ id: "(\w+)", label: "([^"]+)"/g)]
    .map((m) => ({ id: m[1], label: m[2] }));
}

/**
 * Where each section's heading lives.
 *
 * Sections whose heading is not a fixed string are listed with the reason: the
 * overview is titled with the project's own name.
 *
 * `expect` overrides the rail label, and every use of it switches off the check
 * this file exists for — a first draft set it on four sections whose headings
 * already matched, and renaming one of them back to its old wrong label passed.
 * It is for a heading that is legitimately different, and there are none today.
 */
const HEADING_IN: Record<string, { file: string; expect?: string; why?: string }> = {
  board: { file: "components/board/Board.tsx" },
  overview: { file: "", why: "Titled with the project's name, which is the more useful heading." },
  sources: { file: "components/views.tsx" },
  variables: { file: "components/variables.tsx" },
  search: { file: "components/views.tsx" },
  literature: { file: "components/literature.tsx" },
  datasearch: { file: "components/datasearch.tsx" },
  discover: { file: "components/views.tsx" },
  compare: { file: "components/compare.tsx" },
  patterns: { file: "components/patterns.tsx" },
  connections: { file: "app/workspace/page.tsx" },
  findings: { file: "components/views.tsx" },
  analyses: { file: "components/analyses.tsx" },
  graph: { file: "components/graphview.tsx" },
  embedding: { file: "components/embeddingspace.tsx" },
  reports: { file: "components/reports.tsx" },
  figures: { file: "components/figures.tsx" },
  notebook: { file: "components/notebook.tsx" },
  journal: { file: "components/journal.tsx" },
  activity: { file: "components/activity.tsx" },
  gallery: { file: "components/gallery.tsx" },
  settings: { file: "components/settings.tsx" },
};

describe("the rail and the screen agree", () => {
  it("knows about every section in the rail", () => {
    const missing = railItems().filter((i) => !(i.id in HEADING_IN));
    expect(missing.map((m) => m.id), "add these to HEADING_IN").toEqual([]);
  });

  it("gives every section a heading", () => {
    /*
     * A screen with no title is a screen a reader cannot name, and the one
     * that had none was the workboard.
     */
    const untitled = railItems().filter((item) => {
      const where = HEADING_IN[item.id];
      if (!where?.file) return false;
      return !/<h1>/.test(readFileSync(join(WEB, where.file), "utf8"));
    });
    expect(untitled.map((u) => u.label)).toEqual([]);
  });

  it("uses the same words in both places", () => {
    const wrong: string[] = [];
    for (const item of railItems()) {
      const where = HEADING_IN[item.id];
      if (!where?.file) continue;
      const source = readFileSync(join(WEB, where.file), "utf8");
      const wanted = where.expect ?? item.label;
      if (!source.includes(`<h1>${wanted}</h1>`)) {
        wrong.push(`${item.label} → no <h1>${wanted}</h1> in ${where.file}`);
      }
    }
    expect(wrong, wrong.join("; ")).toEqual([]);
  });

  it("has no stale exemption", () => {
    const live = new Set(railItems().map((i) => i.id));
    expect(Object.keys(HEADING_IN).filter((id) => !live.has(id))).toEqual([]);
  });
});
