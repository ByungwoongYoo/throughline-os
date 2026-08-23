/**
 * Air Ink: what a stroke *is*, before anything draws one.
 *
 * The temptation with hand drawing is to treat a stroke as a trail of pixels and
 * be done. That produces a whiteboard, and a whiteboard is not a research
 * instrument — a circle drawn round a cluster is only useful if the system can
 * later say *which 243 observations* were inside it, and can still say so after
 * the chart is resized, re-scaled or rotated.
 *
 * So a stroke carries the space it was drawn in, and that choice is the whole
 * design:
 *
 *   - **screen** — over a document or a static panel. Pixels are the truth.
 *   - **object** — attached to a research object, moving when it moves.
 *   - **data** — in the chart's own coordinates. A circle round `x = 42–57`
 *     stays round those values when the axes rescale, because the stroke was
 *     never really about pixels.
 *   - **world** — free in the 3D scene.
 *   - **surface** — adhering to a mesh, so an annotation on a protein stays on
 *     the protein when it turns.
 *
 * Two things are kept that a drawing app would discard.
 *
 * **The original points, always.** Beautification, shape fitting and handwriting
 * recognition all produce a *second* version. A researcher who deliberately drew
 * an irregular boundary meant that boundary, and a system that replaces it with
 * a tidy ellipse has quietly changed what they said (§174).
 *
 * **A timestamp per point.** Speech and gesture have to be fused on a shared
 * clock — "why are *these*" said while a circle is closing is only resolvable if
 * both carry time (§199, §219). It is also the only way to measure the latency
 * the whole subsystem is judged on.
 */

export type InkCoordinateSpace =
  | "screen"
  | "object"
  | "data"
  | "world"
  | "surface";

export type InkTool = "pen" | "highlighter" | "eraser" | "lasso";

export type StrokePoint = {
  x: number;
  y: number;
  /** Present for world and surface strokes. */
  z?: number;
  /** Milliseconds, monotonic. Shared clock with speech and gesture. */
  timestamp: number;
  /** The tracker's confidence in the hand this point came from. */
  confidence: number;
  /**
   * Whether this point was predicted rather than observed.
   *
   * Recorded rather than hidden: a predicted point is a guess made to cover
   * camera and inference latency, and it must never end up inside a selection
   * polygon or a measurement claiming to be what the researcher drew.
   */
  predicted?: boolean;
};

export type StrokeStyle = {
  colour: string;
  width: number;
  opacity: number;
  dashed?: boolean;
};

export const DEFAULT_STYLE: StrokeStyle = {
  colour: "#1443B8",
  width: 2.5,
  opacity: 0.95,
};

export type SpatialStroke = {
  id: string;
  tool: InkTool;
  space: InkCoordinateSpace;
  /** Which research object this is attached to, for object/data/surface ink. */
  parentObjectId?: string;
  style: StrokeStyle;
  /** Exactly what the hand did. Never rewritten. */
  originalPoints: StrokePoint[];
  /** Smoothed for drawing. Derived, and discardable. */
  points: StrokePoint[];
  createdAt: number;
  createdBy: string;
  /**
   * The stroke this was split from, if it was (§178).
   *
   * Erasing the middle of a mark leaves two, and a fragment with no ancestry is
   * indistinguishable from something the researcher drew separately — which
   * matters the moment anything downstream asks what an annotation was, or how
   * many marks a figure carries.
   */
  derivedFrom?: string;
  /**
   * The shape this was tidied into, if the researcher accepted one (§181).
   *
   * Recorded rather than implied, so a figure can always distinguish a circle
   * somebody drew from a circle the system offered and they agreed to.
   * `originalPoints` is untouched either way — the tidy changes `points`, which
   * is the drawn copy, and never the record.
   */
  interpretation?: { kind: string; confidence: number };
  /**
   * How the chart was being looked at when this was drawn (§143).
   *
   * Present for screen-space ink over a rotatable scene, which is the case with
   * no honest data-space conversion: a loop on screen picks out a set of marks,
   * but rotate the scene and the marks move while the annotation stays, so a
   * circle that meant "these four" comes to mean nothing — silently, and while
   * still looking like a deliberate annotation.
   *
   * A 2D chart does not need this, because a screen loop there *does* convert to
   * data coordinates. Storing the view is the answer for the case where the
   * conversion is ill-posed rather than merely unimplemented: depth is ambiguous
   * from a single projection, so there is no region of data the researcher can
   * be said to have circled independently of where they were standing.
   */
  viewState?: Readonly<Record<string, number>>;
};

let counter = 0;

export function newStrokeId(): string {
  counter += 1;
  return `ink_${Date.now().toString(36)}_${counter}`;
}

/**
 * Points the researcher actually made.
 *
 * Used wherever a stroke is turned into a claim about data — a selection, a
 * measurement, a region. Predicted points exist to keep the line under the
 * fingertip while the camera catches up; treating them as observations would
 * mean a selection could contain a point the hand never visited.
 */
export function observedPoints(stroke: SpatialStroke): StrokePoint[] {
  return stroke.originalPoints.filter((point) => !point.predicted);
}

/** Total path length, in whatever units the stroke's space uses. */
export function strokeLength(points: StrokePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x,
                        points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Whether a stroke is closed enough to be read as a region.
 *
 * Nobody draws a closed loop by hand. The test is the gap between the ends
 * relative to the path travelled: a circle drawn round a cluster ends near where
 * it began after a long journey, while a line ends far away after a short one.
 * A fixed pixel tolerance would fail at both extremes of zoom.
 */
export function isClosed(points: StrokePoint[], tolerance = 0.22): boolean {
  if (points.length < 8) return false;
  const first = points[0];
  const last = points[points.length - 1];
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  const length = strokeLength(points);
  if (length <= 0) return false;
  return gap / length < tolerance;
}

/**
 * Whether a point lies inside a stroke read as a polygon.
 *
 * Ray casting, with the stroke implicitly closed. This is what turns a circle
 * into a selection, so it runs on observed points only — see `observedPoints`.
 */
export function containsPoint(polygon: Array<{ x: number; y: number }>,
                              point: { x: number; y: number }): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
        && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Drop points that are too close together to matter.
 *
 * A 30 Hz hand held nearly still emits dozens of points inside a pixel. Kept,
 * they cost memory and make every later geometric test slower without adding
 * information — and they make a "closed" test noisier, because path length
 * accumulates while the hand goes nowhere.
 */
export function resample(points: StrokePoint[], minimumGap = 1.2): StrokePoint[] {
  if (points.length === 0) return [];
  const kept = [points[0]];
  for (const point of points.slice(1)) {
    const last = kept[kept.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= minimumGap) {
      kept.push(point);
    }
  }
  // The final point is always kept: it is where the hand actually stopped, and
  // dropping it moves the end of the stroke somewhere the researcher did not
  // put it — which matters most for a closed region.
  const last = points[points.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}
