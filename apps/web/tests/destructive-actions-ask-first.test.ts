/**
 * Every destructive action either asks first, or is written down as reversible.
 *
 * §96 has stood as partial with the note "no confirmation step before
 * destructive actions". That has not been true for a while — `ConfirmDialog`
 * exists and is thorough: it lists consequences, can require the name typed,
 * focuses the safe choice rather than the destructive one, and refuses to
 * close while the request is in flight. It was simply not used everywhere.
 *
 * Deleting a project asked. Removing the stored model key did not: one
 * `btn-danger` labelled "Remove", and the key is gone — a credential the
 * researcher must go back to the provider for, and may not have kept.
 *
 * The rule is not "confirm everything". A dialog on every action is how people
 * learn to click through dialogs, and this codebase already reasons that way
 * about blocking a button that the lifecycle already guards. So an action may
 * instead be listed here as reversible, with the reason — which is a claim
 * somebody has to write down and can be argued with, rather than an omission.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");

/**
 * Deletions that need no dialog, and why. Each is reversible by the researcher
 * without going anywhere else.
 */
const REVERSIBLE: Record<string, string> = {
  "board/Board.tsx":
    "Removing a card takes it off the board; the research object it stands "
    + "for is untouched and can be put back from the same panel.",
  "literature/PaperReader.tsx":
    "Rubbing out a mark is a deliberate eraser gesture, held over the mark, "
    + "and it restores the mark if the server refuses. A dialog per eraser "
    + "stroke would make the gesture unusable.",
};

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, found);
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

const deleters = sources(join(WEB, "components"))
  .filter((f) => /\bapi\.del(ete)?\s*[<(]/.test(readFileSync(f, "utf8")))
  .map((f) => f.slice(join(WEB, "components").length + 1));

describe("destructive actions", () => {
  it("finds the deletions, so an empty scan cannot pass", () => {
    expect(deleters.length).toBeGreaterThanOrEqual(4);
  });

  it("asks first, unless it is written down as reversible", () => {
    const silent = deleters.filter((name) => {
      if (name in REVERSIBLE) return false;
      const source = readFileSync(join(WEB, "components", name), "utf8");
      return !source.includes("ConfirmDialog");
    });
    expect(silent, "these delete without asking and without a reason on "
      + "record: " + silent.join(", ")).toEqual([]);
  });

  it("keeps every exemption explained", () => {
    for (const [name, why] of Object.entries(REVERSIBLE)) {
      expect(deleters, `${name} is exempted here and no longer deletes `
        + `anything — remove the exemption`).toContain(name);
      expect(why.length, name).toBeGreaterThan(60);
    }
  });
});
