/**
 * Which figure the hand is talking to (§189, §224).
 *
 * This existed as a bug with no symptom. The session took one controller, so on
 * a page with two figures every gesture went to the first and the second was
 * simply dead to the hand — a researcher waving at it concludes the tracking is
 * broken. `/gesture-check` shipped that way, with a `surfaceRef` created, passed
 * to the chart, and never given to anything that produces gestures.
 */

import { describe, expect, it } from "vitest";
import { Rect, chooseTarget, pointerFor } from "@/lib/spatial/targeting";

function chart(name: string, rect: Rect | null) {
  return { name, bounds: () => rect };
}

const TOP = chart("top", { x: 100, y: 0, width: 400, height: 300 });
const BOTTOM = chart("bottom", { x: 100, y: 400, width: 400, height: 300 });

function choose(pointer: { x: number; y: number },
                options: Partial<{ engaged: boolean; heldTarget: typeof TOP | null }> = {}) {
  return chooseTarget([TOP, BOTTOM], pointer,
    { engaged: false, heldTarget: null, ...options });
}

describe("pointing chooses the figure under the hand", () => {
  it("reaches the second chart, which is the whole bug", () => {
    expect(choose({ x: 300, y: 500 }).target?.name).toBe("bottom");
  });

  it("reaches the first", () => {
    expect(choose({ x: 300, y: 150 }).target?.name).toBe("top");
  });

  it("addresses nothing when the hand is not over a figure", () => {
    /**
     * Deliberately not "the nearest chart". A hand resting beside the figures,
     * or moving while the researcher talks, would otherwise be quietly steering
     * whichever happened to be closest — which is Rule 2's failure and the
     * reason a gesture layer gets switched off for good.
     */
    expect(choose({ x: 300, y: 350 }).target).toBeNull();   // the gap between
    expect(choose({ x: 900, y: 150 }).target).toBeNull();   // beside them
  });

  it("includes the edges, so a mark at the border is reachable", () => {
    expect(choose({ x: 100, y: 0 }).target?.name).toBe("top");
    expect(choose({ x: 500, y: 300 }).target?.name).toBe("top");
  });

  it("ignores a figure that cannot be measured yet", () => {
    // Null rather than a zero rectangle: a zero rectangle is a real region that
    // nothing is inside, which makes a chart silently unreachable instead of
    // visibly unmounted.
    const unmounted = chart("unmounted", null);
    const choice = chooseTarget([unmounted, BOTTOM], { x: 300, y: 500 },
                                { engaged: false, heldTarget: null });
    expect(choice.target?.name).toBe("bottom");
  });

  it("picks the nearer centre when figures overlap", () => {
    const wide = chart("wide", { x: 0, y: 0, width: 1000, height: 700 });
    const small = chart("small", { x: 400, y: 300, width: 100, height: 100 });
    const choice = chooseTarget([wide, small], { x: 450, y: 350 },
                                { engaged: false, heldTarget: null });
    expect(choice.target?.name).toBe("small");
  });
});

describe("a gesture keeps the figure it started on (§189)", () => {
  it("holds the target while the hand is closed", () => {
    const choice = choose({ x: 300, y: 150 }, { engaged: true, heldTarget: BOTTOM });
    expect(choice.target?.name).toBe("bottom");
    expect(choice.locked).toBe(true);
  });

  it("holds it even when the hand leaves every figure", () => {
    /**
     * The case that matters. A drag that starts on a chart and travels off it is
     * still that chart's drag — otherwise the scene stops responding partway
     * through a movement, for no reason the person making it can see.
     */
    const choice = choose({ x: 900, y: 900 }, { engaged: true, heldTarget: TOP });
    expect(choice.target?.name).toBe("top");
  });

  it("does not hand the drag to whatever passes underneath", () => {
    // §189's own example: pinch chart A, move through chart B, still A.
    const choice = choose({ x: 300, y: 500 }, { engaged: true, heldTarget: TOP });
    expect(choice.target?.name).toBe("top");
  });

  it("chooses afresh once the hand opens", () => {
    const choice = choose({ x: 300, y: 500 }, { engaged: false, heldTarget: TOP });
    expect(choice.target?.name).toBe("bottom");
    expect(choice.locked).toBe(false);
  });

  it("lets go of a target that is no longer on the page", () => {
    // A chart unmounted mid-gesture must not keep receiving commands, and the
    // hand must not be stuck holding something that is gone.
    const choice = chooseTarget([BOTTOM], { x: 300, y: 500 },
                                { engaged: true, heldTarget: TOP });
    expect(choice.target?.name).toBe("bottom");
    expect(choice.locked).toBe(false);
  });
});

describe("where a hand points", () => {
  it("maps the camera's field to the whole window", () => {
    const at = pointerFor({ x: 0.5, y: 0.5 }, { width: 1000, height: 800 });
    expect(at.x).toBe(500);
    expect(at.y).toBe(400);
  });

  it("mirrors x, because a webcam image is a mirror", () => {
    /**
     * Identical to `SpatialMachine.toScreen`, deliberately. A hand that chose
     * one chart and hovered a mark on another would be two features
     * contradicting each other on the same screen.
     */
    const left = pointerFor({ x: 0.1, y: 0.5 }, { width: 1000, height: 800 });
    expect(left.x).toBe(900);
  });
});

describe("a figure that is not on screen is not addressed", () => {
  /**
   * A consequence of measuring in client coordinates, and the right one — but
   * worth pinning, because it is the kind of behaviour that looks like the bug
   * this module was written to fix.
   *
   * `bounds()` is viewport-relative, so a chart scrolled past has a negative
   * top and a chart below the fold has a top beyond the window. A hand's
   * normalised position only ever maps inside the window, so neither can be
   * pointed at. That is correct: you address what you can see, and a gesture
   * that steered a figure off the bottom of the page would be worse than one
   * that did nothing. Measured on the real page: with the saddle scrolled into
   * view, the cloud sits at y = -753 and is unreachable, and the saddle is.
   */
  const WINDOW = { width: 1000, height: 800 };

  function reachable(rect: Rect): boolean {
    const target = chart("t", rect);
    for (let ny = 0; ny <= 1; ny += 0.01) {
      const at = pointerFor({ x: 0.5, y: ny }, WINDOW);
      if (chooseTarget([target], at, { engaged: false, heldTarget: null }).target) {
        return true;
      }
    }
    return false;
  }

  it("cannot be reached once scrolled above the window", () => {
    expect(reachable({ x: 0, y: -900, width: 1000, height: 500 })).toBe(false);
  });

  it("cannot be reached while still below the fold", () => {
    expect(reachable({ x: 0, y: 1100, width: 1000, height: 500 })).toBe(false);
  });

  it("can be reached as soon as part of it is visible", () => {
    // Partially on screen is enough: the visible part is pointed at normally.
    expect(reachable({ x: 0, y: 600, width: 1000, height: 500 })).toBe(true);
    expect(reachable({ x: 0, y: -300, width: 1000, height: 500 })).toBe(true);
  });
});
