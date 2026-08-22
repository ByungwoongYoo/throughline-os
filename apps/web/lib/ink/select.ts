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

import { SpatialStroke, isClosed, observedPoints } from "./stroke";
import { TargetRef, VisualizationController } from "@/lib/spatial/commands";

export type RegionSelection =
  | { ok: true; targets: TargetRef[]; closed: boolean }
  | { ok: false; reason: "not-a-region" | "nothing-inside"; message: string };

/**
 * Everything inside a drawn region.
 *
 * Takes the chart rather than a probe function: the chart is what knows where
 * its marks are, and asking it is both exact and cheaper than sampling the area
 * they sit in.
 */
export function selectWithinStroke(
  stroke: SpatialStroke,
  chart: Pick<VisualizationController, "withinPolygon">,
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

  // The chart tests each of its marks against the region.
  //
  // The first version of this sampled: it walked a six-pixel grid inside the
  // loop asking what was at each step. That is an approximation, and it fails in
  // the direction that matters — a mark between two samples is simply missed, so
  // the count comes back short with nothing to indicate it. That count is the
  // number a researcher reads, quotes in a paper, and hands to the assistant as
  // "these observations". An approximate selection is not a smaller feature than
  // an exact one; it is a wrong answer delivered confidently.
  //
  // Asking the chart is exact and cheaper: one test per observation rather than
  // one per pixel of area, and it uses the same projection the marks were drawn
  // with, so picking cannot disagree with painting.
  const targets = chart.withinPolygon(
    points.map((point) => ({ x: point.x, y: point.y })));

  if (targets.length === 0) {
    return {
      ok: false,
      reason: "nothing-inside",
      message: "Nothing was inside that region. If you meant to select points, "
             + "try drawing a little wider — a loop between marks catches "
             + "nothing.",
    };
  }

  return { ok: true, targets, closed: true };
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
