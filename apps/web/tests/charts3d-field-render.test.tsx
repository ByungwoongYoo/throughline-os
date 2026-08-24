/**
 * Drawing a vector field (§9 fields).
 *
 * The claims here are the ones a reader's conclusions rest on: that an arrow
 * points where the vector points after projection, that a nearer arrow covers
 * a farther one, that an arrow with nowhere to point is a dot rather than a
 * misleading stub, and that magnitude survives the length clamp by way of
 * colour.
 */

import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { Field3D, magnitudeColour, paintField } from "@/components/charts/Field3D";
import { DEFAULT_CAMERA, toCanvas } from "@/lib/charts/scene3d";
import { Field, Sample, prepareField } from "@/lib/charts3d/field";
import { VisualizationController } from "@/lib/spatial/commands";

type Call = { op: string; args: number[]; stroke: string; fill: string };

/** A canvas that remembers what it was asked to do, in order. */
function recordingCanvas() {
  const calls: Call[] = [];
  const context: Record<string, unknown> & {
    strokeStyle: string; fillStyle: string;
  } = { strokeStyle: "", fillStyle: "", lineWidth: 0 };
  const note = (op: string) => (...args: unknown[]) => {
    calls.push({
      op,
      args: args.filter((a): a is number => typeof a === "number"),
      stroke: String(context.strokeStyle),
      fill: String(context.fillStyle),
    });
  };
  Object.assign(context, {
    clearRect: note("clearRect"), save: note("save"), restore: note("restore"),
    beginPath: note("beginPath"), moveTo: note("moveTo"), lineTo: note("lineTo"),
    stroke: note("stroke"), fill: note("fill"), arc: note("arc"),
    closePath: note("closePath"),
  });
  const canvas = {
    getContext: () => context, width: 400, height: 300,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const SIZE = { width: 400, height: 300 };
const paint = (field: Field, selected: number | null = null,
               hovered: number | null = null) => {
  const r = recordingCanvas();
  paintField(r.canvas, field, DEFAULT_CAMERA, SIZE, selected, hovered);
  return r;
};

describe("an arrow points where the vector points", () => {
  it("draws the shaft from the tail to the projected head", () => {
    /*
     * The whole chart is this one claim. If the head is projected by different
     * arithmetic from the tail — or from a second copy of the projection —
     * every arrow points somewhere the data does not, and nothing about the
     * picture looks wrong.
     */
    const field = prepareField([
      { x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 },
      { x: 1, y: 1, z: 1, u: 1, v: 0, w: 0 },
    ]);
    const { calls } = paint(field);
    const glyph = field.glyphs[0];
    const tail = toCanvas(glyph, DEFAULT_CAMERA, 400, 300);
    const head = toCanvas({ x: glyph.hx, y: glyph.hy, z: glyph.hz },
                          DEFAULT_CAMERA, 400, 300);

    const moves = calls.filter((c) => c.op === "moveTo");
    const lines = calls.filter((c) => c.op === "lineTo");
    expect(moves[0].args[0]).toBeCloseTo(tail.x, 6);
    expect(lines[0].args[0]).toBeCloseTo(head.x, 6);
    expect(lines[0].args[1]).toBeCloseTo(head.y, 6);
  });

  it("gives the arrow a head, so which end is the front is visible", () => {
    // Without one the field is a set of segments and the reader cannot tell
    // flow from its reverse — which is the whole of what the chart says.
    const field = prepareField([
      { x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 },
      { x: 1, y: 1, z: 1, u: 1, v: 0, w: 0 },
    ]);
    const { calls } = paint(field);
    expect(calls.some((c) => c.op === "fill")).toBe(true);
    expect(calls.some((c) => c.op === "closePath")).toBe(true);
  });

  it("keeps the head the same size however long the shaft is", () => {
    /*
     * The head is drawn against the screen rather than modelled in the scene.
     * A cone in three dimensions is nearly invisible when it points at the
     * camera — which is exactly the direction the reader most needs to
     * identify, and the one where the shaft has no length to read either.
     */
    const short = prepareField([
      { x: 0, y: 0, z: 0, u: 0.2, v: 0, w: 0 },
      { x: 1, y: 0, z: 0, u: 1, v: 0, w: 0 },
    ]);
    const long = prepareField([
      { x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 },
      { x: 1, y: 0, z: 0, u: 1, v: 0, w: 0 },
    ]);
    const barbSpan = (field: Field) => {
      const { calls } = paint(field);
      // The two barbs of the first arrowhead: lineTo #2 and #3 (after the
      // shaft's own lineTo).
      const lines = calls.filter((c) => c.op === "lineTo");
      return Math.hypot(lines[2].args[0] - lines[1].args[0],
                        lines[2].args[1] - lines[1].args[1]);
    };
    expect(barbSpan(short)).toBeCloseTo(barbSpan(long), 6);
  });
});

describe("what is in front is drawn last", () => {
  it("draws the nearer arrow after the farther one", () => {
    /*
     * `depth` is larger when nearer, so the sort must ascend. Descending
     * draws near arrows first and lets far ones paint over them — the
     * flat-looking failure a spatial field exists to avoid.
     */
    const samples: Sample[] = [
      { x: 0, y: 0, z: -1, u: 1, v: 0, w: 0 },
      { x: 0, y: 0, z: 1, u: 1, v: 0, w: 0 },
    ];
    const field = prepareField(samples);
    /*
     * Nearest in *camera* space, not in the data's z. The default camera has a
     * yaw and a pitch, so which sample is in front is a question about the
     * projection rather than about the coordinate — an earlier version of this
     * test assumed the two agreed and failed on the difference.
     */
    const near = [...field.glyphs].sort(
      (a, b) => toCanvas(a, DEFAULT_CAMERA, 400, 300).depth
              - toCanvas(b, DEFAULT_CAMERA, 400, 300).depth).pop()!;
    const { calls } = paint(field);
    /*
     * Each arrow emits two `moveTo`s — one to start the shaft at the tail, one
     * to start the head at the tip — so the last arrow's *tail* is the
     * second-to-last of them. Taking the last picks up an arrowhead and
     * compares it against a tail position, which is a test failing for a
     * reason that has nothing to do with ordering.
     */
    const moves = calls.filter((c) => c.op === "moveTo");
    const nearScreen = toCanvas(near, DEFAULT_CAMERA, 400, 300);
    expect(moves[moves.length - 2].args[0]).toBeCloseTo(nearScreen.x, 6);
  });

  it("clears before drawing, so a rotation does not smear", () => {
    const { calls } = paint(prepareField(
      [{ x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 }]));
    expect(calls[0].op).toBe("clearRect");
  });

  it("does nothing at all without a canvas", () => {
    // The ref is null for the first frame after mount, every mount.
    expect(() => paintField(null, prepareField([]), DEFAULT_CAMERA, SIZE,
                            null, null)).not.toThrow();
  });

  it("draws nothing for an empty field", () => {
    const { calls } = paint(prepareField([]));
    expect(calls.filter((c) => c.op === "moveTo")).toHaveLength(0);
  });
});

describe("a vector with nowhere to point", () => {
  it("draws a still point as a dot rather than a stub", () => {
    /*
     * A stagnation point in a flow is a finding. A zero-length shaft with a
     * head on it would take its direction from whatever the arithmetic
     * happened to produce — pointing somewhere the data does not.
     */
    const field = prepareField([
      { x: 0, y: 0, z: 0, u: 0, v: 0, w: 0 },
      { x: 1, y: 1, z: 1, u: 5, v: 0, w: 0 },
    ]);
    const { calls } = paint(field);
    expect(calls.filter((c) => c.op === "arc")).toHaveLength(1);
  });

  it("draws an arrow pointing straight at the camera as a dot too", () => {
    /*
     * It projects to nothing, and no amount of drawing recovers what the
     * projection threw away — the honest response is a dot, and rotation,
     * rather than a head pointing in a direction invented by rounding.
     *
     * The samples sit *on the view axis*, which is the only place this is
     * true. Off-axis, perspective gives a vector pointing at the viewer real
     * projected length — the head is nearer the eye than the tail, so it moves
     * outward from the centre. A first version of this test put the samples at
     * a corner, measured that genuine length, and was wrong rather than the
     * renderer.
     */
    const onAxis: Sample[] = [
      { x: 0, y: 0, z: 0, u: 0, v: 0, w: 1 },
      { x: 0, y: 0, z: 1, u: 0, v: 0, w: 1 },
    ];
    // Looking down the z axis, so the vectors point at the viewer.
    const camera = { ...DEFAULT_CAMERA, yaw: 0, pitch: 0 };
    const r = recordingCanvas();
    paintField(r.canvas, prepareField(onAxis), camera, SIZE, null, null);
    expect(r.calls.some((c) => c.op === "arc")).toBe(true);
    expect(r.calls.some((c) => c.op === "lineTo")).toBe(false);
  });
});

describe("magnitude survives the clamp", () => {
  it("colours a larger vector differently from a smaller one", () => {
    const field = prepareField([
      { x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 },
      { x: 1, y: 0, z: 0, u: 9, v: 0, w: 0 },
    ]);
    const { calls } = paint(field);
    const strokes = new Set(calls.filter((c) => c.op === "stroke")
                                 .map((c) => c.stroke));
    expect(strokes.size).toBe(2);
  });

  it("darkens with magnitude along one hue, not a rainbow", () => {
    /*
     * A rainbow ramp has no perceptual order — readers disagree about whether
     * green is more or less than yellow — and it invents banding at the hue
     * boundaries that reads as structure in the field.
     */
    const channels = (level: number) =>
      magnitudeColour(level).match(/\d+/g)!.slice(0, 3).map(Number);
    const light = channels(0), dark = channels(1);
    for (let i = 0; i < 3; i += 1) expect(dark[i]).toBeLessThan(light[i]);
  });

  it("stays inside the ramp for a level outside 0..1", () => {
    // Cheaper than trusting every caller, and an out-of-range channel is a
    // colour the browser silently reinterprets rather than rejects.
    expect(magnitudeColour(-5)).toBe(magnitudeColour(0));
    expect(magnitudeColour(5)).toBe(magnitudeColour(1));
  });
});

describe("the controller the seam talks to", () => {
  const samples: Sample[] = [
    { x: 0, y: 0, z: 0, u: 1, v: 0, w: 0 },
    { x: 1, y: 0, z: 0, u: 0, v: 1, w: 0 },
    { x: 0, y: 1, z: 0, u: 0, v: 0, w: 1 },
  ];

  it("reports a view that changes when the camera does", () => {
    const ref = createRef<VisualizationController>();
    render(<Field3D samples={samples} controllerRef={ref} />);
    const before = ref.current!.viewState();
    ref.current!.rotate(40, 0);
    expect(ref.current!.viewState().yaw).not.toBeCloseTo(before.yaw, 6);
  });

  it("returns to a snapshot and refuses a partial one", () => {
    const ref = createRef<VisualizationController>();
    render(<Field3D samples={samples} controllerRef={ref} />);
    const home = ref.current!.viewState();
    ref.current!.rotate(50, 20);
    const moved = ref.current!.viewState();
    ref.current!.restoreViewState({ pitch: 0.9, zoom: 3 });
    ref.current!.restoreViewState({ yaw: 0.9, zoom: 3 });
    ref.current!.restoreViewState({ yaw: 0.9, pitch: 0.9 });
    expect(ref.current!.viewState()).toEqual(moved);
    ref.current!.restoreViewState(home);
    expect(ref.current!.viewState().yaw).toBeCloseTo(home.yaw, 6);
  });

  it("says how many vectors it drew and over what range", () => {
    const { container } = render(
      <Field3D samples={samples} caption="Wind, m/s." />);
    expect(container.textContent).toContain("Wind, m/s.");
    expect(container.textContent).toContain("3 vectors");
  });

  it("reports the magnitude of the arrow that was selected", () => {
    const ref = createRef<VisualizationController>();
    const { container } = render(
      <Field3D samples={samples} controllerRef={ref} />);
    act(() => { ref.current!.focus("0"); });
    expect(container.textContent).toContain("Selected: magnitude");
  });

  it("ignores a focus on something that is not one of its arrows", () => {
    /*
     * `Number("citation-4")` is NaN, and a NaN selection reads as "nothing"
     * everywhere except the one comparison that shows it — so the caption
     * would silently claim a selection that no arrow can be highlighted for.
     */
    const ref = createRef<VisualizationController>();
    const { container } = render(
      <Field3D samples={samples} controllerRef={ref} />);
    act(() => { ref.current!.focus("citation-4"); });
    act(() => { ref.current!.focus("99"); });
    expect(container.textContent).not.toContain("Selected");
  });

  it("drops a selection the field no longer has", () => {
    /*
     * The case the caption's own existence check carries: a selection held
     * while the samples change under it. The index survives the change and
     * points at an arrow that is no longer there, and reading through it
     * would report a magnitude belonging to nothing.
     */
    const ref = createRef<VisualizationController>();
    const { container, rerender } = render(
      <Field3D samples={samples} controllerRef={ref} />);
    act(() => { ref.current!.focus("2"); });
    expect(container.textContent).toContain("Selected: magnitude");

    rerender(<Field3D samples={[samples[0]]} controllerRef={ref} />);
    expect(container.textContent).not.toContain("Selected: magnitude");
  });

  it("tells the caller when nothing was under the point", () => {
    const onSelect = vi.fn();
    const ref = createRef<VisualizationController>();
    render(<Field3D samples={samples} controllerRef={ref} onSelect={onSelect} />);
    act(() => { ref.current!.select({ x: -900, y: -900 }); });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("finds an arrow where the projection puts its tail", () => {
    // Hit-testing and painting must use the same arithmetic, or the reader
    // points at a mark and is told they pointed at nothing.
    const ref = createRef<VisualizationController>();
    render(<Field3D samples={samples} controllerRef={ref} width={400}
                    height={300} />);
    let found = null;
    for (let x = 0; x <= 400 && !found; x += 4) {
      for (let y = 0; y <= 300 && !found; y += 4) {
        found = ref.current!.hover({ x, y });
      }
    }
    expect(found).not.toBeNull();
  });

  it("takes every arrow inside a lasso round the whole canvas, and none outside", () => {
    const ref = createRef<VisualizationController>();
    render(<Field3D samples={samples} controllerRef={ref} width={400}
                    height={300} />);
    expect(ref.current!.withinPolygon([
      { x: -1000, y: -1000 }, { x: 1000, y: -1000 },
      { x: 1000, y: 1000 }, { x: -1000, y: 1000 }])).toHaveLength(3);
    expect(ref.current!.withinPolygon([
      { x: -50, y: -50 }, { x: -10, y: -50 },
      { x: -10, y: -10 }, { x: -50, y: -10 }])).toEqual([]);
  });

  it("has no bounds before it is laid out", () => {
    const ref = createRef<VisualizationController>();
    render(<Field3D samples={samples} controllerRef={ref} />);
    expect(ref.current!.bounds()).toBeNull();
  });

  it("tells the reader when the selected arrow was shortened", () => {
    /*
     * The clamp is a loss, and a reader comparing two arrows of the same
     * length needs to know that one of them is not the length it earned.
     */
    const withOutlier: Sample[] = Array.from({ length: 40 }, (_, i) => ({
      x: i, y: 0, z: 0, u: 1, v: 0, w: 0 }));
    withOutlier.push({ x: 40, y: 0, z: 0, u: 500, v: 0, w: 0 });

    const field = prepareField(withOutlier);
    const index = field.glyphs.findIndex((g) => g.clamped);
    expect(index).toBeGreaterThanOrEqual(0);

    const ref = createRef<VisualizationController>();
    const { container } = render(
      <Field3D samples={withOutlier} controllerRef={ref} />);
    act(() => { ref.current!.focus(String(index)); });
    expect(container.textContent).toContain("read it by colour");
  });
});
