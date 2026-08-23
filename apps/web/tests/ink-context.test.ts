/**
 * A drawn circle becoming a question the assistant can answer (§198).
 *
 * The step that separates a research instrument from a whiteboard. Everything
 * here is about honesty rather than plumbing: what gets sent has to be exactly
 * what the researcher enclosed, nothing may be invented to fill a gap, and a
 * region that cannot be described has to say so while the hand is still there.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_SELECTION_POINTS, describeContext, selectionContext,
} from "@/lib/ink/context";
import { RegionSelection } from "@/lib/ink/select";
import { ScreenPoint, TargetRef } from "@/lib/spatial/commands";

const CHART = {
  visualization: "a saddle, fitted over two predictors",
  xLabel: "dose", yLabel: "duration", zLabel: "response",
};

function ok(targets: TargetRef[]): RegionSelection {
  return { ok: true, targets, closed: true };
}

function mark(id: string, datum: Record<string, unknown>): TargetRef {
  return { id, label: `Run ${id}`, datum };
}

describe("what gets sent is what was enclosed", () => {
  it("carries the datum's coordinates, not the pixels they were drawn at", () => {
    /**
     * A screen position stops being true the moment the chart is rotated. An
     * answer that outlived its own viewport would be nonsense, so what travels
     * is the observation.
     */
    const result = selectionContext(
      ok([mark("a", { x: 2.5, y: 7, z: -1.25, value: 3 })]), CHART);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.points[0]).toMatchObject(
      { id: "a", label: "Run a", x: 2.5, y: 7, z: -1.25, value: 3 });
  });

  it("names the axes, so a number has units in the answer", () => {
    const result = selectionContext(ok([mark("a", { x: 1, y: 2, z: 3 })]), CHART);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.axes).toEqual(
      { x: "dose", y: "duration", z: "response" });
    expect(result.payload.visualization).toBe(CHART.visualization);
  });

  it("summarises nothing on the way", () => {
    /**
     * The count, the mean and the range are computed on the other side, in
     * `throughline_domain.selection`, precisely so they are calculated rather
     * than asserted by the interface. A mean sent from here would be
     * indistinguishable — to the model and to whoever reads the answer later —
     * from one somebody worked out.
     */
    const result = selectionContext(
      ok([mark("a", { x: 1, y: 2, z: 3 }), mark("b", { x: 5, y: 6, z: 7 })]),
      CHART);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.payload).sort())
      .toEqual(["axes", "points", "visualization"]);
  });

  it("gives a flat chart a z of zero rather than a missing value", () => {
    // A two-dimensional figure genuinely has no third coordinate. That is a
    // fact about the figure, not an absent measurement.
    const result = selectionContext(ok([mark("a", { x: 4, y: 9 })]), CHART);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.points[0].z).toBe(0);
  });
});

describe("nothing is invented to fill a gap", () => {
  it("drops a mark whose datum has no usable position", () => {
    // Defaulting to zero would put an observation somewhere the researcher
    // never saw it, inside a payload that claims to be what they indicated.
    const result = selectionContext(
      ok([mark("good", { x: 1, y: 2, z: 3 }), mark("bare", { label: "?" })]),
      CHART);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.points.map((p) => p.id)).toEqual(["good"]);
  });

  it("refuses a non-finite coordinate rather than passing NaN along", () => {
    const result = selectionContext(
      ok([mark("bad", { x: Number.NaN, y: 2, z: 3 })]), CHART);
    expect(result.ok).toBe(false);
  });

  it("says so when nothing in the region can be described", () => {
    const result = selectionContext(ok([mark("bare", {})]), CHART);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/nothing to ask about/i);
  });

  it("passes a refusal from the region straight through", () => {
    // A loop that caught nothing, or a line that was not a region, already has
    // a message written for a person. Replacing it would lose the reason.
    const refusal: RegionSelection = {
      ok: false, reason: "not-a-region",
      message: "That stroke is not a closed region.",
    };
    const result = selectionContext(refusal, CHART);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("That stroke is not a closed region.");
  });
});

describe("a region too big to discuss is refused where it happened", () => {
  it("refuses more points than the backend would accept", () => {
    /**
     * Checked here as well as on the far side so the researcher is told by the
     * interface that watched them draw it, in the same breath as the gesture,
     * rather than by a failed request minutes later with no circle attached.
     */
    const many = Array.from({ length: MAX_SELECTION_POINTS + 1 }, (_, i) =>
      mark(`p${i}`, { x: i, y: i, z: 0 }));
    const result = selectionContext(ok(many), CHART);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(String(MAX_SELECTION_POINTS));
  });

  it("accepts exactly the limit", () => {
    const many = Array.from({ length: MAX_SELECTION_POINTS }, (_, i) =>
      mark(`p${i}`, { x: i, y: i, z: 0 }));
    expect(selectionContext(ok(many), CHART).ok).toBe(true);
  });
});

