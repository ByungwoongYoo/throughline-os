/**
 * The lasso (§180): a boundary that asks a question and does not become a mark.
 *
 * The distinction from the pen is the whole feature. Drawing a loop with the pen
 * leaves an annotation *and* reports what was inside it; a lasso is drawn to ask
 * "which of these", and leaving it behind afterwards would turn every selection
 * into a scribble somebody has to tidy up.
 */

import { describe, expect, it } from "vitest";
import { InkRecorder } from "@/lib/ink/recorder";
import { selectWithinStroke } from "@/lib/ink/select";
import { ScreenPoint, TargetRef, VisualizationController } from "@/lib/spatial/commands";
import { containsPoint } from "@/lib/ink/stroke";
import { Hand, HandFrame } from "@/lib/spatial/types";

function hand(at: { x: number; y: number }, pinch: number): Hand {
  const span = 0.1;
  return {
    handedness: "right", confidence: 0.95,
    wrist: { x: at.x, y: at.y + span * 2 },
    indexBase: { x: at.x, y: at.y + span },
    thumbTip: { x: at.x - pinch / 2, y: at.y },
    indexTip: { x: at.x + pinch / 2, y: at.y },
    middleTip: { x: at.x, y: at.y + span * 1.7 },
    ringTip: { x: at.x, y: at.y + span * 1.8 },
    pinkyTip: { x: at.x, y: at.y + span * 1.9 },
    palmCenter: { x: at.x, y: at.y },
  };
}

/** Draw a closed loop, returning every frame's result. */
function loop(recorder: InkRecorder, startAt = 1000) {
  const centre = { x: 0.5, y: 0.5 }, radius = 0.12;
  const steps = [
    { at: { x: centre.x + radius, y: centre.y }, pinch: 0.2 },
    ...Array.from({ length: 26 }, (_, i) => {
      const t = (i / 25) * Math.PI * 2;
      return { at: { x: centre.x + Math.cos(t) * radius,
                     y: centre.y + Math.sin(t) * radius }, pinch: 0.02 };
    }),
    { at: { x: centre.x + radius, y: centre.y }, pinch: 0.2 },
  ];
  return steps.map((step, i) => recorder.step({
    timestamp: startAt + i * 33, hands: [hand(step.at, step.pinch)],
  } as HandFrame));
}

function armed(tool: "pen" | "lasso") {
  const recorder = new InkRecorder({ now: () => 5000 });
  recorder.setViewport({ width: 720, height: 520 });
  recorder.arm();
  recorder.setTool(tool);
  return recorder;
}

describe("a lasso asks a question and leaves nothing behind", () => {
  it("does not become a mark", () => {
    const recorder = armed("lasso");
    loop(recorder);
    expect(recorder.strokes()).toEqual([]);
  });

  it("hands the boundary over once, on the frame it closes", () => {
    const recorder = armed("lasso");
    const results = loop(recorder);
    const withLasso = results.filter((r) => r.lasso !== null);

    expect(withLasso).toHaveLength(1);
    expect(withLasso[0].lasso!.originalPoints.length).toBeGreaterThan(8);
  });

  it("is visible while it is being drawn (§180)", () => {
    // A boundary you cannot see is one you cannot close accurately, which is
    // why it is drawn at all rather than merely accumulated.
    const recorder = armed("lasso");
    const results = loop(recorder);
    const midway = results[Math.floor(results.length / 2)];

    expect(midway.open).not.toBeNull();
    expect(midway.open!.points.length).toBeGreaterThan(1);
  });

  it("leaves nothing in the undo history to bring it back", () => {
    /**
     * A lasso is not something anybody would want to undo *back onto* the
     * figure. If it were in the history, the first press of undo after a
     * selection would restore a boundary the researcher had already finished
     * with.
     */
    const recorder = armed("lasso");
    loop(recorder);
    expect(recorder.canUndo()).toBe(false);
  });

  it("reports nothing committed, so a host does not treat it as an annotation", () => {
    const recorder = armed("lasso");
    expect(loop(recorder).some((r) => r.committed)).toBe(false);
  });
});

describe("the same loop with the pen behaves differently", () => {
  it("keeps the mark", () => {
    // The contrast that makes the lasso a distinct tool rather than a label.
    const recorder = armed("pen");
    loop(recorder);

    expect(recorder.strokes()).toHaveLength(1);
    expect(recorder.canUndo()).toBe(true);
  });

  it("reports no lasso", () => {
    const recorder = armed("pen");
    expect(loop(recorder).every((r) => r.lasso === null)).toBe(true);
  });
});

describe("what the boundary selects", () => {
  function chartWith(marks: Array<{ id: string; at: ScreenPoint }>)
      : Pick<VisualizationController, "withinPolygon"> {
    return {
      withinPolygon: (polygon: ScreenPoint[]): TargetRef[] =>
        marks.filter((m) => containsPoint(polygon, m.at))
             .map((m) => ({ id: m.id, datum: { id: m.id } })),
    };
  }

  it("resolves exactly like a drawn region, because it is one", () => {
    const recorder = armed("lasso");
    const boundary = loop(recorder).find((r) => r.lasso)!.lasso!;
    const chart = chartWith([
      { id: "inside", at: { x: 360, y: 260 } },
      { id: "outside", at: { x: 40, y: 40 } },
    ]);

    const result = selectWithinStroke(boundary, chart);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targets.map((t) => t.id)).toEqual(["inside"]);
  });

  it("refuses a boundary that was never closed", () => {
    // A line dragged across the figure is not a region, and saying so is better
    // than selecting whatever the line happened to pass near.
    const recorder = armed("lasso");
    const steps = Array.from({ length: 12 }, (_, i) => ({
      at: { x: 0.3 + i * 0.02, y: 0.5 }, pinch: i === 0 || i === 11 ? 0.2 : 0.02,
    }));
    const results = steps.map((step, i) => recorder.step({
      timestamp: 1000 + i * 33, hands: [hand(step.at, step.pinch)],
    } as HandFrame));

    const boundary = results.find((r) => r.lasso)?.lasso;
    if (!boundary) return;               // nothing closed: also acceptable
    const result = selectWithinStroke(boundary,
                                      chartWith([{ id: "a", at: { x: 360, y: 260 } }]));
    expect(result.ok).toBe(false);
  });
});
