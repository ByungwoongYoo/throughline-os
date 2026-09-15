/**
 * The server's text does not depend on the last bit of a float (T180).
 *
 * `/case-compare` failed hydration on every load. The volume's caption counts
 * the voxels below its window, and the window's edge is a percentile of the
 * same values — so a group of symmetric voxels sits exactly on it. Node 26
 * (the server) and Chrome 152 (the browser) return different last bits from
 * `Math.exp`, so one pass counted 392 below the window and the other 400,
 * React found text it could not reconcile, and threw the server's page away.
 *
 * No test environment reproduces that by rendering, because the suite runs
 * both passes in one engine. So this nudges `Math` by one part in 10¹² between
 * two server renders — the size of the real difference — and requires the
 * text to be identical. A chart whose server text is computed from floats
 * fails here in any engine; one that describes itself after mounting passes.
 */

import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { Bars3D } from "@/components/charts/Bars3D";
import { Field3D } from "@/components/charts/Field3D";
import { Globe3D } from "@/components/charts/Globe3D";
import { Isosurface3D } from "@/components/charts/Isosurface3D";
import { Lines3D } from "@/components/charts/Lines3D";
import { Network3D } from "@/components/charts/Network3D";
import { Surface } from "@/components/charts/Surface";
import { Volume } from "@/components/charts/Volume";
import { VoxelVolume } from "@/components/charts/VoxelVolume";
import { sampleFunction } from "@/lib/charts3d/field";
import { gridFromFunction } from "@/lib/charts3d/voxels";

afterEach(cleanup);

const NUDGED = ["exp", "sin", "cos", "sqrt", "pow", "atan2", "log", "hypot", "tan"] as const;

/** Run `body` with Math's transcendental functions off by one part in 10¹². */
function nudged<T>(body: () => T): T {
  const m = Math as unknown as Record<string, (...args: number[]) => number>;
  const saved = NUDGED.map((name) => m[name]);
  NUDGED.forEach((name, i) => {
    const real = saved[i];
    m[name] = (...args: number[]) => real(...args) * (1 + 1e-12);
  });
  try {
    return body();
  } finally {
    NUDGED.forEach((name, i) => { m[name] = saved[i]; });
  }
}

const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/*
 * The data is built inside each render, so the nudge reaches it the way the
 * engine difference reached `blob()` in the worked example.
 */
const CHARTS: Array<[string, () => React.ReactElement]> = [
  ["VoxelVolume", () => <VoxelVolume grid={gridFromFunction(
    (x, y, z) => 90 * Math.exp(-(x * x + y * y + z * z) / 0.3)
                 + 30 * Math.exp(-(x * x + y * y + z * z) / 1.2), 20)} />],
  ["Isosurface3D", () => <Isosurface3D grid={gridFromFunction(
    (x, y, z) => Math.exp(-(x * x + y * y + z * z) / 0.4), 16)} />],
  ["Field3D", () => <Field3D samples={sampleFunction(
    (x, y, z) => [-Math.sin(y), Math.cos(x), Math.exp(z) * 0.1], 5)} />],
  ["Network3D", () => <Network3D graph={{
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    edges: [{ source: "a", target: "b" }, { source: "b", target: "c" },
            { source: "c", target: "d" }, { source: "d", target: "a" }],
  }} />],
  ["Lines3D", () => <Lines3D paths={[{ id: "p", points: Array.from(
    { length: 12 }, (_, i) => ({ x: Math.cos(i / 2), y: Math.sin(i / 2), z: Math.exp(i / 20) })) }]} />],
  ["Bars3D", () => <Bars3D bars={[
    { row: 0, column: 0, value: Math.exp(1) }, { row: 1, column: 0, value: Math.exp(2) },
    { row: 0, column: 1, value: Math.sqrt(2) }, { row: 1, column: 1, value: Math.PI }]} />],
  ["Surface", () => <Surface grid={{
    x: [0, 1, 2], y: [0, 1, 2],
    z: [[0, Math.exp(1), 0], [Math.exp(1), Math.exp(2), Math.exp(1)], [0, Math.exp(1), 0]],
  }} xLabel="x" yLabel="y" zLabel="z" />],
  ["Volume", () => <Volume points={[
    { id: "a", label: "a", x: 0, y: 0, z: 0, value: Math.exp(1) },
    { id: "b", label: "b", x: 1, y: Math.sqrt(0.3), z: 0.2, value: Math.exp(2) },
    { id: "c", label: "c", x: Math.sin(1), y: 1, z: 0.8, value: Math.PI }]}
    xLabel="x" yLabel="y" zLabel="z" />],
  ["Globe3D", () => <Globe3D world={{
    type: "FeatureCollection", features: [{
      type: "Feature", id: "004", properties: { name: "Somewhere" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    }],
  }} places={[]} valueLabel="value" />],
];

describe("a spatial chart's server text is the same in every engine", () => {
  it.each(CHARTS)("%s", (_, element) => {
    const plain = text(renderToStaticMarkup(element()));
    const perturbed = text(nudged(() => renderToStaticMarkup(element())));
    expect(perturbed).toBe(plain);
  });

  /*
   * The property itself, for every chart that describes itself: no computed
   * description reaches the server's markup. The nudge above only fails where
   * a value happens to sit on a threshold today; a count against a window, an
   * isovalue or a clamp can land there with the next dataset.
   */
  it.each(CHARTS.slice(0, 6))("%s says nothing computed before it mounts", (_, element) => {
    const markup = renderToStaticMarkup(element());
    const caption = markup.match(/<figcaption class="chart-caption">([\s\S]*?)<\/figcaption>/);
    expect(caption, "the chart has a caption element").not.toBeNull();
    // Fixed wording may stay — "the axes are scaled independently" is true on
    // both passes. A number is what the engines disagree about.
    expect(text(caption![1])).not.toMatch(/\d/);
  });

  it("still describes itself once mounted", () => {
    // The fix must defer the description, not delete it: the caption is how a
    // volume admits what it hides.
    const [, volume] = CHARTS[0];
    const { container } = render(volume());
    expect(container.querySelector(".chart-caption")?.textContent)
      .toMatch(/voxels drawn/);
  });
});
