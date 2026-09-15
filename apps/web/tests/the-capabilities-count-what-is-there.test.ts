/**
 * The catalogue figures in `docs/CAPABILITIES.md`, checked against the catalogue.
 *
 * They were in the README until it was restructured to say first what the
 * product is and how to run it (T186); the paragraph moved verbatim and this
 * guard moved with it. What follows is the reason it exists, as written when
 * the paragraph still lived in the README.
 *
 * They had drifted to 238 named and 199 drawable while the registry held 253
 * and drew 216 — understating the product by fifteen and seventeen, in the
 * document somebody reads before anything else.
 *
 * This is the defect the catalogue *page* was already repaired for.
 * `catalogue-draws.test.tsx` opens by recording it: a headline number was an
 * assertion in a data file with nothing behind it, and the repair was to
 * derive the number from the code rather than correct it. The page derives it
 * now — `{drawable} of {CATALOGUE.length}` — and this paragraph was left
 * typed out, so the identical rot happened in the one place with no test.
 *
 * A read me cannot derive anything at runtime. A test can, and that is the
 * whole of this file: correcting the numbers without this would leave them
 * true today and wrong again later, which is what happened the first time.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGUE } from "@/lib/charts3d/registry";
import { isDrawable } from "@/lib/charts3d/examples";

const README = readFileSync(
  join(__dirname, "..", "..", "..", "docs", "CAPABILITIES.md"), "utf8");

/**
 * The paragraph that makes the claim, so a number elsewhere cannot satisfy it.
 *
 * Whitespace is collapsed before matching. The first version asserted against
 * the line breaks as they fall today, so rewrapping the prose — an ordinary
 * edit, and one this paragraph invites, since correcting a number changes its
 * width — would have failed the test for a reason that has nothing to do with
 * whether the claim is true. A guard that fails on formatting is one somebody
 * silences.
 */
const PARAGRAPH = README.slice(
  README.indexOf("`apps/web/lib/charts3d/registry.ts` names all"),
  README.indexOf("which the registry keeps apart from a missing renderer"))
  .replace(/\s+/g, " ");

describe("the read me's catalogue figures", () => {
  it("found the paragraph, so an empty match cannot pass", () => {
    expect(PARAGRAPH.length).toBeGreaterThan(200);
    expect(CATALOGUE.length).toBeGreaterThan(200);
  });

  it("names as many visualizations as the registry holds", () => {
    expect(PARAGRAPH).toContain(`names all ${CATALOGUE.length} visualizations`);
  });

  it("claims as many drawable as the code can draw", () => {
    const drawable = CATALOGUE.filter(isDrawable).length;
    expect(PARAGRAPH).toContain(`**${drawable} today`);
  });

  it("accounts for the rest as needing another reader", () => {
    // The two numbers have to be consistent with each other as well as with
    // the registry: a paragraph can be right twice and still not add up.
    const rest = CATALOGUE.length - CATALOGUE.filter(isDrawable).length;
    expect(PARAGRAPH).toContain(`The remaining ${rest} need somebody else's reader`);
  });
});
