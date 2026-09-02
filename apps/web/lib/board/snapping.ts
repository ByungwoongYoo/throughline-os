/**
 * Cards that line up, and the guides that say why (§54).
 *
 * §54 asks for alignment guides and magnetic snapping on the workboard, and
 * neither existed — the section had been recorded as built on the strength of
 * the resizable shell panels, which are a different thing entirely (D183).
 * Dragging a card left it wherever the pointer stopped, so a board a
 * researcher had tidied drifted a pixel out of line every time they touched
 * it.
 *
 * **The threshold is in screen pixels, not world units.** This is the whole
 * subtlety. The board has a camera with a zoom, and a card's coordinates are
 * in world space; a fixed world threshold would feel sticky when zoomed out
 * and dead when zoomed in, because the same eight units are eight pixels at
 * 1x and eighty at 10x. Snapping is a property of the hand, not of the data,
 * so the threshold is converted through the zoom.
 *
 * **The nearest candidate wins, per axis, independently.** A card can snap its
 * left edge to one neighbour and its vertical centre to another, which is what
 * a person arranging a grid actually does. Taking the first match instead of
 * the nearest makes the behaviour depend on the order cards happen to be
 * stored in — the same class of bug as a chart that draws in insertion order
 * and calls it depth.
 *
 * **Nothing snaps to itself**, and a board with one card snaps to nothing.
 * Both are ordinary and both produce a divide-by-nothing or a card frozen to
 * its own edge if left unhandled.
 */

export type Rect = { x: number; y: number; width: number; height: number };

/** A line to draw while dragging, in world coordinates. */
export type Guide =
  | { axis: "x"; at: number; from: number; to: number }
  | { axis: "y"; at: number; from: number; to: number };

/**
 * How close, in *screen* pixels, before a card is pulled into line.
 *
 * Eight is about a finger's worth of imprecision at 1x. Much larger and a card
 * refuses to sit where it was put; much smaller and the feature is a rumour.
 */
export const SNAP_PIXELS = 8;

/** The three interesting positions on an axis: both edges and the centre. */
function anchorsX(rect: Rect): number[] {
  return [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
}
function anchorsY(rect: Rect): number[] {
  return [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
}

type Best = { delta: number; at: number; other: Rect } | null;

function nearest(moving: number[], candidates: Rect[],
                 anchorsOf: (r: Rect) => number[], within: number): Best {
  let best: Best = null;
  for (const other of candidates) {
    for (const target of anchorsOf(other)) {
      for (const mine of moving) {
        const delta = target - mine;
        if (Math.abs(delta) > within) continue;
        if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, at: target, other };
        }
      }
    }
  }
  return best;
}

/**
 * Where a dragged card should actually land, and the guides to draw.
 *
 * `zoom` is the camera's, and `others` must not contain the moving card —
 * the caller knows which one is moving and this cannot tell.
 */
export function snap(moving: Rect, others: Rect[], zoom: number): {
  x: number; y: number; guides: Guide[];
} {
  // A zoom of zero or less is not a view anybody is looking through; treat the
  // threshold as its unscaled self rather than dividing by it.
  const within = zoom > 0 ? SNAP_PIXELS / zoom : SNAP_PIXELS;
  const guides: Guide[] = [];

  const alongX = nearest(anchorsX(moving), others, anchorsX, within);
  const alongY = nearest(anchorsY(moving), others, anchorsY, within);

  const x = moving.x + (alongX ? alongX.delta : 0);
  const y = moving.y + (alongY ? alongY.delta : 0);

  /*
   * The guide spans both cards rather than the whole board. A full-height line
   * says "something up there is aligned"; a line from one card to the other
   * says which, which is the question a person actually has.
   */
  if (alongX) {
    const settled = { ...moving, x, y };
    guides.push({
      axis: "x", at: alongX.at,
      from: Math.min(settled.y, alongX.other.y),
      to: Math.max(settled.y + settled.height,
                   alongX.other.y + alongX.other.height),
    });
  }
  if (alongY) {
    const settled = { ...moving, x, y };
    guides.push({
      axis: "y", at: alongY.at,
      from: Math.min(settled.x, alongY.other.x),
      to: Math.max(settled.x + settled.width,
                   alongY.other.x + alongY.other.width),
    });
  }
  return { x, y, guides };
}
