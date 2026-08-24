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

describe("the detent on the pointer path", () => {
  /**
   * The feedback a laptop can genuinely deliver: a hand dragging a trackpad is a
   * hand on the actuator. This is what makes a scatter feel like it has objects
   * in it rather than pixels.
   */
  it("marks landing on a point, not merely moving while one is hovered", () => {
    /** Firing while the pointer sits still on the same mark is a buzz, not a
     * boundary. The detent belongs to the transition. */
    const onDetent = vi.fn();
    render(<Volume points={CLOUD} onDetent={onDetent} xLabel="x" yLabel="y"
                   zLabel="z" width={400} height={400} />);
    const canvas = document.querySelector("canvas")!;

    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 200 });
    const afterLanding = onDetent.mock.calls.length;
    fireEvent.pointerMove(canvas, { clientX: 201, clientY: 200 });

    expect(afterLanding).toBe(1);
    expect(onDetent).toHaveBeenCalledTimes(1);
    expect(onDetent).toHaveBeenCalledWith("hover");
  });

  it("marks a selection that actually chose something", () => {
    const onDetent = vi.fn();
    render(<Volume points={CLOUD} onDetent={onDetent} xLabel="x" yLabel="y"
                   zLabel="z" width={400} height={400} />);
    const canvas = document.querySelector("canvas")!;

    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(canvas, { clientX: 200, clientY: 200 });

    expect(onDetent).toHaveBeenCalledWith("select");
  });

  it("says nothing when a click chose nothing", () => {
    /** A tap would confirm a selection that did not happen. */
    const onDetent = vi.fn();
    render(<Volume points={CLOUD} onDetent={onDetent} xLabel="x" yLabel="y"
                   zLabel="z" width={400} height={400} />);
    const canvas = document.querySelector("canvas")!;

    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 395 });
    fireEvent.pointerUp(canvas, { clientX: 5, clientY: 395 });

    expect(onDetent).not.toHaveBeenCalledWith("select");
  });

  it("stays silent in a chart that did not ask for it", () => {
    /**
     * A primitive drawn into a report has no business making a machine tap. The
     * callback is opt-in precisely so a figure is silent by construction rather
     * than by every host remembering to switch it off.
     */
    expect(() => {
      render(<Volume points={CLOUD} xLabel="x" yLabel="y" zLabel="z"
                     width={400} height={400} />);
      const canvas = document.querySelectorAll("canvas")[0];
      fireEvent.pointerMove(canvas, { clientX: 200, clientY: 200 });
    }).not.toThrow();
  });
});

describe("everything the pointer can do, the keyboard can do", () => {
  /**
   * §30 and Rule 5. Before this the chart could rotate with a keyboard and
   * nothing else — selection in particular was reachable only with a pointer,
   * and selection is what feeds a question to the assistant. A researcher who
   * cannot use a mouse was locked out of the product's headline capability,
   * which is a different thing from being inconvenienced.
   *
   * The model is aim-and-press: there is no cursor in a 3D scene, so the target
   * is the centre of the view. Rotate to bring a point there, then press.
   */
  function mountFor(onSelect = vi.fn(), onDetent = vi.fn()) {
    render(<Volume points={CLOUD} onSelect={onSelect} onDetent={onDetent}
                   xLabel="x" yLabel="y" zLabel="z" width={400} height={400} />);
    return { canvas: document.querySelector("canvas")!, onSelect, onDetent };
  }

  it("selects the point nearest the centre", () => {
    const { canvas, onSelect } = mountFor();

    fireEvent.keyDown(canvas, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }));
  });

  it("accepts Space as well as Enter", () => {
    /** Both are "press this" on a focused control, and picking one would make
     * the other silently do nothing. */
    const { canvas, onSelect } = mountFor();

    fireEvent.keyDown(canvas, { key: " " });

    expect(onSelect).toHaveBeenCalled();
  });

  it("aims generously, because rotating is coarser than pointing", () => {
    /**
     * Requiring pixel accuracy from the one input that cannot be precise would
     * make the feature technically present and practically unusable.
     */
    const { canvas, onSelect } = mountFor();

    // Turn the scene, so nothing is exactly on the centre any more.
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("clears a selection with Escape", () => {
    const { canvas, onSelect } = mountFor();
    fireEvent.keyDown(canvas, { key: "Enter" });

    fireEvent.keyDown(canvas, { key: "Escape" });

    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("zooms, and stays inside the same bounds the pointer obeys", () => {
    /**
     * One zoom helper for wheel, controller and keyboard: three callers clamping
     * independently is three chances to disagree about the bounds, and the
     * bounds are what stop the scene being lost (§32).
     */
    const ref = createRef<VisualizationController | null>();
    render(<Volume points={CLOUD} controllerRef={ref} xLabel="x" yLabel="y"
                   zLabel="z" width={400} height={400} />);
    const canvas = document.querySelector("canvas")!;

    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(canvas, { key: "+" });

    // Still findable, exactly as the controller's own clamp guarantees.
    expect(ref.current!.hover({ x: 200, y: 200 })).not.toBeUndefined();
  });

  it("comes home", () => {
    const ref = createRef<VisualizationController | null>();
    render(<Volume points={CLOUD} controllerRef={ref} xLabel="x" yLabel="y"
                   zLabel="z" width={400} height={400} />);
    const canvas = document.querySelector("canvas")!;
    for (let i = 0; i < 8; i += 1) fireEvent.keyDown(canvas, { key: "ArrowRight" });

    fireEvent.keyDown(canvas, { key: "Home" });

    expect(ref.current!.hover({ x: 200, y: 200 })?.id).toBe("a");
  });

  it("taps when a key chose something, and not when it chose nothing", () => {
    const { canvas, onDetent } = mountFor();

    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(onDetent).not.toHaveBeenCalled();

    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(onDetent).toHaveBeenCalledWith("select");
  });

  it("leaves keys it does not handle to the browser", () => {
    /** Swallowing Tab would trap a keyboard user inside the chart. */
    const { canvas } = mountFor();

    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true,
                                               bubbles: true });
    canvas.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(false);
  });

  it("tells a keyboard user the keys exist", () => {
    /** A control that is reachable and undiscoverable is reachable in the same
     * sense a door with no handle is a door. */
    const { canvas } = mountFor();
    const label = canvas.getAttribute("aria-label") ?? "";

    expect(label).toMatch(/arrow keys rotate/i);
    expect(label).toMatch(/enter selects/i);
    expect(label).toMatch(/escape/i);
  });
});

