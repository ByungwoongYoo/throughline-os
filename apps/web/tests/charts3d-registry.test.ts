/**
 * The catalogue of spatial visualizations (§9, §10).
 *
 * Two hundred and twenty-six named visualizations, nine primitives. This file
 * exists because the alternative to a checkable catalogue is memory, and memory
 * is how §74 and §75 sat recorded as unreviewed while their code was finished
 * and unreachable.
 *
 * So these tests are mostly about the catalogue being *honest*: no name twice,
 * no status that contradicts its primitive, and no ordinary chart quietly
 * claiming a third dimension it does not have — which is the specific thing §10
 * forbids.
 */

import { describe, expect, it } from "vitest";
import {
  CATALOGUE, Primitive, available, buildOrder, drawableOnDemand, drawnBy,
  unlockedBy,
} from "@/lib/charts3d/registry";

const PRIMITIVES: Primitive[] = [
  "points", "lines", "surface", "bars", "glyphs", "volume", "isosurface",
  "network", "mesh",
];

describe("the catalogue is complete and consistent", () => {
  it("names each visualization exactly once", () => {
    // A duplicate is how a toolbox ends up offering the same thing twice under
    // two names, and how a coverage count quietly overstates itself.
    const names = CATALOGUE.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("draws everything with one of the nine primitives", () => {
    for (const entry of CATALOGUE) {
      expect(PRIMITIVES).toContain(entry.primitive);
    }
  });

  it("covers every family the brief groups them under", () => {
    const families = new Set(CATALOGUE.map((v) => v.family));
    for (const family of [
      "Core", "Mathematical", "Fields", "Volume", "Statistical",
      "Machine learning", "Networks", "Geographic", "Physics", "Engineering",
      "Chemistry", "Medical", "Astronomy", "Financial", "Native",
    ]) {
      expect(families).toContain(family);
    }
  });

  it("is large enough to be the catalogue rather than a sample", () => {
    // The brief lists around two hundred and fifty; a catalogue of thirty would
    // mean the reduction had quietly become a selection.
    expect(CATALOGUE.length).toBeGreaterThan(200);
  });
});

describe("what it claims about itself", () => {
  it("does not call something built when its primitive is missing", () => {
    /*
     * The contradiction that would make the whole catalogue untrustworthy: an
     * entry marked built whose renderer does not exist is exactly the "recorded
     * as done, unreachable in fact" failure this file is meant to prevent.
     */
    const missing = new Set(
      CATALOGUE.filter((v) => v.status === "primitive-missing")
               .map((v) => v.primitive));

    for (const entry of CATALOGUE) {
      if (entry.status !== "built") continue;
      expect(missing.has(entry.primitive)).toBe(false);
    }
  });

  it("keeps a library dependency separate from a missing renderer", () => {
    /*
     * Different costs in kind. A missing primitive is an afternoon of geometry;
     * a library is a format, a viewer, a maintenance burden and tens of
     * megabytes. Collapsing them would make the build order meaningless.
     */
    const byLibrary = CATALOGUE.filter((v) => v.status === "needs-library");
    expect(byLibrary.length).toBeGreaterThan(0);
    // Almost all of them are imported geometry, which is precisely why they
    // need somebody else's reader.
    const meshes = byLibrary.filter((v) => v.primitive === "mesh").length;
    expect(meshes / byLibrary.length).toBeGreaterThan(0.5);
  });

  it("says which things are only framed in space, not spatial (§10)", () => {
    /*
     * §10: never convert an ordinary chart into 3D to appear futuristic,
     * because depth buys occlusion, perspective distortion and ambiguity.
     * Marking them keeps the catalogue honest about which third axis is the
     * data and which is the room.
     */
    const framed = CATALOGUE.filter((v) => v.spatial === "framed");
    expect(framed.length).toBeGreaterThan(10);
    // Bars are the clearest case: a 3D bar chart is a bar chart in a room.
    expect(drawnBy("bars").every((v) => v.spatial === "framed")).toBe(true);
  });

  it("treats a height field and a closed shell as different primitives", () => {
    /*
     * A sphere is not z = f(x,y) — no height field can be double-valued, so
     * drawing one as a surface produces a bowl. Getting this wrong is how a
     * catalogue promises something that renders incorrectly rather than not at
     * all, which is worse.
     */
    const sphere = CATALOGUE.find((v) => v.name === "Sphere");
    const saddle = CATALOGUE.find((v) => v.name === "Saddle surface");
    expect(sphere?.primitive).toBe("isosurface");
    expect(saddle?.primitive).toBe("surface");
  });
});

describe("what can be drawn today", () => {
  it("offers what is built or configurable", () => {
    const now = available();
    expect(now.length).toBeGreaterThan(50);
    expect(now.every((v) => v.status !== "primitive-missing")).toBe(true);
    expect(now.every((v) => v.status !== "needs-library")).toBe(true);
  });

  it("counts a specialist viewer as on demand, not as drawn today", () => {
    /*
     * Two different promises, and the charts page states the first one as a
     * number: what is on screen now from data this system holds, against what
     * appears after a researcher opens a file from their own disk and waits
     * for a library to download. Folding the second into `available()` would
     * inflate that sentence — the one sentence on the page whose whole job is
     * to be honest about reach.
     */
    expect(available().every((v) => v.status !== "specialist")).toBe(true);
    expect(drawableOnDemand().every((v) => v.status === "specialist")).toBe(true);

    // No entry can be counted in both, and none is lost between them.
    const today = new Set(available().map((v) => v.name));
    expect(drawableOnDemand().some((v) => today.has(v.name))).toBe(false);
    expect(drawableOnDemand()).toEqual(
      CATALOGUE.filter((v) => v.status === "specialist"));
  });

  it("gives every specialist entry a viewer to be drawn by", () => {
    /*
     * "Specialist" is a claim that something loads. An entry making it without
     * naming which library would be unreachable by construction — the Wave-0
     * failure in one field. Which viewer names resolve is checked by
     * `specialist-seam.test.tsx`, against the loader map itself.
     */
    for (const entry of drawableOnDemand()) {
      expect(entry.viewer, `${entry.name} names no viewer`).toBeDefined();
    }
  });

  it("already covers the commonest scientific spatial charts", () => {
    // The ones a researcher actually reaches for first.
    const names = new Set(available().map((v) => v.name));
    for (const expected of [
      "3D scatter", "3D surface", "Function surface", "PCA 3D", "Embedding space",
      "Regression plane", "3D terrain", "Loss landscape",
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe("what to build next", () => {
  it("counts what a primitive would unlock, not what it is called", () => {
    /*
     * The number that should decide the order. One renderer that turns two
     * dozen named visualizations from impossible into available is a different
     * proposition from adding one chart, and only the count makes that visible.
     */
    const order = buildOrder();
    expect(order.length).toBeGreaterThan(0);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].unlocks).toBeGreaterThanOrEqual(order[i].unlocks);
    }
  });

  it("agrees with what unlockedBy reports for each primitive", () => {
    for (const { primitive, unlocks } of buildOrder()) {
      expect(unlockedBy(primitive)).toHaveLength(unlocks);
    }
  });

  it("lists nothing already drawable as unlockable", () => {
    for (const { primitive } of buildOrder()) {
      for (const entry of unlockedBy(primitive)) {
        expect(entry.status).toBe("primitive-missing");
      }
    }
  });
});
