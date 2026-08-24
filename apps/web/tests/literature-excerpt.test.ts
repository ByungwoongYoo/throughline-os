/**
 * Taking a piece of a paper to the board, and refusing to (§204, §205).
 *
 * §205 names five things an excerpt must preserve — source paper, page,
 * bounding region, citation, original context — so most of these tests are
 * about what happens when one of them is missing. The refusals are the subject
 * rather than the edge cases: an excerpt that cannot say where it came from is
 * the failure this product exists to prevent, and it is dangerous precisely
 * because on a board it looks identical to one that can.
 */

import { describe, expect, it } from "vitest";
import {
  Mark, PaperSource, citationFor, excerptFrom, excerptOnScreen, marksOnPage,
} from "@/lib/literature/excerpt";

const PAPER: PaperSource = {
  id: "paper-1",
  title: "Sleep duration and reaction time",
  authors: ["Okafor", "Lindqvist"],
  year: 2021,
  doi: "10.1000/abcd",
};

/** A square region, comfortably above the minimum. */
const CIRCLED = [
  { x: 100, y: 400 }, { x: 300, y: 400 },
  { x: 300, y: 560 }, { x: 100, y: 560 },
];

function take(overrides: Partial<Parameters<typeof excerptFrom>[0]> = {}) {
  return excerptFrom({
    source: PAPER, page: 4, points: CIRCLED, context: "Figure 2 shows the "
      + "relationship between sleep and response latency.",
    id: "excerpt-1", at: 1_000, ...overrides,
  });
}

describe("an excerpt keeps everything §205 lists", () => {
  it("carries source, page, region, citation and context", () => {
    const result = take();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.excerpt.source.id).toBe("paper-1");
    expect(result.excerpt.page).toBe(4);
    expect(result.excerpt.region)
      .toEqual({ x: 100, y: 400, width: 200, height: 160 });
    expect(result.excerpt.citation).toContain("p. 4");
    expect(result.excerpt.context).toContain("Figure 2");
  });

  it("cites in a form that leads back to the paper", () => {
    const citation = citationFor(PAPER, 4);
    expect(citation).toBe(
      "Okafor and Lindqvist (2021) Sleep duration and reaction time, p. 4 "
      + "(doi:10.1000/abcd)");
  });

  it("shortens a long author list rather than dropping the names", () => {
    expect(citationFor({ ...PAPER, authors: ["A", "B", "C"] }, 1))
      .toContain("A et al.");
  });

  it("cites a paper with no author or year without inventing either", () => {
    // Plenty of documents genuinely have neither, and "Anonymous (n.d.)" is a
    // claim about the paper rather than an admission about the metadata.
    const citation = citationFor(
      { id: "p", title: "Working notes", authors: [] }, 2);
    expect(citation).toBe("Working notes, p. 2");
  });
});

describe("what it refuses, and why refusing is the point", () => {
  it("will not excerpt from a paper that cannot be cited", () => {
    /*
     * The dangerous case. A figure on a board with no traceable source sits
     * beside figures that have one and looks exactly like them — so months
     * later there is no way to tell which claims are supported.
     */
    const result = take({ source: { ...PAPER, title: "  " } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no title");
  });

  it("names what is missing, so it can be supplied", () => {
    const result = take({ source: { ...PAPER, id: "" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A researcher can act on "wait for it to load"; they cannot act on
    // "invalid input".
    expect(result.reason).toMatch(/loading|title/);
  });

  it("refuses a brush of the page rather than citing a sliver", () => {
    const result = take({ points: [{ x: 100, y: 400 }, { x: 103, y: 402 }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("too small");
  });

  it("accepts a long thin underline, which is not a brush", () => {
    // An underline is legitimately a few units tall and hundreds long, so a
    // minimum applied to *both* dimensions would reject the commonest §204 mark.
    const result = take({
      points: [{ x: 100, y: 400 }, { x: 400, y: 403 }] });
    expect(result.ok).toBe(true);
  });

  it("refuses when nothing was indicated", () => {
    const result = take({ points: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("No region");
  });

  it("refuses a page number that is not a page", () => {
    for (const page of [0, -1, 1.5]) {
      const result = take({ page });
      expect(result.ok).toBe(false);
    }
  });
});

describe("context", () => {
  it("is null for a scan, rather than an empty string", () => {
    // "The page had no extractable text" and "the surrounding text was blank"
    // are different facts, and only one of them is true of a scanned paper.
    const result = take({ context: "   " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.excerpt.context).toBeNull();
  });

  it("is null when none was offered at all", () => {
    const result = take({ context: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.excerpt.context).toBeNull();
  });
});

describe("an excerpt on screen", () => {
  it("follows the zoom without its stored region changing", () => {
    /*
     * §204 again, from the excerpt's side: the region is document coordinates,
     * so zooming moves where it is *drawn* and never what is *stored*.
     */
    const result = take();
    if (!result.ok) throw new Error("expected an excerpt");
    const stored = { ...result.excerpt.region };

    const atOne = excerptOnScreen(result.excerpt,
      { width: 612, height: 792, rotation: 0, scale: 1 });
    const atTwo = excerptOnScreen(result.excerpt,
      { width: 612, height: 792, rotation: 0, scale: 2 });

    expect(atTwo.width).toBeCloseTo(atOne.width * 2, 6);
    expect(atTwo.height).toBeCloseTo(atOne.height * 2, 6);
    expect(result.excerpt.region).toEqual(stored);
  });

  it("stays a positive rectangle on a rotated page", () => {
    const result = take();
    if (!result.ok) throw new Error("expected an excerpt");
    for (const rotation of [0, 90, 180, 270] as const) {
      const box = excerptOnScreen(result.excerpt,
        { width: 612, height: 792, rotation, scale: 1 });
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });
});

describe("marks belong to the page they were drawn on", () => {
  const marks: Mark[] = [
    { id: "c", kind: "circle", page: 2, points: [], at: 300 },
    { id: "a", kind: "underline", page: 1, points: [], at: 100 },
    { id: "b", kind: "highlight", page: 1, points: [], at: 200 },
  ];

  it("returns only that page's marks, oldest first", () => {
    expect(marksOnPage(marks, 1).map((m) => m.id)).toEqual(["a", "b"]);
    expect(marksOnPage(marks, 2).map((m) => m.id)).toEqual(["c"]);
    expect(marksOnPage(marks, 3)).toEqual([]);
  });

  it("does not let a stroke near the edge leak onto the next page", () => {
    // A mark is on the page it was drawn on. Proximity is not membership.
    const running: Mark = {
      id: "d", kind: "arrow", page: 1,
      points: [{ x: 10, y: 5 }, { x: 10, y: -40 }], at: 400,
    };
    expect(marksOnPage([...marks, running], 2).map((m) => m.id)).toEqual(["c"]);
  });
});
