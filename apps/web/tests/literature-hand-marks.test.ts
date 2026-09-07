/**
 * A stroke drawn in the air, landing on a page (§143, §204).
 *
 * This is the seam where §143's screen-space ink becomes §204's document
 * coordinates, and it is the piece most able to be wrong invisibly: a hand mark
 * that lands slightly off looks exactly like imprecise tracking, so it would be
 * blamed on the camera and tuned around rather than fixed.
 *
 * So the central test is the one §204 states — a stroke drawn at one zoom
 * produces the same page coordinates as the same gesture drawn at another. If
 * that holds, the hand and the pointer are writing the same thing down.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OVERSHOOT, canvasMapping, markFromStroke, markUnder,
} from "@/lib/literature/handMarks";
import type { SpatialStroke, StrokePoint } from "@/lib/ink/stroke";
import type { Mark } from "@/lib/literature/excerpt";

const GEOMETRY = { width: 612, height: 792, rotation: 0 as const, scale: 1 };

function point(x: number, y: number): StrokePoint {
  return { x, y, timestamp: 0, confidence: 0.9 };
}

function stroke(overrides: Partial<SpatialStroke> = {}): SpatialStroke {
  const points = [point(100, 200), point(200, 200), point(300, 200)];
  return {
    id: "stroke-1", tool: "pen", space: "screen", layerId: "researcher",
    style: {} as SpatialStroke["style"],
    originalPoints: points, points,
    ...overrides,
  } as SpatialStroke;
}

/** The identity mapping: the canvas sits at the origin, unscaled. */
const identity = canvasMapping({
  rect: { left: 0, top: 0, width: 612, height: 792 },
  width: 612, height: 792,
});

const options = {
  geometry: GEOMETRY, page: 1, kind: "underline" as const,
  toCanvas: identity, at: 1_000,
};

describe("a hand stroke becomes a mark on the page", () => {
  it("records document coordinates, not pixels", () => {
    const mark = markFromStroke(stroke(), options);
    expect(mark).not.toBeNull();
    // y is flipped, because PDF counts upward from the bottom of the page.
    expect(mark!.points[0]).toEqual({ x: 100, y: 592 });
    expect(mark!.kind).toBe("underline");
    expect(mark!.page).toBe(1);
  });

  it("keeps the stroke's own id", () => {
    /*
     * So the mark and the untouched original remain one gesture rather than two
     * records of it. §174 requires what the hand did to survive unrewritten,
     * and the ink layer still holds `originalPoints` under this id.
     */
    expect(markFromStroke(stroke(), options)!.id).toBe("stroke-1");
  });

  it("lands in the same place whatever the zoom was", () => {
    /*
     * §204, applied to the hand. The same gesture over the same part of the
     * paper must record the same document coordinates at 100% and at 200% —
     * otherwise a mark made while zoomed in would sit somewhere else when the
     * researcher zoomed back out, and it would look like tracking drift.
     */
    const atOne = markFromStroke(stroke(), options);

    // The same gesture at 200%: the page is twice as large on screen, so the
    // hand travels twice as far across the same words.
    const doubled = [point(200, 400), point(400, 400), point(600, 400)];
    const atTwo = markFromStroke(
      stroke({ points: doubled, originalPoints: doubled }),
      { ...options,
        geometry: { ...GEOMETRY, scale: 2 },
        toCanvas: canvasMapping({
          rect: { left: 0, top: 0, width: 1224, height: 1584 },
          width: 1224, height: 1584 }) });

    expect(atTwo!.points[0].x).toBeCloseTo(atOne!.points[0].x, 6);
    expect(atTwo!.points[0].y).toBeCloseTo(atOne!.points[0].y, 6);
  });

  it("uses the smoothed points rather than the raw ones", () => {
    // A tremor faithfully reproduced is a worse underline than a steady one,
    // and the record of what the hand actually did lives on the stroke.
    const raw = [point(100, 205), point(200, 195), point(300, 203)];
    const smooth = [point(100, 200), point(200, 200), point(300, 200)];
    const mark = markFromStroke(
      stroke({ originalPoints: raw, points: smooth }), options);
    expect(mark!.points.map((p) => p.y)).toEqual([592, 592, 592]);
  });

  it("falls back to the raw points when nothing was smoothed", () => {
    const raw = [point(100, 200), point(300, 200)];
    const mark = markFromStroke(
      stroke({ originalPoints: raw, points: [] }), options);
    expect(mark!.points).toHaveLength(2);
  });
});

