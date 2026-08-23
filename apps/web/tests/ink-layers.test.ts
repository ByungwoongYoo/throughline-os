/**
 * Whose mark it is, and whether it is showing (§201, §202).
 *
 * Layers are usually an organisational convenience. One requirement here is not:
 * an annotation the assistant drew must never be mistakable for one a researcher
 * drew. A figure carrying a *suggested* trend line makes a different claim from
 * one carrying a trend line somebody committed to, and that difference has to
 * survive being screenshotted, printed in greyscale, and looked at a year later
 * by somebody who was not there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_DASH, INK_COLOURS, assistantLayer, dashFor, describeLayer, isShowing,
  researcherLayer,
} from "@/lib/ink/layers";
import { paint } from "@/components/spatial/InkLayer";
import { DEFAULT_STYLE, SpatialStroke } from "@/lib/ink/stroke";
import { InkRecorder } from "@/lib/ink/recorder";
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

function stroke(id: string, layerId: string): SpatialStroke {
  const points = Array.from({ length: 6 }, (_, i) =>
    ({ x: 10 + i * 20, y: 40, timestamp: i, confidence: 1 }));
  return {
    id, tool: "pen", space: "screen", layerId,
    style: { ...DEFAULT_STYLE },
    originalPoints: points, points, createdAt: 0, createdBy: "test",
  };
}

/** A 2D context that records what it was asked to do. */
function recordingContext() {
  const dashes: unknown[] = [];
  let strokes = 0;
  const context = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, property: string) {
      if (property === "canvas") return undefined;
      if (property === "setLineDash") return (d: unknown) => dashes.push(d);
      if (property === "stroke") return () => { strokes += 1; };
      return () => {};
    },
    set() { return true; },
  });
  return { context, dashes, count: () => strokes };
}

let recorded: ReturnType<typeof recordingContext>;

beforeEach(() => {
  recorded = recordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => recorded.context) as never;
});
afterEach(() => vi.restoreAllMocks());

function canvas() {
  const c = document.createElement("canvas");
  c.width = 720; c.height = 520;
  return c;
}

describe("an assistant's annotation cannot pass as a researcher's", () => {
  it("is drawn dashed", () => {
    paint(canvas(), [stroke("a", "assistant")], { width: 720, height: 520 },
          [assistantLayer({ ...DEFAULT_STYLE })]);
    expect(recorded.dashes).toContainEqual([...AI_DASH]);
  });

  it("stays dashed even when its style says otherwise", () => {
    /**
     * The mechanism, and the reason origin is read at render time rather than
     * expressed through style. A caller can set an AI stroke's colour, width and
     * dash to match a researcher's exactly — by copying a style, by a future
     * control offering "dash" as an option, or deliberately — and the mark is
     * still drawn dashed.
     */
    const disguised = assistantLayer({ ...DEFAULT_STYLE, dashed: false });
    paint(canvas(), [stroke("a", "assistant")], { width: 720, height: 520 },
          [disguised]);

    expect(recorded.dashes).toContainEqual([...AI_DASH]);
    expect(recorded.dashes).not.toContainEqual([]);
  });

  it("uses a distinction that survives greyscale and a small screenshot", () => {
    // Not a lighter colour or a thinner line: "it looked slightly fainter" is
    // not something anybody can rely on a year later.
    expect(dashFor(assistantLayer({ ...DEFAULT_STYLE }))).toEqual(AI_DASH);
    expect(AI_DASH.length).toBeGreaterThan(0);
  });

  it("leaves a researcher's own mark solid unless they asked for a dash", () => {
    paint(canvas(), [stroke("a", "researcher")], { width: 720, height: 520 },
          [researcherLayer({ ...DEFAULT_STYLE })]);
    expect(recorded.dashes).toContainEqual([]);
  });

  it("lets a researcher dash their own mark without it reading as the assistant's", () => {
    const dashed = dashFor(researcherLayer({ ...DEFAULT_STYLE, dashed: true }));
    expect(dashed).not.toBeNull();
    expect(dashed).not.toEqual(AI_DASH);
  });

  it("says so beside the toggle, not only in a tooltip", () => {
    // The distinction between a suggestion and a decision is exactly what gets
    // lost when a figure leaves the room it was made in.
    expect(describeLayer(assistantLayer({ ...DEFAULT_STYLE })))
      .toMatch(/cannot be mistaken for yours/i);
  });
});

