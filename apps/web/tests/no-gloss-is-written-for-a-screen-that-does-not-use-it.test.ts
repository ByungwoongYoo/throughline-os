/**
 * The glossary is a table of words on screens, not a dictionary (D207, T188).
 *
 * The failure this guards against has already happened once here: `estimand`
 * sat in `GLOSSES` from the day the table was written and no screen ever
 * rendered it, so the product shipped a definition of a word it never showed.
 * A dictionary nobody reads is the thing a glossary page was rejected for
 * being, and it decays the same way — silently, one unused entry at a time.
 *
 * So every gloss must be reachable from some screen: named in a `<Term>`, in a
 * `TermList`, or in `METHOD_TERM`, which names the glosses a table picks from
 * the methods it is actually showing.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GLOSSES } from "@/components/term";

const ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Every term id named anywhere a reader could meet it. */
function glossesInUse(): Set<string> {
  const used = new Set<string>();
  // The declaration itself is not a use, and neither is a test.
  const files = [...sourceFiles(join(ROOT, "components")), ...sourceFiles(join(ROOT, "app"))]
    .filter((path) => !path.endsWith(join("components", "term.tsx")));

  for (const path of files) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/<Term\s+id="([^"]+)"/g)) used.add(match[1]);
    // A TermList is self-closing, so its attributes end at the first `/>`.
    for (const start of [...source.matchAll(/<TermList\b/g)].map((m) => m.index!)) {
      const end = source.indexOf("/>", start);
      if (end < 0) continue;
      for (const quoted of source.slice(start, end).matchAll(/"([^"]+)"/g)) used.add(quoted[1]);
    }
  }
  // The method legend picks from this table at run time.
  const term = readFileSync(join(ROOT, "components", "term.tsx"), "utf8");
  const map = /export const METHOD_TERM[\s\S]*?\n};/.exec(term);
  if (map) for (const quoted of map[0].matchAll(/: "([^"]+)"/g)) used.add(quoted[1]);
  return used;
}

describe("the glossary", () => {
  it("defines only words a screen actually shows", () => {
    const used = glossesInUse();
    const unused = Object.keys(GLOSSES).filter((word) => !used.has(word));
    expect(unused, `glossed but never rendered: ${unused.join(", ")}`).toEqual([]);
  });

  it("is the only place any of these words is defined", () => {
    // A second table would let two screens define one word two ways, which is
    // the reason there is one table at all.
    const others = [...sourceFiles(join(ROOT, "components")), ...sourceFiles(join(ROOT, "app"))]
      .filter((path) => !path.endsWith(join("components", "term.tsx")))
      .filter((path) => /\bGLOSSES\s*[:=]/.test(readFileSync(path, "utf8")));
    expect(others).toEqual([]);
  });
});
