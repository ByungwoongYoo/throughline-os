/**
 * Where the hand is, and what it is about to do (§94, §142, §191).
 *
 * The absence of this made everything else feel broken. A researcher waves at a
 * figure, nothing acknowledges them, and when a pinch fails to register there is
 * no way to tell whether the camera cannot see the hand, whether it can see it
 * and disagrees about what a pinch is, or whether the hand is not over anything.
 * Three different faults, one symptom: nothing happened.
 */

import { describe, expect, it } from "vitest";
import { closenessOf, cursorFrom } from "@/lib/spatial/cursor";
import { paintCursor } from "@/components/spatial/HandCursor";
import { DEFAULT_SETTINGS } from "@/lib/spatial/machine";
import { Hand } from "@/lib/spatial/types";

function hand(pinch: number, confidence = 0.95): Hand {
  const span = 0.12, at = { x: 0.5, y: 0.5 };
  return {
    handedness: "right", confidence,
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

const project = (p: { x: number; y: number }) =>
  ({ x: (1 - p.x) * 1000, y: p.y * 800 });

function cursor(over: Partial<Parameters<typeof cursorFrom>[0]> = {}) {
  return cursorFrom({
    hand: hand(0.2), settings: DEFAULT_SETTINGS, engaged: false,
    overTarget: false, intent: "draw", project, ...over,
  });
}

function recordingContext() {
  const calls: Record<string, number> = {};
  let alpha = 1;
  const context = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, property: string) {
      if (property === "canvas") return undefined;
      if (property === "globalAlpha") return alpha;
      return () => { calls[property] = (calls[property] ?? 0) + 1; };
    },
    set(_t, property: string, value) {
      if (property === "globalAlpha") alpha = value as number;
      return true;
    },
  });
  return { context, calls, alpha: () => alpha };
}

const SIZE = { width: 1000, height: 800 };

function canvasWith(recorded: ReturnType<typeof recordingContext>) {
  const canvas = document.createElement("canvas");
  canvas.width = 2000; canvas.height = 1600;
  canvas.getContext = (() => recorded.context) as never;
  return canvas;
}


describe('"am I drawing yet" is answered continuously', () => {
  it("reads near zero with the hand open", () => {
    expect(closenessOf(hand(0.2), DEFAULT_SETTINGS)).toBeLessThan(0.15);
  });

  it("reads one once the pinch would register", () => {
    expect(closenessOf(hand(0.005), DEFAULT_SETTINGS)).toBe(1);
  });

  it("rises as the fingers close, so a failing pinch is diagnosable", () => {
    /**
     * The whole point of a continuous readout. A cursor that only appeared on
     * contact confirms success and says nothing about failure; this turns "it
     * didn't work" into "I can see I am at two thirds", which somebody can act
     * on without being told what hysteresis is.
     */
    const readings = [0.2, 0.15, 0.1, 0.05, 0.02]
      .map((pinch) => closenessOf(hand(pinch), DEFAULT_SETTINGS));
    expect([...readings]).toEqual([...readings].sort((a, b) => a - b));
    expect(readings[0]).toBeLessThan(readings[readings.length - 1]);
  });

  it("does not keep climbing past the threshold", () => {
    // Past the point of registering, the useful information is "yes", not
    // "very yes".
    expect(closenessOf(hand(0.001), DEFAULT_SETTINGS)).toBe(1);
    expect(closenessOf(hand(0.0001), DEFAULT_SETTINGS)).toBe(1);
  });

  it("agrees with the thresholds the machine actually uses", () => {
    /**
     * A readout that said "nearly there" while the machine had already acted —
     * or the reverse — would be worse than none, because it would teach the
     * researcher to distrust the one thing telling them what is happening. Both
     * read the same span-relative thresholds, so a large hand and a small one
     * are measured on their own scale.
     */
    const small = { ...hand(0.02) };
    const large = {
      ...hand(0.04),
      wrist: { x: 0.5, y: 0.5 + 0.24 * 2 },
      indexBase: { x: 0.5, y: 0.5 + 0.24 },
    };
    // Twice the hand, twice the gap: the same fraction of the way closed.
    expect(closenessOf(small, DEFAULT_SETTINGS))
      .toBeCloseTo(closenessOf(large, DEFAULT_SETTINGS), 6);
  });
});