describe("turning a layer off", () => {
  it("stops its marks being drawn", () => {
    const hidden = { ...researcherLayer({ ...DEFAULT_STYLE }), visible: false };
    paint(canvas(), [stroke("a", "researcher")], { width: 720, height: 520 },
          [hidden]);
    expect(recorded.count()).toBe(0);
  });

  it("leaves the others alone", () => {
    const layers = [
      { ...researcherLayer({ ...DEFAULT_STYLE }), visible: false },
      assistantLayer({ ...DEFAULT_STYLE }),
    ];
    paint(canvas(), [stroke("a", "researcher"), stroke("b", "assistant")],
          { width: 720, height: 520 }, layers);
    expect(recorded.count()).toBe(1);
  });

  it("keeps the marks, so turning it back on returns them", () => {
    // Hiding is not erasing. A layer switched off and on again must be the
    // figure it was, not a figure somebody has to redraw.
    const layer = researcherLayer({ ...DEFAULT_STYLE });
    const marks = [stroke("a", "researcher")];
    paint(canvas(), marks, { width: 720, height: 520 },
          [{ ...layer, visible: false }]);
    expect(recorded.count()).toBe(0);

    recorded = recordingContext();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => recorded.context) as never;
    paint(canvas(), marks, { width: 720, height: 520 }, [layer]);
    expect(recorded.count()).toBe(1);
  });

  it("draws a stroke whose layer is unknown rather than swallowing it", () => {
    /**
     * A mark on no known layer is still a mark somebody made. Hiding it because
     * its group is missing would lose work silently, which is worse than showing
     * it unattributed.
     */
    paint(canvas(), [stroke("a", "gone")], { width: 720, height: 520 }, []);
    expect(recorded.count()).toBe(1);
  });

  it("is a property of the layer, checked the same way everywhere", () => {
    expect(isShowing({ visible: true })).toBe(true);
    expect(isShowing({ visible: false })).toBe(false);
  });
});

describe("a stroke belongs to a layer from the moment it is made", () => {
  function drawOn(recorder: InkRecorder) {
    recorder.setViewport({ width: 720, height: 520 });
    recorder.arm();
    let clock = 1000;
    const steps = [
      { at: { x: 0.30, y: 0.5 }, pinch: 0.2 },
      ...Array.from({ length: 8 }, (_, i) => ({ at: { x: 0.30 + i * 0.01, y: 0.5 },
                                                pinch: 0.02 })),
      { at: { x: 0.38, y: 0.5 }, pinch: 0.2 },
    ];
    for (const step of steps) {
      recorder.step({ timestamp: clock,
                      hands: [hand(step.at, step.pinch)] } as HandFrame);
      clock += 33;
    }
  }

  it("lands on the active layer", () => {
    const recorder = new InkRecorder({ now: () => 5000 });
    drawOn(recorder);
    expect(recorder.strokes()[0].layerId).toBe(recorder.activeLayerId());
  });

  it("never has no layer at all", () => {
    /**
     * A mark on no layer cannot be hidden, cannot be attributed, and cannot be
     * told apart from one the assistant drew — so a recorder always has one.
     */
    const recorder = new InkRecorder({ now: () => 5000 });
    expect(recorder.allLayers().length).toBeGreaterThan(0);
    drawOn(recorder);
    expect(recorder.strokes()[0].layerId).toBeTruthy();
  });

  it("follows the layer the researcher switched to", () => {
    const recorder = new InkRecorder({ now: () => 5000 });
    recorder.putLayer(assistantLayer({ ...DEFAULT_STYLE }));
    recorder.setActiveLayer("assistant");
    drawOn(recorder);
    expect(recorder.strokes()[0].layerId).toBe("assistant");
  });

  it("ignores a layer that does not exist rather than orphaning the next mark", () => {
    const recorder = new InkRecorder({ now: () => 5000 });
    const before = recorder.activeLayerId();
    recorder.setActiveLayer("nonexistent");
    expect(recorder.activeLayerId()).toBe(before);
  });

  it("takes the style the researcher chose (§202)", () => {
    const recorder = new InkRecorder({ now: () => 5000 });
    recorder.setStyle({ colour: INK_COLOURS[1].value, width: 5 });
    drawOn(recorder);

    expect(recorder.strokes()[0].style.colour).toBe(INK_COLOURS[1].value);
    expect(recorder.strokes()[0].style.width).toBe(5);
  });

  it("offers few enough colours to choose from without a palette (§202)", () => {
    // "Keep the default interface minimal. Do not require floating palettes for
    // every change."
    expect(INK_COLOURS.length).toBeLessThanOrEqual(5);
  });
});
