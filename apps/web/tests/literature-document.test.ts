/**
 * Opening a paper, and what it reads off it (§205).
 *
 * These run against real PDFs built in memory, because the things worth testing
 * here are all *readings of a document* — its page size, its rotation, its
 * title, its authors, its text — and a mock would only assert that the code
 * returns what the mock was told to return.
 *
 * The metadata tests matter more than they look. §205 refuses to create an
 * excerpt from a paper that cannot be cited, so whatever `openPaper` reports as
 * the title and authors decides whether circling a figure works at all. Getting
 * "Okafor, Lindqvist" back as a single author is not a cosmetic problem: it is a
 * citation that names a person who does not exist.
 */

import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  geometryOf, openPaper, setWorkerSource, WORKER_PATH,
} from "@/lib/literature/document";

/*
 * The worker, from disk rather than over HTTP.
 *
 * `WORKER_PATH` is a URL the application serves; under the test runner nothing
 * is serving anything, so it resolves to a missing file and every document
 * fails to parse. The privacy assertion below still checks the real constant —
 * this only changes where the bytes come from, not what production points at.
 */
const require = createRequire(import.meta.url);
setWorkerSource(join(
  dirname(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")),
  "pdf.worker.min.mjs"));

/** A small, real PDF, with an optional Info dictionary. */
function makePdf({ width = 612, height = 792, rotate = 0,
                   title = "", author = "", created = "" } = {}): Uint8Array {
  const info: string[] = [];
  if (title) info.push(`/Title (${title})`);
  if (author) info.push(`/Author (${author})`);
  if (created) info.push(`/CreationDate (${created})`);

  const objects = [
    `<</Type/Catalog/Pages 2 0 R>>`,
    `<</Type/Pages/Kids[3 0 R]/Count 1>>`,
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]/Rotate ${rotate}>>`,
  ];
  if (info.length) objects.push(`<<${info.join("")}>>`);

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
  const trailer = info.length
    ? `<</Size ${objects.length + 1}/Root 1 0 R/Info 4 0 R>>`
    : `<</Size ${objects.length + 1}/Root 1 0 R>>`;
  pdf += `trailer\n${trailer}\nstartxref\n${startxref}\n%%EOF\n`;
  return Uint8Array.from([...pdf].map((c) => c.charCodeAt(0)));
}

const open = (bytes: Uint8Array, filename = "okafor-2021.pdf") =>
  openPaper(bytes, { id: "paper-1", filename });

describe("the worker is served by this application", () => {
  it("is a same-origin path, not a CDN", () => {
    /*
     * The one assertion in this file that is about privacy rather than
     * correctness, and the one most likely to be undone by somebody following
     * PDF.js's own documentation. A CDN worker would mean opening a paper tells
     * a third party that a paper was opened.
     */
    expect(WORKER_PATH.startsWith("/")).toBe(true);
    expect(WORKER_PATH).not.toMatch(/^https?:|unpkg|cdnjs|jsdelivr/);
  });
});

describe("reading a paper", () => {
  it("reports the page's own size, unscaled and unrotated", async () => {
    // Unscaled and unrotated because this is what the annotation transform
    // expects. A size taken from a viewport would already have zoom baked in,
    // and every stored mark would inherit the zoom it was drawn at.
    const paper = await open(makePdf({ width: 612, height: 792, rotate: 90 }));
    const page = await paper.page(1);
    expect(page.width).toBe(612);
    expect(page.height).toBe(792);
    expect(page.rotation).toBe(90);
    await paper.close();
  }, 30_000);

  it("counts its pages", async () => {
    const paper = await open(makePdf());
    expect(paper.pageCount).toBe(1);
    await paper.close();
  }, 30_000);

  it("combines size, rotation and zoom in one place", async () => {
    /*
     * `geometryOf` exists so the canvas and the annotation transform cannot be
     * computed from different numbers. When they were computed separately,
     * annotations sat a few pixels off on rotated pages only — which reads as
     * imprecise hand tracking rather than as a bug.
     */
    const paper = await open(makePdf({ rotate: 270 }));
    const page = await paper.page(1);
    expect(geometryOf(page, 1.5))
      .toEqual({ width: 612, height: 792, rotation: 270, scale: 1.5 });
    await paper.close();
  }, 30_000);
});

describe("what it can say about the paper, for the citation", () => {
  it("prefers the document's own title", async () => {
    const paper = await open(makePdf({ title: "Sleep and reaction time" }));
    expect(paper.source.title).toBe("Sleep and reaction time");
    await paper.close();
  }, 30_000);

  it("falls back to the filename, without the extension", async () => {
    // §205 refuses to excerpt from an untitled paper, so the fallback is what
    // makes circling a figure work at all for the many PDFs with no metadata.
    const paper = await open(makePdf(), "okafor-2021.pdf");
    expect(paper.source.title).toBe("okafor-2021");
    await paper.close();
  }, 30_000);

  it("splits an author field into the people it names", async () => {
    /*
     * PDF metadata puts every author in one string. Left alone, the citation
     * names a single person called "Okafor, Lindqvist" — which is not a
     * formatting problem but a false statement about who wrote the paper.
     */
    const paper = await open(makePdf({ author: "Okafor, Lindqvist" }));
    expect(paper.source.authors).toEqual(["Okafor", "Lindqvist"]);
    await paper.close();
  }, 30_000);

  it("handles the other separators the format is written with", async () => {
    const paper = await open(makePdf({ author: "Okafor and Lindqvist" }));
    expect(paper.source.authors).toEqual(["Okafor", "Lindqvist"]);
    await paper.close();
  }, 30_000);

  it("has no authors rather than an empty one", async () => {
    const paper = await open(makePdf());
    expect(paper.source.authors).toEqual([]);
    await paper.close();
  }, 30_000);

  it("does not take a publication year from the file's creation date", async () => {
    /*
     * `CreationDate` is when the *file* was made, not when the work was
     * published. A 1999 paper re-exported from a publisher's site last year
     * carries last year's date, and a scan carries the date of the scan.
     *
     * A first version did use it, bounded to "plausible" years, and this test
     * caught the disagreement between that guard and its own comment. The bound
     * was never the problem — the field means something else, and a citation
     * that states a wrong year sends a reader to the wrong volume.
     */
    const paper = await open(makePdf({ created: "D:20240417120000Z" }));
    expect(paper.source.year).toBeUndefined();
    await paper.close();
  }, 30_000);

  it("has no year rather than a wrong one when there is no date", async () => {
    const paper = await open(makePdf());
    expect(paper.source.year).toBeUndefined();
    await paper.close();
  }, 30_000);
});

describe("text, for §205's original context", () => {
  it("is null for a page with no text layer", async () => {
    /*
     * The normal case for a scanned paper, and the reason `context` is nullable
     * all the way through. Returning "" would say the surrounding text was
     * checked and found blank, which is a different and untrue statement.
     */
    const paper = await open(makePdf());
    const page = await paper.page(1);
    expect(await page.text()).toBeNull();
    await paper.close();
  }, 30_000);
});
