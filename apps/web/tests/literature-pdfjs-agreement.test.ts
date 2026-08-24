/**
 * Our transform against the one that actually renders the page (§204).
 *
 * `literature-coordinates.test.ts` proves the transform is self-consistent: a
 * mark goes out to the screen and comes back to where it started. That is
 * necessary and it is not sufficient, and the gap between the two is exactly
 * where this class of bug lives — **a transform that is uniformly wrong round
 * trips perfectly.** Flip a sign in both directions and every existing test
 * still passes while every annotation in every paper lands somewhere else.
 *
 * So this compares against PDF.js's own `PageViewport`, which is the object the
 * renderer uses to put ink on the canvas. If the two ever disagree, annotations
 * drift away from the sentences they belong to, and nothing internal to this
 * codebase would have noticed.
 *
 * The PDF is built here rather than committed as a fixture. A binary in the
 * repository is a thing nobody can read, review or adjust, and what these tests
 * need — a known page size and a known `/Rotate` — is a few hundred bytes of
 * plain text. Being able to *see* that the page is 612×792 and rotated 90° is
 * the point; a fixture would just move the assumption somewhere unreadable.
 */

import { describe, expect, it } from "vitest";
import {
  PageRotation, renderedSize, toPage, toViewport,
} from "@/lib/literature/coordinates";

/**
 * The smallest legal PDF with a page of a given size and rotation.
 *
 * Three objects, a real cross-reference table and no content stream: nothing is
 * drawn because nothing needs to be. The page's geometry is the entire subject.
 */
function minimalPdf({ width = 612, height = 792, rotate = 0 } = {}): Uint8Array {
  const objects = [
    `<</Type/Catalog/Pages 2 0 R>>`,
    `<</Type/Pages/Kids[3 0 R]/Count 1>>`,
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]/Rotate ${rotate}>>`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\n`
       + `startxref\n${startxref}\n%%EOF\n`;
  return Uint8Array.from([...pdf].map((c) => c.charCodeAt(0)));
}

type Viewport = {
  width: number; height: number;
  convertToViewportPoint: (x: number, y: number) => number[];
};

async function pdfjsViewport(rotate: number, scale: number,
                             size = { width: 612, height: 792 }): Promise<Viewport> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: minimalPdf({ ...size, rotate }) });
  const document = await task.promise;
  const page = await document.getPage(1);
  return page.getViewport({ scale }) as unknown as Viewport;
}

const ROTATIONS: PageRotation[] = [0, 90, 180, 270];

describe("our page transform agrees with the renderer's", () => {
  it("maps every point exactly as PDF.js does, at every rotation", async () => {
    const size = { width: 612, height: 792 };
    const scale = 1.5;
    const marks = [
      { x: 0, y: 0 },
      { x: 612, y: 792 },
      { x: 100, y: 700 },
      { x: 306, y: 396 },
      { x: 611.5, y: 0.5 },
    ];

    for (const rotation of ROTATIONS) {
      const viewport = await pdfjsViewport(rotation, scale, size);
      const page = { ...size, rotation, scale };
      for (const mark of marks) {
        const theirs = viewport.convertToViewportPoint(mark.x, mark.y);
        const ours = toViewport(mark, page);
        expect(ours.x).toBeCloseTo(theirs[0], 6);
        expect(ours.y).toBeCloseTo(theirs[1], 6);
      }
    }
  }, 30_000);

  it("agrees about how big the rendered page is", async () => {
    // A canvas sized from a disagreeing transform clips the page along one edge,
    // which reads as a broken document rather than a broken calculation.
    for (const rotation of ROTATIONS) {
      const viewport = await pdfjsViewport(rotation, 2);
      const ours = renderedSize({ width: 612, height: 792, rotation, scale: 2 });
      expect(ours.width).toBeCloseTo(viewport.width, 6);
      expect(ours.height).toBeCloseTo(viewport.height, 6);
    }
  }, 30_000);

  it("agrees on a page that is wider than it is tall", async () => {
    /*
     * A landscape page separates the two things a square page conflates. With
     * 612×792 a transform that swapped width for height would be caught; with
     * 400×400 it would not, and a figure in a landscape paper is exactly the
     * kind of thing §205 asks a researcher to circle.
     */
    const size = { width: 800, height: 300 };
    for (const rotation of ROTATIONS) {
      const viewport = await pdfjsViewport(rotation, 1, size);
      const page = { ...size, rotation, scale: 1 };
      for (const mark of [{ x: 0, y: 0 }, { x: 800, y: 300 }, { x: 640, y: 90 }]) {
        const theirs = viewport.convertToViewportPoint(mark.x, mark.y);
        const ours = toViewport(mark, page);
        expect(ours.x).toBeCloseTo(theirs[0], 6);
        expect(ours.y).toBeCloseTo(theirs[1], 6);
      }
    }
  }, 30_000);

  it("reads the rotation the document declares", async () => {
    // The reason rotation is handled at all: scanned papers are routinely
    // stored rotated, and they are the ones most likely to be marked by hand.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    for (const rotate of [0, 90, 180, 270]) {
      const document = await pdfjs.getDocument({
        data: minimalPdf({ rotate }) }).promise;
      expect((await document.getPage(1)).rotate).toBe(rotate);
    }
  }, 30_000);

  it("puts a mark back where the researcher drew it, through the real viewport",
     async () => {
    /*
     * The whole subsystem in one assertion, and the direction that decides
     * whether a stored annotation is right *forever*: a hand at a canvas pixel,
     * converted to page space by us, converted back to a canvas pixel by
     * PDF.js. A researcher underlines a sentence at 150%; the ink must sit on
     * that sentence when the paper is reopened at any other zoom.
     */
    const size = { width: 612, height: 792 };
    for (const rotation of ROTATIONS) {
      const drawnAt = { x: 240, y: 310 };
      const stored = toPage(drawnAt, { ...size, rotation, scale: 1.5 });

      for (const scale of [1, 1.5, 3]) {
        const viewport = await pdfjsViewport(rotation, scale, size);
        const shown = viewport.convertToViewportPoint(stored.x, stored.y);
        expect(shown[0]).toBeCloseTo(drawnAt.x * (scale / 1.5), 6);
        expect(shown[1]).toBeCloseTo(drawnAt.y * (scale / 1.5), 6);
      }
    }
  }, 30_000);
});
