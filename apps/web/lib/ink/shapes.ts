/**
 * Reading a drawn mark as a shape (§181), without ever replacing it (§174).
 *
 * A circle drawn in mid-air is a wobbly polygon. In a figure somebody publishes
 * it looks careless, and the researcher's choice is to accept that or to leave
 * the annotation out — so offering a clean one is worth doing. What is not worth
 * doing is any version of it that loses the original.
 *
 * **Recognition happens after the stroke finishes** (§181, explicitly). Morphing
 * a line into a circle while the hand is still moving takes the drawing away
 * from the person doing it: they aim, the shape jumps, they correct, it jumps
 * again. The stroke is read once, when it is done.
 *
 * **The answer may be "a scribble", and often should be.** Every recogniser that
 * always returns its best guess turns every mark into whichever shape it
 * resembles least badly, and a researcher who drew a deliberate irregular
 * boundary gets an ellipse. So each candidate is scored against how far the
 * points actually lie from it, and a mark that fits nothing well is reported as
 * fitting nothing.
 *
 * **Nothing here mutates a stroke.** `recognise` returns a description and a set
 * of points; whether to use them is the caller's decision and, per §197, the
 * researcher's. `originalPoints` is untouched in every path, so a tidied
 * annotation can always say what was actually drawn.
 *
 * Deliberately geometry rather than a model. These shapes are defined by
 * measurable properties — constant radius, four right angles, low residual to a
 * line — and a recogniser that can explain itself in those terms is one whose
 * mistakes can be reasoned about. A learned classifier here would be a
 * dependency, a download, and an answer nobody could interrogate.
 */

import { StrokePoint } from "./stroke";

export type ShapeKind =
  | "line" | "circle" | "ellipse" | "rectangle" | "polygon" | "arrow" | "bracket";

export type Shape = {
  kind: ShapeKind;
  /**
   * How well the mark fits, from 0 to 1.
   *
   * One minus the mean distance from the fitted shape, relative to the mark's
   * own size — so it does not quietly become stricter on small annotations.
   */
  confidence: number;
  /** A clean version, in the same coordinates the stroke was drawn in. */
  points: Array<{ x: number; y: number }>;
  /** For a person deciding whether to accept it. */
  description: string;
};

/**
 * Below this, a mark is reported as fitting nothing.
 *
 * Chosen so a deliberately irregular boundary — the case §174 exists to protect
 * — is not rounded off into an ellipse. It is better to offer nothing than to
 * offer a shape the researcher did not draw.
 */
export const MIN_CONFIDENCE = 0.82;

type Point = { x: number; y: number };

function centroidOf(points: readonly Point[]): Point {
  const sum = points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }),
                            { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** The mark's own size, used to keep every score scale-free. */
function extentOf(points: readonly Point[]): number {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs),
                  Math.max(...ys) - Math.min(...ys));
}

/**
 * How well a mark fits a shape, scored from its *worst* parts rather than its
 * average one.
 *
 * The mean was wrong and a test caught it. A loop with seven deliberate lobes —
 * exactly the irregular boundary §174 exists to protect — scored 0.93 and was
 * offered as a circle, because a seventh of the points being 35% out is a small
 * number once it is averaged against the six sevenths that fit. Averaging is the
 * wrong summary for "does this look like a circle to a person": nobody looks at
 * the mean deviation, they look at the bits that stick out.
 *
 * The 90th percentile instead. Sensitive to a systematic departure, which is
 * what a lobe is, and still tolerant of one or two tracker spikes, which is what
 * the maximum would not be.
 */
function scoreFrom(residuals: readonly number[], extent: number): number {
  if (extent <= 0 || residuals.length === 0) return 0;
  const sorted = [...residuals].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1,
                        Math.max(0, Math.ceil(0.9 * sorted.length) - 1));
  return Math.max(0, 1 - (sorted[rank] / extent) * 4);
}

function isClosedEnough(points: readonly Point[]): boolean {
  const gap = Math.hypot(points[0].x - points[points.length - 1].x,
                         points[0].y - points[points.length - 1].y);
  return gap < extentOf(points) * 0.35;
}

/** Distance from a point to the infinite line through a and b. */
function distanceToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
}

function asLine(points: readonly Point[]): Shape | null {
  if (isClosedEnough(points)) return null;
  const a = points[0], b = points[points.length - 1];
  const extent = extentOf(points);
  const confidence = scoreFrom(points.map((p) => distanceToLine(p, a, b)), extent);
  return {
    kind: "line", confidence, points: [a, b],
    description: "a straight line",
  };
}

