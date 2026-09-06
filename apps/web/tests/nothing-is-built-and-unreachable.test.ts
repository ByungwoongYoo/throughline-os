/**
 * A module the product does not import is a module nobody can use.
 *
 * This is the defect this repository finds more often than any other, and it
 * has been found by hand every time: §74's whole report pipeline, reachable
 * from no route; `attach_claim`, called only by the worked example, so no
 * researcher's finding could leave CANDIDATE; `send_to_back`, shipped with a
 * button and no test; `lib/board/history.ts`, a complete undo for a board that
 * had none. Each cost an afternoon to notice, and each was obvious the moment
 * somebody asked who imports this.
 *
 * So the question is asked here instead. A module under `lib/` or
 * `components/` that only its own test imports is either unfinished work
 * nobody can reach, or something that belongs to the tests — and the second
 * has to be said out loud rather than assumed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");

/**
 * Modules deliberately not wired to anything yet, and why.
 *
 * An entry here is a claim somebody can argue with. An empty list would be
 * better, and shrinking it is the point.
 */
const NOT_YET_REACHABLE: Record<string, string> = {
  "lib/selection.ts":
    "§65's selection-by-record, built ahead of the screens that would use it. "
    + "Nothing selects across charts yet, so wiring it would add a menu that "
    + "answers no question a researcher is currently asking.",
};

/**
 * Features a module cannot see: reached only through a prop nobody passes.
 *
 * This guard walks the *import* graph, so a module counts as reached the
 * moment something reachable imports it. That is the right question for a
 * whole module and the wrong one for a feature that lives behind an optional
 * prop: `charts/linked.tsx` is imported by `Cartesian`, which every figure
 * screen renders, and it is nevertheless dead — no page wraps anything in
 * `<LinkedCharts>` and no chart is ever given a `linkKey`, so the provider,
 * the brushing, the echo counts and the muting reach no researcher. The
 * module-level guard reported it as reachable, correctly and uselessly.
 *
 * The list below is maintained **by hand**, and deliberately so. An automated
 * scan for "optional props no caller passes" was written for this and was
 * wrong twice — it missed bare boolean props (`attritionIsExpected title=…`
 * is passed and reads as unpassed) and it counted a component's own module as
 * an outside caller. A guard that accuses correct code is one people delete,
 * which would cost more than the blind spot it covers. So: two entries that
 * were confirmed by reading every call site, and no claim that this catches
 * the next one automatically.
 */