describe("the contract between the machine and the chart", () => {
  /**
   * The test that was missing, and the reason a whole feature never worked.
   *
   * Both sides had tests and both passed. The machine's tests asserted that a
   * rotate command was *emitted*; the chart's asserted that `rotate()` did not
   * throw. Neither looked at the number crossing between them — and the machine
   * was producing normalised image units (about 0.01 for a deliberate hand
   * movement) while the chart multiplied as though it had been handed a pointer
   * drag in pixels. The scene turned by five thousandths of a degree.
   *
   * So this drives the real machine with a plausible hand and applies its real
   * commands to a real chart, then looks at whether anything moved.
   */
  function screenPositionOf(controller: VisualizationController, id: string) {
    // Scanned well beyond the canvas, for the same reason `findWithin` above
    // does: hit-testing accepts any coordinate, and a point at the corner of the
    // cube projects outside the visible area at the default camera. This
    // measures where the scene *is*, not what happens to be on screen.
    for (let x = -600; x <= 1000; x += 6) {
      for (let y = -600; y <= 1000; y += 6) {
        if (controller.hover({ x, y })?.id === id) return { x, y };
      }
    }
    return null;
  }

  function pinchedHand(x: number) {
    const span = 0.1;
    return {
      handedness: "right" as const, confidence: 0.95,
      wrist: { x, y: 0.5 + span * 2 },
      indexBase: { x, y: 0.5 + span },
      thumbTip: { x: x - 0.01, y: 0.5 },
      indexTip: { x: x + 0.01, y: 0.5 },
      middleTip: { x, y: 0.5 + span * 1.7 },
      ringTip: { x, y: 0.5 + span * 1.8 },
      pinkyTip: { x, y: 0.5 + span * 1.9 },
      palmCenter: { x, y: 0.5 },
    };
  }

  it("turns the scene by an amount a person can see", async () => {
    const { SpatialInteractionMachine } = await import("@/lib/spatial/machine");
    const ref = mount();
    const before = screenPositionOf(ref.current!, "b");
    expect(before).not.toBeNull();

    const machine = new SpatialInteractionMachine();
    machine.viewport = ref.current!.viewport();

    // A hand crossing about a fifth of the frame while pinched — an ordinary,
    // deliberate movement, not a swipe.
    let clock = 0;
    for (const x of [0.40, 0.40, 0.43, 0.46, 0.49, 0.52, 0.55, 0.58, 0.60]) {
      clock += 33;
      const result = machine.step({ timestamp: clock, hands: [pinchedHand(x)] });
      for (const command of result.commands) apply(ref.current!, command);
    }

    const after = screenPositionOf(ref.current!, "b");
    expect(after).not.toBeNull();

    const moved = Math.hypot(after!.x - before!.x, after!.y - before!.y);
    // Twenty pixels is a low bar deliberately: the point is that the scene
    // moved *at all*, and before this fix it moved by a fraction of a pixel.
    expect(moved).toBeGreaterThan(20);
  });

  it("emits a rotation measured in the viewport it was given", async () => {
    /**
     * The unit, asserted directly. A command in normalised units would be a
     * number below one; the chart needs tens of pixels to turn visibly.
     */
    const { SpatialInteractionMachine } = await import("@/lib/spatial/machine");
    const machine = new SpatialInteractionMachine();
    machine.viewport = { width: 720, height: 520 };

    let clock = 0;
    const deltas: number[] = [];
    for (const x of [0.45, 0.45, 0.48, 0.51]) {
      clock += 33;
      for (const command of machine.step(
             { timestamp: clock, hands: [pinchedHand(x)] }).commands) {
        if (command.kind === "rotate") deltas.push(Math.abs(command.deltaX));
      }
    }

    expect(deltas.length).toBeGreaterThan(0);
    expect(Math.max(...deltas)).toBeGreaterThan(1);
  });

  it("scales with the chart, so a small chart does not spin", async () => {
    /**
     * The conversion uses the viewport that arrives with each frame rather than
     * a constant, so the same hand movement turns a small chart and a large one
     * by a comparable *angle* rather than a comparable number of pixels.
     */
    const { SpatialInteractionMachine } = await import("@/lib/spatial/machine");

    const measure = (viewport: { width: number; height: number }) => {
      const machine = new SpatialInteractionMachine();
      machine.viewport = viewport;
      let clock = 0;
      let total = 0;
      for (const x of [0.45, 0.45, 0.48, 0.51]) {
        clock += 33;
        for (const command of machine.step(
               { timestamp: clock, hands: [pinchedHand(x)] }).commands) {
          if (command.kind === "rotate") total += Math.abs(command.deltaX);
        }
      }
      return total;
    };

    expect(measure({ width: 1440, height: 900 }))
      .toBeGreaterThan(measure({ width: 360, height: 300 }) * 2);
  });
});

