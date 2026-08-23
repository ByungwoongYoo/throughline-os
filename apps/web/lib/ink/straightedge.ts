/**
 * Drawing a straight line with an unsupported arm (§182).
 *
 * A hand in mid-air cannot draw a straight line, and no amount of smoothing
 * makes it able to — smoothing removes tremor, and the problem is not tremor but
 * that an arm rotates about a shoulder while the researcher believes they are
 * moving it sideways. The result bows. For an annotation on a figure that is
 * fine; for an axis marker, a trend line or the edge of a region it is not, and
 * the researcher's only recourse today is to draw it again and accept whichever
 * attempt bowed least.
 *
 * So the constraint is applied *while drawing*, which is the opposite of how
 * shape recognition works (§181) and deliberately so. A shape offer must wait
 * until the stroke is finished, because morphing a mark under a moving hand
 * takes the drawing away from the person doing it. A straightedge is not an
 * interpretation of what somebody drew — it is a **tool they picked up before
 * they started**, and a ruler that only became straight after you lifted the pen
 * would be useless.
 *
 * **Magnetic rather than absolute** (§182's word). In `magnetic` mode a stroke
 * near a horizontal, vertical or 45-degree line is pulled onto it and a stroke
 * that is plainly none of those is left alone. A hard snap-to-nearest would make
 * every deliberately oblique line jump to 45 degrees, which is worse than no
 * constraint at all: the researcher would be fighting the tool rather than using
 * it.
 */

export type Straightedge =
  /** No constraint. The hand draws what it draws. */
  | "off"
  /** A straight line in whatever direction the stroke set off in. */
  | "line"
  | "horizontal"
  | "vertical"
  /** Snapped to the nearest 45 degrees. */
  | "diagonal"
  /** Pulled onto an axis or a diagonal only when it is already near one. */
  | "magnetic";

export type Point = { x: number; y: number };

/**
 * How close a stroke must be to a constraint before it is pulled onto it.
 *
 * About twelve degrees. Wide enough that somebody aiming for horizontal gets
 * horizontal without being precise, narrow enough that a line drawn at thirty
 * degrees is understood as thirty degrees.
 */
export const MAGNETIC_TOLERANCE = 0.21;

/** The directions `magnetic` recognises: the axes and the diagonals. */
const CARDINALS = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];

/** Project `point` onto the line through `anchor` in direction `angle`. */
function project(anchor: Point, point: Point, angle: number): Point {
  const dx = point.x - anchor.x, dy = point.y - anchor.y;
  // The component along the direction; the perpendicular part is discarded,
  // which is exactly what a ruler does.
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  return { x: anchor.x + Math.cos(angle) * along,
           y: anchor.y + Math.sin(angle) * along };
}

/** The smallest angle between two directions, ignoring which way along. */
function angleBetween(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

/**
 * Apply the straightedge to one point.
 *
 * `anchor` is where the stroke began and `heading` the direction it set off in,
 * measured once and passed back in — recomputing the heading from the current
 * point every frame would let it drift as the line grew, so a stroke that began
 * horizontally would slowly follow the hand off horizontal, which is precisely
 * the bowing this exists to prevent.
 */
export function constrain(anchor: Point, point: Point, mode: Straightedge,
                          heading: number | null): Point {
  switch (mode) {
    case "off":
      return point;
    case "horizontal":
      return { x: point.x, y: anchor.y };
    case "vertical":
      return { x: anchor.x, y: point.y };
    case "diagonal": {
      const angle = Math.atan2(point.y - anchor.y, point.x - anchor.x);
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      return project(anchor, point, snapped);
    }
    case "line":
      // Nothing to hold to until the stroke has a direction of its own.
      return heading === null ? point : project(anchor, point, heading);
    case "magnetic": {
      if (heading === null) return point;
      const nearest = CARDINALS.reduce((a, b) =>
        (angleBetween(heading, a) <= angleBetween(heading, b) ? a : b));
      // Left alone unless it is already close to an axis or a diagonal. A hard
      // snap-to-nearest would drag every deliberately oblique line onto 45
      // degrees, and the researcher would be fighting the tool.
      if (angleBetween(heading, nearest) > MAGNETIC_TOLERANCE) return point;
      return project(anchor, point, nearest);
    }
  }
}

/**
 * The direction a stroke has set off in, once it has gone far enough to have one.
 *
 * Returns null below a minimum distance. The first few samples of any stroke are
 * a hand accelerating from rest, and their direction is mostly noise — locking a
 * ruler to that would produce a perfectly straight line pointing somewhere the
 * researcher never intended, which is a worse failure than a line that bows.
 */
export function headingOf(anchor: Point, points: readonly Point[],
                          minimumDistance = 18): number | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const dx = points[i].x - anchor.x, dy = points[i].y - anchor.y;
    if (Math.hypot(dx, dy) >= minimumDistance) return Math.atan2(dy, dx);
  }
  return null;
}

/** What each setting does, for a control that has to explain itself. */
export const STRAIGHTEDGE_LABEL: Record<Straightedge, string> = {
  off: "Free",
  line: "Straight",
  horizontal: "Horizontal",
  vertical: "Vertical",
  diagonal: "45°",
  magnetic: "Magnetic",
};

export const STRAIGHTEDGE_HELP: Record<Straightedge, string> = {
  off: "The line follows your hand exactly.",
  line: "The line holds the direction it started in.",
  horizontal: "The line stays level, however your hand drifts.",
  vertical: "The line stays upright, however your hand drifts.",
  diagonal: "The line snaps to the nearest 45 degrees.",
  magnetic: "Level, upright and 45° pull the line in when it is already close; "
          + "anything else is left as you drew it.",
};
