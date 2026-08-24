/**
 * Taking ink away (§175–§178).
 *
 * **The eraser is measured against the path, not against its samples.** A hand
 * moving at 30 Hz leaves the eraser's centre in a dozen places a second, and
 * testing a stroke only against those points leaves untouched gaps wherever the
 * hand moved faster than the sampling — a wipe across a line that visibly
 * removes most of it and leaves flecks behind. This is the same defect as the
 * sampled region selection in T038, and it is the same fix: measure against the
 * continuous thing rather than against a discrete approximation of it. Distance
 * here is to the eraser's *segments*.
 *
 * **Erasing the middle of a stroke splits it** (§178). A researcher rubbing out
 * the centre of a line expects two lines, not the whole line gone and not a
 * line with an invisible hole in it. So the surviving runs of a stroke become
 * strokes in their own right.
 *
 * **A fragment is a subsequence, never a redrawing.** Its points are the points
 * the hand made, minus the ones erased — nothing is resampled, interpolated or
 * fitted on the way out. §174 forbids replacing what somebody drew with a
 * tidier version of it, and that applies to the remains of a stroke as much as
 * to the whole.
 *
 * **Nothing here mutates.** Erasing returns new strokes and leaves the originals
 * untouched, so the undo history can hold the originals and hand them back
 * exactly. A destructive edit that modified in place would make undo a
 * reconstruction, and a reconstruction eventually differs.
 */

import { SpatialStroke, StrokePoint, newStrokeId } from "./stroke";

export type ErasePath = ReadonlyArray<{ x: number; y: number }>;

export type EraseResult = {
  /** What the canvas becomes: untouched strokes plus the fragments. */
  strokes: SpatialStroke[];
  /** Strokes that were changed or removed, for the undo history. */
  affected: SpatialStroke[];
  /** True when anything at all was erased. */
  changed: boolean;
};

/**
 * How close the eraser has to come to a mark to take it.
 *
 * In the same viewport pixels strokes are recorded in. Roughly a fingertip's
 * worth: large enough that the researcher does not have to trace the line
 * exactly, small enough that passing near a neighbouring mark does not take it
 * as well.
 */
export const ERASER_RADIUS = 14;

/** Shortest distance from a point to a segment, not to its endpoints. */
function distanceToSegment(point: { x: number; y: number },
                           a: { x: number; y: number },
                           b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  // Where the perpendicular falls along the segment, clamped to its ends.
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Whether a point is within `radius` of the eraser's path. */
export function touchedBy(point: { x: number; y: number }, path: ErasePath,
                          radius: number): boolean {
  if (path.length === 0) return false;
  if (path.length === 1) return Math.hypot(point.x - path[0].x,
                                           point.y - path[0].y) <= radius;
  for (let i = 1; i < path.length; i += 1) {
    if (distanceToSegment(point, path[i - 1], path[i]) <= radius) return true;
  }
  return false;
}

/**
 * Erase along a path, splitting strokes rather than removing them whole.
 *
 * Returns the canvas as it becomes. A stroke is left entirely alone when the
 * eraser did not reach it — the same object, not a copy — so an untouched
 * annotation stays identical through any number of erasures.
 */
export function eraseAlong(strokes: readonly SpatialStroke[], path: ErasePath,
                           radius = ERASER_RADIUS,
                           now: () => number = () => Date.now()): EraseResult {
  const out: SpatialStroke[] = [];
  const affected: SpatialStroke[] = [];

  for (const stroke of strokes) {
    const survives = stroke.originalPoints.map(
      (point) => !touchedBy(point, path, radius));

    if (survives.every(Boolean)) {
      // Untouched: the same object, so identity is preserved for anything
      // holding a reference to it.
      out.push(stroke);
      continue;
    }

    affected.push(stroke);
    for (const run of runsOf(stroke.originalPoints, survives)) {
      // A single surviving point is not a mark, for the same reason a one-frame
      // pinch is not: it cannot be drawn as a line, and leaving it would strew
      // invisible dots across the canvas that still answer selections.
      if (run.length < 2) continue;
      out.push(fragmentOf(stroke, run, now));
    }
  }

  return { strokes: out, affected, changed: affected.length > 0 };
}

/** Contiguous runs of surviving points. */
function runsOf(points: readonly StrokePoint[],
                survives: readonly boolean[]): StrokePoint[][] {
  const runs: StrokePoint[][] = [];
  let current: StrokePoint[] = [];
  points.forEach((point, i) => {
    if (survives[i]) current.push(point);
    else if (current.length) { runs.push(current); current = []; }
  });
  if (current.length) runs.push(current);
  return runs;
}

/**
 * One surviving run, as a stroke.
 *
 * Carries `derivedFrom` so provenance survives the edit: an annotation that was
 * once one mark and is now two should be able to say so, and a fragment with no
 * ancestry is indistinguishable from something the researcher drew separately.
 */
function fragmentOf(stroke: SpatialStroke, run: StrokePoint[],
                    now: () => number): SpatialStroke {
  return {
    ...stroke,
    id: newStrokeId(),
    derivedFrom: stroke.derivedFrom ?? stroke.id,
    // The points the hand made, minus the ones erased. Not resampled, not
    // refitted: §174 applies to the remains of a stroke as much as to the whole.
    originalPoints: run,
    points: run,
    createdAt: now(),
  };
}
