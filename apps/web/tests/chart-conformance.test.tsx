/**
 * The two spatial charts, held to one contract.
 *
 * `Volume` and `Surface` are the only charts that implement
 * `VisualizationController`, and the whole premise of that seam is that a
 * gesture learned on one works on the other. Nothing enforced it: each chart had
 * its own tests, written at different times against its own fixture, so the two
 * could drift apart in behaviour while both stayed green. `scene3d`'s own
 * docstring warns about exactly this — two implementations of the same idea start
 * identical, one gets tuned, and they quietly stop agreeing.
 *
 * So every assertion below runs against both, from the same fixture shape, and a
 * new spatial chart is expected to join the table rather than bring its own
 * suite. The 2D charts are deliberately absent: they do not rotate and should
 * not (§10, "DO NOT FORCE 3D"), and a bar chart turned in space is harder to
 * read rather than more immersive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Volume } from "@/components/charts/Volume";
import { Surface } from "@/components/charts/Surface";
import {
  ScreenPoint, VisualizationController, sameView,
} from "@/lib/spatial/commands";

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const POINTS = Array.from({ length: 120 }, (_, i) => ({
  id: `p${i}`, label: `Point ${i}`,
  x: Math.sin(i * 1.7) * 2, y: Math.cos(i * 2.3) * 2, z: Math.sin(i * 0.9) * 2,
  value: i % 10,
}));

const AXIS = Array.from({ length: 13 }, (_, i) => i / 1.5);
const GRID = {
  x: AXIS, y: AXIS,
  z: AXIS.map((y) => AXIS.map((x) => (x - 4) ** 2 / 3 - (y - 4) ** 2 / 3)),
};
const OBSERVED = Array.from({ length: 12 }, (_, i) => {
  const x = 1 + (i % 6) * 1.2, y = 1.5 + Math.floor(i / 6) * 3;
  return { id: `o${i}`, label: `Run ${i}`, x, y,
           z: (x - 4) ** 2 / 3 - (y - 4) ** 2 / 3 };
});

/** Each spatial chart, and how to mount it. */
const CHARTS: Array<{
  name: string;
  mount: (ref: React.RefObject<VisualizationController | null>) => void;
}> = [
  {
    name: "Volume",
    mount: (ref) => render(
      <Volume controllerRef={ref} points={POINTS}
              xLabel="x" yLabel="y" zLabel="z" title="cloud" />),
  },
  {
    name: "Surface",
    mount: (ref) => render(
      <Surface controllerRef={ref} grid={GRID} observations={OBSERVED}
               xLabel="x" yLabel="y" zLabel="z" title="saddle" />),
  },
];