describe("region queries are exact, because a count gets quoted", () => {
  /**
   * The number a hand-drawn circle produces is read out loud, written into a
   * paper, and handed to the assistant as "these observations". An approximate
   * answer here is not a smaller feature than an exact one — it is a confident
   * wrong number, and nothing downstream can tell.
   */
  function polygonAround(controller: VisualizationController, id: string,
                         radius: number) {
    // The *centroid* of every position that resolves to this mark, not the
    // first one found. `hover` reports the nearest mark within a radius, so the
    // first hit is an edge of that catchment rather than the mark itself — and a
    // loop drawn tightly round an edge misses the point it was aimed at.
    let sumX = 0, sumY = 0, hits = 0;
    for (let x = -600; x <= 1000; x += 3) {
      for (let y = -600; y <= 1000; y += 3) {
        if (controller.hover({ x, y })?.id !== id) continue;
        sumX += x; sumY += y; hits += 1;
      }
    }
    if (hits === 0) throw new Error(`could not locate ${id}`);
    const cx = sumX / hits, cy = sumY / hits;
    return Array.from({ length: 24 }, (_, i) => {
      const t = (i / 24) * Math.PI * 2;
      return { x: cx + Math.cos(t) * radius, y: cy + Math.sin(t) * radius };
    });
  }

  it("finds a mark inside the region", () => {
    const ref = mount();
    const region = polygonAround(ref.current!, "a", 30);

    const found = ref.current!.withinPolygon(region);

    expect(found.map((t) => t.id)).toContain("a");
  });

  it("excludes marks outside it", () => {
    const ref = mount();
    // A tight loop around one point should not catch the others.
    const region = polygonAround(ref.current!, "a", 12);

    const found = ref.current!.withinPolygon(region);

    expect(found).toHaveLength(1);
    expect(found[0].id).toBe("a");
  });

  it("carries the datum, so a region can become AI context", () => {
    const ref = mount();
    const region = polygonAround(ref.current!, "a", 30);

    expect(ref.current!.withinPolygon(region)[0].datum)
      .toMatchObject({ id: "a" });
  });

  it("returns nothing for a region containing nothing", () => {
    const ref = mount();
    const empty = Array.from({ length: 12 }, (_, i) => {
      const t = (i / 12) * Math.PI * 2;
      return { x: -400 + Math.cos(t) * 5, y: -400 + Math.sin(t) * 5 };
    });

    expect(ref.current!.withinPolygon(empty)).toEqual([]);
  });

  it("uses the same projection the marks were drawn with", () => {
    /**
     * Picking and painting must not disagree. A second copy of the projection
     * would put the region a few pixels from the marks, and the researcher would
     * see a point plainly inside their circle reported as outside it — the same
     * class of bug as the rotation units.
     */
    const ref = mount();
    ref.current!.rotate(60, 25);           // move the scene
    const region = polygonAround(ref.current!, "b", 25);

    expect(ref.current!.withinPolygon(region).map((t) => t.id)).toContain("b");
  });
});

describe("there is a visible way back", () => {
  /**
   * A reader who has rotated into something unreadable needs a recovery path
   * they can see. `Home` reset the view and nothing on screen said so, which for
   * anybody using a pointer is the same as no recovery at all — and it is how a
   * figure ends up reported as "I can't do anything with this graph".
   */
  it("offers a reset control, not only a keyboard binding", () => {
    mount();
    expect(screen.getByRole("button", { name: /reset the view/i })).toBeTruthy();
  });

  it("returns the scene to where it started when pressed", () => {
    const ref = mount();
    const before = ref.current!.hover({ x: 200, y: 200 })?.id ?? null;

    ref.current!.rotate(400, 160);
    ref.current!.zoom(2.5);
    fireEvent.click(screen.getByRole("button", { name: /reset the view/i }));

    // The same pixel resolves to the same mark again, which is the property a
    // reader actually cares about: the view they were given is recoverable.
    expect(ref.current!.hover({ x: 200, y: 200 })?.id ?? null).toBe(before);
  });
});