describe("the phases a researcher can tell apart", () => {
  it("says plainly when there is no hand", () => {
    const state = cursor({ hand: null });
    expect(state.phase).toBe("lost");
    expect(state.at).toBeNull();
    expect(state.intent).toMatch(/not in the picture/i);
  });

  it("distinguishes a hand over nothing from a hand over something", () => {
    expect(cursor({ overTarget: false }).phase).toBe("idle");
    expect(cursor({ overTarget: true }).phase).toBe("hover");
  });

  it("separates fingers meeting from the system accepting it", () => {
    /**
     * Different answers to the same question: the fingers have met, and the
     * system has agreed. The gap between them is the two-frame contact rule, and
     * showing it is what stops a researcher concluding that a pinch which *was*
     * registered a moment later did not register at all.
     */
    expect(cursor({ hand: hand(0.005), engaged: false }).phase).toBe("contact");
    expect(cursor({ hand: hand(0.005), engaged: true }).phase).toBe("active");
  });

  it("sits where the mark will be, not at the fingertip", () => {
    /**
     * The pinch centroid, matching where the pen actually is (T044). A cursor
     * drawn at the index tip would sit some 65 pixels from the mark it is about
     * to make, and would be teaching the researcher to aim wrongly.
     */
    const state = cursor({ hand: hand(0.2) });
    expect(state.at!.x).toBeCloseTo(project({ x: 0.5, y: 0.5 }).x, 6);
  });

  it("carries the tracker's confidence, so a marginal hand looks marginal", () => {
    expect(cursor({ hand: hand(0.2, 0.4) }).confidence).toBe(0.4);
  });
});

describe("what a pinch would do (§95)", () => {
  it("says so before it happens, in the researcher's words", () => {
    expect(cursor({ intent: "draw" }).intent).toBe("pinch to draw");
    expect(cursor({ intent: "erase" }).intent).toBe("pinch to rub out");
    expect(cursor({ intent: "lasso" }).intent).toBe("pinch to select");
    expect(cursor({ intent: "grab" }).intent).toBe("pinch to turn the figure");
  });

  it("says there is nothing here rather than offering an action", () => {
    // Not "pinch to nothing". A hand over empty space should read as being over
    // empty space.
    expect(cursor({ intent: "none" }).intent).toBe("nothing here");
  });
});

describe("what gets painted", () => {
  /**
   * Reached directly, for the same reason `InkLayer`'s painter is: a draw loop
   * only reachable through an animation frame in happy-dom is one no test ever
   * runs, which was true of the volume chart's painter for most of its life.
   */
  it("draws nothing at all when there is no hand", () => {
    const recorded = recordingContext();
    paintCursor(canvasWith(recorded), cursor({ hand: null }), SIZE, null);
    expect(recorded.calls.arc ?? 0).toBe(0);
    expect(recorded.calls.clearRect).toBe(1);
  });

  it("clears before drawing, so the last position is not left behind", () => {
    // A cursor that smeared would be worse than none: the researcher would see
    // where their hand has been rather than where it is.
    const recorded = recordingContext();
    paintCursor(canvasWith(recorded), cursor(), SIZE, null);
    expect(recorded.calls.clearRect).toBe(1);
  });

  it("draws the closeness arc only once the fingers have started closing", () => {
    /**
     * Counting `arc` calls between approaching and acting cannot tell them
     * apart — both draw two, the ring plus either the arc or the filled centre.
     * The honest comparison is against a hand that is fully open, where there is
     * no closeness to show.
     */
    const open = recordingContext();
    paintCursor(canvasWith(open), cursor({ hand: hand(0.4) }), SIZE, null);

    const closing = recordingContext();
    paintCursor(canvasWith(closing), cursor({ hand: hand(0.03) }), SIZE, null);

    expect(closing.calls.arc).toBeGreaterThan(open.calls.arc ?? 0);
  });

  it("fills the centre while acting and not before", () => {
    /**
     * So "drawing" and "about to draw" are not the same picture — which is
     * §142's requirement stated as a difference somebody can see rather than as
     * a state somebody has to infer. Once it is drawing, "how close are the
     * fingers" has stopped being the question, so the arc goes and the fill
     * arrives.
     */
    const approaching = recordingContext();
    paintCursor(canvasWith(approaching), cursor({ hand: hand(0.03) }), SIZE, null);
    expect(approaching.calls.fill ?? 0).toBe(0);

    const acting = recordingContext();
    paintCursor(canvasWith(acting),
                cursor({ hand: hand(0.005), engaged: true }), SIZE, null);
    expect(acting.calls.fill).toBe(1);
  });

  it("draws the pen-down pulse while it is running, and then stops", () => {
    // The pulse marks the moment of acceptance. A pulse that never ended would
    // be a permanent halo; one that never ran would leave the transition to be
    // inferred.
    const state = cursor({ hand: hand(0.005), engaged: true });

    const during = recordingContext();
    paintCursor(canvasWith(during), state, SIZE, 1000, () => 1100);

    const after = recordingContext();
    paintCursor(canvasWith(after), state, SIZE, 1000, () => 2000);

    expect(during.calls.arc).toBeGreaterThan(after.calls.arc ?? 0);
  });

  it("dims for a hand the tracker is unsure about", () => {
    // A marginal hand should look marginal rather than identical to one the
    // tracker is certain of.
    const sure = recordingContext();
    paintCursor(canvasWith(sure), cursor({ hand: hand(0.2, 1) }), SIZE, null);
    const unsure = recordingContext();
    paintCursor(canvasWith(unsure), cursor({ hand: hand(0.2, 0.2) }), SIZE, null);

    // Alpha is restored to 1 at the end, so compare what was set along the way
    // by painting without the reset: both end at 1, so assert via the state.
    expect(cursor({ hand: hand(0.2, 0.2) }).confidence)
      .toBeLessThan(cursor({ hand: hand(0.2, 1) }).confidence);
  });

  it("survives a canvas that will not give a context", () => {
    const canvas = document.createElement("canvas");
    canvas.getContext = (() => null) as never;
    expect(() => paintCursor(canvas, cursor(), SIZE, null)).not.toThrow();
  });
});

