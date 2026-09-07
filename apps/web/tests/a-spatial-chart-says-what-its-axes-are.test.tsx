/**
 * The two charts that were asked about by name actually write on themselves.
 *
 * The complaint that started this was specific: a reader was shown a response
 * surface with labelled axes, numeric ticks, gridded walls and a colour key,
 * and asked why ours were not that. The renderer was never the gap — the
 * projection, the rotation, the occlusion count and the extrapolation marking
 * were all built and correct. What no spatial chart in this product had was
 * anything letting a reader say what a dimension *is* or read a value off it:
 * `fillText` appeared in none of `components/charts/*.tsx`.
 *
 * So the thing worth pinning is not that `axisFurniture` computes a frame —
 * `an-axis-says-what-it-measures` does that, without a canvas. It is that the
 * charts **paint** it, in the caller's own numbers, along the directions they
 * actually drew the data.
 *
 * **Why this compares against a recomputed frame rather than a fixture.** The
 * failure being guarded is not "the labels are in the wrong place"; the
 * furniture decides that and is tested on its own. It is the mistake the
 * furniture cannot catch and no screenshot reveals: `Axes3D` is keyed by
 * *scene* axis, and `Surface` puts its response on scene y and its second
 * predictor on scene z. Hand the three specs across in the order the props are
 * named and every label is drawn correctly, legibly, and against the wrong
 * direction — and the numbers, being real numbers from the right dataset, look
 * entirely plausible. Rebuilding the frame from the mapping that is *supposed*
 * to hold and demanding the chart's own `fillText` calls match it is the only
 * assertion that fails when the two are swapped.
 *
 * happy-dom paints nothing, so the context is a recorder. That costs nothing
 * here: what is under test is which strings were asked for and where, and
 * those are the arguments, not the pixels.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { Surface } from "@/components/charts/Surface";
import { Volume } from "@/components/charts/Volume";
import { Axes3D, DEFAULT_CAMERA, axisFurniture } from "@/lib/charts/scene3d";
import type { VisualizationController } from "@/lib/spatial/commands";

const W = 420, H = 380;

/** A 2D context that remembers what it was asked to do, arguments and all. */
function recordingContext() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const context = new Proxy({} as CanvasRenderingContext2D, {
    get(_target, property: string) {
      // The furniture asks the canvas which font the page is set in. There is
      // no layout here, and it falls back on its own when the answer is
      // nothing — which is the path a worker or an exporter takes too.
      if (property === "canvas") return undefined;
      return (...args: unknown[]) => { calls.push({ name: property, args }); };
    },
    set() { return true; },
  });
  return { context, calls };
}

let context: CanvasRenderingContext2D;
let calls: Array<{ name: string; args: unknown[] }>;
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  ({ context, calls } = recordingContext());
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as never;
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Run the chart's own rAF loop once, since happy-dom will not. */
function paint() {
  act(() => {
    for (const callback of frames.splice(0, frames.length)) {
      callback(performance.now());
    }
  });
}

/**
 * The text the chart painted, split into ticks and titles.
 *
 * `drawFurniture` hangs a tick off its own coordinates and draws a title at
 * the origin of a translated frame, because a title on a steep axis is turned
 * and turned text has to rotate about its own anchor. So a `fillText` at
 * exactly (0, 0) is a title and its position is the translate before it —
 * every tick is nudged clear of the canvas edge and cannot land there.
 */
function painted() {
  const ticks: Array<{ text: string; x: number; y: number }> = [];
  const titles: Array<{ text: string; x: number; y: number }> = [];
  let frame: { x: number; y: number } | null = null;
  for (const { name, args } of calls) {
    if (name === "translate") {
      frame = { x: args[0] as number, y: args[1] as number };
      continue;
    }
    if (name !== "fillText") continue;
    const text = args[0] as string;
    const x = args[1] as number, y = args[2] as number;
    if (x === 0 && y === 0 && frame) titles.push({ text, ...frame });
    else ticks.push({ text, x, y });
  }
  return { ticks, titles };
}

