/**
 * Cards line up, and the threshold is a property of the hand.
 *
 * §54 asks for alignment guides and magnetic snapping, and had neither — the
 * row was recorded as built on the strength of the resizable shell panels,
 * which are a different thing (D183). A board a researcher had tidied drifted
 * a pixel out of line on every touch.
 *
 * The tests that matter here are the two that are easy to get wrong in a way
 * that still looks like it works: the threshold must be in screen pixels
 * rather than world units, and the *nearest* candidate must win rather than
 * the first one in the array.
 */

import { describe, expect, it } from "vitest";
import { SNAP_PIXELS, snap, type Rect } from "@/lib/board/snapping";

const card = (x: number, y: number, width = 100, height = 60): Rect =>
  ({ x, y, width, height });

describe("a card is pulled into line with its neighbours", () => {
  it("snaps a near-miss left edge onto the one beside it", () => {
    const moved = snap(card(203, 400), [card(200, 100)], 1);
    expect(moved.x).toBe(200);
    expect(moved.guides.some((g) => g.axis === "x" && g.at === 200)).toBe(true);
  });

  it("leaves a card alone when nothing is close", () => {
    const moved = snap(card(500, 400), [card(200, 100)], 1);
    expect(moved).toMatchObject({ x: 500, y: 400 });
    expect(moved.guides).toEqual([]);
  });

  it("aligns centres, not only edges", () => {
    /** Two cards of different widths line up on their middles, which is what
     *  a person means by "centre these". */
    const other = card(200, 100, 200);            // centre at 300
    const moving = card(248, 400, 100);           // centre at 298
    expect(snap(moving, [other], 1).x).toBe(250); // centre pulled to 300
  });

  it("snaps both axes independently, to different neighbours", () => {
    /** A card can take its column from one neighbour and its row from
     *  another, which is how a grid gets built. */
    const moved = snap(card(203, 502), [card(200, 100), card(700, 500)], 1);
    expect(moved.x).toBe(200);
    expect(moved.y).toBe(500);
    expect(moved.guides).toHaveLength(2);
  });
});

describe("the threshold belongs to the hand, not to the data", () => {
  it("is harder to reach in world units when zoomed in", () => {
    /**
     * The subtlety this whole file exists for. A card's coordinates are in
     * world space and the board has a zoom, so a fixed world threshold feels
     * sticky zoomed out and dead zoomed in. At 4x, eight screen pixels are
     * two world units — so a three-unit gap is *outside* the threshold.
     */
    const gap = card(203, 400);
    expect(snap(gap, [card(200, 100)], 1).x).toBe(200);   // 3 units < 8px @1x
    expect(snap(gap, [card(200, 100)], 4).x).toBe(203);   // 3 units > 2px @4x
  });

  it("is easier to reach in world units when zoomed out", () => {
    const far = card(212, 400);
    expect(snap(far, [card(200, 100)], 1).x).toBe(212);    // 12 > 8
    expect(snap(far, [card(200, 100)], 0.5).x).toBe(200);  // 12 < 16
  });

  it("does not divide by a zoom of zero", () => {
    /** A zoom of zero is not a view anybody is looking through, and NaN here
     *  would move the card to nowhere and save it there. */
    const moved = snap(card(203, 400), [card(200, 100)], 0);
    expect(Number.isFinite(moved.x)).toBe(true);
    expect(Number.isFinite(moved.y)).toBe(true);
  });
});

describe("the nearest candidate wins", () => {
  it("prefers the closer neighbour over the first one listed", () => {
    /**
     * Taking the first match makes the result depend on the order cards happen
     * to be stored in — the same class of defect as a chart that draws in
     * insertion order and calls the result depth.
     */
    const near = card(202, 100);
    const far = card(198, 700);
    const forwards = snap(card(203, 400), [far, near], 1).x;
    const backwards = snap(card(203, 400), [near, far], 1).x;

    expect(forwards).toBe(202);
    expect(backwards).toBe(202);
  });
});

describe("the ordinary empty cases", () => {
  it("snaps to nothing on a board with one card", () => {
    const moved = snap(card(203, 400), [], 1);
    expect(moved).toMatchObject({ x: 203, y: 400, guides: [] });
  });

  it("draws a guide spanning both cards rather than the whole board", () => {
    /** A full-height line says "something up there is aligned". A line between
     *  the two says which, which is the question a person has. */
    const guide = snap(card(203, 400), [card(200, 100)], 1)
      .guides.find((g) => g.axis === "x")!;

    expect(guide.from).toBe(100);          // top of the neighbour
    expect(guide.to).toBe(460);            // bottom of the dragged card
  });

  it("keeps the threshold a stated number rather than a literal", () => {
    expect(SNAP_PIXELS).toBeGreaterThan(2);
    expect(SNAP_PIXELS).toBeLessThan(20);
  });
});
