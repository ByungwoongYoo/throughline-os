/**
 * Drawing a mark, and where it appears (§143, imaging).
 *
 * The rules live in `highlight.ts` and are tested there against values. These
 * check the thing that actually reaches a doctor's eye: that the outline is
 * *painted* on the scans where it belongs and *not painted* on the ones where
 * it would assert a correspondence that does not exist — and that its absence
 * is stated rather than silent.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import {
  HighlightLayer, markFrom, paintMarks,
} from "@/components/imaging/HighlightLayer";
import { Highlight } from "@/lib/imaging/highlight";
import { ViewState } from "@/lib/spatial/commands";

type Call = { op: string; args: number[]; stroke: string; dash: number[] };

function recordingCanvas() {
  const calls: Call[] = [];
  const context: Record<string, unknown> & { strokeStyle: string } = {
    strokeStyle: "", fillStyle: "", lineWidth: 0, lineJoin: "", lineCap: "",
    font: "", textBaseline: "",
  };
  let dash: number[] = [];
  const note = (op: string) => (...args: unknown[]) => {
    calls.push({
      op, args: args.filter((a): a is number => typeof a === "number"),
      stroke: String(context.strokeStyle), dash: [...dash],
    });
  };
  Object.assign(context, {
    clearRect: note("clearRect"), save: note("save"), restore: note("restore"),
    beginPath: note("beginPath"), moveTo: note("moveTo"), lineTo: note("lineTo"),
    stroke: note("stroke"), fillText: note("fillText"),
    setLineDash: (d: number[]) => { dash = d; },
  });
  const canvas = {
    getContext: () => context, width: 200, height: 200,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const view: ViewState = { yaw: 0.6, pitch: 0.3, zoom: 1, level: 40, window: 80 };
const SIZE = { width: 200, height: 200 };

const mark = (over: Partial<Highlight> = {}): Highlight => ({
  id: "m1", on: "case", note: "lesion", by: "Dr Chen", at: 1,
  points: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 30 }],
  view, ...over,
});

describe("what gets painted", () => {
  it("draws a mark that belongs here", () => {
    const { canvas, calls } = recordingCanvas();
    paintMarks(canvas, [{ mark: mark(), how: "drawn" }], [], SIZE);
    expect(calls.filter((c) => c.op === "lineTo").length).toBe(2);
    expect(calls.some((c) => c.op === "stroke")).toBe(true);
  });

  it("draws an echoed mark more faintly than the one it came from", () => {
    /*
     * The echo is the same region and not the same evidence: it was read on the
     * case, and it is being shown here because the two may be compared. A
     * reader should be able to tell which scan the judgement was made on.
     */
    const drawn = recordingCanvas();
    paintMarks(drawn.canvas, [{ mark: mark(), how: "drawn" }], [], SIZE);
    const echoed = recordingCanvas();
    paintMarks(echoed.canvas, [{ mark: mark(), how: "echoed" }], [], SIZE);

    const toneOf = (r: ReturnType<typeof recordingCanvas>) =>
      r.calls.find((c) => c.op === "stroke")!.stroke;
    expect(toneOf(drawn)).not.toBe(toneOf(echoed));
  });

  it("dashes a stale mark rather than drawing it as though it still fits", () => {
    /*
     * It stays on screen because removing it would lose the researcher's work,
     * but the view has moved and it no longer corresponds to anything — and a
     * solid outline in the wrong place is worse than none.
     */
    const { canvas, calls } = recordingCanvas();
    paintMarks(canvas, [{ mark: mark(), how: "stale" }], [], SIZE);
    const stroked = calls.find((c) => c.op === "stroke")!;
    expect(stroked.dash.length).toBeGreaterThan(0);
  });

  it("never paints a withheld mark", () => {
    /*
     * The central refusal, at the point where it would actually mislead: the
     * outline itself. Drawing it on a scan that cannot be compared invites the
     * reader to conclude the same place was examined and found different.
     */
    const { canvas, calls } = recordingCanvas();
    paintMarks(canvas, [{ mark: mark(), how: "withheld" }], [], SIZE);
    expect(calls.filter((c) => c.op === "lineTo")).toHaveLength(0);
    expect(calls.filter((c) => c.op === "stroke")).toHaveLength(0);
  });

  it("labels a mark with the researcher's own words", () => {
    const { canvas, calls } = recordingCanvas();
    paintMarks(canvas, [{ mark: mark({ note: "rim enhancement" }), how: "drawn" }],
               [], SIZE);
    expect(calls.some((c) => c.op === "fillText")).toBe(true);
  });

  it("draws no label when the researcher wrote none", () => {
    // Rather than inventing one: nothing here is entitled to name a finding.
    const { canvas, calls } = recordingCanvas();
    paintMarks(canvas, [{ mark: mark({ note: "" }), how: "drawn" }], [], SIZE);
    expect(calls.some((c) => c.op === "fillText")).toBe(false);
  });

  it("clears before drawing", () => {
    const { canvas, calls } = recordingCanvas();
    paintMarks(canvas, [{ mark: mark(), how: "drawn" }], [], SIZE);
    expect(calls[0].op).toBe("clearRect");
  });

  it("draws the stroke in progress", () => {
    const { canvas, calls } = recordingCanvas();
    paintMarks(canvas, [], [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 9, y: 2 }], SIZE);
    expect(calls.filter((c) => c.op === "lineTo").length).toBe(2);
  });

  it("does nothing at all without a canvas", () => {
    expect(() => paintMarks(null, [{ mark: mark(), how: "drawn" }], [], SIZE))
      .not.toThrow();
  });
});

