/**
 * Taking things back (§42, §179).
 *
 * The specification calls undo mandatory and says why: spatial interaction
 * raises the rate at which somebody does something they did not mean. A pinch is
 * a decision made by a hand that is also being used to gesture while talking,
 * with a camera guessing at the boundary. The remedy is that everything can be
 * undone, not that nothing is ever misrecognised.
 *
 * These tests are mostly about *Clear*, because that is the one action here that
 * destroyed work permanently.
 */

import { describe, expect, it } from "vitest";
import { InkHistory, applyOperation } from "@/lib/ink/history";
import { InkRecorder } from "@/lib/ink/recorder";
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

/** An armed recorder, and a way to put marks on it. */
function armed() {
  const recorder = new InkRecorder({ now: () => 1 });
  recorder.setViewport({ width: 720, height: 520 });
  recorder.arm();
  let clock = 1000;
  const draw = (y: number) => {
    const steps = [
      { at: { x: 0.30, y }, pinch: OPEN },
      ...Array.from({ length: 8 }, (_, i) => ({ at: { x: 0.30 + i * 0.01, y },
                                                pinch: PINCHED })),
      { at: { x: 0.38, y }, pinch: OPEN },
    ];
    for (const step of steps) {
      recorder.step({ timestamp: clock, hands: [hand(step.at, step.pinch)] } as HandFrame);
      clock += 33;
    }
    clock += 500;
  };
  return { recorder, draw };
}

describe("clearing the canvas is recoverable", () => {
  it("gives back every stroke", () => {
    /**
     * The reason this exists. Forty marks made over twenty minutes, gone to one
     * misplaced press, with the interface offering nothing.
     */
    const { recorder, draw } = armed();
    draw(0.4); draw(0.5); draw(0.6);
    expect(recorder.strokes()).toHaveLength(3);

    recorder.clear();
    expect(recorder.strokes()).toHaveLength(0);

    expect(recorder.undo()).toBe(true);
    expect(recorder.strokes()).toHaveLength(3);
  });

  it("gives back the same strokes, not rebuilt ones", () => {
    /**
     * A history that re-derives what it discarded will eventually re-derive it
     * slightly differently, and the researcher gets back something that
     * *resembles* their annotation — which is worse than losing it, because they
     * will not notice.
     */
    const { recorder, draw } = armed();
    draw(0.4); draw(0.5);
    const before = recorder.strokes();
    const ids = before.map((s) => s.id);
    const points = before[0].originalPoints.length;

    recorder.clear();
    recorder.undo();

    const after = recorder.strokes();
    expect(after.map((s) => s.id)).toEqual(ids);
    expect(after[0].originalPoints).toHaveLength(points);
    // The same objects, by identity.
    expect(after[0]).toBe(before[0]);
  });

  it("keeps the order they were drawn in", () => {
    // A restored stroke on top would paint over marks that were above it.
    const { recorder, draw } = armed();
    draw(0.3); draw(0.5); draw(0.7);
    const ids = recorder.strokes().map((s) => s.id);

    recorder.clear();
    recorder.undo();

    expect(recorder.strokes().map((s) => s.id)).toEqual(ids);
  });

  it("can be redone, so undo is not a one-way door either", () => {
    const { recorder, draw } = armed();
    draw(0.4); draw(0.5);
    recorder.clear();
    recorder.undo();
    expect(recorder.strokes()).toHaveLength(2);

    expect(recorder.redo()).toBe(true);
    expect(recorder.strokes()).toHaveLength(0);
  });

  it("records nothing when there was nothing to clear", () => {
    // An empty clear in the history would make undo appear to do nothing, which
    // reads as broken rather than as a no-op.
    const { recorder } = armed();
    recorder.clear();
    expect(recorder.canUndo()).toBe(false);
  });
});

describe("a stroke can be taken back", () => {
  it("removes the most recent mark and can restore it", () => {
    const { recorder, draw } = armed();
    draw(0.4); draw(0.6);

    expect(recorder.undo()).toBe(true);
    expect(recorder.strokes()).toHaveLength(1);
    expect(recorder.redo()).toBe(true);
    expect(recorder.strokes()).toHaveLength(2);
  });

  it("does not record a pinch that never became a mark", () => {
    /**
     * A pinch shorter than the contact rule is not something the researcher
     * did. Putting it in the history would mean the first press of undo appears
     * to do nothing, and the actual mistake needs two presses.
     */
    const { recorder } = armed();
    [OPEN, PINCHED, OPEN].forEach((pinch, i) => recorder.step({
      timestamp: 1000 + i * 33, hands: [hand({ x: 0.5, y: 0.5 }, pinch)],
    } as HandFrame));

    expect(recorder.canUndo()).toBe(false);
  });

  it("says nothing to undo when nothing has happened", () => {
    const { recorder } = armed();
    expect(recorder.undo()).toBe(false);
    expect(recorder.redo()).toBe(false);
    expect(recorder.describeUndo()).toBeNull();
  });
});

describe("the history says what it is about to do", () => {
  it("counts the strokes a clear would restore", () => {
    // "Undo clear" is not a decision anybody can make. "Undo clearing 12
    // strokes" is.
    const { recorder, draw } = armed();
    draw(0.4); draw(0.5); draw(0.6);
    recorder.clear();

    expect(recorder.describeUndo()).toBe("Undo clearing 3 strokes");
  });

  it("uses the singular for one", () => {
    const { recorder, draw } = armed();
    draw(0.4);
    recorder.clear();
    expect(recorder.describeUndo()).toBe("Undo clearing 1 stroke");
  });

  it("names a stroke as a stroke", () => {
    const { recorder, draw } = armed();
    draw(0.4);
    expect(recorder.describeUndo()).toBe("Undo drawing a stroke");
  });
});

describe("the stack behaves the way people expect", () => {
  function stroke(id: string): SpatialStroke {
    return {
      id, tool: "pen", space: "screen",
      style: { colour: "#000", width: 2, opacity: 1 },
      originalPoints: [], points: [], createdAt: 0, createdBy: "test",
    };
  }

  it("drops the redo stack once something new happens", () => {
    /**
     * Conventional, and right for a specific reason: once a new mark exists,
     * the undone operations describe a canvas that no longer exists, and
     * replaying them would put strokes back at indices that now mean something
     * else.
     */
    const history = new InkHistory();
    history.did({ kind: "draw", stroke: stroke("a") });
    history.undo();
    expect(history.canRedo()).toBe(true);

    history.did({ kind: "draw", stroke: stroke("b") });
    expect(history.canRedo()).toBe(false);
  });

  it("forgets the oldest operations rather than growing without limit", () => {
    // The strokes themselves are held, so an unbounded history keeps every mark
    // ever drawn alive — including the ones cleared an hour ago.
    const history = new InkHistory({ depth: 3 });
    for (const id of ["a", "b", "c", "d"]) {
      history.did({ kind: "draw", stroke: stroke(id) });
    }
    let undone = 0;
    while (history.undo()) undone += 1;
    expect(undone).toBe(3);
  });

  it("restores an erased stroke to where it was, not to the end", () => {
    const strokes = [stroke("a"), stroke("b"), stroke("c")];
    const removed = applyOperation(strokes,
      { kind: "erase", stroke: strokes[1], index: 1 }, "do");
    expect(removed.map((s) => s.id)).toEqual(["a", "c"]);

    const restored = applyOperation(removed,
      { kind: "erase", stroke: strokes[1], index: 1 }, "undo");
    expect(restored.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});
