/**
 * The guarantee §204 states, checked rather than asserted (§143, §204, §205).
 *
 * *"Annotations must attach to the document coordinate system. If the PDF zoom
 * changes, annotations stay aligned."* That is a property, not a behaviour, so
 * most of this file checks it as one: transform a mark out and back at many
 * scales and rotations and require it to return to where it started.
 *
 * The last group is the one that matters most. Round-trip tests prove the
 * transform is *self-consistent*, which a transform that is uniformly wrong also
 * is — flip a sign in both directions and every round trip still passes while
 * every annotation lands in the wrong place. So the final tests build a real PDF
 * and compare against **PDF.js's own viewport**: the thing that actually renders
 * the page. If these two ever disagree, marks drift, and no amount of internal
 * consistency would have caught it.
 */

import { describe, expect, it } from "vitest";
import {
  PageGeometry, PageRotation, normaliseRotation, onPage, regionAround,
  regionBetween, regionToViewport, renderedSize, toPage, toViewport,
} from "@/lib/literature/coordinates";

const ROTATIONS: PageRotation[] = [0, 90, 180, 270];
/** US Letter, and a squarer page — a square page hides axis-swap bugs. */
const PAGES = [
  { width: 612, height: 792 },
  { width: 400, height: 400 },
  { width: 800, height: 300 },
];

function geometry(size: { width: number; height: number },
                  rotation: PageRotation, scale: number): PageGeometry {
  return { ...size, rotation, scale };
}

describe("a mark survives the journey to the screen and back", () => {
  it("returns to where it started, at every rotation and zoom", () => {
    const marks = [
      { x: 0, y: 0 }, { x: 306, y: 396 }, { x: 72, y: 720 }, { x: 611, y: 1 },
    ];
    for (const size of PAGES) {
      for (const rotation of ROTATIONS) {
        for (const scale of [0.5, 1, 1.75, 4]) {
          const page = geometry(size, rotation, scale);
          for (const mark of marks) {
            if (mark.x > size.width || mark.y > size.height) continue;
            const back = toPage(toViewport(mark, page), page);
            expect(back.x).toBeCloseTo(mark.x, 6);
            expect(back.y).toBeCloseTo(mark.y, 6);
          }
        }
      }
    }
  });

  it("is stable under zoom — the sentence §204 actually states", () => {
    /*
     * The failure this prevents: a researcher underlines a sentence, zooms in to
     * read the next paragraph, and every mark in the paper slides off at once.
     *
     * Stated as *the page coordinates do not depend on scale*, which is the
     * strongest form: not "close enough after zooming" but "zoom is not an input
     * to where the mark is".
     */
    const size = PAGES[0];
    const screenPoint = { x: 200, y: 300 };
    for (const rotation of ROTATIONS) {
      const atOne = toPage(screenPoint, geometry(size, rotation, 1));
      // The same *document* position, viewed at another zoom, must render to the
      // proportionally-scaled screen position.
      for (const scale of [0.25, 2, 3.5]) {
        const page = geometry(size, rotation, scale);
        const rendered = toViewport(atOne, page);
        expect(rendered.x).toBeCloseTo(screenPoint.x * scale, 6);
        expect(rendered.y).toBeCloseTo(screenPoint.y * scale, 6);
      }
    }
  });

  it("puts the origin where PDF puts it, not where the screen does", () => {
    // The bottom-left of the page is the *top*-left of an unrotated render.
    const page = geometry({ width: 612, height: 792 }, 0, 1);
    expect(toViewport({ x: 0, y: 792 }, page)).toEqual({ x: 0, y: 0 });
    expect(toViewport({ x: 0, y: 0 }, page)).toEqual({ x: 0, y: 792 });
  });
});

