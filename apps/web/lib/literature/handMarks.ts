/**
 * A stroke drawn in the air, landing on a page (§143, §204).
 *
 * §143 calls marking a PDF *screen-space ink* — the hand draws over the
 * document, and the stroke arrives in viewport pixels. §204 requires the
 * opposite: annotations attach to the document coordinate system so that
 * changing the zoom does not move them. Both are right, and this is the seam
 * between them.
 *
 * It is a separate module rather than a few lines inside the reader for the
 * usual reason: this is the part that can be wrong in a way nobody notices. A
 * hand stroke that lands three millimetres off is indistinguishable from
 * imprecise tracking, so it would be blamed on the camera and tuned around
 * forever. Here it is pure, and provable without a camera or a PDF.
 *
 * **The smoothed points are what becomes the mark, and the original stroke is
 * not discarded.** §174's rule is that what the hand did is never rewritten —
 * so the mark carries the stroke's id, and the ink layer still holds
 * `originalPoints` untouched. The mark is the *drawing*; the stroke remains the
 * record of the hand.
 */

import { PageGeometry, PagePoint, onPage, toPage } from "./coordinates";
import type { Mark, MarkKind } from "./excerpt";
import type { SpatialStroke } from "@/lib/ink/stroke";

/**
 * How far outside the paper a point may stray and still count, in PDF units.
 *
 * Not zero. A hand drawing an underline runs past the end of the line, and a
 * circle around a figure near the edge of the page overshoots the margin —
 * refusing those would make the commonest marks the ones that fail. Wide enough
 * to forgive an overshoot, narrow enough that a stroke made over the reader's
 * grey surround is still not a mark on the page.
 */
export const OVERSHOOT = 24;

/** Points that landed on the paper, in page coordinates. */
function pagepoints(stroke: SpatialStroke, geometry: PageGeometry,
                    toCanvas: (p: PagePoint) => PagePoint): PagePoint[] {
  const kept: PagePoint[] = [];
  // The smoothed points: a hand tremor faithfully reproduced is a worse
  // underline than a steady one, and §174's record of what the hand did lives
  // on the stroke rather than here.
  const source = stroke.points.length > 0 ? stroke.points : stroke.originalPoints;

  for (const point of source) {
    /*
     * Dropped explicitly, and deliberately redundant.
     *
     * `onPage` below would reject a NaN anyway — every comparison against NaN
     * is false, so it fails the bounds check — which means no test can tell
     * this line from its absence, and a mutation removing it survives. It stays
     * because the reason a non-finite coordinate is unacceptable has nothing to
     * do with the page bounds: it is a broken sample from the tracker, and it
     * should be refused where it arrives rather than incidentally, by a check
     * whose purpose is something else and whose form could reasonably change.
     */
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const onCanvas = toCanvas({ x: point.x, y: point.y });
    const inPage = toPage(onCanvas, geometry);
    // Clipped rather than clamped. A point dragged onto the page edge would
    // claim the researcher pointed somewhere they did not, and a stroke that
    // wandered off the paper and back should keep the gap.
    if (!onPage(inPage, geometry, OVERSHOOT)) continue;
    kept.push(inPage);
  }
  return kept;
}

/**
 * The mark a hand stroke makes on this page, or nothing.
 *
 * Returns null rather than an empty mark whenever the stroke did not land on
 * the paper. A mark with no points would draw nothing while appearing in the
 * page's list, so it would read as an annotation that failed to render — and
 * somebody would go looking for the rendering bug.
 *
 * `toCanvas` maps a viewport point into the ink canvas's own pixels. It is
 * passed in rather than computed here because only the component knows where
 * its canvas sits, and a second copy of that arithmetic is how the ink and the
 * page drift apart.
 */
