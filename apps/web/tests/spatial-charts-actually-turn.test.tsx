/**
 * The arrow keys actually turn the chart (§ the label promises it).
 *
 * `spatial-charts-answer-keys.test.ts` reads the source of every spatial chart
 * and checks that a key handler is present, that the canvas is focusable, and
 * that it carries a label. All true, all necessary, and none of it presses a
 * key — so "the arrow keys turn the chart" was asserted about the text of the
 * files rather than about their behaviour.
 *
 * That gap matters more here than it usually would. Every one of these canvases
 * tells a screen reader "Arrow keys rotate, plus and minus zoom, Home resets
 * the view", which is an instruction rather than a description: a reader who
 * cannot see the picture is being told exactly how to operate it. If the keys
 * did nothing, the label would not merely be stale — it would be sending
 * somebody who has no other way in to a control that ignores them.
 *
 * And rotation is not a convenience on these charts. Motion parallax is the
 * strongest depth cue a flat screen has, and §10 only tolerates three
 * dimensions where depth carries real information — so a reader who cannot
 * rotate is looking at one fixed projection of a tangle, permanently.
 *
 * **What these still do not check.** The assertion is that the camera moved,
 * read back through the chart's own controller — not that the canvas repainted.
 * happy-dom has no real 2D context, so a chart that turned its camera and
 * forgot to raise its dirty flag would pass here and show a frozen picture in a
 * browser. That case is left to the eye and named here rather than implied to
 * be covered.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Bars3D } from "@/components/charts/Bars3D";
import { Field3D } from "@/components/charts/Field3D";
import { Isosurface3D } from "@/components/charts/Isosurface3D";
import { Lines3D } from "@/components/charts/Lines3D";
import { Network3D } from "@/components/charts/Network3D";
import { Globe3D } from "@/components/charts/Globe3D";
import { Surface } from "@/components/charts/Surface";
import { Volume } from "@/components/charts/Volume";
import { VoxelVolume } from "@/components/charts/VoxelVolume";
import type { VisualizationController } from "@/lib/spatial/commands";
import { KEY_STEP } from "@/lib/charts/spatialKeys";
import { DEFAULT_CAMERA, rotateCamera } from "@/lib/charts/scene3d";
import { gridFromFunction } from "@/lib/charts3d/voxels";
import { sampleFunction } from "@/lib/charts3d/field";

const graph = {
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  edges: [{ source: "a", target: "b" }, { source: "b", target: "c" }],
};

const grid = gridFromFunction((x, y, z) => 60 * Math.exp(-(x * x + y * y + z * z)));
const field = sampleFunction((x, y, z) => [-y, x, z * 0.1], 4);
const paths = [{ id: "p", points: [
  { x: 0, y: 0, z: 0 }, { x: 0.4, y: 0.2, z: 0.1 }, { x: 0.8, y: 0.5, z: 0.3 },
] }];
/*
 * `Surface` and `Volume` hand-roll their own key handler rather than using
 * `useSpatialKeys`, and so does `Globe3D`. The step sizes agree with the hook's
 * today — 12 degrees and 1.15 — and nothing was checking that they still would:
 * three literal copies of two magic numbers is exactly the drift the hook's own
 * docstring says it exists to prevent, and a reader who learns that Left turns
 * the network by one amount expects Left to turn the surface by the same one.
 */
/*
 * The smallest thing `Globe3D` will accept: one square "coastline" and no
 * places. The globe deliberately carries no data — a value invented for a real
 * country reads as a fact about the world — so an empty `places` list is its
 * ordinary state, not a degenerate one.
 */
const world = {
  type: "FeatureCollection" as const,
  features: [{
    type: "Feature" as const,
    id: "004",
    properties: { name: "Somewhere" },
    geometry: {
      type: "Polygon" as const,
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    },
  }],
};

const surface = {
  x: [0, 1, 2],
  y: [0, 1, 2],
  z: [[0, 1, 0], [1, 4, 1], [0, 1, 0]] as Array<Array<number | null>>,
};

const cloud = [
  { id: "a", label: "a", x: 0, y: 0, z: 0, value: 1 },
  { id: "b", label: "b", x: 1, y: 0.5, z: 0.2, value: 3 },
  { id: "c", label: "c", x: 0.4, y: 1, z: 0.8, value: 2 },
];

const bars = [
  { row: 0, column: 0, value: 4 }, { row: 1, column: 0, value: 9 },
  { row: 0, column: 1, value: 2 }, { row: 1, column: 1, value: 7 },
];