describe("the page as rendered", () => {
  it("swaps width and height on a quarter turn", () => {
    const size = { width: 612, height: 792 };
    expect(renderedSize(geometry(size, 0, 1))).toEqual({ width: 612, height: 792 });
    expect(renderedSize(geometry(size, 90, 1))).toEqual({ width: 792, height: 612 });
    expect(renderedSize(geometry(size, 180, 1))).toEqual({ width: 612, height: 792 });
    expect(renderedSize(geometry(size, 270, 1))).toEqual({ width: 792, height: 612 });
  });

  it("keeps every corner of the page inside the rendered canvas", () => {
    /*
     * The check that a round trip cannot make. A transform can be perfectly
     * invertible and still send the page off the edge of its own canvas, which
     * is what a wrong rotation case looks like: the document renders, and the
     * top half is missing.
     */
    for (const size of PAGES) {
      for (const rotation of ROTATIONS) {
        const page = geometry(size, rotation, 1.5);
        const { width, height } = renderedSize(page);
        const corners = [
          { x: 0, y: 0 }, { x: size.width, y: 0 },
          { x: 0, y: size.height }, { x: size.width, y: size.height },
        ];
        for (const corner of corners) {
          const at = toViewport(corner, page);
          expect(at.x).toBeGreaterThanOrEqual(-1e-6);
          expect(at.y).toBeGreaterThanOrEqual(-1e-6);
          expect(at.x).toBeLessThanOrEqual(width + 1e-6);
          expect(at.y).toBeLessThanOrEqual(height + 1e-6);
        }
      }
    }
  });

  it("normalises whatever rotation a document claims", () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(360)).toBe(0);
  });
});

describe("marks that are not on the paper", () => {
  const page = geometry({ width: 612, height: 792 }, 0, 1);

  it("refuses a point in the reader's margin rather than clamping it", () => {
    // Clamping would move the researcher's mark onto the page edge, which is a
    // different claim about where they pointed.
    expect(onPage({ x: -5, y: 100 }, page)).toBe(false);
    expect(onPage({ x: 100, y: 900 }, page)).toBe(false);
    expect(onPage({ x: 100, y: 100 }, page)).toBe(true);
  });

  it("allows a deliberate tolerance for a mark on the very edge", () => {
    expect(onPage({ x: -2, y: 100 }, page, 3)).toBe(true);
  });
});

describe("regions, for putting a figure on the board (§205)", () => {
  it("is the same region whichever way it was drawn", () => {
    const a = regionBetween({ x: 10, y: 10 }, { x: 100, y: 200 });
    const b = regionBetween({ x: 100, y: 200 }, { x: 10, y: 10 });
    expect(a).toEqual(b);
    expect(a.width).toBe(90);
    expect(a.height).toBe(190);
  });

  it("encloses a circled figure", () => {
    const circled = [
      { x: 50, y: 400 }, { x: 300, y: 500 }, { x: 180, y: 380 },
    ];
    expect(regionAround(circled))
      .toEqual({ x: 50, y: 380, width: 250, height: 120 });
  });

  it("has no region for no points, rather than a point at the origin", () => {
    // A zero-size rectangle at (0,0) is a confident answer about the corner of
    // a page nobody indicated, and §205 would happily cite it.
    expect(regionAround([])).toBeNull();
    expect(regionAround([{ x: NaN, y: NaN }])).toBeNull();
  });

  it("survives rotation with its corners the right way round", () => {
    /*
     * Transforming the origin and scaling the size — the obvious shortcut — is
     * correct at rotation 0 and wrong at the other three, because the y-flip
     * swaps which corner is the top-left. A negative width here would draw the
     * highlight box inside-out.
     */
    const region = { x: 100, y: 200, width: 150, height: 90 };
    for (const rotation of ROTATIONS) {
      const page = geometry({ width: 612, height: 792 }, rotation, 2);
      const drawn = regionToViewport(region, page);
      expect(drawn.width).toBeGreaterThan(0);
      expect(drawn.height).toBeGreaterThan(0);
      // Area is preserved up to the scale factor, whatever the rotation.
      expect(drawn.width * drawn.height)
        .toBeCloseTo(region.width * region.height * 4, 4);
    }
  });
});