/** Positions compared to a thousandth: the same arithmetic, not a redrawing. */
const round = (n: number) => Math.round(n * 1000) / 1000;
function place<T extends { text: string; x: number; y: number }>(labels: T[]) {
  return labels.map((l) => ({ text: l.text, x: round(l.x), y: round(l.y) }))
    .sort((a, b) => a.text.localeCompare(b.text));
}

/** The frame the chart is supposed to have drawn, from the module it uses. */
function expectedFrame(axes: Axes3D) {
  const furniture = axisFurniture(axes, DEFAULT_CAMERA, W, H);
  return {
    ticks: place(furniture.ticks.map((t) => ({ ...t, ...t.at }))),
    titles: place(furniture.titles.map((t) => ({ ...t, ...t.at }))),
  };
}

// ---------------------------------------------------------------------------
// P15, the chart the question was actually about
// ---------------------------------------------------------------------------

/**
 * A saddle whose three directions cannot be confused for one another.
 *
 * The predictors run 0 to 4 and 0 to 40, and the response −4 to 4. Three
 * disjoint ranges, so a tick alone says which axis it was written for — with a
 * cube of identical domains a transposition draws exactly the same picture.
 */
const GRID = {
  x: [0, 1, 2, 3, 4],
  y: [0, 10, 20, 30, 40],
  z: [0, 1, 2, 3, 4].map((j) =>
    [0, 1, 2, 3, 4].map((i) => (i - 2) * (i - 2) - (j - 2) * (j - 2))),
};

const OBSERVATIONS = [
  { id: "o1", label: "Run 1", x: 1, y: 10, z: 0 },
  { id: "o2", label: "Run 2", x: 3, y: 10, z: 1 },
];

describe("a fitted surface names its three directions", () => {
  function drawSurface(props: Record<string, unknown> = {}) {
    render(
      <Surface grid={GRID} observations={OBSERVATIONS}
               xLabel="Dose" yLabel="Duration" zLabel="Response"
               width={W} height={H} {...props} />);
    paint();
    return painted();
  }

  it("writes all three labels onto the picture", () => {
    /*
     * The whole of T141 in one assertion. `xLabel`, `yLabel` and `zLabel` have
     * been props of this component since it was written; they reached the data
     * table and the screen-reader description and never the canvas, so a
     * sighted reader had a shape with no names on it.
     */
    const { titles } = drawSurface();

    expect(titles.map((t) => t.text).sort())
      .toEqual(["Dose", "Duration", "Response"]);
  });

  it("puts the response on the direction that runs up the screen", () => {
    /*
     * The transposition, which is the only way to get this wrong invisibly.
     * The expected frame is built with the height on scene `y` and the second
     * predictor on scene `z`, exactly as the projection places them
     * (`y: sz(o.z), z: sy(o.y)`). Swap the two and every label is still drawn,
     * still legible, still a real number from this dataset — and describing
     * the wrong direction.
     */
    const drawn = drawSurface();
    const expected = expectedFrame({
      x: { label: "Dose", min: 0, max: 4 },
      y: { label: "Response", min: -4, max: 4 },
      z: { label: "Duration", min: 0, max: 40 },
    });

    expect(place(drawn.titles)).toEqual(expected.titles);
    expect(place(drawn.ticks)).toEqual(expected.ticks);
  });

  it("scales the height axis over the observations too, not the fit alone", () => {
    /*
     * `unitScale` is given the grid and the observations together, so the axis
     * has to be labelled over that same pair. Labelling it with the grid's own
     * range is right whenever every measurement falls inside the fitted
     * surface and silently wrong the moment one does not — which is the case a
     * reader most wants to look at.
     */
    const drawn = drawSurface({
      observations: [...OBSERVATIONS,
                     { id: "o3", label: "Run 3", x: 2, y: 20, z: 9 }],
    });
    const expected = expectedFrame({
      x: { label: "Dose", min: 0, max: 4 },
      y: { label: "Response", min: -4, max: 9 },
      z: { label: "Duration", min: 0, max: 40 },
    });

    expect(place(drawn.ticks)).toEqual(expected.ticks);
  });

  it("draws the walls under the marks and the labels over them", () => {
    /*
     * Two passes per frame, and the order is the whole reason the furniture is
     * split in two. A filled surface is opaque: a pane painted after it hides
     * the data, and a label painted before it is a label nobody ever sees. One
     * `drawFurniture` call with the default stage would do both at once and
     * look, in a still, almost right.
     *
     * Read off the order of the calls rather than the pixels, which is all
     * that survives having no renderer — and is exactly the property at stake.
     *
     * Drawn with a third observation, because both points in the shared fixture
     * sit inside the fitted range where the surface covers them — and a covered
     * point is counted as hidden and drawn as nothing, so this order would have
     * had nothing in the middle to assert about. The third sits at the top of
     * the response range, in front of the sheet.
     */
    drawSurface({
      observations: [...OBSERVATIONS,
                     { id: "o3", label: "Run 3", x: 2, y: 20, z: 9 }],
    });
    const names = calls.map((c) => c.name);

    // A pane is filled before any observation is drawn: the walls are behind.
    expect(names.indexOf("fill")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("fill")).toBeLessThan(names.indexOf("arc"));
    // And no text is written until the last observation is on the canvas.
    expect(names.indexOf("fillText"))
      .toBeGreaterThan(names.lastIndexOf("arc"));
  });
});

