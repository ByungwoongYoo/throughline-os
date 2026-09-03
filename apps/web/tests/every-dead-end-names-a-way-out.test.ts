/**
 * An empty screen says what would fill it.
 *
 * Forty-nine screens in this product can be empty, and forty-seven of them
 * already told the researcher what to do next — "Run discovery to search for
 * candidates", "Validate a connection, then record what it shows". Two did
 * not, and those two are the ends of the two longest journeys in the product:
 * a finding with no claims, and a connection that could not be loaded.
 *
 * A first run is nothing but empty screens. Every one that reports absence
 * without naming a cause is a place the journey stops, so this is checked for
 * all of them rather than fixed twice and forgotten.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        sources(path, found);
      }
    } else if (entry.name.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

/** The whole `<Empty ... >` opening tag, braces balanced so a `{...}` prop
 *  containing a ">" does not truncate it. */
function emptyTags(source: string): string[] {
  const tags: string[] = [];
  for (let i = source.indexOf("<Empty"); i !== -1;
       i = source.indexOf("<Empty", i + 1)) {
    if (/[A-Za-z]/.test(source[i + 6] ?? "")) continue;  // <EmptySomething
    let depth = 0;
    let j = i;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(source.slice(i, j));
  }
  return tags;
}

const files = sources(join(ROOT, "components"))
  .concat(sources(join(ROOT, "app")));

describe("an empty screen names a way out", () => {
  it("finds the empty states, so an empty scan cannot pass", () => {
    const total = files
      .map((f) => emptyTags(readFileSync(f, "utf8")).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(40);
  });

  it("gives every one of them a hint", () => {
    const dead: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const tag of emptyTags(source)) {
        if (!/\bhint[=\s]/.test(tag)) {
          dead.push(`${file.slice(ROOT.length + 1)}: ${
            tag.replace(/\s+/g, " ").slice(0, 70)}`);
        }
      }
    }
    expect(dead, "empty states that report absence and stop").toEqual([]);
  });

  it("does not accept a blank hint as an answer", () => {
    for (const file of files) {
      for (const tag of emptyTags(readFileSync(file, "utf8"))) {
        const written = /hint="([^"]*)"/.exec(tag);
        if (written) {
          expect(written[1].trim().length,
                 `${file}: ${written[1]}`).toBeGreaterThan(15);
        }
      }
    }
  });
});
