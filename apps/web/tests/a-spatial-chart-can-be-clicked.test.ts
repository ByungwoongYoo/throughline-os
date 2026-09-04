/**
 * Selection that a mouse could never reach.
 *
 * Six spatial charts painted a selected mark, reported one through `onSelect`,
 * and exposed `select` on their controller — and no pointer ever called any of
 * it. The capability was available to the gesture layer and to nothing a mouse
 * could do, so clicking a node in a node-link graph did nothing at all. That is
 * this repository's most-repeated defect wearing an interaction as its
 * disguise: built, correct, unreachable.
 *
 * Two things have to be right, and the second fails quietly.
 *
 * A click has to be told from a rotation, because these canvases turn on drag
 * and every selection begins as a press that might become a camera move.
 *
 * And the point has to be converted into the coordinates the chart *draws* in.
 * A chart lays out at whatever width the page gives it and draws at its design
 * size; read in screen pixels, a click still selects something — just not what
 * is under the cursor. Nothing errors. The researcher concludes the
 * hit-testing is vague.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLICK_SLOP, canvasPoint, isClick } from "@/lib/charts/pointer";

const CHARTS = join(__dirname, "..", "components", "charts");

/** An element reporting a rendered box smaller than the chart's design size. */
function shrunk(width: number, height: number, scale: number) {
  return {
    getBoundingClientRect: () => ({
      left: 20, top: 10, width: width * scale, height: height * scale,
      right: 0, bottom: 0, x: 20, y: 10, toJSON: () => ({}),
    }),
  } as unknown as Element;
}

describe("a click reaches the coordinates the chart draws in", () => {
  it("scales a point up when the figure is shown smaller than it draws", () => {
    // Half size: a click 100px into the element is 200 units into the scene.
    const point = canvasPoint({ clientX: 120, clientY: 110 },
                              shrunk(720, 520, 0.5), 720, 520);

    expect(point.x).toBeCloseTo(200, 6);
    expect(point.y).toBeCloseTo(200, 6);
  });

  it("leaves a point alone at full size", () => {
    const point = canvasPoint({ clientX: 120, clientY: 110 },
                              shrunk(720, 520, 1), 720, 520);

    expect(point.x).toBeCloseTo(100, 6);
    expect(point.y).toBeCloseTo(100, 6);
  });

  it("does not put every click at the origin before layout", () => {
    /**
     * A zero-sized box means the element has not been laid out. Scaling by it
     * divides by zero, and every click would land at the same place — which
     * reads as "this chart always selects the same thing".
     */
    const notLaidOut = {
      getBoundingClientRect: () => ({
        left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0,
        x: 0, y: 0, toJSON: () => ({}),
      }),
    } as unknown as Element;

    const point = canvasPoint({ clientX: 40, clientY: 25 }, notLaidOut, 720, 520);

    expect(Number.isFinite(point.x)).toBe(true);
    expect(point).toEqual({ x: 40, y: 25 });
  });
});

describe("a click is told from a rotation", () => {
  it("counts a press that did not travel", () => {
    expect(isClick({ x: 100, y: 100 }, { x: 101, y: 102 })).toBe(true);
  });

  it("does not count a drag", () => {
    expect(isClick({ x: 100, y: 100 }, { x: 100 + CLICK_SLOP * 4, y: 100 }))
      .toBe(false);
  });

  it("does not count a release with no press", () => {
    // A pointer that entered the canvas already down belongs to something
    // else; treating it as a click selects on a gesture aimed elsewhere.
    expect(isClick(null, { x: 100, y: 100 })).toBe(false);
  });
});

describe("every spatial chart a mouse can select in", () => {
  it("routes a click into the chart's own hit-testing", () => {
    /**
     * Structural, because the alternative is six near-identical handlers and
     * a seventh written from whichever one was open. A chart that offers
     * selection at all must offer it to a pointer.
     */
    const offenders: string[] = [];
    let checked = 0;
    for (const name of readdirSync(CHARTS)) {
      if (!name.endsWith(".tsx")) continue;
      const source = readFileSync(join(CHARTS, name), "utf8");
      if (!source.includes("    select: (point)")) continue;   // no selection
      checked += 1;
      const clickable = source.includes("canvasPoint(") && source.includes("isClick(");
      if (!clickable) offenders.push(name);
    }
    expect(checked).toBeGreaterThan(4);
    expect(offenders,
      "these charts offer selection that no pointer can reach").toEqual([]);
  });
});