/** The centroid of every pixel that resolves to `id`, i.e. where the mark is. */
function locate(controller: VisualizationController, id: string) {
  let sx = 0, sy = 0, n = 0;
  for (let x = 0; x <= 720; x += 4) {
    for (let y = 0; y <= 520; y += 4) {
      if (controller.hover({ x, y })?.id !== id) continue;
      sx += x; sy += y; n += 1;
    }
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

/** Whatever mark this chart happens to put on screen first. */
function anyVisibleMark(controller: VisualizationController) {
  for (let x = 0; x <= 720; x += 6) {
    for (let y = 0; y <= 520; y += 6) {
      const hit = controller.hover({ x, y });
      if (hit) return hit;
    }
  }
  return null;
}

describe.each(CHARTS)("$name honours the spatial contract", ({ mount }) => {
  function controller() {
    const ref = createRef<VisualizationController | null>();
    mount(ref);
    return ref.current!;
  }

  it("exposes the whole seam", () => {
    const c = controller();
    // The complete interface, listed rather than sampled: a chart that
    // implements most of it still breaks whichever gesture reaches the rest.
    for (const method of ["rotate", "zoom", "pan", "hover", "select",
                          "selectRegion", "withinPolygon", "focus", "deselect",
                          "resetView", "viewport", "viewState", "restoreViewState"]) {
      expect(typeof (c as unknown as Record<string, unknown>)[method])
        .toBe("function");
    }
  });

  it("rotates by an amount somebody can see", () => {
    /**
     * The rotation-units defect, as a contract rather than a chart's own test.
     * Both sides of that seam passed their own tests while disagreeing by a
     * factor of the viewport width, and the scene moved five thousandths of a
     * degree. A drag has to move a mark by pixels, not by a rounding error.
     */
    const c = controller();
    const mark = anyVisibleMark(c);
    expect(mark).not.toBeNull();

    const before = locate(c, mark!.id)!;
    c.rotate(120, 0);
    const after = locate(c, mark!.id);

    // Either it moved visibly, or it rotated out of view — both are real motion.
    if (after) {
      expect(Math.hypot(after.x - before.x, after.y - before.y))
        .toBeGreaterThan(20);
    }
  });

  it("zooms, and cannot be zoomed into nothing or out of sight", () => {
    const c = controller();
    for (let i = 0; i < 60; i += 1) c.zoom(1.4);
    expect(anyVisibleMark(c)).not.toBeNull();
    for (let i = 0; i < 120; i += 1) c.zoom(0.6);
    expect(anyVisibleMark(c)).not.toBeNull();
  });

  it("comes back to exactly where it started", () => {
    // The recovery path. A reader who has rotated into something unreadable
    // must be able to get the view they were given back.
    const c = controller();
    const mark = anyVisibleMark(c)!;
    const before = locate(c, mark.id)!;

    c.rotate(500, -220);
    c.zoom(3);
    c.resetView();
    const after = locate(c, mark.id)!;

    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  it("offers that recovery as something visible, not only a key", () => {
    controller();
    expect(screen.getByRole("button", { name: /reset the view/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /reset the view/i }));
  });

  it("resolves a drawn region exactly, against its own projection", () => {
    const c = controller();
    const mark = anyVisibleMark(c)!;
    const at = locate(c, mark.id)!;
    const loop: ScreenPoint[] = Array.from({ length: 24 }, (_, i) => {
      const t = (i / 24) * Math.PI * 2;
      return { x: at.x + Math.cos(t) * 26, y: at.y + Math.sin(t) * 26 };
    });

    expect(c.withinPolygon(loop).map((t) => t.id)).toContain(mark.id);
  });

  it("finds nothing in a region containing nothing", () => {
    const c = controller();
    const empty: ScreenPoint[] = Array.from({ length: 12 }, (_, i) => {
      const t = (i / 12) * Math.PI * 2;
      return { x: -500 + Math.cos(t) * 6, y: -500 + Math.sin(t) * 6 };
    });
    expect(c.withinPolygon(empty)).toEqual([]);
  });

  it("keeps picking and painting in step after the scene has moved", () => {
    // If hit-testing used a second copy of the projection it would drift from
    // the drawing, and a reader would point at a mark and be told they pointed
    // at nothing — which reads as broken tracking rather than as a mismatch.
    const c = controller();
    c.rotate(80, 35);
    c.zoom(1.4);
    const mark = anyVisibleMark(c);
    expect(mark).not.toBeNull();
    const at = locate(c, mark!.id)!;
    expect(c.hover(at)?.id).toBe(mark!.id);
  });

  it("selects and clears", () => {
    const c = controller();
    const mark = anyVisibleMark(c)!;
    const at = locate(c, mark.id)!;
    expect(c.select(at)?.id).toBe(mark.id);
    c.deselect();
  });

  it("reports a viewport, which is what the gesture machine converts against", () => {
    // The units the rotation defect turned on: the machine converts normalised
    // hand movement into this chart's pixels using exactly this number.
    const c = controller();
    const v = c.viewport();
    expect(v.width).toBeGreaterThan(0);
    expect(v.height).toBeGreaterThan(0);
  });

  it("pans without throwing, and stays on screen", () => {
    const c = controller();
    c.pan(60, -40);
    expect(anyVisibleMark(c)).not.toBeNull();
  });

  it("reports a view that changes when the scene does", () => {
    /**
     * §143. Ink is drawn in screen pixels, and a screen loop over a rotatable
     * scene has no data-space equivalent — depth is ambiguous from one
     * projection, so there is no region of data the researcher can be said to
     * have circled independently of where they were standing. An annotation
     * therefore carries the view it was drawn in, and that is only possible if
     * a chart can report one.
     */
    const c = controller();
    const before = c.viewState();

    c.rotate(90, 30);
    expect(sameView(before, c.viewState())).toBe(false);
  });

  it("goes back to a view exactly, so an annotation can be revisited", () => {
    const c = controller();
    const mark = anyVisibleMark(c)!;
    const drawnAt = c.viewState();
    const where = locate(c, mark.id)!;

    c.rotate(300, -140);
    c.zoom(2.2);
    c.restoreViewState(drawnAt);

    expect(sameView(drawnAt, c.viewState())).toBe(true);
    const now = locate(c, mark.id)!;
    expect(now.x).toBeCloseTo(where.x, 3);
    expect(now.y).toBeCloseTo(where.y, 3);
  });

  it("ignores a view it does not recognise rather than half-applying it", () => {
    // A partial restore puts the scene somewhere the researcher has never been,
    // which is worse than leaving it where they left it.
    const c = controller();
    c.rotate(60, 20);
    const current = c.viewState();

    c.restoreViewState({ nonsense: 1 });

    expect(sameView(current, c.viewState())).toBe(true);
  });

  it("draws a data table beside the figure, for a reader who cannot see it", () => {
    controller();
    expect(screen.getByRole("table")).toBeTruthy();
  });
});

describe("sameView", () => {
  /**
   * The comparison the whole staleness signal rests on. It is deliberately
   * opaque about *what* a view is — a map has a centre and a zoom, a timeline
   * has a range — so all it can ask is whether two snapshots agree.
   */
  it("treats identical snapshots as the same view", () => {
    expect(sameView({ yaw: 0.6, pitch: -0.34, zoom: 1 },
                    { yaw: 0.6, pitch: -0.34, zoom: 1 })).toBe(true);
  });

  it("notices a change in any single component", () => {
    const base = { yaw: 0.6, pitch: -0.34, zoom: 1 };
    expect(sameView(base, { ...base, yaw: 0.9 })).toBe(false);
    expect(sameView(base, { ...base, pitch: 0.1 })).toBe(false);
    expect(sameView(base, { ...base, zoom: 1.4 })).toBe(false);
  });

  it("scales its tolerance to the magnitude", () => {
    // A zoom of 4 should not be judged by the same absolute slack as a pitch of
    // 0.02, or the signal is noisy at one end and blind at the other.
    expect(sameView({ zoom: 4 }, { zoom: 4 + 1e-9 })).toBe(true);
    expect(sameView({ pitch: 0.02 }, { pitch: 0.03 })).toBe(false);
  });

  it("treats a missing snapshot as not the same view", () => {
    // Never drawn, or never recorded, is not evidence that nothing moved.
    expect(sameView(null, { yaw: 1 })).toBe(false);
    expect(sameView({ yaw: 1 }, null)).toBe(false);
    expect(sameView(null, null)).toBe(false);
  });

  it("treats snapshots of different shapes as different", () => {
    expect(sameView({ yaw: 1 }, { yaw: 1, zoom: 2 })).toBe(false);
  });
});
