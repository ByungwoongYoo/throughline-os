/**
 * Drawing a shell in space (§9 isosurface).
 *
 * A closed shell is mostly hidden by itself, so almost everything here is about
 * occlusion: that facets are drawn back to front, that the one under the
 * pointer is the one in front, and that a facet turned away from the lamp is
 * still drawn as a facet rather than as a black hole.
 */

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import {
  Isosurface3D, facetTone, paintSurface,
} from "@/components/charts/Isosurface3D";
import { DEFAULT_CAMERA, toCanvas } from "@/lib/charts/scene3d";
import { Surface, extractSurface } from "@/lib/charts3d/isosurface";
import { Grid, gridFromFunction } from "@/lib/charts3d/voxels";
import { VisualizationController } from "@/lib/spatial/commands";

type Call = { op: string; args: number[]; fill: string; width: number };

function recordingCanvas() {
  const calls: Call[] = [];
  const context: Record<string, unknown> & { fillStyle: string } = {
    fillStyle: "", strokeStyle: "", lineWidth: 0 };
  const note = (op: string) => (...args: unknown[]) => {
    calls.push({
      op,
      args: args.filter((a): a is number => typeof a === "number"),
      fill: String(context.fillStyle),
      // Captured because "a stroke happened" does not distinguish the picked
      // facet's outline from the hairline every facet already gets.
      width: Number(context.lineWidth),
    });
  };
  Object.assign(context, {
    clearRect: note("clearRect"), save: note("save"), restore: note("restore"),
    beginPath: note("beginPath"), moveTo: note("moveTo"), lineTo: note("lineTo"),
    closePath: note("closePath"), fill: note("fill"), stroke: note("stroke"),
  });
  const canvas = {
    getContext: () => context, width: 400, height: 300,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const SIZE = { width: 400, height: 300 };

/** Let the chart's paint loop run one frame. */
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const sphere = (n = 14): Grid =>
  gridFromFunction((x, y, z) => Math.sqrt(x * x + y * y + z * z), n,
                   { min: -1.5, max: 1.5 });

const paint = (surface: Surface) => {
  const r = recordingCanvas();
  paintSurface(r.canvas, surface, DEFAULT_CAMERA, SIZE);
  return r;
};

describe("the shell is drawn back to front", () => {
  it("orders every facet by depth", () => {
    /*
     * A closed shell is mostly hidden by itself. Drawn in extraction order its
     * far side lands on top of its near side, and the result reads as a
     * wireframe tangle rather than as a solid — while still looking like a
     * picture of something.
     */
    const surface = extractSurface(sphere(12), 1.0);
    expect(surface.triangles.length).toBeGreaterThan(20);

    const { calls } = paint(surface);

    /*
     * Keyed by all three vertices. The mesh is welded, so many triangles share
     * a first vertex — keying on that alone collapses them in the lookup and
     * compares the wrong depths, which is how an earlier version of this test
     * failed against a renderer that was ordering correctly.
     */
    const at = (p: { x: number; y: number; z: number }) =>
      toCanvas(p, DEFAULT_CAMERA, 400, 300);
    const key = (pts: Array<{ x: number; y: number }>) =>
      pts.map((q) => `${q.x.toFixed(5)},${q.y.toFixed(5)}`).join("|");

    const depthOf = new Map<string, number>();
    for (const t of surface.triangles) {
      const a = at(t.a), b = at(t.b), c = at(t.c);
      depthOf.set(key([a, b, c]), (a.depth + b.depth + c.depth) / 3);
    }

    // Rebuild each drawn facet from its moveTo + two lineTo calls.
    const drawn: number[] = [];
    for (let i = 0; i < calls.length; i += 1) {
      if (calls[i].op !== "moveTo") continue;
      const l1 = calls[i + 1], l2 = calls[i + 2];
      if (l1?.op !== "lineTo" || l2?.op !== "lineTo") continue;
      const d = depthOf.get(key([
        { x: calls[i].args[0], y: calls[i].args[1] },
        { x: l1.args[0], y: l1.args[1] },
        { x: l2.args[0], y: l2.args[1] }]));
      if (d !== undefined) drawn.push(d);
    }

    expect(drawn.length).toBeGreaterThan(10);
    for (let i = 1; i < drawn.length; i += 1) {
      expect(drawn[i]).toBeGreaterThanOrEqual(drawn[i - 1] - 1e-9);
    }
  });

  it("draws one filled facet per triangle", () => {
    const surface = extractSurface(sphere(10), 1.0);
    const { calls } = paint(surface);
    expect(calls.filter((c) => c.op === "fill"))
      .toHaveLength(surface.triangles.length);
  });

  it("strokes each facet as well as filling it", () => {
    /*
     * Canvas antialiases polygon edges, so abutting fills leave a hairline of
     * background between them. A mesh drawn with fills alone is visibly cracked
     * along every shared edge — which on this chart reads as exactly the holes
     * the caption says are not there.
     */
    const surface = extractSurface(sphere(10), 1.0);
    const { calls } = paint(surface);
    expect(calls.filter((c) => c.op === "stroke"))
      .toHaveLength(surface.triangles.length);
  });

  it("clears before drawing, so a rotation does not smear", () => {
    expect(paint(extractSurface(sphere(8), 1.0)).calls[0].op).toBe("clearRect");
  });

  it("does nothing at all without a canvas", () => {
    expect(() => paintSurface(null, extractSurface(sphere(8), 1.0),
                              DEFAULT_CAMERA, SIZE)).not.toThrow();
  });

  it("draws nothing when the level is outside the field", () => {
    const { calls } = paint(extractSurface(sphere(8), 99));
    expect(calls.filter((c) => c.op === "fill")).toHaveLength(0);
  });
});

describe("shading reads as form, not as holes", () => {
  it("never draws a facet fully black", () => {
    /*
     * A facet turned away from the lamp at pure black is indistinguishable
     * from a gap in the shell — and this chart's entire caption is about which
     * gaps are real.
     */
    for (const n of [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
                     { x: 0, y: 0, z: -1 }, { x: 0.3, y: -0.9, z: 0.1 }]) {
      expect(facetTone(n)).toBeGreaterThan(0.25);
    }
  });

  it("gives facets at different angles different tones", () => {
    // Otherwise the shell is one flat silhouette and its curvature is
    // unreadable — the only thing flat shading has to offer.
    const tones = new Set([
      facetTone({ x: 1, y: 0, z: 0 }),
      facetTone({ x: 0, y: 1, z: 0 }),
      facetTone({ x: 0, y: 0, z: 1 }),
    ].map((t) => t.toFixed(4)));
    expect(tones.size).toBe(3);
  });

  it("lights a facet and its opposite the same", () => {
    /*
     * The shell is open wherever the data had holes, so back faces are kept
     * rather than culled. A back face lit to zero would make an opening look
     * like a void instead of like the inside of a surface.
     */
    expect(facetTone({ x: 0, y: 0, z: 1 }))
      .toBeCloseTo(facetTone({ x: 0, y: 0, z: -1 }), 9);
  });

  it("stays inside the tone range whatever the normal", () => {
    expect(facetTone({ x: 5, y: -3, z: 2 })).toBeLessThanOrEqual(1.0001);
  });
});

describe("the controller the seam talks to", () => {
  it("reports the facet in front, not one behind it", () => {
    /*
     * In a closed shell every pixel has a front and a back facet under it, so
     * naming the back one reports a place the reader cannot see.
     *
     * **The camera is turned first, and that is not decoration.** At the
     * default view a sphere's facets come out of the march in an order that
     * already agrees with depth — measured: 936 screen points carry two or
     * more facets and *not one* of them disagrees — so a hit test that simply
     * took the last match would pass. Rotated, 939 of 940 disagree. An earlier
     * version of this test swept for the first hit at the default camera and
     * proved nothing.
     */
    const grid = sphere(12);
    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={grid} level={1.0} controllerRef={ref}
                         width={400} height={300} />);

    const home = ref.current!.viewState();
    const camera = { yaw: 2.2, pitch: -0.9, zoom: home.zoom };
    act(() => { ref.current!.restoreViewState({ ...camera, level: 1.0 }); });

    const surface = extractSurface(grid, 1.0);
    const projected = surface.triangles.map((t) =>
      [t.a, t.b, t.c].map((p) => toCanvas(p, { ...DEFAULT_CAMERA, ...camera },
                                          400, 300)));
    const covers = (pt: { x: number; y: number },
                    tri: Array<{ x: number; y: number }>) => {
      const side = (u: { x: number; y: number }, v: { x: number; y: number }) =>
        (v.x - u.x) * (pt.y - u.y) - (v.y - u.y) * (pt.x - u.x);
      const ab = side(tri[0], tri[1]);
      const bc = side(tri[1], tri[2]);
      const ca = side(tri[2], tri[0]);
      return !((ab < 0 || bc < 0 || ca < 0) && (ab > 0 || bc > 0 || ca > 0));
    };
    const depth = (tri: Array<{ depth: number }>) =>
      (tri[0].depth + tri[1].depth + tri[2].depth) / 3;

    let probe: { x: number; y: number } | null = null;
    let expected = -1;
    for (let x = 0; x <= 400 && probe === null; x += 3) {
      for (let y = 0; y <= 300 && probe === null; y += 3) {
        const under = projected
          .map((tri, i) => ({ tri, i }))
          .filter(({ tri }) => covers({ x, y }, tri));
        if (under.length < 2) continue;
        const front = under.reduce((a, b) => (depth(b.tri) > depth(a.tri) ? b : a));
        if (front.i === under[under.length - 1].i) continue;
        probe = { x, y };
        expected = front.i;
      }
    }
    expect(probe).not.toBeNull();
    expect(ref.current!.hover(probe!)?.id).toBe(String(expected));
  });

  it("finds nothing where the shell is not", () => {
    /*
     * The inside test accepts either winding, because an open shell shows both
     * faces. Accepting *everything* is the failure mode that hides behind
     * that: a point far outside the silhouette must still come back empty, or
     * the hand is told it is pointing at a surface wherever it goes.
     */
    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={sphere(10)} level={1.0} controllerRef={ref}
                         width={400} height={300} />);
    expect(ref.current!.hover({ x: -900, y: -900 })).toBeNull();
    expect(ref.current!.hover({ x: 5000, y: 5000 })).toBeNull();
  });

  it("carries the level in the view state, not just the camera", () => {
    // The same grid at two levels is two different pictures, so a mark placed
    // on one shell means nothing over the other.
    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={sphere(8)} level={1.0} controllerRef={ref} />);
    expect(ref.current!.viewState()).toHaveProperty("level", 1.0);
  });

  it("restores the level along with the camera, and refuses a partial", () => {
    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={sphere(8)} level={1.0} controllerRef={ref} />);
    const home = ref.current!.viewState();

    act(() => { ref.current!.restoreViewState({ ...home, level: 0.6 }); });
    expect(ref.current!.viewState().level).toBeCloseTo(0.6, 9);

    const moved = ref.current!.viewState();
    for (const missing of ["yaw", "pitch", "zoom", "level"]) {
      const partial: Record<string, number> = { ...moved };
      delete partial[missing];
      act(() => { ref.current!.restoreViewState(partial); });
      expect(ref.current!.viewState()).toEqual(moved);
    }
  });

  it("brings the level back when the view is reset", () => {
    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={sphere(8)} level={1.0} controllerRef={ref} />);
    act(() => { ref.current!.restoreViewState(
      { ...ref.current!.viewState(), level: 0.4 }); });
    expect(ref.current!.viewState().level).toBeCloseTo(0.4, 9);

    act(() => { ref.current!.resetView(); });
    expect(ref.current!.viewState().level).toBeCloseTo(1.0, 9);
  });

  it("has no bounds before it is laid out", () => {
    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={sphere(8)} controllerRef={ref} />);
    expect(ref.current!.bounds()).toBeNull();
  });
});