describe("strokes that are not marks", () => {
  it("ignores an eraser pass", () => {
    /*
     * The dangerous one, and a mistake this codebase has already made: a wipe
     * recorded as something drawn produced a reference to a region the
     * researcher never indicated.
     */
    expect(markFromStroke(stroke({ tool: "eraser" }), options)).toBeNull();
  });

  it("ignores a lasso", () => {
    expect(markFromStroke(stroke({ tool: "lasso" }), options)).toBeNull();
  });

  it("ignores ink drawn in another space", () => {
    // Ink attached to a chart is not an annotation on this page, however much
    // it overlaps on screen.
    expect(markFromStroke(stroke({ space: "object" }), options)).toBeNull();
  });

  it("ignores a tap", () => {
    const tap = [point(100, 200)];
    expect(markFromStroke(stroke({ points: tap, originalPoints: tap }), options))
      .toBeNull();
  });

  it("but a note is a single point by definition", () => {
    const tap = [point(100, 200)];
    const mark = markFromStroke(
      stroke({ points: tap, originalPoints: tap }),
      { ...options, kind: "note" });
    expect(mark!.points).toHaveLength(1);
  });
});

describe("strokes that miss the paper", () => {
  it("is nothing when the whole stroke was over the surround", () => {
    /*
     * Null rather than an empty mark: a mark with no points draws nothing while
     * appearing in the page's list, so it reads as an annotation that failed to
     * render and somebody goes looking for a rendering bug.
     */
    const away = [point(-400, 200), point(-300, 200), point(-350, 210)];
    expect(markFromStroke(stroke({ points: away, originalPoints: away }), options))
      .toBeNull();
  });

  it("forgives an overshoot past the end of a line", () => {
    // A hand running past the end of an underline is the ordinary case, not an
    // error — refusing it would make the commonest mark the one that fails.
    const over = [point(600, 200), point(612 + OVERSHOOT - 2, 200)];
    const mark = markFromStroke(
      stroke({ points: over, originalPoints: over }), options);
    expect(mark!.points).toHaveLength(2);
  });

  it("drops the part that left the page rather than dragging it to the edge", () => {
    /*
     * Clipped, not clamped. A point pulled onto the margin would claim the
     * researcher pointed somewhere they did not, and a stroke that wandered off
     * the paper and back should keep the gap rather than acquire a straight run
     * along the edge.
     */
    const wandering = [point(100, 200), point(-500, 200), point(300, 200)];
    const mark = markFromStroke(
      stroke({ points: wandering, originalPoints: wandering }), options);
    expect(mark!.points).toHaveLength(2);
    expect(mark!.points.every((p) => p.x >= 0)).toBe(true);
  });

  it("ignores points that are not numbers", () => {
    // A NaN reaches the canvas as a break in the path and the store as a record
    // that can never be drawn again.
    const bad = [point(100, 200), point(NaN, 200), point(300, 200)];
    const mark = markFromStroke(
      stroke({ points: bad, originalPoints: bad }), options);
    expect(mark!.points).toHaveLength(2);
  });
});

describe("mapping the viewport onto a canvas", () => {
  it("accounts for a canvas laid out smaller than its pixels", () => {
    /*
     * A page rendered at 200% inside a window too small for it. Using the CSS
     * size where the backing size belongs puts every mark at a constant
     * fraction of where it should be — which looks like a calibration problem
     * rather than a units problem, and gets tuned instead of fixed.
     */
    const map = canvasMapping({
      rect: { left: 50, top: 20, width: 600, height: 800 },
      width: 1200, height: 1600,
    });
    expect(map({ x: 350, y: 420 })).toEqual({ x: 600, y: 800 });
  });

  it("subtracts where the canvas sits on the page", () => {
    const map = canvasMapping({
      rect: { left: 100, top: 40, width: 612, height: 792 },
      width: 612, height: 792,
    });
    expect(map({ x: 100, y: 40 })).toEqual({ x: 0, y: 0 });
  });

  it("does not divide by a canvas with no size", () => {
    // A canvas measured before layout reports zero, and an Infinity here would
    // put every mark nowhere.
    const map = canvasMapping({
      rect: { left: 0, top: 0, width: 0, height: 0 }, width: 612, height: 792,
    });
    const mapped = map({ x: 10, y: 10 });
    expect(Number.isFinite(mapped.x)).toBe(true);
    expect(Number.isFinite(mapped.y)).toBe(true);
  });
});

