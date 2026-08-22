/**
 * A circle drawn round a cluster, turned into something the assistant can be
 * asked about (§198).
 *
 * This is the step that makes Air Ink a research instrument rather than a
 * whiteboard. §160 already turns a loop into *which observations* were inside
 * it; this turns those observations into the payload the ask endpoint validates,
 * so "why are these different" is a question with a referent instead of a
 * gesture nobody recorded.
 *
 * Three things are deliberately not done here, and each is a way this becomes
 * dishonest.
 *
 * **Nothing is summarised on the way.** The backend computes the count, the mean
 * and the range itself, in `throughline_domain.selection`, precisely so the
 * numbers in an answer are calculated rather than asserted by the interface. A
 * mean computed here and passed along would be indistinguishable, to the model
 * and to the researcher reading the answer later, from one somebody worked out.
 *
 * **A malformed selection is refused rather than repaired.** The validator on
 * the other side takes the same view and says why: a selection quietly patched
 * up produces an answer about something other than what was indicated, and
 * nothing about that answer will look wrong.
 *
 * **The datum is carried, not the screen position.** What the researcher
 * enclosed is a set of observations, not a set of pixels — the pixels stop being
 * true the moment the chart is rotated, and an answer that outlived its own
 * viewport would be nonsense.
 */

import { TargetRef } from "@/lib/spatial/commands";
import { RegionSelection } from "./select";

/** Matches what `throughline_domain.selection.validate` accepts. */
export type SelectionPayload = {
  visualization: string;
  axes: { x: string; y: string; z: string; value?: string };
  points: Array<{
    id?: string;
    label?: string;
    x: number;
    y: number;
    z: number;
    value?: number;
  }>;
};

export type ContextResult =
  | { ok: true; payload: SelectionPayload }
  | { ok: false; reason: string };

/**
 * The most points a drawn region may hand to the assistant.
 *
 * Matches `MAX_POINTS` on the validating side. Checked here as well so a
 * researcher who circles half the chart is told immediately, by the interface
 * that watched them do it, rather than after a round trip — and so the failure
 * names the gesture rather than the request.
 */
export const MAX_SELECTION_POINTS = 500;

export type ChartDescription = {
  /** What the figure is, in the researcher's words. */
  visualization: string;
  xLabel: string;
  yLabel: string;
  zLabel: string;
  valueLabel?: string;
};

/**
 * Turn a resolved region into the ask endpoint's selection payload.
 *
 * Returns a refusal rather than throwing: this runs while somebody is drawing,
 * and the interface has to say what went wrong in the same breath as the
 * gesture. An exception here would surface as a failed request minutes later,
 * detached from the circle that caused it.
 */
export function selectionContext(selection: RegionSelection,
                                 chart: ChartDescription): ContextResult {
  if (!selection.ok) return { ok: false, reason: selection.message };

  if (selection.targets.length > MAX_SELECTION_POINTS) {
    return {
      ok: false,
      reason: `That region covers ${selection.targets.length} observations, and `
            + `at most ${MAX_SELECTION_POINTS} can be discussed at once. Draw a `
            + `smaller region, or filter first.`,
    };
  }

  const points: SelectionPayload["points"] = [];
  for (const target of selection.targets) {
    const point = coordinatesOf(target);
    // A mark whose datum carries no usable coordinates is dropped rather than
    // defaulted to zero. A zero is a position, and inventing one puts an
    // observation somewhere the researcher never saw it.
    if (!point) continue;
    points.push({
      id: target.id,
      label: target.label,
      ...point,
    });
  }

  if (points.length === 0) {
    return {
      ok: false,
      reason: "Nothing in that region carries coordinates that can be described, "
            + "so there is nothing to ask about.",
    };
  }

  return {
    ok: true,
    payload: {
      visualization: chart.visualization,
      axes: {
        x: chart.xLabel, y: chart.yLabel, z: chart.zLabel,
        ...(chart.valueLabel ? { value: chart.valueLabel } : {}),
      },
      points,
    },
  };
}

/**
 * The datum's position, if it has one.
 *
 * `TargetRef.datum` is deliberately loose — a chart knows what its own marks
 * mean and the seam does not — so this reads the three coordinates the
 * validator requires and refuses anything else. `z` defaults to 0 because a
 * two-dimensional chart genuinely has no third coordinate, and that is a fact
 * about the figure rather than a missing value.
 */
function coordinatesOf(target: TargetRef):
    { x: number; y: number; z: number; value?: number } | null {
  const datum = target.datum as Record<string, unknown> | undefined;
  if (!datum) return null;

  const x = numberOf(datum.x);
  const y = numberOf(datum.y);
  if (x === null || y === null) return null;

  const z = numberOf(datum.z) ?? 0;
  const value = numberOf(datum.value);
  return value === null ? { x, y, z } : { x, y, z, value };
}

function numberOf(candidate: unknown): number | null {
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) return null;
  return candidate;
}

/**
 * What to show before sending, so an interpretation is confirmed rather than
 * applied (§197).
 *
 * "43 observations — ask about these?" is a question somebody can answer. A
 * request that silently happened is one they have to notice afterwards.
 */
export function describeContext(result: ContextResult): string {
  if (!result.ok) return result.reason;
  const count = result.payload.points.length;
  return count === 1
    ? "1 observation is ready to ask about."
    : `${count} observations are ready to ask about.`;
}