function asCircle(points: readonly Point[]): Shape | null {
  if (!isClosedEnough(points)) return null;
  const centre = centroidOf(points);
  const radii = points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y));
  const radius = radii.reduce((a, b) => a + b, 0) / radii.length;
  const confidence = scoreFrom(radii.map((r) => Math.abs(r - radius)),
                               extentOf(points));
  return {
    kind: "circle", confidence,
    points: ring(24, (t) => ({ x: centre.x + Math.cos(t) * radius,
                               y: centre.y + Math.sin(t) * radius })),
    description: `a circle of radius ${Math.round(radius)}`,
  };
}

/**
 * An ellipse, from the spread of the points along their own principal axes.
 *
 * Not a least-squares conic fit: that is more accurate on clean input and much
 * less stable on a hand-drawn loop, where a few points near one end can swing
 * the solution. The axis-aligned-to-its-own-spread version degrades gently,
 * which is the property that matters for a mark made by an arm in the air.
 */
function asEllipse(points: readonly Point[]): Shape | null {
  if (!isClosedEnough(points)) return null;
  const centre = centroidOf(points);
  const local = points.map((p) => ({ x: p.x - centre.x, y: p.y - centre.y }));

  // The principal axis, from the 2x2 covariance.
  const sxx = local.reduce((a, p) => a + p.x * p.x, 0) / local.length;
  const syy = local.reduce((a, p) => a + p.y * p.y, 0) / local.length;
  const sxy = local.reduce((a, p) => a + p.x * p.y, 0) / local.length;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(angle), sin = Math.sin(angle);

  const along = local.map((p) => p.x * cos + p.y * sin);
  const across = local.map((p) => -p.x * sin + p.y * cos);
  const a = Math.max(...along.map(Math.abs));
  const b = Math.max(...across.map(Math.abs));
  if (a <= 0 || b <= 0) return null;

  // How far each point is from the unit ellipse, scaled back into pixels.
  const residuals = local.map((_, i) => {
    const u = along[i] / a, v = across[i] / b;
    return Math.abs(Math.hypot(u, v) - 1) * Math.min(a, b);
  });

  return {
    kind: "ellipse", confidence: scoreFrom(residuals, extentOf(points)),
    points: ring(28, (t) => {
      const x = Math.cos(t) * a, y = Math.sin(t) * b;
      return { x: centre.x + x * cos - y * sin, y: centre.y + x * sin + y * cos };
    }),
    description: "an ellipse",
  };
}

/**
 * A rectangle, aligned to the mark's own principal axis.
 *
 * Axis-aligned to the *drawing*, not to the screen: a researcher sketching a
 * region on a rotated figure draws a rotated rectangle, and snapping it upright
 * would move the annotation off what it was drawn around.
 */
function asRectangle(points: readonly Point[]): Shape | null {
  if (!isClosedEnough(points)) return null;
  const centre = centroidOf(points);
  const local = points.map((p) => ({ x: p.x - centre.x, y: p.y - centre.y }));
  const sxx = local.reduce((a, p) => a + p.x * p.x, 0) / local.length;
  const syy = local.reduce((a, p) => a + p.y * p.y, 0) / local.length;
  const sxy = local.reduce((a, p) => a + p.x * p.y, 0) / local.length;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(angle), sin = Math.sin(angle);

  const along = local.map((p) => p.x * cos + p.y * sin);
  const across = local.map((p) => -p.x * sin + p.y * cos);
  const a = Math.max(...along.map(Math.abs));
  const b = Math.max(...across.map(Math.abs));
  if (a <= 0 || b <= 0) return null;

  // Distance to the rectangle's outline: how far outside, or how far from the
  // nearest edge when inside.
  const residuals = local.map((_, i) => {
    const u = Math.abs(along[i]), v = Math.abs(across[i]);
    return Math.min(Math.abs(u - a), Math.abs(v - b));
  });

  const corners: Point[] = [[a, b], [a, -b], [-a, -b], [-a, b], [a, b]]
    .map(([x, y]) => ({ x: centre.x + x * cos - y * sin,
                        y: centre.y + x * sin + y * cos }));

  return {
    kind: "rectangle", confidence: scoreFrom(residuals, extentOf(points)),
    points: corners, description: "a rectangle",
  };
}

