/**
 * The primitive registry must describe the code, not intentions.
 *
 * `lib/primitives.ts` says its purpose is that "the marketing page cannot drift
 * from the truth… a hand-written sentence is how a tool ends up claiming a
 * capability it lost three refactors ago." It then drifted, because `status` is
 * a hand-typed string and nothing compared it to the components: P5, binned
 * aggregation, was marked `renders` while `hexbin` appeared nowhere in the
 * repository outside its own registry entry.
 *
 * The landing page's "Not built" ledger and the Gallery's headline both count
 * from this list, so a wrong flag is a false claim in two places at once.
 *
 * (Not to be confused with `primitives.test.tsx`, which covers
 * `components/primitives.tsx` — the Empty/Failure/Loading widgets. The name
 * collision is part of why nothing here was covered.)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGNED, PRIMITIVES, RENDERING } from "@/lib/primitives";

/** Registry id → the component that draws it. */
const COMPONENTS: Record<string, string> = {
  cartesian: "Cartesian.tsx",
  interval: "Interval.tsx",
  density: "Density.tsx",
  matrix: "Matrix.tsx",
  binned: "Binned.tsx",
  hierarchy: "Hierarchy.tsx",
  radial: "Radial.tsx",
  ribbon: "Ribbon.tsx",
  sets: "SetRegions.tsx",
  projection: "Projection.tsx",
  geographic: "Geographic.tsx",
  volume: "Volume.tsx",
  temporal: "Temporal.tsx",
  // Drawn outside components/charts: the force-directed graph is a full
  // interactive surface rather than a figure.
  nodelink: "../KnowledgeGraph.tsx",
};

const chartFiles = new Set(
  readdirSync(join(__dirname, "..", "components", "charts")),
);

describe("the primitive registry", () => {
  it("has a component for every primitive it claims renders", () => {
    const lying = RENDERING.filter((primitive) => {
      const file = COMPONENTS[primitive.id];
      if (!file) return true;
      if (file.startsWith("../")) return false; // checked separately below
      return !chartFiles.has(file);
    });

    expect(
      lying.map((p) => `${p.code} ${p.name}`),
      "marked as rendering with nothing behind them",
    ).toEqual([]);
  });

  it("knows where every primitive is drawn", () => {
    // A primitive with no mapping cannot be verified either way, which is the
    // state that let P5 through.
    const unmapped = PRIMITIVES.filter((p) => !COMPONENTS[p.id]);
    expect(unmapped.map((p) => p.id)).toEqual([]);
  });

  it("counts what it claims", () => {
    expect(RENDERING.length + DESIGNED.length).toBe(PRIMITIVES.length);
    expect(PRIMITIVES).toHaveLength(14);
  });

  it("is shown in full by the gallery that counts from it", () => {
    // The gallery's headline reads "All 14 primitives render" and it rendered
    // eight — P7 to P14 — because the sections were written by hand while the
    // count was computed. A reader saw eight charts under a sentence claiming
    // fourteen. Reading the source is crude but it is the property that broke.
    const gallery = readFileSync(
      join(__dirname, "..", "components", "gallery.tsx"), "utf8");
    const shown = new Set(
      [...gallery.matchAll(/<Section code="(P\d+)"/g)].map((m) => m[1]));
    const missing = PRIMITIVES
      .filter((p) => !shown.has(p.code))
      .map((p) => `${p.code} ${p.name}`);

    expect(missing, "claimed by the gallery's count but not drawn on it")
      .toEqual([]);
  });

  it("gives every primitive the guard it protects against", () => {
    // The `guards` line is what makes the catalogue a teaching surface rather
    // than a feature list: each entry names the misreading it prevents.
    const unguarded = PRIMITIVES.filter((p) => !p.guards?.trim());
    expect(unguarded.map((p) => p.id)).toEqual([]);
  });
});
