/**
 * Aerial perspective: far things are paler.
 *
 * A spatial network had exactly one depth cue — back-to-front drawing — and
 * that is the weakest way to use it. Painter's order only tells a reader which
 * mark is in front *where two marks overlap*; everywhere else, a node six
 * units away and one two units away were drawn identically, so the graph read
 * as a flat tangle until it was moved.
 *
 * **Why not size.** `project` returns a `scale` factor documented "for scaling
 * a mark by its distance", and binding radius to it would be the obvious fix.
 * `Network3D` declines, and is right to: radius already carries node weight,
 * and a size that means two things means neither — a near light node and a far
 * heavy one would draw the same circle. (The reason recorded there is not
 * quite the reason, though. It says depth "is already carried by the
 * projection", and the projection carries depth into a mark's *position*, not
 * its size. The conclusion stands on the weight argument alone.)
 *
 * So depth goes on a channel that is carrying nothing. Opacity is free here,
 * and haze with distance is a cue every reader already knows how to read
 * without being taught.
 *
 * **The floor is the point.** A far node faded to nothing is a node that has
 * been deleted from the reader's view — the same lie as an unlabelled
 * hemisphere on the globe, and worse because nothing counts it. `NEAREST` and
 * `FAREST` bound the range so the furthest mark is quieter and still plainly
 * there.
 */

/** Opacity of the nearest mark, and of the furthest. */
export const NEAREST = 1;
export const FAREST = 0.42;

/**
 * Where `depth` falls between the nearest and furthest marks, as opacity.
 *
 * Normalised against the scene actually on screen rather than against an
 * absolute distance: a tight cluster and a sprawling one both deserve the full
 * range, and a fixed scale would render a compact graph uniformly flat.
 *
 * A scene with no spread returns `NEAREST` rather than dividing by zero — one
 * plane of marks is not far away, it is simply flat, and fading it would be a
 * claim about depth that the data does not make.
 */
export function hazeFor(depth: number, near: number, far: number): number {
  const span = near - far;
  if (!Number.isFinite(span) || span <= 0) return NEAREST;
  const t = Math.min(1, Math.max(0, (depth - far) / span));
  return FAREST + (NEAREST - FAREST) * t;
}

/** The depth range of a set of projected marks. */
export function depthRange(depths: number[]): { near: number; far: number } {
  let near = -Infinity, far = Infinity;
  for (const d of depths) {
    if (d > near) near = d;
    if (d < far) far = d;
  }
  return Number.isFinite(near) ? { near, far } : { near: 0, far: 0 };
}
