/**
 * Drawing a scalar volume (§9 volume).
 *
 * Alpha compositing is not commutative, so the order these splats are drawn in
 * *is* the correctness of the chart — and a volume drawn in the wrong order
 * still looks like a volume, which is what makes the error worth a test rather
 * than an eye. The rest of these check the things a volume must never do:
 * report a value the reader cannot see, or draw a marker on a buried voxel as
 * though it were visible.
 */

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import {
  VoxelVolume, paintVolume, volumeColour,
} from "@/components/charts/VoxelVolume";
import { DEFAULT_CAMERA, toCanvas } from "@/lib/charts/scene3d";
import {
  DEFAULT_VOLUME, Grid, Volume, prepareVolume,
} from "@/lib/charts3d/voxels";
import { ScreenPoint, VisualizationController } from "@/lib/spatial/commands";

type Call = { op: string; args: number[]; alpha: number; fill: string };

function recordingCanvas() {
  const calls: Call[] = [];
  const context: Record<string, unknown> & {
    globalAlpha: number; fillStyle: string; strokeStyle: string;
  } = { globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 0 };
  const note = (op: string) => (...args: unknown[]) => {
    calls.push({
      op,
      args: args.filter((a): a is number => typeof a === "number"),
      alpha: context.globalAlpha,
      fill: String(context.fillStyle),
    });
  };
  Object.assign(context, {
    clearRect: note("clearRect"), save: note("save"), restore: note("restore"),
    beginPath: note("beginPath"), arc: note("arc"), fill: note("fill"),
    stroke: note("stroke"), moveTo: note("moveTo"), lineTo: note("lineTo"),
  });
  const canvas = {
    getContext: () => context, width: 400, height: 300,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const SIZE = { width: 400, height: 300 };
const paint = (volume: Volume, selected: number | null = null,
               camera = DEFAULT_CAMERA) => {
  const r = recordingCanvas();
  paintVolume(r.canvas, volume, camera, SIZE, selected);
  return r;
};

/** A cube of `n³` samples filled by a function of the indices. */
const cube = (n: number, fill: (i: number, j: number, k: number) => number): Grid => {
  const values = new Float64Array(n * n * n);
  for (let k = 0; k < n; k += 1)
    for (let j = 0; j < n; j += 1)
      for (let i = 0; i < n; i += 1) values[i + n * (j + n * k)] = fill(i, j, k);
  return { nx: n, ny: n, nz: n, values, units: "HU" };
};

/** A gradient volume, so every voxel has a distinct value. */
const gradient = (n = 4) => cube(n, (i, j, k) => i + j + k);

describe("the order is the correctness", () => {
  it("composites back to front", () => {
    /*
     * `a over b` is not `b over a`. Drawn front to back the far side of the
     * volume shows through the near side — and the result still looks like a
     * plausible volume, which is precisely why this needs to be checked
     * against the projection rather than by looking at it.
     */
    const volume = prepareVolume(gradient(3));
    const { calls } = paint(volume);
    const arcs = calls.filter((c) => c.op === "arc");
    const depths = volume.splats
      .map((s) => toCanvas(s, DEFAULT_CAMERA, 400, 300))
      .sort((a, b) => a.depth - b.depth);

    expect(arcs).toHaveLength(volume.splats.length);
    // First drawn is the farthest, last drawn is the nearest.
    expect(arcs[0].args[0]).toBeCloseTo(depths[0].x, 6);
    expect(arcs[arcs.length - 1].args[0])
      .toBeCloseTo(depths[depths.length - 1].x, 6);
  });

  it("draws every splat, not only the ones in front", () => {
    // A volume is the accumulation. Skipping the buried ones would draw a
    // shell and call it a volume.
    const volume = prepareVolume(gradient(4));
    const { calls } = paint(volume);
    expect(calls.filter((c) => c.op === "fill"))
      .toHaveLength(volume.splats.length);
  });

  it("draws each splat at the opacity the transfer function gave it", () => {
    /*
     * The opacity is spacing-corrected upstream. A renderer that substituted
     * its own constant would undo that correction silently, and a strided
     * volume would look thinner than the same data drawn in full.
     */
    const volume = prepareVolume(gradient(4));
    const { calls } = paint(volume);
    const alphas = calls.filter((c) => c.op === "fill").map((c) => c.alpha);
    const expected = [...volume.splats]
      .map((s) => ({ s, d: toCanvas(s, DEFAULT_CAMERA, 400, 300).depth }))
      .sort((a, b) => a.d - b.d)
      .map(({ s }) => s.alpha);
    expect(alphas).toEqual(expected);
  });

  it("clears before drawing, so a rotation does not accumulate", () => {
    // Especially here: without a clear, a translucent volume gets steadily
    // more opaque every frame the reader drags it.
    const { calls } = paint(prepareVolume(gradient(3)));
    expect(calls[0].op).toBe("clearRect");
  });

  it("does nothing at all without a canvas", () => {
    expect(() => paintVolume(null, prepareVolume(gradient(2)), DEFAULT_CAMERA,
                             SIZE, null)).not.toThrow();
  });

  it("draws nothing when the window excludes everything", () => {
    const volume = prepareVolume(gradient(3), {
      ...DEFAULT_VOLUME, window: { level: 1000, window: 2 } });
    expect(paint(volume).calls.filter((c) => c.op === "arc")).toHaveLength(0);
  });
});

describe("depth is visible as well as ordered", () => {
  it("draws a nearer voxel larger than a farther one", () => {
    /*
     * The perspective factor, the same cue the rest of the scene uses. Without
     * it a correctly composited volume still reads as flat, because
     * compositing alone gives the eye no size gradient to read depth from.
     */
    const volume = prepareVolume(gradient(3));
    const { calls } = paint(volume);
    const arcs = calls.filter((c) => c.op === "arc");
    const radii = arcs.map((c) => c.args[2]);
    // Drawn back to front, so radius should trend upward.
    expect(radii[radii.length - 1]).toBeGreaterThan(radii[0]);
  });

  it("colours by the value's place in the window", () => {
    const volume = prepareVolume(gradient(4));
    const { calls } = paint(volume);
    const fills = new Set(calls.filter((c) => c.op === "fill")
                               .map((c) => c.fill));
    expect(fills.size).toBeGreaterThan(1);
  });

  it("ramps colour monotonically rather than through a rainbow", () => {
    /*
     * In a volume the colours are composited on top of one another, so a
     * rainbow's hue boundaries accumulate into bands that read as structures
     * that are not there.
     */
    const steps = [0, 0.25, 0.5, 0.75, 1].map(volumeColour);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i][0]).toBeGreaterThan(steps[i - 1][0]);
      expect(steps[i][2]).toBeLessThan(steps[i - 1][2]);
    }
  });

  it("stays inside the ramp for a level outside 0..1", () => {
    expect(volumeColour(-3)).toEqual(volumeColour(0));
    expect(volumeColour(3)).toEqual(volumeColour(1));
  });
});