/** Every chart whose label promises the keys, and how to mount one. */
const CHARTS: Array<[string, (ref: React.RefObject<VisualizationController | null>)
                             => React.ReactElement]> = [
  ["Network3D", (ref) => <Network3D graph={graph} controllerRef={ref} />],
  ["VoxelVolume", (ref) => <VoxelVolume grid={grid} controllerRef={ref} />],
  ["Field3D", (ref) => <Field3D samples={field} controllerRef={ref} />],
  ["Lines3D", (ref) => <Lines3D paths={paths} controllerRef={ref} />],
  ["Bars3D", (ref) => <Bars3D bars={bars} controllerRef={ref} />],
  ["Isosurface3D", (ref) => <Isosurface3D grid={grid} controllerRef={ref} />],
  // The two that do not use the hook and still make the same promise.
  ["Surface", (ref) => <Surface grid={surface} controllerRef={ref}
                              xLabel="x" yLabel="y" zLabel="z" />],
  ["Volume", (ref) => <Volume points={cloud} controllerRef={ref}
                             xLabel="x" yLabel="y" zLabel="z" />],
  // The globe accepted no controller at all until now, so it could be turned by
  // a key and a mouse and by nothing else — no hand, and no test.
  ["Globe3D", (ref) => <Globe3D places={[]} world={world}
                                valueLabel="No values" controllerRef={ref} />],
];

// A plain loop rather than `describe.each`: the table's second column is a
// component factory, and `each` spreads rows as arguments in a way that does
// not survive a function there.
for (const [name, mount] of CHARTS) describe(`${name} answers the keyboard`, () => {
  const withChart = (body: (canvas: HTMLCanvasElement,
                            controller: VisualizationController) => void) => {
    const ref = createRef<VisualizationController | null>();
    const { container, unmount } = render(mount(ref));
    const canvas = container.querySelector("canvas.chart-canvas");
    expect(canvas, `${name} renders no spatial canvas`).toBeTruthy();
    expect(ref.current, `${name} exposes no controller`).toBeTruthy();
    body(canvas as HTMLCanvasElement, ref.current as VisualizationController);
    unmount();
  };

  it("turns when an arrow key is pressed", () => {
    withChart((canvas, controller) => {
      const before = controller.viewState();
      fireEvent.keyDown(canvas, { key: "ArrowRight" });
      expect(controller.viewState(), `${name} ignored ArrowRight`)
        .not.toEqual(before);
    });
  });

  it("turns the other way for the other arrow", () => {
    // Both directions, because a handler that fired on any key and always
    // rotated one way would pass a single-direction test and be useless.
    withChart((canvas, controller) => {
      fireEvent.keyDown(canvas, { key: "ArrowRight" });
      const right = controller.viewState();
      fireEvent.keyDown(canvas, { key: "ArrowLeft" });
      fireEvent.keyDown(canvas, { key: "ArrowLeft" });
      expect(controller.viewState(), `${name} did not turn back`)
        .not.toEqual(right);
    });
  });

  it("returns to where it started when Home is pressed", () => {
    withChart((canvas, controller) => {
      const home = controller.viewState();
      fireEvent.keyDown(canvas, { key: "ArrowRight" });
      fireEvent.keyDown(canvas, { key: "ArrowUp" });
      expect(controller.viewState()).not.toEqual(home);
      fireEvent.keyDown(canvas, { key: "Home" });
      expect(controller.viewState(), `${name} did not reset`).toEqual(home);
    });
  });

  it("leaves keys it does not own to the page", () => {
    /*
     * A chart that swallowed Tab or PageDown would trap a keyboard reader
     * inside it — the opposite failure, and the more frightening one.
     */
    withChart((canvas, controller) => {
      const before = controller.viewState();
      for (const key of ["Tab", "PageDown", "a", "Enter"]) {
        fireEvent.keyDown(canvas, { key });
      }
      expect(controller.viewState()).toEqual(before);
    });
  });

  it("says in its label that it can be turned", () => {
    withChart((canvas) => {
      expect(canvas.getAttribute("aria-label")).toMatch(/arrow keys rotate/i);
      expect(canvas.getAttribute("tabindex")).toBe("0");
    });
  });
});