/**
 * Where a mark turns a corner.
 *
 * Measured over a window rather than between adjacent points: consecutive
 * samples from a hand are a couple of pixels apart and their angle is almost
 * entirely tremor, so a per-point turn finds a corner every few samples along a
 * line somebody drew straight. The window is a fraction of the mark's own
 * length, which keeps it working on a small annotation and a large one.
 *
 * Neighbouring detections are merged, because a real corner is rounded by the
 * hand and by the smoothing and shows up as a run of turning rather than a
 * spike.
 */
export function cornersOf(points: readonly Point[],
                          minimumTurn = Math.PI / 5,
                          closed = isClosedEnough(points)): number[] {
  const window = Math.max(2, Math.round(points.length / 12));
  if (points.length < window * 2 + 1) return [];

  /*
   * A closed mark is walked cyclically, and that is not a refinement.
   *
   * Without it the corner at the *seam* — where the stroke ends where it began —
   * is invisible, because the first and last window of points have no
   * neighbours to measure against. A hand-drawn triangle came back with two
   * corners and was offered as a circle: the shape was right, the corner count
   * was one short, and the score collapsed. Every closed polygon has a corner at
   * its seam roughly a third of the time, so this was not an edge case.
   */
  const n = points.length;
  const at = (i: number) => points[closed ? ((i % n) + n) % n : i];
  const from = closed ? 0 : window;
  const to = closed ? n : n - window;

  const turns: Array<{ index: number; turn: number }> = [];
  for (let i = from; i < to; i += 1) {
    const before = at(i - window), after = at(i + window);
    const here = at(i);
    const a = Math.atan2(here.y - before.y, here.x - before.x);
    const b = Math.atan2(after.y - here.y, after.x - here.x);
    let turn = Math.abs(b - a);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    if (turn >= minimumTurn) turns.push({ index: i, turn });
  }

  // One corner per run of turning: keep the sharpest of each cluster.
  const corners: number[] = [];
  let cluster: Array<{ index: number; turn: number }> = [];
  for (const entry of turns) {
    if (cluster.length && entry.index - cluster[cluster.length - 1].index > window) {
      corners.push(cluster.reduce((a, b) => (a.turn >= b.turn ? a : b)).index);
      cluster = [];
    }
    cluster.push(entry);
  }
  if (cluster.length) {
    corners.push(cluster.reduce((a, b) => (a.turn >= b.turn ? a : b)).index);
  }

  // The clustering wraps too, for the same reason the walk does: a corner
  // sitting on the seam is detected once just after index 0 and again just
  // before the end, and counting it twice turns a triangle into a quadrilateral.
  if (closed && corners.length > 1) {
    const first = corners[0], last = corners[corners.length - 1];
    if (n - last + first <= window) corners.pop();
  }
  return corners;
}

/** Distance from a point to the segment ab, not to the infinite line. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How far the mark strays from the outline through its own corners. */
function residualsToPath(points: readonly Point[], path: readonly Point[]) {
  return points.map((p) => {
    let best = Infinity;
    for (let i = 1; i < path.length; i += 1) {
      best = Math.min(best, distanceToSegment(p, path[i - 1], path[i]));
    }
    return best;
  });
}

/**
 * A closed mark with corners: a triangle, a pentagon, anything up to an octagon.
 *
 * Scored against the outline through its own corners rather than against a
 * regular polygon — a researcher sketching a region draws the shape of the
 * region, and regularising it would move the annotation off what it surrounds.
 */
function asPolygon(points: readonly Point[]): Shape | null {
  if (!isClosedEnough(points)) return null;
  const corners = cornersOf(points);
  if (corners.length < 3 || corners.length > 8) return null;

  /*
   * Four near-right corners is a rectangle, and `asRectangle` says so.
   *
   * A rectangle *is* a quadrilateral, so this scored well and won — leaving the
   * researcher told they had drawn "a 4-sided shape". True, and useless: the
   * more specific name is the informative one, and it is the one that carries a
   * rotation and a pair of side lengths with it.
   */
  if (corners.length === 4) {
    const right = corners.every((index, k) => {
      const before = points[corners[(k + 3) % 4]];
      const here = points[index];
      const after = points[corners[(k + 1) % 4]];
      const a = Math.atan2(here.y - before.y, here.x - before.x);
      const b = Math.atan2(after.y - here.y, after.x - here.x);
      let turn = Math.abs(b - a);
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      return Math.abs(turn - Math.PI / 2) < 0.45;
    });
    if (right) return null;
  }

  const outline = [...corners.map((i) => points[i])];
  outline.push(outline[0]);
  const confidence = scoreFrom(residualsToPath(points, outline), extentOf(points));
  return {
    kind: "polygon", confidence, points: outline,
    description: `a ${corners.length}-sided shape`,
  };
}