// ---------------------------------------------------------------------------
// P13, the scatter that was rendered for the comparison
// ---------------------------------------------------------------------------

/** Three points, three ranges that cannot be mistaken for each other. */
const CLOUD = [
  { id: "a", label: "A", x: 0, y: 0, z: 0, value: 1 },
  { id: "b", label: "B", x: 10, y: 200, z: 3000, value: 9 },
  { id: "c", label: "C", x: 5, y: 100, z: 1500, value: 4 },
];

describe("a 3D scatter names its three directions", () => {
  function drawVolume() {
    render(
      <Volume points={CLOUD} xLabel="Component 1" yLabel="Component 2"
              zLabel="Component 3" valueLabel="Group" width={W} height={H} />);
    paint();
    return painted();
  }

  it("writes all three labels onto the picture", () => {
    const { titles } = drawVolume();

    expect(titles.map((t) => t.text).sort())
      .toEqual(["Component 1", "Component 2", "Component 3"]);
  });

  it("labels each direction with the range it was scaled over", () => {
    /*
     * This chart maps the caller's x, y and z onto the scene's x, y and z
     * unchanged, so the specs go straight across — the easy case, asserted
     * anyway because "straight across" is a claim about the projection rather
     * than an obvious truth, and `Surface` next door is the counterexample.
     */
    const drawn = drawVolume();
    const expected = expectedFrame({
      x: { label: "Component 1", min: 0, max: 10 },
      y: { label: "Component 2", min: 0, max: 200 },
      z: { label: "Component 3", min: 0, max: 3000 },
    });

    expect(place(drawn.titles)).toEqual(expected.titles);
    expect(place(drawn.ticks)).toEqual(expected.ticks);
  });

  it("rebuilds the frame as the scene turns, rather than caching it", () => {
    /*
     * Which walls face away and which edge carries each axis's numbers both
     * change continuously as the camera moves, so the frame has to be
     * recomputed every frame. A cached one is a wall painted over the cloud
     * for half of a rotation and a column of numbers stranded beside an edge
     * that is no longer there — which reads as a rendering bug rather than as
     * a stale value, and is therefore looked for in the wrong place.
     */
    const ref = createRef<VisualizationController | null>();
    render(
      <Volume points={CLOUD} controllerRef={ref} xLabel="Component 1"
              yLabel="Component 2" zLabel="Component 3"
              width={W} height={H} />);
    paint();
    const before = painted().titles;

    calls.length = 0;
    act(() => { ref.current!.rotate(140, 40); });
    paint();
    const after = painted().titles;

    expect(after).toHaveLength(before.length);
    const moved = after.some((title) => {
      const was = before.find((b) => b.text === title.text);
      return !was || Math.hypot(title.x - was.x, title.y - was.y) > 10;
    });
    expect(moved).toBe(true);
  });
});