describe("what the reader is told and can change", () => {
  it("offers the level as a control, because a shell is a choice", () => {
    /*
     * One shell out of a family, shown without the means to move it, implies
     * the field has a boundary — which is the one thing it does not have.
     */
    const { getByLabelText } = render(<Isosurface3D grid={sphere(8)} />);
    expect(getByLabelText("Isosurface level")).toBeTruthy();
  });

  it("redraws when the reader moves the level", () => {
    const onLevelChange = vi.fn();
    const { getByLabelText, container } = render(
      <Isosurface3D grid={sphere(10)} level={1.0}
                    onLevelChange={onLevelChange} />);
    const before = container.textContent;
    fireEvent.change(getByLabelText("Isosurface level"),
                     { target: { value: "0.5" } });
    expect(onLevelChange).toHaveBeenCalled();
    expect(container.textContent).not.toBe(before);
  });

  it("states the level, the field's range and the triangle count", () => {
    const { container } = render(
      <Isosurface3D grid={sphere(10)} level={1.0} caption="A sphere." />);
    expect(container.textContent).toContain("A sphere.");
    expect(container.textContent).toContain("triangles at");
    expect(container.textContent).toContain("from a field of");
  });

  it("says the level is outside the data rather than showing a blank", () => {
    const { container } = render(<Isosurface3D grid={sphere(8)} level={99} />);
    expect(container.textContent).toContain("outside it entirely");
  });
});