/**
 * A bracket: two corners, an open mark, with both ends turning the same way.
 *
 * The same-way test is what separates a bracket from a zigzag. Without it, any
 * mark that changed direction twice would be offered as one.
 */
function asBracket(points: readonly Point[]): Shape | null {
  if (isClosedEnough(points)) return null;
  const corners = cornersOf(points, Math.PI / 4);
  if (corners.length !== 2) return null;

  const path = [points[0], points[corners[0]], points[corners[1]],
                points[points.length - 1]];
  // Both ends must leave the spine on the same side, or it is a zigzag.
  const spine = { x: path[2].x - path[1].x, y: path[2].y - path[1].y };
  const side = (p: Point) =>
    Math.sign((p.x - path[1].x) * spine.y - (p.y - path[1].y) * spine.x);
  if (side(path[0]) === 0 || side(path[0]) !== side(path[3])) return null;

  return {
    kind: "bracket", confidence: scoreFrom(residualsToPath(points, path),
                                           extentOf(points)),
    points: path, description: "a bracket",
  };
}

/**
 * An arrow: a long shaft with a short barb turned back at the end.
 *
 * Defined by the proportion rather than by the angle alone, because a line with
 * a slight hook at the end — which is what a hand does when it stops — would
 * otherwise be offered as an arrow every time.
 */
function asArrow(points: readonly Point[]): Shape | null {
  if (isClosedEnough(points)) return null;
  const corners = cornersOf(points, Math.PI / 3);
  if (corners.length !== 1) return null;

  const corner = corners[0];
  const tip = points[corner];
  const shaft = Math.hypot(tip.x - points[0].x, tip.y - points[0].y);
  const barb = Math.hypot(points[points.length - 1].x - tip.x,
                          points[points.length - 1].y - tip.y);
  // A barb is a fraction of the shaft. Anything longer is a bent line, and
  // anything shorter is the flick a hand makes when it stops.
  if (shaft <= 0 || barb / shaft > 0.45 || barb / shaft < 0.08) return null;

  const path = [points[0], tip, points[points.length - 1]];
  return {
    kind: "arrow", confidence: scoreFrom(residualsToPath(points, path),
                                         extentOf(points)),
    points: arrowOutline(points[0], tip, barb),
    description: "an arrow",
  };
}

/** A shaft with two symmetrical barbs, which is what people mean by an arrow. */
function arrowOutline(from: Point, tip: Point, barb: number): Point[] {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = Math.PI / 7;
  const at = (turn: number) => ({
    x: tip.x - Math.cos(angle + turn) * barb,
    y: tip.y - Math.sin(angle + turn) * barb,
  });
  return [from, tip, at(spread), tip, at(-spread)];
}

function ring(count: number, at: (t: number) => Point): Point[] {
  return Array.from({ length: count + 1 },
                    (_, i) => at((i / count) * Math.PI * 2));
}

/**
 * Read a finished mark as a shape, or report that it is not one.
 *
 * Every candidate is scored and the best is returned only if it clears
 * `MIN_CONFIDENCE`. Returning the best guess unconditionally is what turns a
 * deliberately irregular boundary into an ellipse, which is precisely what §174
 * forbids.
 */
export function recognise(points: readonly StrokePoint[],
                          minimum = MIN_CONFIDENCE): Shape | null {
  // Too few points to have a shape. Three is a corner, not a rectangle.
  if (points.length < 8) return null;

  const plain: Point[] = points.map((p) => ({ x: p.x, y: p.y }));
  if (extentOf(plain) <= 0) return null;

  const candidates = [asLine(plain), asCircle(plain), asEllipse(plain),
                      asRectangle(plain), asPolygon(plain), asArrow(plain),
                      asBracket(plain)]
    .filter((s): s is Shape => s !== null);
  if (candidates.length === 0) return null;

  const best = candidates.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
  return best.confidence >= minimum ? best : null;
}

/**
 * What to ask before tidying anything (§197).
 *
 * The researcher decides. A stroke silently replaced by a neater one is a
 * change to what they said, and the whole value of offering it depends on their
 * being able to decline.
 */
export function describeShape(shape: Shape | null): string {
  if (!shape) return "That does not look like a shape — it will stay as drawn.";
  return `That looks like ${shape.description}. Tidy it? `
       + "What you drew is kept either way.";
}
