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

/*
 * Every stylesheet the app loads. `density.css` and `sky.css` were added when
 * the workspace's rules were split out of `globals.css` — a class defined in a
 * sheet this list does not read is reported as undefined, which turns the
 * guard into a thing people silence rather than a thing they trust.
 */
const STYLESHEETS = [
  "app/globals.css", "app/density.css", "app/sky.css",
  "app/entrance.css", "app/fonts.css",
];

/**
 * Classes used in markup that no rule defines, as of this test being written.
 *
 * Each is a silent no-op today. **Do not add to this list to make a build pass**
 * — write the rule, or drop the class.
 */
const KNOWN_UNSTYLED = new Set([
  // Chart internals, mostly SVG groups that were given semantic names and never
  // any accompanying rule.
  //
  // Six fewer than when this list was written. `Binned.tsx` was using bare
  // `grid`, `axis`, `tick`, `axis-label` and `chart-note` where every other
  // chart uses `chart-grid`, `chart-axis`, `chart-tick`, `chart-axis-label` and
  // `chart-caption` — so the fix was not the invention this list was worried
  // about, it was adopting names the stylesheet already defines. That mattered
  // more than it looks: an SVG `<line>` with no stroke rule is not faint, it is
  // *invisible*, so that chart was drawing no gridlines and no axis ticks at
  // all, and its tick text fell back to black in both themes. It also missed
  // the high-contrast block, which those four class names already have.
  // What survives is one kind of thing, and it is worth naming so the next
  // entry gets triaged rather than added. Every one of these is a *modifier* on
  // an element a base class already styles — `chart chart-binned`,
  // `chart-svg map`, `chart-svg projection`, `beat-card beat-paper` — or a
  // class on something that draws nothing of its own: `upset-row` is an SVG
  // `<g>`, and `nb-list` is the first child of a two-column grid that places it
  // by position. None of them is a silent no-op the way the Binned internals
  // were, where an SVG `<line>` with no stroke rule simply did not draw.
  "chart-binned",
  "map", "projection", "upset-row",
  "beat-data", "beat-paper",
  "nb-list",
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
    const add = (value: string) => {
      for (const name of value.split(/\s+/).filter(Boolean)) {
        const files = used.get(name) ?? new Set<string>();
        files.add(file);
        used.set(name, files);
      }
    };

    for (const [, value] of source.matchAll(/className="([^"{}]+)"/g)) add(value);

    /*
     * The literal parts of a template class name.
     *
     * Interpolated `className={...}` is skipped in general, and rightly: a
     * static reading of an arbitrary expression produces false positives, and
     * a guard that accuses correct code is one somebody suppresses (D021). But
     * a template literal's *literal* segments are not arbitrary — they are
     * written out, character for character, in the source.
     *
     * There are eleven in this repository — I first wrote "two" here, from a
     * grep narrow enough to miss `rc-chip rc-${…}` and its like — and one of
     * them hid a class with no rule: `dlg${destructive ? " dlg-danger" : ""}`.
     * The check exists because a class no stylesheet defines fails silently
     * (D025), and interpolation was the shape it could not see.
     *
     * Segments adjacent to a `${...}` are dropped rather than guessed at:
     * `case-` in `case-${f.agreement}` is a prefix, not a class, and treating
     * it as one would be the false accusation this exclusion exists to avoid.
     */
    for (const [, template] of source.matchAll(/className=\{`([^`]+)`\}/g)) {
      /*
       * The class names in both cases live *inside* the interpolation —
       * `${destructive ? " dlg-danger" : ""}` — so stripping `${...}` and
       * reading what is left finds nothing at all. My first version of this
       * did exactly that and passed while catching neither.
       *
       * String literals inside the expression are read instead. They are
       * written out in the source like any other class, and a ternary between
       * two of them is the ordinary way a conditional class is spelled.
       */
      for (const [, quoted] of template.matchAll(/"([^"]*)"/g)) add(quoted);

      /*
       * The literal segments, minus anything touching a `${...}`. `case-` in
       * `case-${f.agreement}` is a prefix rather than a class, and calling it
       * one would be the false accusation this exclusion exists to avoid.
       */
      const parts = template.split(/\$\{[^}]*\}/);
      parts.forEach((part, i) => {
        let text = part;
        if (i > 0) text = text.replace(/^\S*/, " ");
        if (i < parts.length - 1) text = text.replace(/\S*$/, " ");
        add(text);
      });
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

  it("is reading the markup, so an empty scan cannot pass as a clean one", () => {
    /*
     * The other half of the same proof, and it was missing.
     *
     * The check above shows the *stylesheet* side is populated. Nothing showed
     * the *markup* side was: if `usedClasses()` came back empty — a moved
     * directory, a renamed extension, a glob that stopped matching — then
     * `offenders` is empty too and the guard passes having examined nothing.
     * A silent scan and a clean one look identical from the outside, which is
     * the failure this whole file exists to prevent, one level up.
     *
     * Both forms are asserted, because the template-literal reader is newer
     * and has no other test: dropping it would leave the count untouched.
     */
    const used = usedClasses();

    expect(used.size).toBeGreaterThan(200);
    expect(used.has("case-reasoning"), "plain className= not read").toBe(true);
    /*
     * `rc-chip` comes only from `` `rc-chip rc-${lifecycle.tone}` `` — no
     * plain `className=` anywhere writes it — so it fails if the template
     * reader stops working. My first version asserted `dlg`, which is also
     * written plainly since `dlg-danger` was removed, so disabling the
     * template reader left that assertion passing.
     */
    expect(used.has("rc-chip"), "template className={`…`} not read").toBe(true);
  });
});
