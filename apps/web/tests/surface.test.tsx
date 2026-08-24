/**
 * A surface, which is one of the few charts where three dimensions are honest.
 *
 * The argument that rules 3D out almost everywhere is the same one that lets it
 * in here. A bar chart in 3D is worse than a bar chart: perspective enlarges the
 * near bars, occlusion hides the far ones, and reading a value off a rotated
 * axis is measurably less accurate. Nothing is gained, because the data has one
 * dimension and the picture has three.
 *
 * `z = f(x, y)` is different in kind — it *is* a two-dimensional manifold in
 * three-space. The third dimension is in the data rather than added to it, and
 * the shape a researcher is looking for (ridge, saddle, plateau, single optimum)
 * is exactly what rotating reveals.
 *
 * So these tests are mostly about the two claims the chart makes about itself:
 * that a fit is not data, and that a surface hides things.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Surface } from "@/components/charts/Surface";
import { VisualizationController, apply } from "@/lib/spatial/commands";

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** A saddle: the shape a contour plot flattens away and rotation reveals. */
const GRID = {
  x: [0, 1, 2, 3, 4],
  y: [0, 1, 2, 3, 4],
  z: [0, 1, 2, 3, 4].map((j) =>
    [0, 1, 2, 3, 4].map((i) => (i - 2) * (i - 2) - (j - 2) * (j - 2))),
};

const OBSERVATIONS = [
  { id: "o1", label: "Run 1", x: 1, y: 1, z: 0 },
  { id: "o2", label: "Run 2", x: 3, y: 1, z: 1 },
  { id: "o3", label: "Run 3", x: 2, y: 2, z: 0 },
];

function mount(props: Record<string, unknown> = {}) {
  const ref = createRef<VisualizationController | null>();
  render(
    <Surface grid={GRID} observations={OBSERVATIONS} controllerRef={ref}
             xLabel="dose" yLabel="duration" zLabel="response"
             width={400} height={400} {...props} />);
  return ref;
}

describe("saying that a fit is not data", () => {
  it("says so in the caption, not in a tooltip", async () => {
    /**
     * The single most likely misreading of this chart: that the smooth sheet is
     * something somebody measured. It is what a model predicts at points nobody
     * visited.
     */
    mount();

    expect(await screen.findByText(/this surface is a fit, not data/i))
      .toBeTruthy();
  });

  it("says how many observations it was fitted to", async () => {
    mount();
    expect(await screen.findByText(/3 observations/)).toBeTruthy();
  });

  it("keeps the observations in the data table, and not the fit", async () => {
    /**
     * §T004's rule — every chart has a readable table — applied honestly. The
     * surface has no rows: it is defined everywhere, including where nothing was
     * measured, so tabulating it would invent data.
     */
    mount();

    // `findAll`, because the note appears in the disclosure summary and again
    // in the table's caption — which is the table component doing its job, not
    // a duplicate.
    expect((await screen.findAllByText(/the surface itself is a fit and has no rows/i))
      .length).toBeGreaterThan(0);
  });
});

describe("saying what it hides", () => {
  it("reports observations behind the surface", async () => {
    /**
     * A surface occludes far more completely than a cloud of points does — it is
     * a solid sheet. A chart that did not say so would be claiming the reader
     * can see all of their data.
     */
    mount();

    expect(await screen.findByText(/behind the surface right now|no observations are hidden/i))
      .toBeTruthy();
  });

  it("warns that faint cells have nothing under them", async () => {
    /**
     * The smoothest part of a fitted surface is usually the part with no data
     * beneath it, and nothing in the shape tells a reader that.
     */
    mount();

    expect(await screen.findByText(/no observation near them/i)).toBeTruthy();
  });

  it("says the axes are not comparable", async () => {
    mount();
    expect(await screen.findByText(/distances along different axes are not comparable/i))
      .toBeTruthy();
  });
});

describe("driven like every other spatial chart", () => {
  it("implements the whole controller vocabulary", () => {
    /**
     * The seam is what makes one gesture engine work for every 3D chart. A
     * partial implementation is the failure it exists to prevent: the gesture
     * works on one chart and silently does nothing on the next.
     */
    const ref = mount();
    for (const method of ["rotate", "zoom", "pan", "hover", "select",
                          "selectRegion", "focus", "deselect", "resetView",
                          "viewport"] as const) {
      expect(typeof ref.current?.[method], method).toBe("function");
    }
  });

  it("accepts commands through `apply`, exactly as a gesture would", () => {
    const ref = mount();
    expect(() => {
      apply(ref.current!, { kind: "rotate", deltaX: 40, deltaY: 20 });
      apply(ref.current!, { kind: "zoom", factor: 1.4 });
      apply(ref.current!, { kind: "resetView" });
    }).not.toThrow();
  });

  it("selects an observation, and reports it", () => {
    const onSelect = vi.fn();
    const ref = mount({ onSelect });

    // Sweep, because where an observation lands depends on the camera.
    //
    // Checked on the *return value*, not on whether the spy was called: a miss
    // reports `onSelect(null)`, which is a call, so counting calls would have
    // stopped the sweep on the very first empty pixel.
    let found = null;
    for (let x = 0; x <= 400 && !found; x += 8) {
      for (let y = 0; y <= 400 && !found; y += 8) {
        found = ref.current!.select({ x, y });
      }
    }
    expect(found).not.toBeNull();

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ label: expect.stringContaining("Run") }));
  });

  it("keeps every capability on the keyboard", () => {
    /** §30 and Rule 5, held to on the second chart as well as the first. */
    const onSelect = vi.fn();
    render(
      <Surface grid={GRID} observations={OBSERVATIONS} onSelect={onSelect}
               xLabel="dose" yLabel="duration" zLabel="response"
               width={400} height={400} />);
    const canvas = document.querySelector("canvas")!;

    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(onSelect).toHaveBeenCalled();

    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("taps when a selection lands, and stays silent when it does not", () => {
    const onDetent = vi.fn();
    const ref = mount({ onDetent });

    ref.current!.select({ x: -999, y: -999 });
    expect(onDetent).not.toHaveBeenCalled();
  });
});

describe("degenerate input, which a fit produces more often than data does", () => {
  it("draws a flat surface rather than dividing by zero", () => {
    /**
     * A model that predicts the same value everywhere is a real result — a
     * predictor with no effect — and the chart has to show it rather than
     * rendering every point at NaN and drawing nothing.
     */
    const flat = { x: [0, 1, 2], y: [0, 1, 2],
                   z: [[5, 5, 5], [5, 5, 5], [5, 5, 5]] };
    expect(() => render(
      <Surface grid={flat} xLabel="a" yLabel="b" zLabel="c"
               width={300} height={300} />)).not.toThrow();
  });

  it("skips cells the fit declined to predict", () => {
    /**
     * `null` is how a fit says "not here" — outside a convex hull, or beyond
     * where the model is defined. Drawing it as zero would invent a value.
     */
    const holed = { x: [0, 1, 2], y: [0, 1, 2],
                    z: [[1, null, 1], [null, null, null], [1, 2, 1]] };
    expect(() => render(
      <Surface grid={holed} xLabel="a" yLabel="b" zLabel="c"
               width={300} height={300} />)).not.toThrow();
  });

  it("works with no observations at all", () => {
    /** A purely theoretical surface is a legitimate thing to plot. */
    expect(() => render(
      <Surface grid={GRID} xLabel="a" yLabel="b" zLabel="c"
               width={300} height={300} />)).not.toThrow();
  });
});
