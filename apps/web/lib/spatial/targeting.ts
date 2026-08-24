/**
 * Deciding which chart the hand is talking to (§189, §224).
 *
 * Until now there was nothing to decide, because the session was handed one
 * controller and every gesture went to it. On a page with two figures that is
 * not a simplification, it is a bug with no symptom: the second chart is simply
 * dead to the hand, and a researcher waving at it concludes the tracking is
 * broken. `/gesture-check` shipped that way — a `surfaceRef` created, passed to
 * the chart, and never given to anything that produces gestures.
 *
 * Two rules, and the second is the one that makes the first usable.
 *
 * **Point to choose.** When no gesture is in progress, the chart under the hand
 * is the one being addressed. The hand's normalised position spans the camera's
 * whole field, so it maps to the whole window: move across the camera's view and
 * the point crosses the page.
 *
 * **Then lock until release** (§189). Once a pinch closes, the target is fixed
 * until the hand opens, however far it travels and whatever it passes over.
 * Without this, dragging a chart far enough would hand the rest of the drag to
 * whatever the hand crossed on the way — the scene would stop responding
 * mid-movement and something else would start turning. §189 calls this essential
 * for predictable interaction, and it is: the alternative is a gesture whose
 * meaning changes underneath the person making it.
 *
 * **A locked target is kept even when it is no longer under the hand**, which is
 * the whole point. A drag that starts on a chart and leaves it is still that
 * chart's drag.
 */

export type Rect = { x: number; y: number; width: number; height: number };

/** Anything that can be addressed by a hand, and can say where it is. */
export type Addressable = {
  bounds(): Rect | null;
};

export type TargetChoice<T extends Addressable> = {
  target: T | null;
  /** Whether this was held from a previous frame rather than chosen afresh. */
  locked: boolean;
};

/**
 * Where a hand points, in the coordinates of the window.
 *
 * Mirrored in x, because a webcam image is a mirror — identical to
 * `SpatialMachine.toScreen` and deliberately so. A hand that chose one chart and
 * hovered a mark on another would be two features contradicting each other on
 * the same screen.
 */
export function pointerFor(normalised: { x: number; y: number },
                           window: { width: number; height: number }): Rect {
  return {
    x: (1 - normalised.x) * window.width,
    y: normalised.y * window.height,
    width: 0,
    height: 0,
  };
}

function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width
      && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function distanceTo(rect: Rect, point: { x: number; y: number }): number {
  // Distance to the rectangle, zero inside it. Used only to break a tie between
  // overlapping charts, never to reach one the hand is not over.
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * Which target this frame belongs to.
 *
 * `heldTarget` is whatever was chosen while the hand was last closed; passing
 * `engaged` keeps it. The caller owns that state because it knows what counts as
 * engaged — a pinch here, and later a two-handed hold or an armed pen.
 */
export function chooseTarget<T extends Addressable>(
  candidates: readonly T[],
  pointer: { x: number; y: number },
  options: { engaged: boolean; heldTarget: T | null },
): TargetChoice<T> {
  // §189. Checked before anything else, and deliberately without asking whether
  // the held target is still under the hand: a drag that leaves the chart it
  // started on is still that chart's drag.
  if (options.engaged && options.heldTarget
      && candidates.includes(options.heldTarget)) {
    return { target: options.heldTarget, locked: true };
  }

  const measured = candidates
    .map((target) => ({ target, rect: target.bounds() }))
    .filter((entry): entry is { target: T; rect: Rect } => entry.rect !== null);

  if (measured.length === 0) return { target: null, locked: false };

  const under = measured.filter((entry) => contains(entry.rect, pointer));
  if (under.length === 1) return { target: under[0].target, locked: false };
  if (under.length > 1) {
    // Overlapping figures: the nearest centre wins, which is the one the hand is
    // most plainly on rather than the one that happens to be first in the DOM.
    const best = under.reduce((a, b) =>
      centreDistance(a.rect, pointer) <= centreDistance(b.rect, pointer) ? a : b);
    return { target: best.target, locked: false };
  }

  /*
   * Nothing under the hand, so nothing is addressed.
   *
   * Deliberately not "the nearest chart". A hand resting beside the figures, or
   * gesturing while the researcher talks, would otherwise be quietly steering
   * whichever one happened to be closest — which is Rule 2's failure and the
   * reason a gesture layer gets switched off. `distanceTo` exists to rank
   * overlaps, not to reach across the page.
   */
  void distanceTo;
  return { target: null, locked: false };
}

function centreDistance(rect: Rect, point: { x: number; y: number }): number {
  return Math.hypot(rect.x + rect.width / 2 - point.x,
                    rect.y + rect.height / 2 - point.y);
}
