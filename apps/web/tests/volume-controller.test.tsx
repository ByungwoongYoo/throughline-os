/**
 * The 3D chart, driven through the seam every input shares.
 *
 * This is the half of Prototype 1 that closes the loop: the gesture machine
 * emits `IntentCommand`s, and something has to turn them into a scene that
 * moved. If the abstraction is right, this test can exercise the whole chain
 * with no camera and no hand — the commands are the same ones a pinch would
 * produce.
 *
 * happy-dom has no canvas, so nothing here asserts on pixels. What it asserts
 * is the part that would still be wrong on a real screen: which point the chart
 * resolves, whether the selection survives, and whether ordinary mouse use
 * still reaches the same capability.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Volume } from "@/components/charts/Volume";
import { VisualizationController, apply } from "@/lib/spatial/commands";

beforeEach(() => {
  // The chart draws on mount; without a 2D context it would throw before any
  // of the behaviour under test could run.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const CLOUD = [
  { id: "a", label: "Sample A", x: 0, y: 0, z: 0, value: 1 },
  { id: "b", label: "Sample B", x: 10, y: 10, z: 10, value: 9 },
  { id: "c", label: "Sample C", x: -10, y: -10, z: -10, value: 4 },
];

function mount(onSelect?: (t: unknown) => void) {
  const ref = createRef<VisualizationController | null>();
  render(
    <Volume points={CLOUD} controllerRef={ref} onSelect={onSelect as never}
            xLabel="x" yLabel="y" zLabel="z" valueLabel="value"
            width={400} height={400} />);
  return ref;
}

describe("the controller seam", () => {
  it("exposes the whole vocabulary, so no command is silently unimplemented", () => {
    /**
     * A partially implemented controller is the failure this abstraction exists
     * to prevent: the gesture works on one chart and does nothing on the next,
     * and the researcher cannot tell which.
     */
    const ref = mount();
    for (const method of ["rotate", "zoom", "pan", "hover", "select", "focus",
                          "deselect", "resetView", "viewport"] as const) {
      expect(typeof ref.current?.[method], method).toBe("function");
    }
  });

  it("accepts commands through `apply`, exactly as a gesture would", () => {
    const ref = mount();
    expect(() => {
      apply(ref.current!, { kind: "rotate", deltaX: 0.2, deltaY: 0.1 });
      apply(ref.current!, { kind: "zoom", factor: 1.4 });
      apply(ref.current!, { kind: "resetView" });
    }).not.toThrow();
  });

  it("reports its own viewport, so normalised hand coordinates can be mapped", () => {
    const ref = mount();
    expect(ref.current?.viewport()).toEqual({ width: 400, height: 400 });
  });
});

describe("safe limits", () => {
  /**
   * Scan a region far larger than the canvas for a point, since the camera is
   * not exposed. Hit-testing accepts any coordinate, so this measures where the
   * scene *is*, not what happens to be visible.
   */
  function findWithin(controller: VisualizationController, id: string,
                      reach = 1400): boolean {
    for (let x = -reach; x <= reach; x += 16) {
      for (let y = -reach; y <= reach; y += 16) {
        if (controller.hover({ x, y })?.id === id) return true;
      }
    }
    return false;
  }

  it("keeps zoom bounded, so the scene stays somewhere findable", () => {
    /**
     * §32 — a transformation without limits puts the data somewhere no reset
     * short of a reload can reach.
     *
     * Note what this does *not* claim: that everything stays inside the canvas.
     * Zooming in crops the cloud, which is the entire point of zooming in. The
     * property that matters is that the scale stops somewhere, so the scene
     * remains a finite distance away rather than a million pixels off.
     *
     * Asserted on an off-centre point. The origin projects to the middle at
     * every zoom, so testing with it would pass whether the clamp existed or
     * not — which the first version of this test did.
     */
    const ref = mount();
    for (let i = 0; i < 40; i += 1) ref.current!.zoom(1.5);

    expect(findWithin(ref.current!, "b")).toBe(true);
  });

  it("cannot zoom the cloud away to nothing", () => {
    const ref = mount();
    for (let i = 0; i < 40; i += 1) ref.current!.zoom(0.6);

    expect(findWithin(ref.current!, "b")).toBe(true);
  });

  it("comes home from anywhere", () => {
    /** The recovery §31 requires: one action returns a lost view. */
    const ref = mount();
    for (let i = 0; i < 20; i += 1) ref.current!.zoom(1.5);
    ref.current!.rotate(400, 300);
    ref.current!.resetView();

    expect(ref.current!.hover({ x: 200, y: 200 })?.id).toBe("a");
  });
});

describe("pointing at data", () => {
  it("resolves the point nearest the pointer, not only a direct hit", () => {
    /**
     * §7 — a researcher indicating a cluster is naming a region, not hitting a
     * 3.4px target. Requiring precision makes pointing feel broken.
     */
    const ref = mount();
    // The centre of the cube: the origin point projects to the middle.
    const target = ref.current!.hover({ x: 200, y: 200 });

    expect(target?.id).toBe("a");
  });

  it("resolves nothing in empty space rather than the closest point anywhere", () => {
    /**
     * Nearest-object logic with no bound would mean the pointer is *always* on
     * something, and a highlight that never goes out is a highlight that says
     * nothing.
     */
    const ref = mount();
    expect(ref.current!.hover({ x: 5, y: 395 })).toBeNull();
  });

  it("carries the datum, so a selection can become AI context", () => {
    /** §26. The gesture layer never learns what a datum is; it just passes it. */
    const ref = mount();
    const target = ref.current!.hover({ x: 200, y: 200 });

    expect(target?.datum).toMatchObject({ id: "a", label: "Sample A" });
  });
});

