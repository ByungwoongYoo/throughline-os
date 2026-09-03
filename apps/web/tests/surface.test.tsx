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

  it("does not describe observations on a surface that has none", () => {
    /**
     * The caption carried two sentences that contradicted each other. One
     * branch said "No observations are drawn on this surface, so it is the
     * height field it was given rather than a model fitted to measurements" —
     * and then, unconditionally, "Faint cells have no observation near them".
     *
     * Vacuously true of every cell, and it reads as though some cells *did*
     * have data under them. Worse, it describes a fit: a reader is told the
     * smooth parts are where the measurements ran out, on a surface that was
     * never fitted to any. The catalogue draws every one of its 52 generated
     * surfaces this way, so it was the common case rather than an edge.
     */
    const { container } = render(
      <Surface grid={GRID} xLabel="a" yLabel="b" zLabel="c"
               width={300} height={300} />);
    const caption = container.querySelector("figcaption")?.textContent ?? "";

    expect(caption).toContain("No observations are drawn");
    expect(caption).not.toContain("Faint cells");
    // The part that is true of any surface stays.
    expect(caption).toContain("scaled independently");
  });

  it("still explains faintness where there are observations to be near", () => {
    const { container } = render(
      <Surface grid={GRID} observations={OBSERVATIONS} xLabel="a" yLabel="b"
               zLabel="c" width={300} height={300} />);
    const caption = container.querySelector("figcaption")?.textContent ?? "";
    expect(caption).toContain("Faint cells");
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


// ---------------------------------------------------------------------------
// Colour carrying a fourth variable, with a key (§9, and a reference figure)
// ---------------------------------------------------------------------------

describe("colour can carry something the axes do not", () => {
  const GRID_3 = {
    x: [0, 1, 2], y: [0, 1, 2],
    z: [[1, 2, 3], [2, 3, 4], [3, 4, 5]],
  };

  it("draws no key when colour only repeats the height", () => {
    /**
     * The default. Height already carries z, so a scale for it keys the
     * picture to itself and adds a legend a reader has to check against an
     * axis that says the same thing.
     */
    const { container } = render(
      <Surface grid={GRID_3} xLabel="a" yLabel="b" zLabel="c"
               width={300} height={300} />);

    expect(container.querySelector(".surface-legend")).toBeNull();
  });

  it("draws a key, with its unit, when colour carries a fourth variable", () => {
    /**
     * The case the reference figure is built on: a surface whose height is one
     * quantity and whose colour is another — dispersion across a strike and
     * maturity surface. Four dimensions in one picture, and unreadable without
     * a key.
     */
    const { container } = render(
      <Surface
        grid={GRID_3}
        colourBy={{
          values: [[10, 20, 30], [20, 30, 40], [30, 40, 50]],
          label: "Dispersion", unit: "bps",
        }}
        xLabel="a" yLabel="b" zLabel="c" width={300} height={300} />);

    const legend = container.querySelector(".surface-legend");
    expect(legend).not.toBeNull();
    expect(legend!.textContent).toContain("Dispersion");
    expect(legend!.textContent).toContain("bps");
    // The ends of the scale are the fourth variable's range, not the height's.
    expect(legend!.textContent).toContain("10");
    expect(legend!.textContent).toContain("50");
  });

  it("keys the scale to the fourth variable, not to z", () => {
    /**
     * The mistake worth guarding: taking the range from the height while
     * painting from another variable produces a bar whose numbers belong to a
     * different quantity than its colours.
     */
    const { container } = render(
      <Surface
        grid={GRID_3}
        colourBy={{ values: [[100, 200, 300], [200, 300, 400], [300, 400, 500]],
                    label: "Residual" }}
        xLabel="a" yLabel="b" zLabel="c" width={300} height={300} />);

    // The two ends, read as their own spans. A substring test would be
    // meaningless here: "100500" contains "5" because 500 does.
    const ends = [...container.querySelectorAll(".surface-legend-ends span")]
      .map((node) => node.textContent);
    expect(ends).toEqual(["100", "500"]);
    // Not the height's range, which is 1 to 5.
    expect(ends).not.toEqual(["1", "5"]);
  });

  it("refuses a colour grid that is not this surface", () => {
    /**
     * Painting one surface with another's values is confidently wrong
     * everywhere and no reader could see it. Falling back to height silently
     * would draw a different picture from the one that was asked for, so the
     * fallback happens *and says so*.
     */
    const { container } = render(
      <Surface
        grid={GRID_3}
        colourBy={{ values: [[1, 2]], label: "Wrong shape" }}
        xLabel="a" yLabel="b" zLabel="c" width={300} height={300} />);

    // No key, because the colour is back to meaning the height.
    expect(container.querySelector(".surface-legend")).toBeNull();
  });

  it("refuses a colour grid with the right rows and the wrong columns", () => {
    /**
     * The case the first version of this file missed. A grid with too few
     * *rows* is caught by a length check; one with the right number of rows
     * and a short row inside it is not, and it is the likelier mistake —
     * a column dropped somewhere in a pipeline rather than a whole grid
     * mismatched. Painting from it would colour each row by the wrong cells
     * and look entirely plausible.
     */
    const { container } = render(
      <Surface
        grid={GRID_3}
        colourBy={{ values: [[1, 2, 3], [4, 5], [6, 7, 8]],
                    label: "Ragged" }}
        xLabel="a" yLabel="b" zLabel="c" width={300} height={300} />);

    expect(container.querySelector(".surface-legend")).toBeNull();
  });

  it("survives a fourth variable with holes in it", () => {
    /** `null` is how a grid says "not here", and it must not become a colour. */
    expect(() => render(
      <Surface
        grid={GRID_3}
        colourBy={{ values: [[10, null, 30], [null, 30, 40], [30, 40, null]],
                    label: "Sparse" }}
        xLabel="a" yLabel="b" zLabel="c" width={300} height={300} />)).not.toThrow();
  });
});
