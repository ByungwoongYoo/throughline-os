/**
 * The culling is checked against the actual Earth, not a square near Sumatra.
 *
 * `globe-geometry` uses hand-built polygons because a failure there should say
 * which piece of arithmetic broke. But every synthetic feature in that file was
 * written by the same person who wrote the code, and shares its assumptions —
 * so a sign error consistent across both would pass. The bundled 110m topology
 * does not share them: 177 countries, real longitudes, Antarctica wrapping the
 * pole, Russia crossing the antimeridian, Indonesia in thirteen thousand
 * pieces.
 *
 * The property tested is one no formula restates. A country the reader cannot
 * see from here is a country they *can* see from directly behind, because
 * opposite views of a sphere partition it. That fails loudly if the depth sign
 * inverts (everything hides), if culling is dropped (nothing hides), or if
 * `some` becomes `every` (limb countries vanish from both views) — and the
 * browser reported 34 hidden facing Eurasia against 136 facing the Pacific,
 * which is this property observed once by hand.
 */

import { describe, expect, it } from "vitest";
import type { Feature } from "geojson";
import { feature } from "topojson-client";
import topology from "world-atlas/countries-110m.json";
import { visibility } from "@/lib/charts3d/globe";
import { DEFAULT_CAMERA, project } from "@/lib/charts/scene3d";

const world = feature(
  topology as never,
  (topology as never as { objects: { countries: unknown } }).objects.countries as never,
) as unknown as { features: Feature[] };

/**
 * Depth under a camera turned `yaw` radians, level with the equator.
 *
 * `pitch: 0` is load-bearing, and a first version that inherited the default
 * pitch failed here — correctly. Yaw is applied before pitch, so turning the
 * globe half way round while the camera still looks down at it does *not* give
 * the opposite view: a band around the far pole stays behind the horizon in
 * both, and eight countries were reported visible from nowhere. Two views are
 * antipodal only when the camera is level, which is the only case in which the
 * partition below is a real property rather than an assumption about pitch.
 */
const facing = (yaw: number) =>
  (p: { x: number; y: number; z: number }) =>
    project(p, { ...DEFAULT_CAMERA, yaw, pitch: 0 }).depth;

describe("the globe hides the right half of a real Earth", () => {
  it("has a world to draw at all", () => {
    expect(world.features.length).toBeGreaterThan(150);
  });

  it("hides some countries and draws the rest, accounting for every one", () => {
    const { drawn, hidden } = visibility(world.features, facing(0));
    expect(hidden).toBeGreaterThan(20);          // not "culling is off"
    expect(hidden).toBeLessThan(world.features.length - 20); // not "all hidden"
    expect(drawn.length + hidden).toBe(world.features.length);
  });

  it("shows from behind every country it hides from here", () => {
    const here = new Set(
      visibility(world.features, facing(0)).drawn.map((d) => d.feature));
    const behind = new Set(
      visibility(world.features, facing(Math.PI)).drawn.map((d) => d.feature));

    const nowhere = world.features.filter(
      (f) => !here.has(f) && !behind.has(f));
    expect(nowhere).toEqual([]);
  });

  it("does not simply draw everything from both sides", () => {
    /** Guards the test above: it would pass trivially if nothing were culled. */
    const here = new Set(
      visibility(world.features, facing(0)).drawn.map((d) => d.feature));
    const behind = visibility(world.features, facing(Math.PI)).drawn
      .filter((d) => !here.has(d.feature));
    expect(behind.length).toBeGreaterThan(20);
  });
});
