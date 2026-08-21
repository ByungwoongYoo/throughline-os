/**
 * A `className` that no stylesheet defines.
 *
 * CSS fails silently, which is what makes this worth a guard. A misspelled class
 * is not an error anywhere: the element renders, inherits whatever its parent
 * had, and usually looks *nearly* right — so it survives review, survives the
 * suite (happy-dom applies no CSS at all), and is found eventually by someone
 * wondering why one panel is a slightly different colour.
 *
 * D025 recorded this once already, for a `var(--surface)` that did not exist and
 * a `className="linkish"` on the exports panel that did not either. The token
 * half is guarded by `css-tokens.test.ts`. This is the class half — and it was
 * written because I reintroduced `linkish` in `SpatialControl` while building
 * the spatial panel, in a file whose whole subject is being careful.
 *
 * **On the allowlist below.** Thirteen classes predate this test. They are
 * recorded rather than fixed, because inventing styles for thirteen chart
 * internals blind would change how those figures look with nothing to check the
 * result against — a worse outcome than an honest list. The list exists to stop
 * the number growing, so removing an entry is welcome and adding one needs a
 * reason.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const STYLESHEETS = ["app/globals.css", "app/landing.css", "app/fonts.css"];

/**
 * Classes used in markup that no rule defines, as of this test being written.
 *
 * Each is a silent no-op today. **Do not add to this list to make a build pass**
 * — write the rule, or drop the class.
 */
const KNOWN_UNSTYLED = new Set([
  // Chart internals, mostly SVG groups that were given semantic names and never
  // any accompanying rule.
  "axis", "axis-label", "chart-binned", "chart-note", "grid", "tick",
  "map", "projection", "upset-row",
  "beat-data", "beat-paper",
  "nb-hint", "nb-list",
]);

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

function definedClasses(): Set<string> {
  const css = STYLESHEETS.map((file) => readFileSync(file, "utf8")).join("\n");
  return new Set(Array.from(css.matchAll(/\.([a-zA-Z][\w-]*)/g), (m) => m[1]));
}

/**
 * Only literal `className="..."` is read.
 *
 * Interpolated values (`className={...}`) are deliberately skipped: they are
 * composed at runtime and a static reading of them would produce false
 * positives, which is how a guard gets suppressed rather than fixed — the
 * lesson from D021.
 */
function usedClasses(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const file of [...walk("components"), ...walk("app")]) {
    const source = readFileSync(file, "utf8");
    for (const [, value] of source.matchAll(/className="([^"{}]+)"/g)) {
      for (const name of value.split(/\s+/).filter(Boolean)) {
        const files = used.get(name) ?? new Set<string>();
        files.add(file);
        used.set(name, files);
      }
    }
  }
  return used;
}

describe("every class in the markup exists in a stylesheet", () => {
  it("finds no class that nothing defines", () => {
    const defined = definedClasses();
    const offenders: string[] = [];

    for (const [name, files] of usedClasses()) {
      if (defined.has(name) || KNOWN_UNSTYLED.has(name)) continue;
      offenders.push(`${name} (in ${[...files].join(", ")})`);
    }

    expect(offenders, "classes with no rule in any stylesheet").toEqual([]);
  });

  it("keeps the allowlist honest", () => {
    /**
     * An allowlist nothing checks becomes a place entries go to die. If someone
     * writes the missing rule, the entry has to leave the list — otherwise the
     * list slowly stops describing anything and the guard stops meaning
     * anything.
     */
    const defined = definedClasses();
    const nowStyled = [...KNOWN_UNSTYLED].filter((name) => defined.has(name));

    expect(nowStyled, "styled now — remove these from KNOWN_UNSTYLED").toEqual([]);
  });

  it("still notices a class that is used and never defined", () => {
    /**
     * The guard proving itself, rather than being trusted. A guard for a silent
     * failure is worth exactly as much as its ability to fail.
     */
    const defined = definedClasses();

    expect(defined.has("definitely-not-a-real-class")).toBe(false);
    expect(defined.has("spatial-panel")).toBe(true);
  });
});