export function markFromStroke(
  stroke: SpatialStroke,
  options: {
    geometry: PageGeometry;
    page: number;
    kind: MarkKind;
    toCanvas: (point: PagePoint) => PagePoint;
    at?: number;
  },
): Mark | null {
  // Only the pen leaves a mark. An eraser pass and a lasso are both strokes and
  // neither is an annotation; treating them as one is how a wipe ends up
  // recorded as something drawn — a mistake this codebase has already made once.
  if (stroke.tool !== "pen") return null;
  if (stroke.space !== "screen") return null;

  const points = pagepoints(stroke, options.geometry, options.toCanvas);
  // One point is a tap, not a stroke — except for a note, which is placed at a
  // single point by definition.
  const enough = options.kind === "note" ? 1 : 2;
  if (points.length < enough) return null;

  return {
    // The stroke's own id, so the mark and the untouched original remain the
    // same thing rather than two records of one gesture.
    id: stroke.id,
    kind: options.kind,
    page: options.page,
    points,
    at: options.at ?? Date.now(),
  };
}

/**
 * A mapping from viewport pixels into a canvas's own pixels.
 *
 * The canvas may be laid out smaller than its backing store — a page rendered
 * at 200% inside a window that cannot fit it — so the ratio matters and is not
 * always one. Using the CSS size where the backing size is meant puts every
 * mark at a constant fraction of where it belongs, which looks like a
 * calibration problem rather than a units problem.
 */
export function canvasMapping(canvas: {
  rect: { left: number; top: number; width: number; height: number };
  width: number;
  height: number;
}): (point: PagePoint) => PagePoint {
  const { rect } = canvas;
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  return (point) => ({
    x: (point.x - rect.left) * scaleX,
    y: (point.y - rect.top) * scaleY,
  });
}

/**
 * The mark under a point, if any (§176).
 *
 * Distance to the **path**, not to the sampled points, and that distinction is
 * the whole function. A stroke is recorded as a handful of samples with long
 * gaps between them — a straight underline may be two points a hundred
 * millimetres apart — so measuring to the nearest sample would make the middle
 * of a line unerasable while its ends worked. The researcher would conclude the
 * eraser was unreliable, which is a worse belief than "it does not work".
 *
 * A note has one point and no path, so it falls out of the same maths: the
 * segment from a point to itself is that point.
 *
 * Ties go to the most recent mark. Where two marks overlap, the one drawn last
 * is the one on top, and taking the one underneath would remove something the
 * researcher could not see at the place they pointed.
 */
export function markUnder(at: PagePoint, marks: readonly Mark[],
                          options: { page: number; within: number }): Mark | null {
  let best: Mark | null = null;
  let bestDistance = Infinity;

  for (const mark of marks) {
    if (mark.page !== options.page) continue;
    const distance = distanceToPath(at, mark.points);
    if (distance > options.within) continue;
    // `<=` so a later mark wins an exact tie: it is the one drawn on top.
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = mark;
    }
  }
  return best;
}

/** Shortest distance from a point to a polyline, or to a lone point. */
function distanceToPath(at: PagePoint, path: readonly PagePoint[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return Math.hypot(at.x - path[0].x, at.y - path[0].y);

  let shortest = Infinity;
  for (let i = 1; i < path.length; i += 1) {
    shortest = Math.min(shortest, distanceToSegment(at, path[i - 1], path[i]));
  }
  return shortest;
}

function distanceToSegment(at: PagePoint, a: PagePoint, b: PagePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  // A zero-length segment is a point, which happens when a stroke pauses and
  // records the same position twice. Dividing by it would give NaN, and a NaN
  // distance compares false against every threshold — so the mark would become
  // silently unerasable rather than obviously broken.
  if (lengthSquared === 0) return Math.hypot(at.x - a.x, at.y - a.y);

  // Clamped, so the nearest point is on the segment rather than on the
  // infinite line through it — otherwise a click far past the end of a short
  // underline would count as being on it.
  const t = Math.max(0, Math.min(1,
    ((at.x - a.x) * dx + (at.y - a.y) * dy) / lengthSquared));
  return Math.hypot(at.x - (a.x + t * dx), at.y - (a.y + t * dy));
}
