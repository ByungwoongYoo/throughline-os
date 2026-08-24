/**
 * Measuring between two observations (§183, §184).
 *
 * §183 wants "42 mm" under a line between two points, and §184 says what to do
 * when that number is not available: *never infer physical dimensions if scale
 * information is unavailable. Say so clearly.* On the charts this product
 * actually has, the second sentence governs, and the reason is worth stating
 * because it decides the whole design rather than being a caveat on it.
 *
 * **The axes are scaled independently.** Every spatial chart here maps each axis
 * onto the same cube so the *shape* of a cloud is legible — which means a
 * centimetre along x and a centimetre along y represent different amounts of
 * different quantities. A dose and a duration have no common unit, so there is
 * no length of the line joining two observations. Not "we cannot compute it
 * accurately": there is no such quantity. `Volume`'s own caption has said so
 * since it was written.
 *
 * So this reports **the difference along each axis, in that axis's own units**,
 * and refuses the single number §183 draws. That refusal is the feature. A
 * product that answered "42" would be inventing a unit, and the researcher would
 * quote it.
 *
 * **It measures between observations, not between screen points**, which is the
 * other half of being honest here. A point on screen over a rotatable scene is a
 * ray, not a position — depth is ambiguous from one projection — so "the point I
 * indicated" only has data coordinates when it is a mark that exists. Two marks
 * have exact coordinates and the difference between them is exact.
 */

export type MeasuredAxis = {
  label: string;
  from: number;
  to: number;
  /** `to - from`, signed, because direction is usually the point. */
  difference: number;
};

export type Measurement =
  | { ok: true; axes: MeasuredAxis[]; caveat: string }
  | { ok: false; reason: string };

export type AxisLabels = {
  x: string;
  y: string;
  z?: string;
};

/** What a mark carries. Loose, because a chart decides what its data means. */
export type Datum = Record<string, unknown>;

function numberOn(datum: Datum, key: string): number | null {
  const value = datum[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The difference between two observations, axis by axis.
 *
 * Refuses rather than guessing whenever an axis is missing from either mark:
 * reporting a difference on two axes and silently omitting a third would read as
 * a complete answer about a chart that has three.
 */
export function measureBetween(a: Datum, b: Datum,
                               labels: AxisLabels): Measurement {
  const wanted: Array<["x" | "y" | "z", string]> = [
    ["x", labels.x], ["y", labels.y],
  ];
  if (labels.z) wanted.push(["z", labels.z]);

  /*
   * The same observation twice is not a measurement.
   *
   * Found by clicking around the page rather than by reasoning: selecting one
   * mark and then selecting it again reported "0 x, 0 y, 0 z", which is a
   * confident answer to a question nobody asked and looks exactly like a real
   * result. A researcher glancing at it would read three zeroes as a finding —
   * two observations that coincide — rather than as a mis-click.
   *
   * Compared by identity rather than by coordinates: two *different*
   * observations that happen to share coordinates are a genuine and interesting
   * zero, and refusing that would hide the finding this is meant to surface.
   */
  const idA = typeof a.id === "string" ? a.id : null;
  const idB = typeof b.id === "string" ? b.id : null;
  if (idA !== null && idA === idB) {
    return {
      ok: false,
      reason: "That is the same observation twice. Choose a second one to "
            + "measure against.",
    };
  }

  const axes: MeasuredAxis[] = [];
  for (const [key, label] of wanted) {
    const from = numberOn(a, key);
    const to = numberOn(b, key);
    if (from === null || to === null) {
      return {
        ok: false,
        reason: `Those two observations do not both carry a ${label} value, so `
              + "the difference along it cannot be stated.",
      };
    }
    axes.push({ label, from, to, difference: to - from });
  }

  return {
    ok: true,
    axes,
    /*
     * Said every time, not once in a footnote.
     *
     * The caveat is the finding here, and a researcher reading a measurement
     * months later is exactly the person who will not have the surrounding
     * conversation. §184's "say so clearly" is a requirement about the
     * measurement, not about the documentation.
     */
    caveat: "There is no single distance between these: the axes are scaled "
          + "independently and measure different quantities, so a straight line "
          + "between them has no length in the data.",
  };
}

/** Short, and never in exponent form, which reads as spurious precision. */
function number(value: number): string {
  return `${value > 0 ? "+" : ""}${Number(value.toPrecision(4))}`;
}

/**
 * The measurement as prose, for showing beside the figure.
 *
 * Signed differences rather than magnitudes: "17 lower in duration" is the
 * finding, and an absolute value throws away the half of it that matters.
 */
export function describeMeasurement(measurement: Measurement): string {
  if (!measurement.ok) return measurement.reason;
  const parts = measurement.axes.map(
    (axis) => `${number(axis.difference)} ${axis.label}`);
  return `${parts.join(", ")}. ${measurement.caveat}`;
}
