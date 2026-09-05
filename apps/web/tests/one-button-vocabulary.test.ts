/**
 * One button vocabulary (plan §4.6.4, Slice 2 item 2.1).
 *
 * The product had four button vocabularies and a fifth state of no class at
 * all, so the same rank of action looked different depending on which screen
 * invented its CSS first: "Search" was `btn-primary` on Search sources and
 * `.nj-primary` on Find papers and Find data — one verb, one rank, two shapes,
 * on three adjacent rail entries. `.nj-primary` and `.ct-dataset` are gone;
 * `.btn` / `.btn btn-primary` is the whole vocabulary.
 *
 * This test is the guard, and every exception to it is written down. A
 * `<button>` in `components/` carries a class, or its file is in ALLOWED below
 * with the CSS rule that already styles it and the count of buttons that rule
 * covers. The count is the honest part: an allowlisted file cannot quietly grow
 * a forty-third unstyled button, because the number would no longer match.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = join(__dirname, "..", "components");
const GLOBALS = join(__dirname, "..", "app", "globals.css");

/**
 * Files whose unclassed buttons are already styled, by a descendant selector
 * in `globals.css`, as something other than a `.btn` — a text row, a toolbar
 * segment, a list opener. Giving those `.btn` would not unify anything; it
 * would put chrome on rows that are deliberately flat. The reason names the
 * rule, so a reader can check the claim without grepping.
 */
const ALLOWED: ReadonlyArray<{ file: string; count: number; reason: string }> = [
  { file: "NodeJournal.tsx", count: 3,
    reason: "`.nj-lineage li button` (2 lineage openers) and `.nj-ask button` (the Ask field's own submit, sized to the input beside it)." },
  { file: "Shell.tsx", count: 1,
    reason: "`.crumb button` — a breadcrumb segment is text, not a control with chrome." },
  { file: "notebook.tsx", count: 4,
    reason: "`.nb-index button`, `.nb-index-hubs button` and `.nb-links button` (×2) — note titles that are the way into the note." },
  { file: "views.tsx", count: 1,
    reason: "`.steps button` — a loop row is a whole row that happens to be pressable; `.step-action .btn` is the one real control in that card and it is classed." },
  { file: "charts/Cartesian.tsx", count: 3,
    reason: "`.chart-echo button` and `.chart-selection button` (×2) — inline verbs inside a status sentence, sized to the sentence." },
  { file: "charts/ChartExport.tsx", count: 2,
    reason: "`.chart-export button` — an 11px format segment in a save strip beside the figure." },
  { file: "imaging/CaseWorkspace.tsx", count: 1,
    reason: "`.case-marklist button` — a mark's own label in a bulleted list." },
  { file: "board/Board.tsx", count: 6,
    reason: "`.board-history button` (undo, redo), `.board-picker button` (an object row), `.board-region-actions button` (rename, nudge, remove — 11px controls floating over the board itself)." },
  { file: "literature/PaperReader.tsx", count: 5,
    reason: "`.reader-bar button` — the reader's own toolbar, which also styles `aria-pressed` for the tool segments." },
  { file: "charts3d/CatalogueBrowser.tsx", count: 1,
    reason: "`.c3d-list button` — a catalogue row, with its own `aria-pressed` selected state." },
  { file: "spatial/SpatialControl.tsx", count: 2,
    reason: "`.spatial-teaching-actions button` — underlined text escapes from a teaching step, deliberately quieter than the step they interrupt." },
];

/** Every `.tsx`/`.ts` file under `components/`, as a path relative to it. */
function sources(dir = COMPONENTS, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...sources(full, `${prefix}${entry}/`)); continue; }
    if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(`${prefix}${entry}`);
  }
  return out;
}

/**
 * Comments blanked, strings kept. Without this the test reads the `<button
 * role="option">` inside `notebook.tsx`'s explanation of why that button was
 * *removed* and reports it as an unclassed control — an allowlist padded by a
 * regex mistake is not a record of anything.
 */
