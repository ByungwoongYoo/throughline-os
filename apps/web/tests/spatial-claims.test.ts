/**
 * A chart claims a third dimension only where the data has one (§10).
 *
 * §10 is *do not force 3D*, and the catalogue carries the claim in a field:
 * `inherently` means "the data has three meaningful dimensions", `framed`
 * means "the third axis is the room, not the data". Those are different
 * promises to a reader deciding whether the depth in front of them is a
 * finding or a layout.
 *
 * Twenty-one network entries claimed `inherently`. Every network in the
 * catalogue takes `needs: "graph"`, and that shape is nodes and edges — no
 * coordinates anywhere in it — so all three dimensions come out of
 * `layoutGraph`, a force simulation run to spread the nodes apart. The claim
 * was false for every one of them, and the split was arbitrary on its face:
 * "Citation network" and "Dependency graph" are the same shape with the same
 * renderer and carried opposite answers, with no note either way.
 */

import { describe, expect, it } from "vitest";
import { CATALOGUE } from "@/lib/charts3d/registry";

/** Shapes that carry a position per datum, and so can be inherently spatial. */
const CARRIES_COORDINATES = new Set([
  "xyz", "xyzv", "grid", "field", "voxels", "geometry", "places",
]);

describe("a claim of three dimensions is a claim about the data", () => {
  it("finds the field, so a broken scan cannot pass", () => {
    expect(CATALOGUE.length).toBeGreaterThan(200);
    expect(CATALOGUE.some((v) => v.spatial === "inherently")).toBe(true);
    expect(CATALOGUE.some((v) => v.spatial === "framed")).toBe(true);
  });

  it("never claims inherent depth for a shape that carries no position", () => {
    /**
     * The defect, generalised past the networks that revealed it. `graph` and
     * `series` describe *relations* and *counts*; neither has a coordinate in
     * it, so any depth drawn from them was computed by a layout and belongs
     * to the picture rather than to the measurement.
     */
    const overclaiming = CATALOGUE
      .filter((v) => v.spatial === "inherently"
                  && !CARRIES_COORDINATES.has(v.needs))
      .map((v) => `${v.name} (${v.primitive} over ${v.needs})`);

    expect(overclaiming,
      "these say the data has three dimensions and the data has none:\n  "
      + overclaiming.join("\n  ")).toEqual([]);
  });

  it("says the third axis is the room for every network", () => {
    /**
     * Stated as its own rule rather than left to the one above, because a
     * network is the case where the picture is most persuasive: a cloud of
     * nodes in depth reads as structure discovered, and it is structure
     * arranged.
     */
    const networks = CATALOGUE.filter((v) => v.primitive === "network");
    expect(networks.length).toBeGreaterThan(30);
    for (const entry of networks) {
      expect(entry.spatial, entry.name).toBe("framed");
    }
  });

  it("still claims inherent depth where the data really has it", () => {
    /**
     * Guards the correction from over-reaching. A surface over a grid, a
     * volume over voxels and a globe over places are three-dimensional
     * measurements, and marking everything `framed` to be safe would make the
     * field say nothing at all.
     */
    const genuine = CATALOGUE.filter((v) => v.spatial === "inherently");
    expect(genuine.length).toBeGreaterThan(100);
    for (const entry of genuine) {
      expect(CARRIES_COORDINATES.has(entry.needs), entry.name).toBe(true);
    }
  });
});
