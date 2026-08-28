/**
 * Marking a region on a scan, and deciding where that mark may be shown.
 *
 * A highlight drawn on a volume is not a fact about the volume. It is a fact
 * about *a projection* of the volume — this region, seen from this angle, at
 * this window. Rotate the scene and the marked voxels move while the mark
 * stays; move the window and the thing that was circled may not be visible at
 * all. §143 is explicit that a stroke must never be treated as merely screen
 * pixels, and for a rotatable 3D scene there is no honest conversion to data
 * space, so the mark carries the view it was made in and can say when that is
 * no longer the view.
 *
 * **The part that is specific to comparing a case.** Because the whole
 * workspace is held at one shared view, a mark drawn on the received case is —
 * geometrically — at the same view as every other scan on screen. That makes it
 * *possible* to echo the mark onto the others, and possibility is the trap: a
 * region echoed onto a scan the comparability engine refused would assert a
 * correspondence that does not exist. Circling a lesion on a portal-venous CT
 * and showing that same outline on a non-contrast scan invites the reader to
 * conclude the lesion is absent there, when the truth is that the acquisition
 * could not have shown it either way.
 *
 * So a mark is echoed only where the verdict permits comparison, and withheld —
 * visibly, with the reason — everywhere else.
 */

import { ViewState, sameView } from "@/lib/spatial/commands";
import { Verdict, permitsComparison } from "./comparability";

export type Point = { x: number; y: number };

export type Highlight = {
  id: string;
  /** The scan it was drawn on. */
  on: string;
  /** The path, in the canvas coordinates of the scan it was drawn on. */
  points: Point[];
  /** The view it was drawn in. Without this the mark means nothing later. */
  view: ViewState;
  /** What the researcher was marking. Their words, never inferred. */
  note: string;
  /**
   * Who made the mark, and when.
   *
   * Carried because these are shown in a room. A highlight on a scan projected
   * in front of colleagues is read as authoritative unless it says whose
   * judgement it is — and "who marked that?" is the first question anybody
   * asks. The system never fills this in on somebody's behalf and never marks
   * anything itself, so an unattributed mark is a bug rather than a default.
   */
  by: string;
  /** Milliseconds since the epoch, from the machine that made the mark. */
  at: number;
};

/**
 * Marks in the order they were made.
 *
 * Presenting a case is walking through what was noticed, in the order it was
 * noticed. Sorted by time rather than by position on screen: the sequence is
 * the argument, and re-ordering it spatially would rearrange the reasoning.
 */
export function inOrder(marks: Highlight[]): Highlight[] {
  return [...marks].sort((a, b) => a.at - b.at);
}

/**
 * Where a mark stands with respect to one scan, right now.
 *
 * Four outcomes rather than a boolean, because "not shown" has three different
 * reasons and a reader needs to tell them apart: the view moved, the scan
 * cannot be compared, or this simply is not that scan.
 */
export type Standing =
  /** The scan it was drawn on, at the view it was drawn in. */
  | "drawn"
  /** Another scan the case may be compared with, at the same view. */
  | "echoed"
  /** The right scan, but the view has moved since. Offer to restore it. */
  | "stale"
  /** Comparability refused. Showing it here would assert a false correspondence. */
  | "withheld";

/**
 * Whether this mark may be drawn on this scan.
 *
 * `verdict` is the comparability of *that scan against the case*, and is
 * ignored for the scan the mark was made on — a mark is always valid on its own
 * scan, whatever it can or cannot be compared with.
 */
export function standing(mark: Highlight, scanId: string,
                         verdict: Verdict | null,
                         view: ViewState | null): Standing {
  const here = mark.on === scanId;

  /*
   * Staleness is checked before comparability, and the order matters. A mark
   * whose view has moved is not *wrong* — it is unplaced, and restoring the
   * view brings it back. Reporting that as a refusal would tell the researcher
   * their scans are incomparable when all that happened is somebody rotated
   * the scene.
   */
  if (!sameView(mark.view, view)) return "stale";
  if (here) return "drawn";
  /*
   * The null check is defensive rather than load-bearing, and worth saying so:
   * `permitsComparison(null)` is already false, so a mutation removing it
   * changes no behaviour — checked, not assumed. It stays because "never
   * assessed" and "assessed and refused" are different states that happen to
   * share an outcome, and `explain` tells them apart.
   */
  if (verdict === null || !permitsComparison(verdict)) return "withheld";
  return "echoed";
}

/** Why a mark is not being shown, in words a researcher can act on. */
export function explain(standing: Standing, verdict: Verdict | null): string {
  switch (standing) {
    case "drawn": return "Drawn here.";
    case "echoed":
      return "Echoed from the case. The same region, at the same view.";
    case "stale":
      return "The view has moved since this was drawn, so where it sits no "
           + "longer corresponds to anything. Restore the view to place it.";
    case "withheld":
      return verdict === null
        ? "Not shown here: this scan has not been compared with the case."
        : "Not shown here, because this scan cannot be compared with the case. "
          + "Drawing the region anyway would suggest the same place had been "
          + "examined, when the acquisition could not have shown it either way.";
  }
}

/**
 * The mark's own bounding box, for placing a label without covering the mark.
 *
 * Null for a mark with no points — an empty stroke has no position, and a
 * caller that received {0,0} would put a label in the corner and it would look
 * deliberate.
 */
export function boundsOf(mark: Highlight): {
  x: number; y: number; width: number; height: number } | null {
  if (mark.points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of mark.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * A stroke reduced to the points worth keeping.
 *
 * A hand or a pointer emits far more samples than a shape needs, and a mark
 * with a thousand points costs a redraw on every scan it is echoed to. Points
 * nearer than `gap` to the last kept one are dropped; the last point is always
 * kept, so a closed loop still closes.
 */
export function thin(points: Point[], gap = 3): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]];
  for (const p of points.slice(1, -1)) {
    const last = out[out.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < gap) continue;
    out.push(p);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * How many scans a mark is currently shown on, and how many withheld from.
 *
 * The withheld count is the number worth surfacing: a researcher who has marked
 * a region should be told plainly that it is deliberately absent from four of
 * the scans in front of them, rather than being left to notice.
 */
export function reach(
  mark: Highlight,
  scans: Array<{ id: string; verdict: Verdict | null }>,
  view: ViewState | null,
): { shown: number; withheld: number; stale: boolean } {
  let shown = 0, withheld = 0, stale = false;
  for (const scan of scans) {
    switch (standing(mark, scan.id, scan.verdict, view)) {
      case "drawn": case "echoed": shown += 1; break;
      case "withheld": withheld += 1; break;
      case "stale": stale = true; break;
    }
  }
  return { shown, withheld, stale };
}

/** A fresh identifier for a mark. Local, and never derived from the scan. */
export function newHighlightId(): string {
  return `mark-${Math.random().toString(36).slice(2, 10)}`;
}
