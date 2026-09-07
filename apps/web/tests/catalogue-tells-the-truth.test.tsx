/**
 * The catalogue may not claim this product cannot do something it can.
 *
 * `needs-library` is the strongest negative promise the catalogue makes, and
 * the most expensive to get wrong: a reader deciding whether the tool fits
 * their work takes it at its word and stops looking. Two entries carried it
 * falsely at once.
 *
 * "Interactive globe" said "a basemap and a projection, neither of which is
 * here" — `world-atlas` is a bundled dependency, `d3-geo` projects for
 * `Geographic`, and `Globe3D` was already drawing on the same page. And
 * "Molecular dynamics trajectory" said `needs-library` in a note that read
 * "Mol* draws the frames", while Mol* is in `package.json` and seven other
 * entries name it as their viewer.
 *
 * A third arrived later and in the same shape: clicking "3D globe" answered
 * "No renderer here draws a globe yet, so 3D globe cannot be shown" — a few
 * hundred pixels below a rotatable earth with coastlines and a graticule. Not
 * stale; false, and falsifiable by scrolling up. The real reason was better and
 * hidden: a globe is drawn from coastlines, which are a fact about the world
 * rather than something to synthesize, so there is no honest example to invent.
 *
 * Both were found by a reader looking at the rendered list, not by the suite.
 * The existing registry tests check internal consistency — no name twice, no
 * status contradicting its primitive — and neither of these contradicted
 * anything *inside* the catalogue. They contradicted the repository.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CATALOGUE } from "@/lib/charts3d/registry";
import { CatalogueChart } from "@/components/charts3d/CatalogueChart";
import {
  RENDERED, RENDERER_NEEDS_REAL_DATA, exampleFor,
} from "@/lib/charts3d/examples";

const packaged = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
const installed = new Set([
  ...Object.keys(packaged.dependencies ?? {}),
  ...Object.keys(packaged.devDependencies ?? {}),
]);

/**
 * How a library is written in prose against the package that provides it.
 *
 * Only libraries this catalogue actually names. A guard that tried to match
 * every npm package against free text would fire on the word "three" and be
 * turned off within a week.
 */
const NAMED_IN_PROSE: Array<[RegExp, string]> = [
  [/\bmol\*/i, "molstar"],
  [/\bmolstar\b/i, "molstar"],
  [/\bvtk\.?js\b/i, "vtk.js"],
  [/\bniivue\b/i, "niivue"],
  [/\bworld-atlas\b/i, "world-atlas"],
  [/\btopojson\b/i, "topojson-client"],
  [/\bd3-geo\b/i, "d3-geo"],
];

describe("a negative promise is checked against the repository", () => {
  it("has entries that make the claim, so this cannot pass vacuously", () => {
    expect(CATALOGUE.filter((v) => v.status === "needs-library").length)
      .toBeGreaterThan(0);
  });

  it("makes every negative claim checkable, by stating its reason", () => {
    /**
     * The root cause, and the reason the check below was weaker than it
     * looked. All twenty-four remaining `needs-library` entries carried **no
     * note at all** — so the guard that reads notes for a false claim passed
     * over every one of them vacuously, one commit after it was written.
     *
     * A negative claim with no reason cannot be checked by a test, by a
     * reviewer, or by the researcher deciding whether this tool does their
     * work. "Needs a library this codebase does not have" is the strongest
     * thing the catalogue says about its own limits, and saying it without
     * saying *which* library and *why* is an assertion dressed as a finding.
     */
    const silent = CATALOGUE
      .filter((v) => v.status === "needs-library" && !(v.note ?? "").trim())
      .map((v) => v.name);
    expect(silent, `needs-library with no stated reason: ${silent.join(", ")}`)
      .toEqual([]);
  });

  it("never says a library is missing when it is installed", () => {
    const wrong: string[] = [];
    for (const entry of CATALOGUE) {
      if (entry.status !== "needs-library") continue;
      for (const [written, packageName] of NAMED_IN_PROSE) {
        if (written.test(entry.note ?? "") && installed.has(packageName)) {
          wrong.push(`${entry.name} says it needs ${packageName}, which is a `
            + `dependency — mark it "specialist" with that viewer`);
        }
      }
    }
    expect(wrong, wrong.join("\n  ")).toEqual([]);
  });

  it("does not file a globe under a primitive that draws flat grids", () => {
    /**
     * The defect that started this: three globes were drawn by the `surface`
     * renderer as height fields on a rectangular lattice. A fourth was missed
     * and sat in the catalogue for another two commits, which is the argument
     * for asking the question of every entry rather than of the three that
     * were noticed.
     */
    const misfiled = CATALOGUE
      .filter((v) => /\bglobe\b/i.test(v.name) && v.primitive !== "globe")
      .map((v) => `${v.name} is filed under "${v.primitive}"`);
    expect(misfiled, misfiled.join("; ")).toEqual([]);
  });

  it("gives every specialist entry a viewer that exists", () => {
    /** Already true, and asserted here because the two fixes above moved an
     *  entry into `specialist` — a status that is only meaningful if the
     *  viewer resolves. */
    const viewers = new Set(["molstar", "vtk", "niivue", "geomap"]);
    for (const entry of CATALOGUE) {
      if (entry.status !== "specialist") continue;
      expect(viewers.has(entry.viewer ?? ""), `${entry.name} names "${entry.viewer}"`)
        .toBe(true);
    }
  });
});