describe("the researcher is asked before anything is sent", () => {
  it("says how many observations are ready", () => {
    // §197: an interpretation that changes what is being analysed is a
    // question, not a side effect.
    const result = selectionContext(
      ok([mark("a", { x: 1, y: 2, z: 3 }), mark("b", { x: 4, y: 5, z: 6 })]),
      CHART);
    expect(describeContext(result)).toBe("2 observations are ready to ask about.");
  });

  it("counts one observation without the plural", () => {
    const result = selectionContext(ok([mark("a", { x: 1, y: 2, z: 3 })]), CHART);
    expect(describeContext(result)).toBe("1 observation is ready to ask about.");
  });

  it("shows the refusal when there is one", () => {
    expect(describeContext(selectionContext(ok([mark("bare", {})]), CHART)))
      .toMatch(/nothing to ask about/i);
  });
});

describe("a stroke resolves against the figure it was drawn on", () => {
  /**
   * With the pen spanning the page rather than sitting inside one chart, a loop
   * has to be moved into the frame of whichever figure the hand was addressing
   * before that figure is asked what is inside it. Getting this wrong is silent
   * in the worst way: the count comes back, it is plausible, and it describes
   * observations from the other chart.
   *
   * The conversion is a subtraction only because strokes and `bounds()` are
   * expressed in the same frame — which is why the layer measures the viewport.
   */
  type Rect = { x: number; y: number; width: number; height: number };

  /** A chart at a position, whose marks sit at known chart-local points. */
  function figureAt(box: Rect, marks: Array<{ id: string; at: ScreenPoint }>) {
    const seen: ScreenPoint[][] = [];
    return {
      seen,
      bounds: () => box,
      withinPolygon: (polygon: ScreenPoint[]) => {
        seen.push(polygon);
        // Inside the polygon's bounding box, in *this chart's* coordinates.
        const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
        const lo = { x: Math.min(...xs), y: Math.min(...ys) };
        const hi = { x: Math.max(...xs), y: Math.max(...ys) };
        return marks
          .filter((m) => m.at.x >= lo.x && m.at.x <= hi.x
                      && m.at.y >= lo.y && m.at.y <= hi.y)
          .map((m) => ({ id: m.id, datum: { id: m.id, x: 1, y: 2, z: 3 } }));
      },
    };
  }

  /** What the page does: move the polygon into the chart's frame. */
  function inFrameOf(chart: ReturnType<typeof figureAt>) {
    const box = chart.bounds();
    return {
      withinPolygon: (polygon: ScreenPoint[]) => chart.withinPolygon(
        polygon.map((p) => ({ x: p.x - box.x, y: p.y - box.y }))),
    };
  }

  /** A loop in viewport coordinates, over the lower figure. */
  const LOOP: ScreenPoint[] = Array.from({ length: 16 }, (_, i) => {
    const t = (i / 16) * Math.PI * 2;
    return { x: 400 + Math.cos(t) * 60, y: 900 + Math.sin(t) * 60 };
  });

  it("moves the loop into the chart's own coordinates", () => {
    const lower = figureAt({ x: 100, y: 800, width: 700, height: 500 },
                           [{ id: "in-lower", at: { x: 300, y: 100 } }]);

    const found = inFrameOf(lower).withinPolygon(LOOP);

    // The mark sits at chart-local (300, 100), which is viewport (400, 900) —
    // the centre of the loop.
    expect(found.map((t) => t.id)).toEqual(["in-lower"]);
    expect(lower.seen[0][0].y).toBeLessThan(500);   // converted, not raw
  });

  it("does not answer with the other figure's observations", () => {
    /**
     * The failure worth guarding. Resolving the same viewport loop against the
     * upper figure — the one the hand was not on — hands back a count that is
     * plausible and wrong, and nothing downstream can tell.
     */
    const upper = figureAt({ x: 100, y: 0, width: 700, height: 500 },
                           [{ id: "in-upper", at: { x: 300, y: 100 } }]);

    expect(inFrameOf(upper).withinPolygon(LOOP)).toEqual([]);
  });

  it("would have been wrong without the conversion", () => {
    // Handing the raw viewport polygon to the chart finds nothing at all, since
    // the chart's own coordinates never reach y = 900 on a 500-tall figure.
    const lower = figureAt({ x: 100, y: 800, width: 700, height: 500 },
                           [{ id: "in-lower", at: { x: 300, y: 100 } }]);

    expect(lower.withinPolygon(LOOP)).toEqual([]);
    expect(inFrameOf(lower).withinPolygon(LOOP)).toHaveLength(1);
  });
});