describe("the layer over a scan", () => {
  it("states that a mark is withheld, rather than saying nothing", () => {
    /*
     * Silence would read as "nothing was marked" — a different claim, and a
     * false one. The count and the reason are both shown.
     */
    const { container } = render(
      <HighlightLayer scanId="other" verdict="NOT_MEANINGFULLY_COMPARABLE"
                      view={view} marks={[mark()]} width={200} height={200} />);
    expect(container.textContent).toContain("1 mark not shown here");
    expect(container.textContent).toContain("cannot be compared with the case");
  });

  it("says nothing when there is nothing to withhold", () => {
    const { container } = render(
      <HighlightLayer scanId="other" verdict="DIRECTLY_COMPARABLE"
                      view={view} marks={[mark()]} width={200} height={200} />);
    expect(container.textContent).not.toContain("not shown here");
  });

  it("only takes a stroke where drawing is allowed", () => {
    /*
     * Marking a comparison scan directly would produce two sets of marks that
     * look alike and mean different things — one a reading of the case, one an
     * annotation of something being compared with it.
     */
    const onDrawn = vi.fn();
    const { getByTestId } = render(
      <HighlightLayer scanId="other" verdict="DIRECTLY_COMPARABLE" view={view}
                      marks={[]} width={200} height={200} onDrawn={onDrawn} />);
    const layer = getByTestId("highlight-other");
    fireEvent.pointerDown(layer, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(layer, { clientX: 40, clientY: 40 });
    fireEvent.pointerMove(layer, { clientX: 60, clientY: 20 });
    fireEvent.pointerUp(layer);
    expect(onDrawn).not.toHaveBeenCalled();
  });

  it("emits a stroke drawn on the case", () => {
    const onDrawn = vi.fn();
    const { getByTestId } = render(
      <HighlightLayer scanId="case" verdict={null} view={view} marks={[]}
                      width={200} height={200} drawable onDrawn={onDrawn} />);
    const layer = getByTestId("highlight-case");
    fireEvent.pointerDown(layer, { clientX: 10, clientY: 10 });
    for (const [x, y] of [[30, 10], [30, 30], [10, 30]]) {
      fireEvent.pointerMove(layer, { clientX: x, clientY: y });
    }
    fireEvent.pointerUp(layer);
    expect(onDrawn).toHaveBeenCalledTimes(1);
    expect(onDrawn.mock.calls[0][0].length).toBeGreaterThanOrEqual(3);
  });

  it("ignores a tap", () => {
    /*
     * Two points are a tap, not a region. Emitting one would leave a mark
     * somewhere the researcher did not mean to put one — and marks are shown to
     * other people.
     */
    const onDrawn = vi.fn();
    const { getByTestId } = render(
      <HighlightLayer scanId="case" verdict={null} view={view} marks={[]}
                      width={200} height={200} drawable onDrawn={onDrawn} />);
    const layer = getByTestId("highlight-case");
    fireEvent.pointerDown(layer, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(layer);
    expect(onDrawn).not.toHaveBeenCalled();
  });
});

describe("a mark made from a stroke", () => {
  it("records who made it, when, and at what view", () => {
    /*
     * All three are needed before it is shown to anybody: an unattributed
     * outline on a projected scan reads as the system's judgement rather than
     * a colleague's.
     */
    const made = markFrom("case", [{ x: 1, y: 1 }, { x: 2, y: 2 }], view,
                          "Dr Chen", "lesion");
    expect(made.by).toBe("Dr Chen");
    expect(made.on).toBe("case");
    expect(made.view).toEqual(view);
    expect(made.note).toBe("lesion");
    expect(made.at).toBeGreaterThan(0);
  });

  it("gives each mark its own identity", () => {
    const a = markFrom("case", [], view, "x", "");
    const b = markFrom("case", [], view, "x", "");
    expect(a.id).not.toBe(b.id);
  });
});
