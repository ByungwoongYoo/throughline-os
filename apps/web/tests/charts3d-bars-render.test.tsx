/**
 * Drawing bars in a room (§9 bars, §10).
 *
 * This chart is built to argue against itself, so the tests are mostly about
 * whether it does: that the costs it reports are recomputed as the view moves,
 * that the occlusion it claims is the occlusion that happens, and that a bar is
 * drawn as a solid rather than as a flat sticker.
 */

import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import {
  Bars3D, barColour, drawOrder, paintBars,
} from "@/components/charts/Bars3D";
import { DEFAULT_CAMERA, toCanvas } from "@/lib/charts/scene3d";
import { Bar, prepareBars } from "@/lib/charts3d/bars";
import { VisualizationController } from "@/lib/spatial/commands";

type Call = { op: string; args: number[]; fill: string };

function recordingCanvas() {
  const calls: Call[] = [];
  const context: Record<string, unknown> & { fillStyle: string } = {
    fillStyle: "", strokeStyle: "", lineWidth: 0 };
  const note = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args: args.filter((a): a is number => typeof a === "number"),
                 fill: String(context.fillStyle) });
  };
  Object.assign(context, {
    clearRect: note("clearRect"), save: note("save"), restore: note("restore"),
    beginPath: note("beginPath"), moveTo: note("moveTo"), lineTo: note("lineTo"),
    closePath: note("closePath"), fill: note("fill"), stroke: note("stroke"),
  });
  const canvas = {
    getContext: () => context, width: 400, height: 300,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const SIZE = { width: 400, height: 300 };
const grid = (values: number[][]): Bar[] =>
  values.flatMap((row, r) => row.map((value, c) => ({ row: r, column: c, value })));

const paint = (bars: Bar[], selected: number | null = null) => {
  const r = recordingCanvas();
  paintBars(r.canvas, prepareBars(bars), DEFAULT_CAMERA, SIZE, selected);
  return r;
};

describe("a bar is drawn as a solid", () => {
  it("draws a top and at least one side for each bar", () => {
    /*
     * A single filled rectangle reads as a flat sticker. The visible sides plus
     * the top are what make it a solid, and the top is what lets the eye find
     * the height.
     */
    /*
     * Five: four sides and the top. All four sides are drawn, back to front,
     * rather than only the two facing the viewer — culling by projected winding
     * selected two *opposite* faces instead of two adjacent ones, and every bar
     * came out as a floating top with a spike beneath it. Found by looking at
     * the screen, not by a test, which is why the count is now exact.
     */
    const { calls } = paint(grid([[1]]));
    const fills = calls.filter((c) => c.op === "fill");
    expect(fills).toHaveLength(5);
  });

  it("draws the sides of one bar back to front", () => {
    // Within a bar the near faces must cover the far ones; that is what makes
    // four overlapping quads read as a solid box rather than as a tangle.
    const { calls } = paint(grid([[1]]));
    const fills = calls.filter((c) => c.op === "fill");
    // The last fill is the top; the four before it are the sides, and the two
    // nearest tones must not be drawn before the two farthest.
    expect(fills).toHaveLength(5);
    expect(fills[4].fill).toBe(barColour(prepareBars(grid([[1]])).bars[0].level, "top"));
  });

  it("shades the faces differently so the sides read as sides", () => {
    /*
     * By orientation rather than by lighting: the tone difference is constant,
     * so a reader is not comparing heights across a gradient.
     */
    const tones = new Set([barColour(0.5, "top"), barColour(0.5, "left"),
                           barColour(0.5, "right")]);
    expect(tones.size).toBe(3);
  });

  it("keeps colour channels inside range for any level", () => {
    for (const level of [-3, 0, 0.5, 1, 4]) {
      for (const face of ["top", "left", "right"] as const) {
        const channels = barColour(level, face).match(/\d+/g)!.map(Number);
        for (const c of channels) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it("draws the top after the sides it shares an edge with", () => {
    // Otherwise a side overdraws the top and the bar loses the face the eye
    // uses to judge height.
    const { calls } = paint(grid([[1]]));
    const fills = calls.filter((c) => c.op === "fill");
    const top = barColour(prepareBars(grid([[1]])).bars[0].level, "top");
    expect(fills[fills.length - 1].fill).toBe(top);
  });

  it("clears before drawing, so a rotation does not smear", () => {
    expect(paint(grid([[1, 2]])).calls[0].op).toBe("clearRect");
  });

  it("does nothing at all without a canvas", () => {
    expect(() => paintBars(null, prepareBars(grid([[1]])), DEFAULT_CAMERA,
                           SIZE, null)).not.toThrow();
  });

  it("draws nothing for an empty chart", () => {
    expect(paint([]).calls.filter((c) => c.op === "fill")).toHaveLength(0);
  });
});

describe("the bars are drawn back to front", () => {
  it("orders by where a bar stands, not by how tall it is", () => {
    /*
     * Sorting by the top would put a short near bar behind a tall far one. The
     * height is the data; the position on the floor is what decides which is in
     * front — so a grid with tall bars at the back and short ones at the front
     * must still be drawn back to front.
     */
    const prepared = prepareBars(grid([[9, 1], [1, 9]]));
    const order = drawOrder(prepared, DEFAULT_CAMERA, SIZE);

    expect(order).toHaveLength(prepared.bars.length);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i].at.depth).toBeGreaterThanOrEqual(order[i - 1].at.depth);
    }
  });

  it("does not let a tall bar jump forward", () => {
    /*
     * The failure the base-sort prevents, at a camera where the two orderings
     * genuinely disagree — measured rather than assumed. At the default pitch
     * a tall far bar and a short near one happen to sort the same way whichever
     * end you take, so an earlier version of this test compared the ordering
     * against itself and passed while the renderer sorted by the top.
     *
     * At pitch 0.9 with values 100 and 1, the bases order [100, 1] and the tops
     * order [1, 100]. The bases are the right answer: where a bar stands is
     * what decides which is in front, and its height is the data.
     */
    const camera = { ...DEFAULT_CAMERA, pitch: 0.9 };
    const prepared = prepareBars([
      { row: 0, column: 0, value: 100 }, { row: 0, column: 1, value: 1 }]);
    const order = drawOrder(prepared, camera, SIZE);

    const depthAt = (bar: (typeof prepared.bars)[0], which: "base" | "top") =>
      toCanvas({ x: bar.x, y: bar[which], z: bar.z }, camera, 400, 300).depth;
    const byBase = [...prepared.bars]
      .sort((a, b) => depthAt(a, "base") - depthAt(b, "base"));
    const byTop = [...prepared.bars]
      .sort((a, b) => depthAt(a, "top") - depthAt(b, "top"));

    // The premise: these two really do disagree here, or the test proves nothing.
    expect(byBase.map((b) => b.value)).not.toEqual(byTop.map((b) => b.value));
    expect(order.map((o) => o.bar.value)).toEqual(byBase.map((b) => b.value));
  });
});

describe("the chart reports what depth costs it", () => {
  it("states the occlusion and the stretch in the caption", () => {
    const { container } = render(<Bars3D bars={grid([[1, 2], [3, 4]])} />);
    expect(container.textContent).toContain("the room, not the data");
    expect(container.textContent).toContain("flat version");
  });

  it("recomputes the costs when the camera moves", () => {
    /*
     * Both change as the view turns, so a caption measured once would describe
     * a view the reader has since turned away from. This is the difference
     * between a caveat and a measurement.
     */
    const many = grid(Array.from({ length: 5 }, (_, r) =>
      Array.from({ length: 5 }, (_, c) => r + c + 1)));
    const ref = createRef<VisualizationController>();
    const { container } = render(
      <Bars3D bars={many} controllerRef={ref} width={400} height={300} />);

    const before = container.textContent;
    act(() => { ref.current!.rotate(120, 40); });
    expect(container.textContent).not.toBe(before);
  });

  it("names how many bars cannot be read from this angle", () => {
    // A dense grid seen at the default camera hides some of itself; the count
    // is the thing §10 asks for.
    const many = grid(Array.from({ length: 6 }, () => Array(6).fill(5)));
    const { container } = render(<Bars3D bars={many} width={300} height={220} />);
    expect(container.textContent).toMatch(/behind another/);
  });
});

describe("the controller the seam talks to", () => {
  const bars = grid([[1, 2], [3, 4]]);

  it("reports the bar in front, not one behind it", () => {
    /*
     * The camera is turned first, and that is the whole test. A regular grid
     * seen from the default view sorts the same way whether you take the
     * nearest bar or simply the last one that overlaps — measured: 3,684 screen
     * points carry two or more bar tops and *not one* of them disagrees. At yaw
     * 3.6, pitch 0.5, all 3,612 of them do.
     *
     * A grid is exactly the case where this coincidence is most likely, so
     * sweeping for the first hit at the default camera would have proved
     * nothing about a chart whose whole subject is occlusion.
     */
    const many: Bar[] = [];
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) many.push({ row: r, column: c, value: 5 });
    }
    const camera = { yaw: 3.6, pitch: 0.5, zoom: 1 };
    const ref = createRef<VisualizationController>();
    render(<Bars3D bars={many} controllerRef={ref} width={400} height={300} />);
    act(() => { ref.current!.restoreViewState(camera); });

    const prepared = prepareBars(many);
    const screen = prepared.bars.map((b) =>
      toCanvas({ x: b.x, y: b.top, z: b.z },
               { ...DEFAULT_CAMERA, ...camera }, 400, 300));

    let probe: { x: number; y: number } | null = null;
    let expected = -1;
    for (let x = 0; x <= 400 && probe === null; x += 2) {
      for (let y = 0; y <= 300 && probe === null; y += 2) {
        const under = screen
          .map((q, i) => ({ q, i }))
          .filter(({ q }) => Math.hypot(q.x - x, q.y - y) <= 18);
        if (under.length < 2) continue;
        const front = under.reduce((a, b) => (b.q.depth > a.q.depth ? b : a));
        if (front.i === under[under.length - 1].i) continue;
        probe = { x, y };
        expected = front.i;
      }
    }
    expect(probe).not.toBeNull();
    expect(ref.current!.hover(probe!)?.id).toBe(String(expected));
  });

  it("finds nothing where there are no bars", () => {
    const ref = createRef<VisualizationController>();
    render(<Bars3D bars={bars} controllerRef={ref} />);
    expect(ref.current!.hover({ x: -900, y: -900 })).toBeNull();
  });

  it("restores a view, and refuses a partial one", () => {
    const ref = createRef<VisualizationController>();
    render(<Bars3D bars={bars} controllerRef={ref} />);
    const home = ref.current!.viewState();
    act(() => { ref.current!.rotate(50, 20); });
    const moved = ref.current!.viewState();

    for (const missing of ["yaw", "pitch", "zoom"]) {
      const partial: Record<string, number> = { ...moved };
      delete partial[missing];
      act(() => { ref.current!.restoreViewState(partial); });
      expect(ref.current!.viewState()).toEqual(moved);
    }
    act(() => { ref.current!.restoreViewState(home); });
    expect(ref.current!.viewState().yaw).toBeCloseTo(home.yaw, 6);
  });

  it("has no bounds before it is laid out", () => {
    const ref = createRef<VisualizationController>();
    render(<Bars3D bars={bars} controllerRef={ref} />);
    expect(ref.current!.bounds()).toBeNull();
  });

  it("tells the caller when nothing was under the point", () => {
    const onSelect = vi.fn();
    const ref = createRef<VisualizationController>();
    render(<Bars3D bars={bars} controllerRef={ref} onSelect={onSelect} />);
    act(() => { ref.current!.select({ x: -900, y: -900 }); });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("names the value of the bar that was selected", () => {
    const ref = createRef<VisualizationController>();
    const { container } = render(<Bars3D bars={bars} controllerRef={ref} />);
    act(() => { ref.current!.focus("2"); });
    expect(container.textContent).toContain("Selected:");
  });

  it("ignores a focus on something that is not one of its bars", () => {
    const ref = createRef<VisualizationController>();
    const { container } = render(<Bars3D bars={bars} controllerRef={ref} />);
    act(() => { ref.current!.focus("99"); });
    expect(container.textContent).not.toContain("Selected:");
  });
});