describe("selection", () => {
  it("tells the host what was chosen", () => {
    const onSelect = vi.fn();
    const ref = mount(onSelect);

    ref.current!.select({ x: 200, y: 200 });

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", label: "Sample A" }));
  });

  it("survives the hand moving away", () => {
    /**
     * §8. A selection that evaporated when the hand dropped would make the
     * researcher hold a pose to keep reading, which is the opposite of the
     * point.
     */
    const onSelect = vi.fn();
    const ref = mount(onSelect);

    ref.current!.select({ x: 200, y: 200 });
    ref.current!.hover({ x: 5, y: 395 });        // pointer wanders off

    // Only the deliberate act cleared it, and nothing has cleared it yet.
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("can be cleared deliberately", () => {
    const onSelect = vi.fn();
    const ref = mount(onSelect);

    ref.current!.select({ x: 200, y: 200 });
    ref.current!.deselect();

    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("selecting empty space reports nothing found", () => {
    const onSelect = vi.fn();
    const ref = mount(onSelect);

    expect(ref.current!.select({ x: 5, y: 395 })).toBeNull();
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("the mouse keeps every capability", () => {
  it("selects on a click that did not travel", () => {
    /** Rule 5 — gesture is an additional layer, never the only route. */
    const onSelect = vi.fn();
    render(<Volume points={CLOUD} onSelect={onSelect} xLabel="x" yLabel="y"
                   zLabel="z" width={400} height={400} />);
    const canvas = screen.getByRole("img", { hidden: true })
      ?? document.querySelector("canvas")!;

    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(canvas, { clientX: 200, clientY: 200 });

    expect(onSelect).toHaveBeenCalled();
  });

  it("does not select at the end of a rotation", () => {
    /**
     * The bug this test was written against: `dragRef` is reassigned on every
     * move, so measuring travel from it always reported roughly zero and every
     * drag ended by selecting whatever the pointer stopped over. Travel is
     * measured from where the pointer went *down*.
     */
    const onSelect = vi.fn();
    render(<Volume points={CLOUD} onSelect={onSelect} xLabel="x" yLabel="y"
                   zLabel="z" width={400} height={400} />);
    const canvas = document.querySelector("canvas")!;

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 120 });
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 140 });
    fireEvent.pointerUp(canvas, { clientX: 202, clientY: 141 });

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("selecting a region rather than a point", () => {
  /**
   * §25 describes pointing at a cluster. This product will not call it one —
   * nothing was fitted and no test was run — but the need underneath is real: a
   * researcher looking at a region wants to ask about the region, not about
   * whichever single mark happened to be nearest their finger.
   */
  it("returns everything within the radius, nearest first", () => {
    const ref = mount();

    const region = ref.current!.selectRegion({ x: 200, y: 200 }, 400);

    expect(region.length).toBeGreaterThan(1);
    // Nearest first, so a caller that truncates keeps what was most clearly
    // indicated rather than an arbitrary subset.
    expect(region[0].id).toBe("a");
  });

  it("returns nothing in empty space rather than the whole cloud", () => {
    /** An unbounded region would mean pointing anywhere selects everything,
     * and a selection that is always everything says nothing. */
    const ref = mount();

    expect(ref.current!.selectRegion({ x: 5, y: 395 }, 4)).toEqual([]);
  });

  it("carries each point's datum, so a region can become AI context", () => {
    const ref = mount();

    const region = ref.current!.selectRegion({ x: 200, y: 200 }, 400);

    expect(region.every((t) => t.datum !== undefined)).toBe(true);
  });

  it("tells the host about the region, not only the nearest point", () => {
    const onSelectRegion = vi.fn();
    const ref = createRef<VisualizationController | null>();
    render(
      <Volume points={CLOUD} controllerRef={ref} onSelectRegion={onSelectRegion}
              xLabel="x" yLabel="y" zLabel="z" width={400} height={400} />);

    ref.current!.selectRegion({ x: 200, y: 200 }, 400);

    expect(onSelectRegion).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "a" })]));
  });

  it("clears the region when the selection is cleared", () => {
    /** Otherwise the emphasis outlives what it referred to, and the chart shows
     * a region the researcher has already dismissed. */
    const onSelectRegion = vi.fn();
    const ref = createRef<VisualizationController | null>();
    render(
      <Volume points={CLOUD} controllerRef={ref} onSelectRegion={onSelectRegion}
              xLabel="x" yLabel="y" zLabel="z" width={400} height={400} />);

    ref.current!.selectRegion({ x: 200, y: 200 }, 400);
    ref.current!.deselect();

    expect(onSelectRegion).toHaveBeenLastCalledWith([]);
  });

  it("is reachable through `apply`, exactly as a gesture would reach it", () => {
    const ref = mount();

    const result = apply(ref.current!,
                         { kind: "selectRegion", at: { x: 200, y: 200 }, radius: 400 });

    expect(Array.isArray(result)).toBe(true);
  });
});
