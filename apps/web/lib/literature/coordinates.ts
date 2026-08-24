/**
 * Where a mark on a paper actually is (§143, §204).
 *
 * §204 states this as a guarantee rather than a feature: *annotations must
 * attach to the document coordinate system; if the PDF zoom changes,
 * annotations stay aligned.* That sentence decides the whole design, because it
 * rules out the obvious implementation. Storing where the researcher's hand was
 * on screen would work perfectly until they zoomed, and then every underline in
 * the paper would slide off its sentence at once — and it would look like a
 * rendering bug rather than a data model that threw away the only stable frame.
 *
 * So marks are stored in **PDF user space**, and screen positions are derived.
 * Never the other way round.
 *
 * Two facts about PDF user space cause most of the bugs here:
 *
 * **The y axis points up.** PDF puts the origin at the bottom-left of the page;
 * every screen coordinate system in this codebase puts it at the top-left. The
 * flip is easy to write once and easy to forget on the way back, and a
 * transform that is wrong in only one direction is worse than one that is wrong
 * in both — annotations land correctly and then drift when the page re-renders.
 *
 * **Pages carry their own rotation.** A scanned paper is frequently stored
 * rotated 90° with a `/Rotate 90` entry, and PDF.js applies it while rendering.
 * Ignoring it puts marks on the wrong axis for exactly the documents most likely
 * to be annotated by hand.
 *
 * The maths is kept here, pure and dependency-free, for two reasons: it is the
 * part that must be right, and it is the part that can be proved right without a
 * browser, a PDF, or a camera. `document.ts` checks it against PDF.js's own
 * viewport so the two cannot silently disagree.
 */

/** A point in PDF user space: origin bottom-left, y upward, unscaled. */
export type PagePoint = { x: number; y: number };

/** A point in rendered canvas pixels: origin top-left, y downward. */
export type ViewportPoint = { x: number; y: number };

/** Quarter-turns only, which is all PDF's `/Rotate` permits. */
export type PageRotation = 0 | 90 | 180 | 270;

export type PageGeometry = {
  /** The page's own size in PDF units, before rotation or zoom. */
  width: number;
  height: number;
  /** The page's `/Rotate`, plus any turn the reader has applied. */
  rotation: PageRotation;
  /** Rendered pixels per PDF unit. */
  scale: number;
};

/** Rotation normalised into the four legal values, so 450 and -90 both work. */
export function normaliseRotation(degrees: number): PageRotation {
  const turned = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return turned as PageRotation;
}

/**
 * The size of the rendered page, in canvas pixels.
 *
 * Width and height swap on a quarter turn. Getting this wrong produces a canvas
 * that clips a rotated page along its long edge, which looks like a broken PDF
 * rather than a broken transform.
 */
export function renderedSize(page: PageGeometry): { width: number; height: number } {
  const turned = page.rotation === 90 || page.rotation === 270;
  const width = (turned ? page.height : page.width) * page.scale;
  const height = (turned ? page.width : page.height) * page.scale;
  return { width, height };
}

/**
 * PDF user space → rendered pixels.
 *
 * Written as the explicit four cases rather than a general matrix. A matrix
 * would be shorter and this has to be *read* and checked by a person against a
 * page they are holding; the rotation cases are where the errors are, and they
 * should be visible rather than folded into sines of right angles that evaluate
 * to 6.1e-17.
 */
export function toViewport(point: PagePoint, page: PageGeometry): ViewportPoint {
  const { width: w, height: h, scale: s } = page;
  switch (page.rotation) {
    case 0:
      // The plain case, and the only one that is just a y-flip.
      return { x: point.x * s, y: (h - point.y) * s };
    case 90:
      return { x: point.y * s, y: point.x * s };
    case 180:
      return { x: (w - point.x) * s, y: point.y * s };
    case 270:
      return { x: (h - point.y) * s, y: (w - point.x) * s };
  }
}

/**
 * Rendered pixels → PDF user space.
 *
 * The direction that matters most, because this is the one that runs when a
 * researcher draws: it decides what gets *stored*, and a mark stored wrongly is
 * wrong forever, while a mark displayed wrongly is wrong until the next render.
 *
 * Exactly inverse to `toViewport`, and the tests assert the round trip rather
 * than trusting that it reads correctly — a sign error here survives inspection
 * easily and shows up months later as annotations that were always slightly off
 * on rotated pages.
 */
export function toPage(point: ViewportPoint, page: PageGeometry): PagePoint {
  const { width: w, height: h, scale: s } = page;
  const x = point.x / s;
  const y = point.y / s;
  switch (page.rotation) {
    case 0:
      return { x, y: h - y };
    case 90:
      return { x: y, y: x };
    case 180:
      return { x: w - x, y };
    case 270:
      return { x: w - y, y: h - x };
  }
}

/**
 * Whether a point is on the page at all.
 *
 * A mark made just outside the paper — in the grey margin of the reader — has
 * no document coordinates, and storing one anyway produces an annotation that
 * belongs to a position no zoom level will ever show. Refused at the boundary
 * rather than clamped: clamping silently moves the researcher's mark onto the
 * edge of the page, which is a different claim about where they pointed.
 */
export function onPage(point: PagePoint, page: PageGeometry,
                       tolerance = 0): boolean {
  return point.x >= -tolerance && point.x <= page.width + tolerance
      && point.y >= -tolerance && point.y <= page.height + tolerance;
}

/**
 * A rectangle in page space, from any two corners.
 *
 * Normalised so that a region drawn upward-and-leftward is the same region as
 * one drawn downward-and-rightward. Without this, `width` comes out negative for
 * half the ways a person can circle a figure, and every consumer has to
 * remember to take absolute values — which one of them eventually will not.
 */
export type PageRegion = { x: number; y: number; width: number; height: number };

export function regionBetween(a: PagePoint, b: PagePoint): PageRegion {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** The region enclosing a set of points, for a circled figure (§205). */
export function regionAround(points: readonly PagePoint[]): PageRegion | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  // Every point was non-finite: there is no region, and a zero-size rectangle at
  // the origin would be a confident answer about a place nobody indicated.
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A page-space region as rendered pixels, for drawing it back onto a canvas. */
export function regionToViewport(region: PageRegion,
                                 page: PageGeometry): PageRegion {
  // Both corners are transformed and then re-normalised, because rotation and
  // the y-flip can each swap which corner is which. Transforming the origin and
  // scaling the size would be shorter and wrong on three of the four rotations.
  const a = toViewport({ x: region.x, y: region.y }, page);
  const b = toViewport({ x: region.x + region.width,
                         y: region.y + region.height }, page);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
