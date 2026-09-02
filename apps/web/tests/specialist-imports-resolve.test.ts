/**
 * Every module a specialist viewer names is a module that is really there.
 *
 * `specialist-vtk` already argues this for one library: "a misspelled vtk.js
 * path is invisible until a researcher opens the viewer: it type-checks, it
 * bundles, and it rejects at run time inside a dynamic import nobody executes
 * in the suite." Every word of that applies to the other three viewers, and
 * two of them had no such check — niivue none at all.
 *
 * It is worth having for a reason beyond spelling. Auditing these viewers by
 * hand, **three separate path guesses were wrong**: `IO/Geometry/OBJReader`
 * (it is `IO/Misc/OBJReader`), the Mol* builders (`builder/`, not
 * `builders/`), and `parseAsArrayBuffer` looked absent from
 * `XMLPolyDataReader` because it is declared on the base `XMLReader`. Two of
 * those produced a confident "NOT FOUND" against working code. A path that
 * looks right and is not is the normal case here, not the exception.
 *
 * **What this deliberately does not check.** It resolves modules, not methods.
 * vtk.js generates most of its setters through macros — `setScalarVisibility`
 * appears nowhere in `Mapper.js`, only `scalarVisibility: true` in its
 * defaults — so a guard that grepped for method names would report working
 * code as broken, and a guard that is wrong about a correct thing is the kind
 * that gets deleted. The one method pair that genuinely could not be inferred
 * is checked directly in `specialist-vtk`, against the reader that broke.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..");
const MODULES = join(WEB_ROOT, "node_modules");

const VIEWERS = ["molstar", "niivue", "geomap", "volume"] as const;

/** Every bare specifier a viewer pulls in through a dynamic import. */
function importsOf(viewer: string): string[] {
  const source = readFileSync(
    join(WEB_ROOT, "components", "specialist", `${viewer}.tsx`), "utf8");
  return [...source.matchAll(/import\(\s*"([^".][^"]*)"\s*\)/g)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith("@/") && !s.startsWith("."));
}

/**
 * Whether a specifier resolves to something on disk.
 *
 * Deliberately generous about the ending. A package entry may be `index.js`,
 * the specifier may already carry its extension, a JSON asset resolves as
 * itself, and a subpath may be a directory. The failure being caught is a
 * wrong *path*, and every one of those forms is a right one.
 */
function resolves(specifier: string): boolean {
  const base = join(MODULES, specifier);
  return [base, `${base}.js`, `${base}.json`, `${base}.d.ts`,
          join(base, "index.js"), join(base, "package.json")]
    .some(existsSync);
}

describe("a viewer names only modules that exist", () => {
  it("finds imports in every viewer, so none can pass by having none", () => {
    /** D021: a walk that quietly matched nothing would pass forever — and one
     *  of these files having no dynamic import at all would mean the lazy seam
     *  had been undone, which is its own defect. */
    for (const viewer of VIEWERS) {
      expect(importsOf(viewer).length, viewer).toBeGreaterThan(0);
    }
  });

  it("resolves every one of them against the installed packages", () => {
    const missing: string[] = [];
    for (const viewer of VIEWERS) {
      for (const specifier of importsOf(viewer)) {
        if (!resolves(specifier)) missing.push(`${viewer}.tsx → ${specifier}`);
      }
    }
    expect(missing, `named but not installed:\n  ${missing.join("\n  ")}`)
      .toEqual([]);
  });

  it("would notice a path that is merely plausible", () => {
    /**
     * Guards the resolver itself. `IO/Geometry/OBJReader` is exactly the shape
     * of a real vtk.js path — right package, right style, right file name, and
     * the reader lives under `IO/Misc`. If this resolved, the test above would
     * pass over the whole class of mistake it exists for.
     */
    expect(resolves("@kitware/vtk.js/IO/Misc/OBJReader")).toBe(true);
    expect(resolves("@kitware/vtk.js/IO/Geometry/OBJReader")).toBe(false);
    expect(resolves("molstar/lib/mol-plugin-state/builder/structure")).toBe(true);
    expect(resolves("molstar/lib/mol-plugin-state/builders/structure")).toBe(false);
  });
});
