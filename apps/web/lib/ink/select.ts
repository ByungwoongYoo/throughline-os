/**
 * Turning a drawn region into a claim about data.
 *
 * This is the line between a whiteboard and a research instrument. A circle
 * round a cluster is decoration until the system can say *which observations*
 * were inside it — and can hand exactly those records to the assistant when the
 * researcher asks "why are these different" (§160, §198).
 *
 * Three decisions, each of which is a way this goes wrong quietly.
 *
 * **Only observed points define the region.** Predicted points exist to keep the
 * line under a moving fingertip; a selection bounded partly by a guess would
 * contain observations the hand never enclosed, and nothing downstream could
 * tell.
 *
 * **The region is resolved against the chart's own hit-testing**, not against a
 * separate copy of the projection. When drawing and picking use different
 * arithmetic they disagree at the edges, and the researcher sees a point plainly
 * inside their circle reported as outside it. That is the same class of bug as
 * the rotation units, and the same fix: one implementation.
 *
 * **A region that selects nothing says so.** Returning an empty selection
 * silently is indistinguishable from a cluster that happens to be empty, and the
 * difference matters — one is a missed circle, the other is a finding.
 */

import { SpatialStroke, containsPoint, isClosed, observedPoints } from "./stroke";
import { TargetRef, VisualizationController } from "@/lib/spatial/commands";

export type RegionSelection =
  | { ok: true; targets: TargetRef[]; closed: boolean }
  | { ok: false; reason: "not-a-region" | "nothing-inside"; message: string };

/**
 * Everything inside a drawn region.
 *
 * `probe` is how the caller asks the chart what sits at a pixel — normally the
 * controller's own `hover`, so drawing and picking cannot drift apart. The
 * sampling step is in pixels: fine enough to catch a single mark, coarse enough
 * that a large lasso does not run a hit test per pixel.
 */
export function selectWithinStroke(
  stroke: SpatialStroke,
  probe: (at: { x: number; y: number }) => TargetRef | null,
  options: { step?: number } = {},
): RegionSelection {
  const points = observedPoints(stroke);

  if (points.length < 8 || !isClosed(points)) {
    return {
      ok: false,
      reason: "not-a-region",
      message: "That stroke is not a closed region. Draw a loop around the "
             + "points to select them — the ends need to meet roughly where "
             + "they started.",
    };
  }

  const step = options.step ?? 6;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  const found = new Map<string, TargetRef>();
  for (let x = left; x <= right; x += step) {
    for (let y = top; y <= bottom; y += step) {
      if (!containsPoint(points, { x, y })) continue;
      const target = probe({ x, y });
      // Keyed by id, because one mark is hit from several sample positions and a
      // selection reporting the same observation twice would misstate its own
      // size — which is the number the researcher reads.
      if (target && !found.has(target.id)) found.set(target.id, target);
    }
  }

  if (found.size === 0) {
    return {
      ok: false,
      reason: "nothing-inside",
      message: "Nothing was inside that region. If you meant to select points, "
             + "try drawing a little wider — a loop between marks catches "
             + "nothing.",
    };
  }

  return { ok: true, targets: [...found.values()], closed: true };
}

/**
 * A summary of what a region caught, for the interface to show before acting.
 *
 * §197: an interpretation that changes what a researcher is analysing gets
 * confirmed rather than applied. "243 observations — select them?" is a
 * question somebody can answer; a selection that silently happened is one they
 * have to notice.
 */
export function describeSelection(selection: RegionSelection): string {
  if (!selection.ok) return selection.message;
  const count = selection.targets.length;
  return count === 1
    ? "1 observation is inside that region."
    : `${count} observations are inside that region.`;
}
