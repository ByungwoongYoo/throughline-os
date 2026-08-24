/**
 * The draw loop, which is where the promise of the subsystem is kept or lost.
 *
 * happy-dom draws no pixels, so nothing here asserts on appearance. It asserts
 * the two things that survive having no renderer, and they are the two the whole
 * two-layer design exists for: that the work per frame does not grow with how
 * much has already been drawn, and that painting does not drag React along with
 * it. A single-canvas implementation passes every correctness test ever written
 * for ink and fails both of these — and fails them slowly, which is why it would
 * reach a researcher.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler, createRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { InkLayer, InkSurface, paint } from "@/components/spatial/InkLayer";
import { SpatialStroke } from "@/lib/ink/stroke";
import { Hand, HandFrame } from "@/lib/spatial/types";

const PINCHED = 0.02;
const OPEN = 0.2;

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

/** A 2D context that records what it was asked to do and draws nothing. */
function recordingContext() {
  const calls: Record<string, number> = {};
  const count = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
  const context = new Proxy({} as CanvasRenderingContext2D, {
    get(_target, property: string) {
      if (property === "canvas") return undefined;
      return () => count(property);
    },
    set() { return true; },
  });
  return { context, calls };
}

let context: CanvasRenderingContext2D;
let calls: Record<string, number>;
let frames: Array<() => void>;

