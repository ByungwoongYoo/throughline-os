/**
 * The draw loop, which no test had ever run.
 *
 * `volume-controller` stubs `getContext` to null so the chart can be mounted
 * without a canvas — which means `draw()` returns on its second line and the
 * entire painting path, the depth sort, the occlusion count and everything that
 * happens sixty times a second during a rotation, has never executed under test.
 * That is a reasonable trade for testing the controller seam and a poor place to
 * leave the part whose cost is paid per frame.
 *
 * So this file supplies a recording 2D context instead of nothing. It does not
 * assert on pixels — happy-dom draws none, and a test that pinned exact `arc`
 * coordinates would fail on every legitimate visual change. It asserts the two
 * things that survive having no renderer: that the work per frame is bounded,
 * and that painting does not drag React along with it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler, createRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { SETTLE_MS, Volume } from "@/components/charts/Volume";
import { VisualizationController } from "@/lib/spatial/commands";

/** A 2D context that records what it was asked to do and draws nothing. */
function recordingContext() {
  const calls: Record<string, number> = {};
  const count = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
  const context = new Proxy({} as CanvasRenderingContext2D, {
    get(_target, property: string) {
      if (property === "canvas") return undefined;
      // Every drawing method is a counter; every property assignment is ignored.
      return () => count(property);
    },
    set() { return true; },
  });
  return { context, calls };
}

/*
 * A cloud dense enough that marks genuinely cover one another, so the occlusion
 * count moves as the scene rotates.
 *
 * 900 points, not 120. The first version of this fixture used 120 and the
 * occlusion count sat at a constant 2 for the whole rotation — so both the
 * dedupe and the counting itself could be deleted with every assertion still
 * passing. The cloud has to be dense enough that marks actually slide behind one
 * another, which at 3.4px marks across a 240px cube means hundreds. 900 is also
 * the scale the draw loop's linear occlusion grid was written for.
 */
const DENSE = Array.from({ length: 900 }, (_, i) => ({
  id: `p${i}`,
  label: `Point ${i}`,
  x: Math.sin(i * 1.7) * 2,
  y: Math.cos(i * 2.3) * 2,
  z: Math.sin(i * 0.9) * 2,
  value: i % 10,
}));

let context: CanvasRenderingContext2D;
let calls: Record<string, number>;

beforeEach(() => {
  ({ context, calls } = recordingContext());
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as never;
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/**
 * Mount inside a Profiler so React commits can be counted.
 *
 * `onRender` fires once per commit of the subtree, which is exactly the question
 * — not "did the canvas repaint" (it should, at frame rate) but "did React
 * re-render the tree along with it" (it should not).
 */
function mount() {
  const ref = createRef<VisualizationController | null>();
  let commits = 0;
  render(
    <Profiler id="volume" onRender={() => { commits += 1; }}>
      <Volume points={DENSE} controllerRef={ref} xLabel="x" yLabel="y" zLabel="z"
              valueLabel="value" width={400} height={400} />
    </Profiler>,
  );
  return { ref, commits: () => commits };
}

/** Run the chart's rAF loop `n` times, since happy-dom does not run it for us. */
function paint(n: number) {
  act(() => {
    for (let i = 0; i < n; i += 1) {
      const pending = frameCallbacks.splice(0, frameCallbacks.length);
      for (const callback of pending) callback(performance.now());
    }
  });
}

let frameCallbacks: FrameRequestCallback[] = [];

beforeEach(() => {
  frameCallbacks = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("painting", () => {
  it("draws the cloud once the loop runs", () => {
    /** The baseline this file exists to establish: the path executes at all. */
    mount();
    paint(2);

    expect(calls.arc ?? 0).toBeGreaterThanOrEqual(DENSE.length);
    expect(calls.clearRect ?? 0).toBeGreaterThan(0);
  });

  it("paints once per frame however many commands arrived", () => {
    /**
     * The reason the chart can be driven by a 30 Hz gesture stream without
     * repainting 30 times: commands mark the canvas dirty, and the rAF loop
     * paints the accumulated result once. A chart that painted synchronously per
     * command would repaint several times per frame under a rotation, and the
     * cost would scale with how fast the tracker happened to run.
     */
    const { ref } = mount();
    paint(1);
    const afterFirst = calls.arc ?? 0;

    act(() => {
      for (let i = 0; i < 20; i += 1) ref.current!.rotate(0.01, 0.005);
    });
    paint(1);

    // One frame's worth of marks was added, not twenty.
    expect((calls.arc ?? 0) - afterFirst)
      .toBeLessThanOrEqual(DENSE.length + DENSE.length / 2);
  });

  it("does not paint when nothing changed", () => {
    /** An idle chart must not hold a repaint budget it is not using. */
    const { ref } = mount();
    paint(1);
    act(() => { ref.current!.rotate(0.02, 0.01); });
    paint(1);
    const settled = calls.arc ?? 0;

    paint(30);

    expect(calls.arc ?? 0).toBe(settled);
  });

  it("does not re-render React while the scene is being rotated", () => {
    /**
     * The cost this file was written to find, and it took two wrong attempts.
     *
     * `draw()` runs inside the rAF loop and ended with an unconditional
     * `setOccluded(hidden)`, so every painted frame asked React to re-render.
     * The first fix compared against the previous value — useless, because on a
     * dense cloud the count genuinely changes almost every frame as marks slide
     * past one another (measured: 419, 422, 420, 425...), which is also why
     * React's own identical-value bail-out cannot help.
     *
     * The first version of *this test* then passed against the broken code,
     * because it wrapped all sixty frames in a single `act()` — React batched
     * the updates and the commit count collapsed to something small. The
     * batching was the test's own doing and hid the exact behaviour it claimed
     * to measure. Each frame is now committed separately, which is what actually
     * happens in a browser.
     *
     * The real fix is to stop asking at frame rate: the count is deferred until
     * the drawing stops, because a caption cycling through eight values a second
     * is unreadable as well as expensive.
     */
    const { ref, commits } = mount();
    paint(1);
    const before = commits();

    // Sixty frames of continuous rotation, committed one at a time — 45 React
    // commits before this was fixed.
    for (let i = 0; i < 60; i += 1) {
      act(() => { ref.current!.rotate(0.03, 0.012); });
      paint(1);
    }

    expect(commits() - before).toBeLessThan(5);
  });

  it("reports the occlusion count once the view settles", async () => {
    /**
     * Deferring must not mean discarding. The number is the chart's own answer
     * to "how much of this can I not see", which §20 treats as owed to the
     * reader rather than optional, so it has to arrive — just not eight times a
     * second while the scene is moving.
     */
    const { ref } = mount();
    paint(1);
    for (let i = 0; i < 10; i += 1) {
      act(() => { ref.current!.rotate(0.03, 0.012); });
      paint(1);
    }

    // Nothing published yet: the view has not stopped moving.
    expect(document.body.textContent).toContain("No points are currently hidden");

    // Real timers, deliberately. Fake timers also fake the scheduler React uses
    // to flush state, so the deferred publish is swallowed and the test reports
    // that nothing arrived.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 80));
    });

    // Asserted through the caption rather than a render count: what is owed to
    // the reader is the number, and a test of commits would still pass if the
    // component re-rendered without ever saying anything.
    expect(document.body.textContent)
      .toMatch(/\d+ of these points are hidden behind others right now/);
  });
});