// ---------------------------------------------------------------------------
// Picking things on the surface (§189)
//
// There was no selection at all: `select` returned a target and recorded
// nothing, `focus` and `deselect` were empty functions, and `selectRegion` and
// `withinPolygon` returned `[]` whatever they were given. A hand that could
// rotate this chart could not pick anything on it, while every other chart in
// the same gallery answered the same commands — the single command
// architecture failing quietly on one implementation.
// ---------------------------------------------------------------------------

describe("selecting on the surface", () => {
  it("finds facets inside a lasso", () => {
    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={sphere(10)} level={1.0} controllerRef={ref} />);

    // A polygon covering the whole canvas: everything drawn is inside it.
    const whole = [
      { x: -1e4, y: -1e4 }, { x: 1e4, y: -1e4 },
      { x: 1e4, y: 1e4 }, { x: -1e4, y: 1e4 },
    ];
    const all = ref.current!.withinPolygon(whole);
    expect(all.length).toBeGreaterThan(0);

    // And a polygon covering nothing finds nothing, or the test above would
    // pass for a function that returns everything regardless.
    expect(ref.current!.withinPolygon([
      { x: -1e4, y: -1e4 }, { x: -9e3, y: -1e4 },
      { x: -9e3, y: -9e3 }, { x: -1e4, y: -9e3 },
    ])).toEqual([]);
  });

  it("selects a smaller region than the whole", () => {
    // The measured property, rather than assuming a radius picks a subset:
    // a circle around the centre must find some facets and not all of them.
    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={sphere(10)} level={1.0} controllerRef={ref} />);

    const { width, height } = ref.current!.viewport();
    const centre = { x: width / 2, y: height / 2 };
    const near = ref.current!.selectRegion(centre, 30);
    const far = ref.current!.selectRegion(centre, 1e4);

    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(far.length);
  });

  it("draws the facet a person picked, rather than only recording it", () => {
    /*
     * The failure this nearly shipped as. The first fix gave the chart a
     * `selected` state and wired `focus`, `select` and `deselect` to set it —
     * and never painted it. That is the same defect one layer down: the
     * command stopped being ignored and started being answered invisibly,
     * which from the researcher's side is the same thing.
     *
     * A recording canvas, so what is asserted is the drawing rather than the
     * state behind it. The picked facet is stroked a second time, in its own
     * colour and at a heavier width, because one facet of a fine mesh is a few
     * pixels across and a different fill is not findable.
     */
    const surface = extractSurface(sphere(8), 1.0);
    expect(surface.triangles.length).toBeGreaterThan(3);

    const plain = recordingCanvas();
    paintSurface(plain.canvas, surface, DEFAULT_CAMERA, SIZE, null);
    const picked = recordingCanvas();
    paintSurface(picked.canvas, surface, DEFAULT_CAMERA, SIZE, 3);

    const strokes = (r: { calls: Call[] }) =>
      r.calls.filter((c) => c.op === "stroke");
    expect(strokes(picked)).toHaveLength(strokes(plain).length + 1);

    // And it is heavier than the seam-hiding hairline, or it is invisible.
    const hairline = Math.max(...strokes(plain).map((c) => c.width));
    const heaviest = Math.max(...strokes(picked).map((c) => c.width));
    expect(heaviest).toBeGreaterThan(hairline);
  });

  it("draws nothing extra when the picked facet is not on this surface", () => {
    const surface = extractSurface(sphere(8), 1.0);
    const plain = recordingCanvas();
    paintSurface(plain.canvas, surface, DEFAULT_CAMERA, SIZE, null);
    const absent = recordingCanvas();
    paintSurface(absent.canvas, surface, DEFAULT_CAMERA, SIZE, 999999);

    const count = (r: { calls: Call[] }) =>
      r.calls.filter((c) => c.op === "stroke").length;
    expect(count(absent)).toBe(count(plain));
  });

  it("keeps the facet already picked when asked to focus a missing one", async () => {
    /*
     * What the bounds check is for. Without it `focus` would replace a
     * selection the person made with an index that draws nothing, so a bad
     * argument would silently clear their pick rather than being ignored.
     */
    /*
     * The component's own canvas, not a separate one painted by hand. An
     * earlier version of this test called `paintSurface` directly after
     * focusing the component, which observes nothing about the component at
     * all — it passed whether or not the guard existed.
     */
    const recorder = recordingCanvas();
    const context = recorder.canvas.getContext("2d");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);

    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={sphere(8)} level={1.0} controllerRef={ref} />);

    const heavy = () => recorder.calls.filter(
      (c) => c.op === "stroke" && c.width > 1).length;

    await act(async () => { ref.current!.focus("2"); await frame(); });
    const afterPicking = heavy();
    expect(afterPicking).toBeGreaterThan(0);

    /*
     * Rotating forces the next repaint, which is what makes the two cases
     * differ at all: ignoring the bad argument changes no state and therefore
     * repaints nothing, so counting frames straight after the call gives the
     * same number either way. What separates them is whether the *next* frame
     * still draws the outline.
     */
    /*
     * Two acts, not one. Putting the focus and the rotate together let the
     * animation frame paint before React had committed the state change, so
     * the frame still carried the previous selection and the count rose either
     * way — the test passed whether or not the guard existed. Committing
     * first, then forcing a repaint, is what separates the two.
     */
    await act(async () => { ref.current!.focus("999999"); });
    await act(async () => { ref.current!.rotate(4, 0); await frame(); });
    expect(heavy()).toBeGreaterThan(afterPicking);

    // And deselecting really does stop drawing it, or the assertion above
    // would hold for a chart that ignored every command equally.
    await act(async () => { ref.current!.deselect(); });
    await act(async () => { ref.current!.rotate(4, 0); await frame(); });
    const afterClearing = heavy();
    await act(async () => { ref.current!.rotate(4, 0); await frame(); });
    expect(heavy()).toBe(afterClearing);
  });

  it("ignores a focus on a facet that does not exist", () => {
    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={sphere(8)} level={1.0} controllerRef={ref} />);
    for (const bad of ["-1", "999999", "not a number", ""]) {
      expect(() => act(() => { ref.current!.focus(bad); })).not.toThrow();
    }
  });

  it("reports the facet in front when one point is picked", () => {
    /*
     * A region and a point mean different things and the rules differ on
     * purpose. A point names one place, so the far wall of a closed shell
     * under the cursor is not it; a region is an area of interest, and
     * dropping the far side would under-report what was enclosed.
     */
    const ref = createRef<VisualizationController>();
    render(<Isosurface3D grid={sphere(10)} level={1.0} controllerRef={ref} />);
    const { width, height } = ref.current!.viewport();
    const centre = { x: width / 2, y: height / 2 };

    const picked = ref.current!.select(centre);
    expect(picked).not.toBeNull();

    /*
     * A region matches facets whose *centre* falls inside it, which is the
     * rule every other chart here uses — a bar by its top, a voxel by its
     * splat centre. So a radius smaller than the spacing between facet centres
     * finds none even where a facet covers the pixel, and that is consistency
     * rather than a miss: one gesture must mean the same thing on every chart.
     *
     * Measured rather than assumed. This test first asserted that a 2px region
     * around a picked point contains at least that facet, which is false for a
     * centroid rule and was the test being wrong about correct code.
     */
    expect(ref.current!.selectRegion(centre, 2)).toEqual([]);

    const wide = ref.current!.selectRegion(centre, 60);
    expect(wide.length).toBeGreaterThan(0);
    // A closed shell has facets on the far side too, and a region keeps them:
    // it encloses an area of interest rather than naming one visible place.
    expect(wide.length).toBeGreaterThan(1);
  });
});