describe("a selected voxel is not promoted above what buries it", () => {
  it("draws the marker in the same pass, so it can be occluded", () => {
    /*
     * A marker drawn afterwards, on top of everything, tells the reader that a
     * voxel is visible when it is buried under half the volume. In a scan that
     * is the difference between "the lesion is at the surface" and "the lesion
     * is deep", read straight off a picture that cannot support either.
     */
    const volume = prepareVolume(gradient(3));
    const { calls } = paint(volume, 0);
    const strokeAt = calls.findIndex((c) => c.op === "stroke");
    const lastFill = calls.map((c) => c.op).lastIndexOf("fill");
    expect(strokeAt).toBeGreaterThanOrEqual(0);
    // Splats drawn after the marker are what will cover it.
    expect(strokeAt).toBeLessThan(lastFill);
  });

  it("draws no marker when nothing is selected", () => {
    expect(paint(prepareVolume(gradient(3)), null)
      .calls.some((c) => c.op === "stroke")).toBe(false);
  });
});

describe("the controller the seam talks to", () => {
  it("reports the nearest voxel under the pointer, never a buried one", () => {
    /*
     * Every pixel of a volume has hundreds of voxels behind it. Reporting any
     * but the front one gives the reader a number belonging to something they
     * cannot see and did not point at.
     */
    /*
     * Ten cubed, and the size is measured rather than guessed.
     *
     * Whether the array order and the depth order ever disagree on screen
     * depends on how densely the projected voxels overlap, so a grid that is
     * too small lets a renderer taking the *last* voxel within range pass. At
     * 6³ there are 4484 points with two or more voxels under them and *none*
     * disagree; at 8³ only two do; at 10³, 425 do. Sweeping for the first hit
     * and checking it happened to be nearest tests nothing at all — mutation
     * testing caught exactly that, twice, at two different grid sizes.
     */
    const grid = gradient(10);
    const ref = createRef<VisualizationController>();
    render(<VoxelVolume grid={grid} controllerRef={ref} width={400}
                        height={300} />);
    const volume = prepareVolume(grid);

    const screen = volume.splats.map(
      (s) => toCanvas(s, DEFAULT_CAMERA, 400, 300));

    /*
     * A point where array order and depth order genuinely disagree — several
     * voxels under the pointer, and the nearest of them is *not* the last one
     * in the list. Sweeping for the first hit and checking it happened to be
     * nearest does not test this: a renderer picking the last within range
     * passes wherever the two orders coincide, which mutation testing found it
     * doing.
     */
    let point: ScreenPoint | null = null;
    let expected = -1;
    for (let x = 0; x <= 400 && point === null; x += 2) {
      for (let y = 0; y <= 300 && point === null; y += 2) {
        const under = screen
          .map((q, index) => ({ q, index }))
          .filter(({ q }) => Math.hypot(q.x - x, q.y - y) <= 10);
        if (under.length < 2) continue;
        const front = under.reduce((a, b) => (b.q.depth > a.q.depth ? b : a));
        if (front.index === under[under.length - 1].index) continue;
        point = { x, y };
        expected = front.index;
      }
    }
    expect(point).not.toBeNull();

    const hit = ref.current!.hover(point!);
    expect(hit).not.toBeNull();
    expect(Number(hit!.id)).toBe(expected);
  });

  it("carries the window in the view state, not just the camera", () => {
    /*
     * §143 at its sharpest. The same scan at a different window is a different
     * picture — a mark circling a lesion visible only in a soft-tissue window
     * means nothing over a bone one — so an annotation's view has to include
     * the window or it cannot say when it has stopped applying.
     */
    const ref = createRef<VisualizationController>();
    render(<VoxelVolume grid={gradient(4)} controllerRef={ref} />);
    const state = ref.current!.viewState();
    expect(state).toHaveProperty("level");
    expect(state).toHaveProperty("window");
  });

  it("restores the window along with the camera", () => {
    const ref = createRef<VisualizationController>();
    render(<VoxelVolume grid={gradient(4)} controllerRef={ref} />);
    const home = ref.current!.viewState();

    act(() => {
      ref.current!.rotate(40, 10);
      ref.current!.restoreViewState({ ...home, level: home.level + 2,
                                      window: 1 });
    });
    expect(ref.current!.viewState().window).toBe(1);

    act(() => { ref.current!.restoreViewState(home); });
    expect(ref.current!.viewState().level).toBeCloseTo(home.level, 6);
    expect(ref.current!.viewState().yaw).toBeCloseTo(home.yaw, 6);
  });

  it("refuses a view state missing any one of its fields", () => {
    // A restore that moved the camera but left the window shows the annotated
    // place through the wrong window, which is worse than not moving at all.
    const ref = createRef<VisualizationController>();
    render(<VoxelVolume grid={gradient(4)} controllerRef={ref} />);
    act(() => { ref.current!.rotate(30, 5); });
    const moved = ref.current!.viewState();

    for (const missing of ["yaw", "pitch", "zoom", "level", "window"]) {
      const partial: Record<string, number> = { ...moved };
      delete partial[missing];
      act(() => { ref.current!.restoreViewState(partial); });
      expect(ref.current!.viewState()).toEqual(moved);
    }
  });

  it("brings the window back when the view is reset", () => {
    /*
     * A reader narrowed to bone who asks to reset expects the whole scan. A
     * reset that moved the camera but left the window narrowed lands them in a
     * volume that still looks nearly empty, which reads as the reset failing.
     */
    const ref = createRef<VisualizationController>();
    render(<VoxelVolume grid={gradient(4)} controllerRef={ref} />);
    const home = ref.current!.viewState();
    act(() => { ref.current!.restoreViewState({ ...home, window: 1 }); });
    expect(ref.current!.viewState().window).toBe(1);

    act(() => { ref.current!.resetView(); });
    expect(ref.current!.viewState().window).toBeCloseTo(home.window, 6);
  });

  it("has no bounds before it is laid out", () => {
    const ref = createRef<VisualizationController>();
    render(<VoxelVolume grid={gradient(3)} controllerRef={ref} />);
    expect(ref.current!.bounds()).toBeNull();
  });

  it("tells the caller when nothing was under the point", () => {
    const onSelect = vi.fn();
    const ref = createRef<VisualizationController>();
    render(<VoxelVolume grid={gradient(3)} controllerRef={ref}
                        onSelect={onSelect} />);
    act(() => { ref.current!.select({ x: -900, y: -900 }); });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("drops a selection the volume no longer has", () => {
    const ref = createRef<VisualizationController>();
    const { container, rerender } = render(
      <VoxelVolume grid={gradient(4)} controllerRef={ref} />);
    act(() => { ref.current!.focus("40"); });
    expect(container.textContent).toContain("Selected:");

    rerender(<VoxelVolume grid={gradient(2)} controllerRef={ref} />);
    expect(container.textContent).not.toContain("Selected:");
  });
});

describe("what the reader is told", () => {
  it("states the window, the range and what is hidden", () => {
    const { container } = render(
      <VoxelVolume grid={gradient(4)} caption="Density." />);
    expect(container.textContent).toContain("Density.");
    expect(container.textContent).toContain("voxels drawn");
    expect(container.textContent).toContain("HU");
  });

  it("offers the window as a control, because there is no single right one", () => {
    /*
     * Lung, bone and soft tissue are three windows over one scan and no one of
     * them shows all three. A volume without a reachable window shows one
     * arbitrary slice of its own range and implies that is what is there.
     */
    const { getByLabelText } = render(<VoxelVolume grid={gradient(4)} />);
    expect(getByLabelText("Window level")).toBeTruthy();
    expect(getByLabelText("Window width")).toBeTruthy();
  });

  it("redraws when the reader moves the window", () => {
    const onWindowChange = vi.fn();
    const { getByLabelText, container } = render(
      <VoxelVolume grid={gradient(4)} onWindowChange={onWindowChange} />);
    const before = container.textContent;

    fireEvent.change(getByLabelText("Window width"), { target: { value: "1" } });
    expect(onWindowChange).toHaveBeenCalled();
    expect(container.textContent).not.toBe(before);
  });

  it("names the value of the voxel that was selected", () => {
    const ref = createRef<VisualizationController>();
    const { container } = render(
      <VoxelVolume grid={gradient(4)} controllerRef={ref} />);
    act(() => { ref.current!.focus("5"); });
    expect(container.textContent).toMatch(/Selected: [\d.]+ HU/);
  });
});