const REACHED_ONLY_BY_A_PROP: Record<string, string> = {
  "components/charts/linked.tsx LinkedCharts + Cartesian.linkKey":
    "§65 selection shared between figures. Nothing renders the provider and "
    + "nothing passes a linkKey, so none of it runs in the product. Wiring it "
    + "needs two figures of the same rows on screen together, and there is no "
    + "such screen: the Figures view draws one chart at a time and the matrix "
    + "view is a heatmap. That screen is the missing piece, not this code.",
  "components/charts/Surface.tsx Surface.colourBy":
    "A fourth variable painted onto a fitted surface, with its own key and a "
    + "refusal when the colour grid does not describe the surface. No caller "
    + "passes it because the figures endpoint returns no fourth per-cell "
    + "quantity; inventing one in the browser — a standard error, a local "
    + "density — would be the claim-without-data this product exists to "
    + "refuse. It waits on the server, not on a screen.",
};

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(join(WEB, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(entry.name)
             && !/\.test\.tsx?$/.test(entry.name)
             // `.d.ts` declares types for a library; nothing imports it at
             // runtime and nothing is meant to.
             && !/\.d\.ts$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

function importsIn(paths: string[]): string[] {
  return paths.flatMap((p) =>
    [...readFileSync(join(WEB, p), "utf8")
      // The third form matters: a Web Worker is loaded as
      // `new URL("../lib/workers/x.worker.ts", import.meta.url)` and never
      // imported. Reading only `from "…"` calls the worker unreachable, which
      // is a scanner defect reported as a product one — the kind of false
      // accusation that gets a guard deleted.
      .matchAll(/from\s+"([^"]+)"|import\("([^"]+)"\)|new URL\("([^"]+)"/g)]
      .map((m) => m[1] ?? m[2] ?? m[3]));
}

const modules = [...sources("lib"), ...sources("components")];
const production = [...modules, ...sources("app")];
const testFiles = readdirSync(join(WEB, "tests"))
  .filter((f) => /\.test\.tsx?$/.test(f)).map((f) => `tests/${f}`);

/** Does `spec`, as written in an import, name `module`? */
function names(spec: string, module: string): boolean {
  const stem = module.replace(/\.tsx?$/, "");
  // `@/lib/x`, `./x` and `../lib/x` all name the same file; only the last
  // was missed, and it is the form a worker URL takes.
  // `@/lib/x`, `./x` and `../lib/x` all name the same file, and a worker URL
  // carries the extension while an import does not — so both sides are
  // stripped before they are compared.
  const cleaned = spec.replace(/^@\//, "").replace(/^(\.\.?\/)+/, "")
    .replace(/\.tsx?$/, "");
  return stem === cleaned || stem.endsWith(`/${cleaned}`)
    || cleaned.endsWith(stem);
}

describe("everything built is reachable", () => {
  it("finds the modules and the imports, so an empty scan cannot pass", () => {
    expect(modules.length).toBeGreaterThan(100);
    expect(importsIn(production).length).toBeGreaterThan(200);
    expect(testFiles.length).toBeGreaterThan(100);
  });

  it("has no module the app cannot reach", () => {
    /*
     * Reachability from `app/`, walked transitively — not "somebody imports
     * it".
     *
     * The first version asked only whether any production file imported the
     * module, and a mutation walked straight through it: unwiring the
     * diagnostics *screen* left the screen importing the diagnostics *library*,
     * so the library still looked used while both were unreachable. An orphan
     * that imports another orphan keeps it alive, which is exactly how a whole
     * subsystem stays green while nobody can open it.
     */
    const graph = new Map<string, string[]>();
    for (const file of production) {
      graph.set(file, importsIn([file]).flatMap(
        (spec) => modules.filter((m) => m !== file && names(spec, m))));
    }

    const reached = new Set<string>();
    const queue = sources("app");
    while (queue.length) {
      const file = queue.pop()!;
      for (const next of graph.get(file) ?? []) {
        if (!reached.has(next)) { reached.add(next); queue.push(next); }
      }
    }

    const stranded = modules.filter((m) =>
      !reached.has(m) && !(m in NOT_YET_REACHABLE));

    expect(stranded, "built and reachable from nothing the app renders:\n  "
      + stranded.join("\n  ")).toEqual([]);
  });

  it("keeps a prop-level orphan named, since the graph cannot see one", () => {
    /*
     * Named and argued, not detected. The check that can be made honestly is
     * that each entry still describes something real: the component exists,
     * the prop is still declared on it, and the reason is long enough to be
     * an argument rather than a label. When one of these is finally wired the
     * entry has to be deleted by hand — which is the point, because deleting
     * it is a person saying the feature now reaches somebody.
     */
    for (const [what, why] of Object.entries(REACHED_ONLY_BY_A_PROP)) {
      const [file, ...rest] = what.split(" ");
      expect(modules, `${file} is named here and no longer exists`)
        .toContain(file);
      const source = readFileSync(join(WEB, file), "utf8");
      for (const symbol of rest.join(" ").split(" + ")) {
        const prop = symbol.includes(".") ? symbol.split(".")[1] : symbol;
        expect(source, `${file} no longer declares ${prop}`).toContain(prop);
      }
      expect(why.length, what).toBeGreaterThan(80);
    }
  });

  it("keeps every exemption explained, and honest about being one", () => {
    for (const [module, why] of Object.entries(NOT_YET_REACHABLE)) {
      expect(modules, `${module} is exempted here and no longer exists`)
        .toContain(module);
      expect(why.length, module).toBeGreaterThan(80);
    }
  });
});