/** One catalogue entry by name, so a renamed entry fails loudly. */
const namedEntry = (name: string) => {
  const found = CATALOGUE.find((e) => e.name === name);
  if (!found) throw new Error(`no catalogue entry named ${name}`);
  return found;
};

describe("a primitive with a renderer but no inventable example", () => {
  it("does not claim the renderer is missing", () => {
    render(<CatalogueChart entry={namedEntry("3D globe")} />);
    const said = screen.getByRole("status").textContent ?? "";
    expect(said).not.toMatch(/no renderer here draws/i);
  });

  it("says what is actually missing, and that your own data supplies it", () => {
    render(<CatalogueChart entry={namedEntry("3D globe")} />);
    const said = screen.getByRole("status").textContent ?? "";
    expect(said).toMatch(/renderer in this codebase/i);
    expect(said).toMatch(/real measurements/i);
    expect(said).toMatch(/your own/i);
  });
});

describe("a primitive with genuinely no renderer", () => {
  it("still says so plainly", () => {
    // 33 `mesh` entries are in this state and the original sentence is correct
    // for every one of them. The fix must not blur the two cases together —
    // that would trade a false statement for a vague one.
    const mesh = CATALOGUE.find(
      (e) => e.primitive === "mesh" && e.needs !== "geometry");
    if (!mesh) return;
    render(<CatalogueChart entry={mesh} />);
    expect(screen.getByRole("status").textContent)
      .toMatch(/no renderer here draws a mesh yet/i);
  });
});

describe("the two sets stay honest about each other", () => {
  it("never claims a renderer both invents examples and cannot", () => {
    for (const primitive of RENDERER_NEEDS_REAL_DATA) {
      expect(RENDERED.has(primitive), primitive).toBe(false);
    }
  });

  it("keeps every entry it says needs real data undrawable here", () => {
    // If one ever became drawable, the sentence would be the stale one instead
    // — the same defect pointing the other way.
    for (const e of CATALOGUE) {
      if (RENDERER_NEEDS_REAL_DATA.has(e.primitive)) {
        expect(exampleFor(e), e.name).toBeNull();
      }
    }
  });

  it("covers every primitive the catalogue uses with one explanation or another",
     () => {
    /*
     * The guard that would have caught this. A primitive in the catalogue that
     * is in neither set falls through to "no renderer here draws it", which is
     * true only by luck — and was not true for `globe`.
     */
    const unexplained = new Set<string>();
    for (const e of CATALOGUE) {
      if (!RENDERED.has(e.primitive)
          && !RENDERER_NEEDS_REAL_DATA.has(e.primitive)
          && e.needs !== "geometry"
          && e.primitive !== "mesh") {
        unexplained.add(e.primitive);
      }
    }
    expect([...unexplained]).toEqual([]);
  });
});