function withoutComments(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i += 1; continue; }
    if (src.startsWith("//", i)) {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      out += " ".repeat(stop - i); i = stop; continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      // Newlines survive so line numbers in a failure message stay true.
      for (const ch of src.slice(i, stop)) out += ch === "\n" ? "\n" : " ";
      i = stop; continue;
    }
    out += c; i += 1;
  }
  return out;
}

/** Each `<button …>` opening tag, with the line it starts on. */
function openingTags(src: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  let i = 0;
  while (i < src.length) {
    const at = src.slice(i).search(/<button[\s/>]/);
    if (at < 0) break;
    const start = i + at;
    let j = start + 7;
    let depth = 0;
    let quote: string | null = null;
    while (j < src.length) {
      const c = src[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
      j += 1;
    }
    found.push({ tag: src.slice(start, j + 1), line: src.slice(0, start).split("\n").length });
    i = j + 1;
  }
  return found;
}

/** `globals.css` with its comments blanked, so a rule name in prose is not a rule. */
function cssRules(): string {
  return readFileSync(GLOBALS, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
}

describe("one button vocabulary", () => {
  it("has retired .nj-primary from every component", () => {
    // Twelve sites across nine screens borrowed a class named for the node
    // journal. "Search" on Find papers and "Search" on Search sources are the
    // same verb at the same rank; they now render as the same button.
    const offenders = sources().filter((f) =>
      readFileSync(join(COMPONENTS, f), "utf8").includes("nj-primary"));
    expect(offenders).toEqual([]);
  });

  it("has retired .ct-dataset from every component", () => {
    // Nine sites, of which four were on Find papers alone.
    const offenders = sources().filter((f) =>
      readFileSync(join(COMPONENTS, f), "utf8").includes("ct-dataset"));
    expect(offenders).toEqual([]);
  });

  it("has deleted both rules from the stylesheet", () => {
    // Deleting the markup and leaving the rule is how a dead vocabulary comes
    // back: the next control that wants an accent fill finds it still defined.
    const css = cssRules();
    expect(css).not.toMatch(/\.nj-primary\s*[,{:]/);
    expect(css).not.toMatch(/\.ct-dataset\s*[,{:]/);
  });

  it("does not leave an anchor wearing .btn underlined", () => {
    // `a { color: inherit }` resets the colour and not the decoration, which is
    // why four same-rank controls on the finding detail had four appearances.
    expect(cssRules()).toMatch(/a\.btn\s*\{[^}]*text-decoration:\s*none/);
  });

  it("gives every <button> in components/ a class, or names the rule that styles it", () => {
    const unexplained: string[] = [];
    const counts = new Map<string, number>();

    for (const file of sources()) {
      const src = withoutComments(readFileSync(join(COMPONENTS, file), "utf8"));
      for (const { tag, line } of openingTags(src)) {
        if (tag.includes("className")) continue;
        counts.set(file, (counts.get(file) ?? 0) + 1);
        if (!ALLOWED.some((entry) => entry.file === file)) {
          unexplained.push(`${file}:${line} ${tag.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }

    // A new bare button in a file nobody excused: the fifth vocabulary
    // returning. `btn`, `btn btn-primary` or `pick` — or an ALLOWED entry
    // saying which rule already dresses it.
    expect(unexplained).toEqual([]);

    // And the excused files may not grow. The count is what makes ALLOWED a
    // record rather than a blanket.
    for (const entry of ALLOWED) {
      expect(`${entry.file}: ${counts.get(entry.file) ?? 0}`)
        .toBe(`${entry.file}: ${entry.count}`);
    }
  });

  it("keeps every allowlist entry pointing at a rule that exists", () => {
    // An excuse that names a selector the stylesheet no longer has is not an
    // excuse, and this is the failure that catches a rename in globals.css.
    const css = cssRules();
    for (const entry of ALLOWED) {
      const selectors = entry.reason.match(/`\.[^`]*button[^`]*`/g) ?? [];
      expect(selectors.length, `${entry.file} names no selector`).toBeGreaterThan(0);
      for (const quoted of selectors) {
        const selector = quoted.replace(/`/g, "").trim();
        expect(css, `${entry.file} cites ${selector}`).toContain(selector);
      }
    }
  });
});