beforeEach(() => {
  ({ context, calls } = recordingContext());
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as never;
  // A manual animation clock. `requestAnimationFrame` in happy-dom fires on a
  // timer this test has no reason to wait on, and the question is what happens
  // per frame rather than how fast frames arrive.
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
    frames.push(fn);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // happy-dom lays nothing out, so every element measures zero and the layer
  // would never size itself. The viewport is the whole point of the coordinate
  // contract, so it is given one.
  Object.defineProperty(HTMLElement.prototype, "clientWidth",
                        { configurable: true, value: 1000 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight",
                        { configurable: true, value: 800 });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Run one animation frame. */
function animate() {
  const pending = frames;
  frames = [];
  act(() => { pending.forEach((fn) => fn()); });
}

function mount(armed = true) {
  const ref = createRef<InkSurface>();
  let commits = 0;
  render(
    <Profiler id="ink" onRender={() => { commits += 1; }}>
      <InkLayer ref={ref} armed={armed} />
    </Profiler>,
  );
  animate();
  return { ref, commits: () => commits };
}

/** Draw one closed-ish mark, returning the number of frames fed. */
function drawStroke(surface: InkSurface, y: number, startAt: number) {
  const steps: Array<{ at: { x: number; y: number }; pinch?: number }> = [
    { at: { x: 0.30, y }, pinch: OPEN },
    ...Array.from({ length: 10 }, (_, i) => ({ at: { x: 0.30 + i * 0.01, y } })),
    { at: { x: 0.40, y }, pinch: OPEN },
  ];
  act(() => {
    steps.forEach((step, i) => surface.step({
      timestamp: startAt + i * 33,
      hands: [hand(step.at, step.pinch ?? PINCHED)],
    } as HandFrame));
  });
  return steps.length;
}

describe("the cost per frame does not grow with the session", () => {
  it("repaints the live layer without touching the finished strokes", () => {
    /**
     * The defect this design exists to prevent. Repainting every stroke each
     * frame is correct and gets slower the longer somebody draws, so the line
     * lags more at minute ten than at minute one — the kind of degradation
     * people blame on their machine rather than report.
     */
    const { ref } = mount();
    const surface = ref.current!;

    // Twenty finished strokes on the committed layer.
    for (let i = 0; i < 20; i += 1) drawStroke(surface, 0.2 + i * 0.02, 1000 + i * 1000);
    animate();

    // Now draw one more, and count the drawing done per frame while it is open.
    act(() => {
      surface.step({ timestamp: 90000, hands: [hand({ x: 0.5, y: 0.9 }, OPEN)] } as HandFrame);
      surface.step({ timestamp: 90033, hands: [hand({ x: 0.5, y: 0.9 }, PINCHED)] } as HandFrame);
      surface.step({ timestamp: 90066, hands: [hand({ x: 0.51, y: 0.9 }, PINCHED)] } as HandFrame);
    });
    animate();

    const before = calls.stroke ?? 0;
    act(() => {
      surface.step({ timestamp: 90099, hands: [hand({ x: 0.52, y: 0.9 }, PINCHED)] } as HandFrame);
    });
    animate();

    // One stroke painted, not twenty-one.
    expect((calls.stroke ?? 0) - before).toBe(1);
  });

  it("does not repaint at all when nothing has changed", () => {
    const { ref } = mount();
    drawStroke(ref.current!, 0.5, 1000);
    animate();

    const before = calls.clearRect ?? 0;
    animate();
    animate();
    animate();

    expect(calls.clearRect ?? 0).toBe(before);
  });

  it("repaints the finished strokes when one is added, and only then", () => {
    const { ref } = mount();
    const surface = ref.current!;

    drawStroke(surface, 0.4, 1000);
    animate();
    const afterFirst = calls.stroke ?? 0;
    expect(afterFirst).toBeGreaterThan(0);

    drawStroke(surface, 0.6, 5000);
    animate();

    // The committed layer now carries two strokes, so it paints two.
    expect((calls.stroke ?? 0) - afterFirst).toBeGreaterThanOrEqual(2);
  });
});

describe("painting does not go through React", () => {
  it("commits no renders while a stroke is being drawn", () => {
    /**
     * Not "did the canvas repaint" — it must, at frame rate — but "did React
     * re-render the tree along with it". At thirty frames a second that cost is
     * paid by the chart the ink is drawn over as well as by the ink.
     */
    const { ref, commits } = mount();
    const before = commits();

    drawStroke(ref.current!, 0.5, 1000);
    animate();
    animate();

    expect(commits()).toBe(before);
  });
});

describe("the layer stays out of the way", () => {
  it("never intercepts a click meant for what it is drawn over", () => {
    const { container } = render(<InkLayer armed={false} />);
    const host = container.querySelector("[data-testid='ink-layer']") as HTMLElement;
    expect(host.style.pointerEvents).toBe("none");
    for (const canvas of Array.from(container.querySelectorAll("canvas"))) {
      expect((canvas as HTMLElement).style.pointerEvents).toBe("none");
    }
  });

  it("draws nothing before the pen is armed", () => {
    const { ref } = mount(false);
    drawStroke(ref.current!, 0.5, 1000);
    animate();

    expect(ref.current!.strokes()).toEqual([]);
    expect(calls.stroke ?? 0).toBe(0);
  });
});

describe("the painter itself", () => {
  /**
   * Reached directly, because in happy-dom the only other way in is an animation
   * frame — and a draw loop that tests can only reach by accident is one that
   * goes untested for years. That was true of the volume chart's painter.
   */
  function strokeOf(points: Array<{ x: number; y: number }>): SpatialStroke {
    return {
      id: "s1", tool: "pen", space: "screen",
      layerId: "researcher",
      style: { colour: "#000", width: 2, opacity: 1 },
      originalPoints: points.map((p, i) => ({ ...p, timestamp: i, confidence: 1 })),
      points: points.map((p, i) => ({ ...p, timestamp: i, confidence: 1 })),
      createdAt: 0, createdBy: "test",
    };
  }

  function canvasOf() {
    const canvas = document.createElement("canvas");
    canvas.width = 2000;   // a 2x display over a 1000px viewport
    canvas.height = 1600;
    return canvas;
  }

  it("scales for the display, so a line is not soft on a retina screen", () => {
    paint(canvasOf(), [strokeOf([{ x: 10, y: 10 }, { x: 90, y: 90 }])],
          { width: 1000, height: 800 });
    expect(calls.setTransform).toBe(1);
  });

  it("clears before drawing, so a stroke is not left behind after an undo", () => {
    paint(canvasOf(), [], { width: 1000, height: 800 });
    expect(calls.clearRect).toBe(1);
    expect(calls.stroke ?? 0).toBe(0);
  });

  it("does not draw a single point as a mark", () => {
    // A dot is the most common piece of unwanted ink, and the two-frame contact
    // rule exists to prevent it. Drawing a lone point here would put it back.
    paint(canvasOf(), [strokeOf([{ x: 10, y: 10 }])], { width: 1000, height: 800 });
    expect(calls.stroke ?? 0).toBe(0);
  });

  it("curves between observations rather than through them", () => {
    // Quadratic segments between midpoints pass near every point and through
    // none, which removes the polygonal look of a 30 Hz sample without moving
    // the line anywhere the hand did not go.
    paint(canvasOf(), [strokeOf([
      { x: 10, y: 10 }, { x: 20, y: 40 }, { x: 30, y: 10 }, { x: 40, y: 40 },
    ])], { width: 1000, height: 800 });
    expect(calls.quadraticCurveTo).toBeGreaterThan(0);
  });

  it("survives a canvas with no 2D context rather than throwing", () => {
    // A browser that refuses a context — memory pressure, a blocked canvas —
    // must not take down the page the ink is drawn over.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
    expect(() => paint(canvasOf(), [strokeOf([{ x: 1, y: 1 }, { x: 2, y: 2 }])],
                       { width: 1000, height: 800 })).not.toThrow();
  });
});