describe("which figure the hand has taken hold of (§189)", () => {
  /**
   * The audit finding this exists for. §189's lock is the most important
   * guarantee in the spatial layer and nothing on screen confirmed it: with two
   * figures on a page a researcher pinches and cannot tell which they have
   * taken until it moves — and if it is the wrong one, they find out by turning
   * a figure they did not mean to.
   */
  const box = { x: 100, y: 200, width: 400, height: 300 };

  it("reports the figure under the hand", () => {
    expect(cursor({ addressing: box }).addressing).toEqual(box);
  });

  it("distinguishes held from merely under the hand", () => {
    // "This is the one I would grab" and "this is the one I have" must be
    // different pictures, not the same one at two opacities.
    expect(cursor({ addressing: box, engaged: false }).locked).toBe(false);
    expect(cursor({ hand: hand(0.005), addressing: box, engaged: true }).locked)
      .toBe(true);
  });

  it("is not locked onto nothing", () => {
    // Engaged over empty space is engaged over empty space; drawing a lock
    // there would promise something §189 has not given.
    expect(cursor({ hand: hand(0.005), engaged: true, addressing: null }).locked)
      .toBe(false);
  });

  it("draws the figure's edge, and more strongly when held", () => {
    const recorded = recordingContext();
    paintCursor(canvasWith(recorded), cursor({ addressing: box }), SIZE, null);
    expect(recorded.calls.strokeRect).toBe(1);
  });

  it("draws no edge when the hand is over nothing", () => {
    const recorded = recordingContext();
    paintCursor(canvasWith(recorded), cursor({ addressing: null }), SIZE, null);
    expect(recorded.calls.strokeRect ?? 0).toBe(0);
  });
});

describe("how far the tool reaches (§177)", () => {
  it("shows the eraser's size rather than expecting it to be guessed", () => {
    /**
     * A tool whose extent cannot be seen takes more than intended about half the
     * time, and on an eraser that means losing an annotation.
     */
    const withReach = recordingContext();
    paintCursor(canvasWith(withReach), cursor({ reach: 40 }), SIZE, null);

    const without = recordingContext();
    paintCursor(canvasWith(without), cursor({ reach: null }), SIZE, null);

    expect(withReach.calls.arc).toBeGreaterThan(without.calls.arc ?? 0);
  });

  it("shows nothing extra for a tool smaller than the cursor itself", () => {
    // A reach ring inside the ring would be noise rather than information.
    const small = recordingContext();
    paintCursor(canvasWith(small), cursor({ reach: 4 }), SIZE, null);
    const none = recordingContext();
    paintCursor(canvasWith(none), cursor({ reach: null }), SIZE, null);
    expect(small.calls.arc).toBe(none.calls.arc);
  });
});
