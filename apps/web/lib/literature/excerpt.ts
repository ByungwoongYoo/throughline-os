/**
 * Marks on a paper, and taking a piece of one to the board (§204, §205).
 *
 * §204 lists what a researcher must be able to do to a paper — underline a
 * sentence, circle a term, write a margin note, draw an arrow, highlight a
 * paragraph — and every one of those is a shape plus an intent. What makes them
 * research objects rather than drawings is §205, which is specific about what
 * has to survive when a circled figure is put on the board:
 *
 *   - source paper
 *   - page
 *   - bounding region
 *   - citation
 *   - original context
 *
 * That list is a provenance requirement, and it is treated here the way the rest
 * of this codebase treats provenance: **an excerpt that cannot state where it
 * came from is not created.** The alternative is the failure mode this whole
 * product exists to prevent — a figure on a board, months later, that nobody can
 * trace to a paper, sitting beside figures that can, and looking exactly like
 * them.
 *
 * So `excerptFrom` returns a reason instead of an excerpt when the provenance is
 * incomplete. Refusing is the feature. A citation of "Unknown" would let the
 * board fill up with orphans that each look properly sourced.
 */

import { PageRegion, PageGeometry, regionAround, regionToViewport } from "./coordinates";
import type { PagePoint } from "./coordinates";

/** The §204 vocabulary. Each is a shape plus what the researcher meant by it. */
export type MarkKind =
  | "underline"
  | "circle"
  | "highlight"
  | "arrow"
  | "note";

export type Mark = {
  id: string;
  kind: MarkKind;
  /** Page number, 1-based, as a person would say it. */
  page: number;
  /**
   * The stroke in **PDF user space**, never in screen pixels.
   *
   * This is the §204 guarantee in the data model rather than in a function: if
   * the only coordinates stored are document coordinates, a mark cannot drift
   * when the zoom changes, because zoom was never part of what was recorded.
   */
  points: PagePoint[];
  /** For a margin note, the words. Marks that are not notes have none. */
  text?: string;
  at: number;
};

/** What a paper knows about itself, and must, before anything can cite it. */
export type PaperSource = {
  /** The `PaperObject` this came from. */
  id: string;
  title: string;
  /** Empty is allowed — plenty of documents have no identified author. */
  authors: string[];
  year?: number;
  doi?: string;
};

/**
 * A piece of a paper, on the board, still attached to where it came from (§205).
 */
export type Excerpt = {
  id: string;
  source: PaperSource;
  page: number;
  region: PageRegion;
  citation: string;
  /**
   * §205's "original context" — the words around the region.
   *
   * Kept because a figure lifted out of a paper loses the sentence that said
   * what it was for, and that sentence is usually the reason it was worth
   * taking. Null when the page has no extractable text, which is the normal
   * case for a scan, and null is honest where empty string would suggest the
   * surrounding text was checked and found blank.
   */
  context: string | null;
  at: number;
};

export type ExcerptResult =
  | { ok: true; excerpt: Excerpt }
  | { ok: false; reason: string };

/**
 * A citation a person could follow.
 *
 * Deliberately plain rather than a named style. Choosing APA or Vancouver here
 * would be inventing a decision the researcher has not made, and the string is
 * for finding the paper again, not for a bibliography — the DOI is what makes it
 * followable and it is included whenever the paper has one.
 */
export function citationFor(source: PaperSource, page: number): string {
  const authors =
    source.authors.length === 0 ? null
    : source.authors.length === 1 ? source.authors[0]
    : source.authors.length === 2 ? `${source.authors[0]} and ${source.authors[1]}`
    : `${source.authors[0]} et al.`;

  const parts = [authors, source.year ? `(${source.year})` : null, source.title]
    .filter((part): part is string => Boolean(part));
  let citation = `${parts.join(" ")}, p. ${page}`;
  if (source.doi) citation += ` (doi:${source.doi})`;
  return citation;
}

/**
 * Turn a circled region into something that can live on the board.
 *
 * Refuses rather than guessing whenever §205's list cannot be filled. Each
 * refusal names the missing thing, because the researcher can usually supply it
 * — a paper with no title is one whose metadata failed to load, and telling them
 * that is more useful than an excerpt cited as "Untitled".
 */
export function excerptFrom(input: {
  source: PaperSource;
  page: number;
  /** The circling stroke, in page coordinates. */
  points: readonly PagePoint[];
  context?: string | null;
  id: string;
  at: number;
  /** Smallest region worth taking, in PDF units — about 4mm square. */
  minimumSize?: number;
}): ExcerptResult {
  const { source, page, points, id, at } = input;

  if (!source.id || !source.title.trim()) {
    return {
      ok: false,
      reason: "This document has no title yet, so an excerpt from it could not "
            + "be cited. Wait for it to finish loading, or give it a title.",
    };
  }
  if (!Number.isInteger(page) || page < 1) {
    return { ok: false, reason: "An excerpt has to come from a numbered page." };
  }

  const region = regionAround([...points]);
  if (!region) {
    return {
      ok: false,
      reason: "No region was indicated. Circle the part of the page to take.",
    };
  }

  /*
   * A tap is not a selection.
   *
   * Without this, brushing the page while reaching for a control produces a
   * region a few thousandths of an inch across, cited as though it were a
   * figure. It would appear on the board as a sliver nobody could identify and
   * nobody would remember making.
   */
  const minimum = input.minimumSize ?? 12;
  if (region.width < minimum && region.height < minimum) {
    return {
      ok: false,
      reason: "That region is too small to be a figure. Draw around the part of "
            + "the page to take.",
    };
  }

  const context = input.context?.trim();
  return {
    ok: true,
    excerpt: {
      id, source, page, region,
      citation: citationFor(source, page),
      // Empty text means the page had none to give — a scan — and that is a
      // different fact from "the surrounding text was blank".
      context: context ? context : null,
      at,
    },
  };
}

/**
 * Where an excerpt's region sits on screen right now.
 *
 * A convenience with a purpose: it is the only supported way to draw a stored
 * excerpt, so no caller is tempted to keep screen coordinates beside the page
 * ones. Two copies of a position drift apart, and the screen copy is the one
 * that would win by being closer to the drawing code.
 */
export function excerptOnScreen(excerpt: Excerpt,
                                page: PageGeometry): PageRegion {
  return regionToViewport(excerpt.region, page);
}

/**
 * Marks belonging to one page, in the order they were made.
 *
 * Filtered by page rather than by proximity: a mark is on the page it was drawn
 * on, and a stroke that runs off the edge does not become a mark on the next
 * one.
 */
export function marksOnPage(marks: readonly Mark[], page: number): Mark[] {
  return marks.filter((mark) => mark.page === page)
              .sort((a, b) => a.at - b.at);
}