describe("finding the mark under a point (§176)", () => {
  const mark = (over: Partial<Mark> = {}): Mark => ({
    id: "m", kind: "underline", page: 1,
    points: [{ x: 100, y: 400 }, { x: 400, y: 400 }], at: 1, ...over,
  });

  it("finds a long stroke by its middle, not only its ends", () => {
    /*
     * The reason this measures to the path rather than to the samples. A
     * straight underline is recorded as two points a long way apart, so
     * measuring to the nearest sample makes the middle of the line unerasable
     * while both ends work — and the researcher concludes the eraser is
     * unreliable, which is a worse belief than "it does not work".
     */
    const found = markUnder({ x: 250, y: 402 }, [mark()],
                            { page: 1, within: 10 });
    expect(found?.id).toBe("m");
  });

  it("does not find a mark the point is nowhere near", () => {
    expect(markUnder({ x: 250, y: 600 }, [mark()], { page: 1, within: 10 }))
      .toBeNull();
  });

  it("does not reach past the end of a short stroke", () => {
    /*
     * Clamped to the segment rather than the infinite line through it.
     * Otherwise pointing well beyond the end of an underline would erase it,
     * which is the eraser taking something the researcher was not pointing at.
     */
    const short = mark({ points: [{ x: 100, y: 400 }, { x: 140, y: 400 }] });
    expect(markUnder({ x: 400, y: 400 }, [short], { page: 1, within: 10 }))
      .toBeNull();
  });

  it("finds a note, which is a single point", () => {
    const note = mark({ id: "n", kind: "note", points: [{ x: 500, y: 700 }] });
    expect(markUnder({ x: 503, y: 702 }, [note], { page: 1, within: 10 })?.id)
      .toBe("n");
  });

  it("ignores marks on other pages", () => {
    // A mark at the same coordinates on page 2 is not under the pointer on
    // page 1, however identical its position.
    expect(markUnder({ x: 250, y: 400 }, [mark({ page: 2 })],
                     { page: 1, within: 10 })).toBeNull();
  });

  it("takes the one on top where two overlap", () => {
    /*
     * The later mark is the one drawn on top and the one the researcher can
     * see. Removing the one underneath would take something invisible at the
     * place they pointed.
     */
    const under = mark({ id: "under", at: 1 });
    const over = mark({ id: "over", at: 2 });
    expect(markUnder({ x: 250, y: 400 }, [under, over],
                     { page: 1, within: 10 })?.id).toBe("over");
  });

  it("survives a stroke that paused in one place", () => {
    // A repeated point makes a zero-length segment; dividing by its length
    // would give NaN, and a NaN distance fails every comparison — so the mark
    // would become silently unerasable rather than obviously broken.
    const paused = mark({ points: [{ x: 100, y: 400 }, { x: 100, y: 400 }] });
    expect(markUnder({ x: 101, y: 401 }, [paused], { page: 1, within: 10 })?.id)
      .toBe("m");
  });

  it("has nothing to find among no marks", () => {
    expect(markUnder({ x: 0, y: 0 }, [], { page: 1, within: 10 })).toBeNull();
  });
});

describe("marks that could not be loaded", () => {
  /*
   * An empty overlay is exactly what a paper with no marks on it looks like,
   * so a failed load told the researcher their earlier annotations were not
   * there. Two concrete hazards follow: the same marks get drawn again, and
   * rubbing out cannot reach an existing mark, because `marks` no longer
   * holds it to be found.
   *
   * Read from the source rather than from a render, which is weaker evidence
   * and is the evidence available: `PaperReader` needs pdf.js and a 2D canvas
   * context, and happy-dom provides neither — the rest of this file tests the
   * exported geometry for the same reason. The reason is recorded here so the
   * next person does not mistake a source assertion for a preference.
   */
  const SOURCE = join(__dirname, "..", "components", "literature",
                      "PaperReader.tsx");

  it("are reported rather than shown as a paper with none", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(SOURCE, "utf8");

    /*
     * The catch attached to the marks request, up to the end of that effect.
     * The end anchor is searched *from* the start, because the same cleanup
     * line appears in an earlier effect — taken from the front, the slice
     * came out empty and both assertions would have been vacuous.
     */
    const from = source.indexOf("/marks`)");
    expect(from, "the marks request moved").toBeGreaterThan(-1);
    const load = source.slice(
      from, source.indexOf("return () => { current = false; };", from));
    expect(load.length, "the effect's cleanup moved").toBeGreaterThan(0);

    expect(load).toContain("setMarks([])");
    expect(load, "a failed marks load must say so").toContain("setProblem(");
  });

  it("still let the paper open, which is why this is not an error banner",
     async () => {
    /*
     * The argued half of the original behaviour, kept: the researcher can
     * still read and still draw, and a failed load says less than a page that
     * refuses to open. So the report goes through the same non-blocking line
     * the save path uses, not through a state that replaces the reader.
     */
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(SOURCE, "utf8");

    expect(source).toContain('{problem && <p className="reader-problem" role="status">');
  });
});