describe("every chart turns by the same amount", () => {
  /*
   * A reader who learns the keys on one chart carries them to the next. Three
   * charts hand-roll the handler instead of using `useSpatialKeys`, so the
   * step and the zoom exist as literals in four places; this is what notices
   * when one of them moves.
   */
  const turnOnce = (mount: (typeof CHARTS)[number][1]) => {
    const ref = createRef<VisualizationController | null>();
    const { container, unmount } = render(mount(ref));
    const canvas = container.querySelector("canvas.chart-canvas");
    const before = ref.current!.viewState();
    fireEvent.keyDown(canvas as HTMLCanvasElement, { key: "ArrowRight" });
    const after = ref.current!.viewState();
    unmount();
    return { before, after };
  };

  it("moves the same axis by the same step on every chart", () => {
    const moves = CHARTS.map(([name, mount]) => {
      const { before, after } = turnOnce(mount);
      const key = Object.keys(after).find((k) => after[k] !== before[k]);
      return { name, key, by: key ? after[key] - before[key] : 0 };
    });
    const steps = new Set(moves.map((m) => m.by));
    expect([...steps], JSON.stringify(moves)).toHaveLength(1);

    /*
     * And the shared step is the hook's, derived rather than written down here:
     * `viewState` reports the camera in its own internal units, so asserting
     * `12` would fail against perfectly correct code and this test would be
     * deleted. Asking `rotateCamera` what `KEY_STEP` does keeps the comparison
     * honest if either the constant or the scaling changes.
     */
    const reference = { ...DEFAULT_CAMERA };
    rotateCamera(reference, KEY_STEP, 0);
    expect([...steps][0]).toBeCloseTo(reference.yaw - DEFAULT_CAMERA.yaw, 10);
  });
});

describe("the controller drives what the keyboard drives", () => {
  /*
   * The keys and the controller are two ways into one camera, and testing only
   * the keys leaves the other half unchecked. It showed: removing the globe's
   * `resetView` restoration of its own zoom — the globe frames a sphere, not
   * the unit cube, so it does not reset to the cube's distance — broke nothing
   * here, because `Home` goes through the key handler and a hand goes through
   * the controller. A hand asking for "reset" would have framed the earth
   * wrongly and no test would have minded.
   */
  for (const [name, mount] of CHARTS) {
    it(`${name} resets through its controller as well as its keyboard`, () => {
      const ref = createRef<VisualizationController | null>();
      const { unmount } = render(mount(ref));
      const controller = ref.current as VisualizationController;

      const home = controller.viewState();
      controller.rotate(30, 15);
      controller.zoom(1.4);
      expect(controller.viewState()).not.toEqual(home);

      controller.resetView();
      expect(controller.viewState(), `${name} reset to the wrong view`)
        .toEqual(home);
      unmount();
    });

    it(`${name} restores a view it was handed`, () => {
      // What the shared-view machinery does across panels: take a snapshot from
      // one chart and put another back to it.
      const ref = createRef<VisualizationController | null>();
      const { unmount } = render(mount(ref));
      const controller = ref.current as VisualizationController;

      controller.rotate(24, 0);
      const somewhere = controller.viewState();
      controller.resetView();
      controller.restoreViewState(somewhere);
      expect(controller.viewState(), `${name} ignored a restored view`)
        .toEqual(somewhere);
      unmount();
    });
  }
});

describe("the table above covers every chart that turns", () => {
  /*
   * The guard that makes the rest of this file hold as charts are added. A new
   * rotatable chart is added by copying an existing one, which copies the
   * promise in the label along with everything else — and it would then sit
   * outside every assertion here while claiming to answer a keyboard.
   *
   * `Globe3D` is why this exists. It promised the keys, implemented them, and
   * accepted no controller — so it could be turned by a key and a mouse and by
   * nothing else: no hand, because `SpatialControl` collects controllers, and
   * no test, because a test needs one to read the camera back.
   */
  const CHARTS_DIR = join(__dirname, "..", "components", "charts");

  const promisesKeys = readdirSync(CHARTS_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => {
      const source = readFileSync(join(CHARTS_DIR, f), "utf8");
      return /Arrow keys rotate/.test(source)
          || /useSpatialKeys/.test(source);
    })
    .map((f) => f.replace(/\.tsx$/, ""));

  it("finds the charts, so an empty scan cannot pass", () => {
    expect(promisesKeys.length).toBeGreaterThanOrEqual(9);
  });

  it("exercises every one of them", () => {
    const covered = new Set(CHARTS.map(([name]) => name));
    expect(promisesKeys.filter((name) => !covered.has(name))).toEqual([]);
  });

  it("gives every one of them a controller to be driven through", () => {
    // Not only a key handler: a chart no seam can address is reachable by
    // exactly one input, and the page's premise is that several can reach it.
    for (const name of promisesKeys) {
      const source = readFileSync(join(CHARTS_DIR, `${name}.tsx`), "utf8");
      expect(/controllerRef/.test(source), `${name} accepts no controller`)
        .toBe(true);
    }
  });
});
