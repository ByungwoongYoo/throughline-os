/**
 * Nothing responds to a click and not to a key.
 *
 * Five lists selected their row from an `onClick` on a `<tr>` or a `<div>` —
 * sources, connections, analysis runs, reports and graph nodes. None of those
 * elements is focusable, and none of the rows held anything that was, so
 * choosing a source was something only a mouse could do. That is §30 and Rule 5
 * failing on the most ordinary action in the product: picking the thing you
 * want to look at.
 *
 * It is a *structural* guard rather than five behavioural tests because the
 * defect is structural. Each of those five was written independently, by
 * someone reaching for the obvious thing, and a test per list would only have
 * caught the five that already existed — the sixth would arrive the same way.
 * This asks the question of every file at once.
 *
 * **What counts as fixed.** Either the element handles keys itself, or it
 * declares a role and a tab stop, or — the pattern actually used here — it
 * contains a real control. The row keeps its click as a convenience for the
 * mouse; the title inside it becomes a `<button>`, which is a tab stop, is
 * announced as actionable, and answers Enter and Space with no hand-written
 * `keydown` at all.
 *
 * Deliberately approximate. It reads a bounded window of text after each
 * opening tag rather than parsing JSX, so it can miss a control that sits far
 * enough away. A guard that tries to be exact here needs a real parser, and one
 * that guesses gets muted the first time it is wrong — so this errs toward
 * silence and catches the shape that actually keeps recurring.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

/** Elements that are not focusable and have no behaviour of their own. */
const INERT = [
  "div", "span", "li", "tr", "td", "p", "section", "article", "figure",
  "circle", "rect", "path", "g", "image", "ul", "ol", "header", "footer",
  "aside", "main", "nav", "label", "h1", "h2", "h3", "h4",
].join("|");

/** Anything that gives a keyboard a way in. */
const REACHABLE = /<button|<a\s|<Link|<input|<select|<textarea|className="pick"|role="(button|option|menuitem|menuitemradio|tab)"/;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** How far past the opening tag to look for a control. */
const WINDOW = 1400;

export function clickOnly(source: string): Array<{ tag: string; line: number }> {
  const found: Array<{ tag: string; line: number }> = [];
  const opening = new RegExp(`<(${INERT})\\b[^>]*?onClick`, "gs");

  for (const match of source.matchAll(opening)) {
    const from = match.index ?? 0;
    const segment = source.slice(from, from + WINDOW);
    const tagEnd = segment.indexOf(">");
    const attrs = segment.slice(0, tagEnd > 0 ? tagEnd : WINDOW);

    // The element handles keys itself, or is declared operable.
    if (/onKeyDown|onKeyUp|onKeyPress/.test(attrs)) continue;
    if (/role=/.test(attrs) && /tabIndex/.test(attrs)) continue;

    // Or it *contains* something a keyboard can reach. Searched from after the
    // opening tag on purpose: matching the tag's own attributes let
    // `<div onClick role="button">` through, because the regex saw the role it
    // was carrying and read it as a control. A role with no tab stop is the
    // same lie in a different place — announced as operable, unreachable.
    const children = segment.slice(tagEnd > 0 ? tagEnd + 1 : WINDOW);
    if (REACHABLE.test(children)) continue;

    found.push({ tag: match[1], line: source.slice(0, from).split("\n").length });
  }
  return found;
}

describe("a click is never the only way", () => {
  it("leaves nothing selectable by mouse alone", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(join(ROOT, "components")),
                        ...sourceFiles(join(ROOT, "app"))]) {
      for (const { tag, line } of clickOnly(readFileSync(file, "utf8"))) {
        offenders.push(`${file.slice(ROOT.length + 1)}:${line} <${tag}>`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("catches a row that only answers a mouse", () => {
    /**
     * The mutation, kept as a test. Without this the guard above would pass
     * just as happily while reading nothing at all — which is how the last
     * stylesheet guard in this suite managed to pass against the bug it was
     * written to catch.
     */
    const bad = `<tr onClick={() => pick(id)}><td>{row.title}</td></tr>`;
    expect(clickOnly(bad)).toHaveLength(1);
  });

  it("accepts a row whose title is a real control", () => {
    const good = `<tr onClick={() => pick(id)}>
      <td><button type="button" className="pick" onClick={go}>{row.title}</button></td>
    </tr>`;
    expect(clickOnly(good)).toHaveLength(0);
  });

  it("accepts an element that handles keys itself", () => {
    const good = `<div onClick={go} onKeyDown={onKey} role="button" tabIndex={0}>x</div>`;
    expect(clickOnly(good)).toHaveLength(0);
  });

  it("does not accept a role without a tab stop", () => {
    /**
     * `role="button"` on something nothing can focus is the same lie in a
     * different place: announced as operable, and unreachable.
     */
    const bad = `<div onClick={go} role="button">x</div>`;
    expect(clickOnly(bad)).toHaveLength(1);
  });
});
