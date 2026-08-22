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
import { TargetRef } from "@/lib/spatial/commands";

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
