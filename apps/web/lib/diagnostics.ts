/**
 * The figures that ask whether a screen should be believed.
 *
 * "An interesting pattern is not a discovery" is the first thing this product
 * says about itself, and until now it said it in prose. These are the three
 * pictures that say it in data — the standard diagnostics for a study that
 * tested many things at once, which is exactly what a discovery run is.
 *
 * **No new chart components.** `Cartesian`'s own documentation is right that
 * one primitive with four marks yields forty named chart types, Q–Q among them.
 * A volcano plot is a scatter of effect against significance; a funnel is a
 * scatter of effect against precision; a Q–Q is a scatter of expected against
 * observed. What was missing was never a renderer — it was the arithmetic that
 * turns a project's connections into those coordinates, and that arithmetic is
 * here, pure and checkable without a browser.
 *
 * **They read the data that already exists.** Every connection carries an
 * effect, a p-value, an FDR-corrected q-value and a confidence interval. That
 * is precisely the input a volcano, a funnel and a Q–Q need, so none of this
 * asks a researcher to compute anything new — it asks the numbers they already
 * have a different question.
 */

/** What a connection offers these figures. A subset, so tests need no fixtures. */
export type Tested = {
  id: string;
  label: string;
  /** The effect. Sign matters: direction is half of what a volcano shows. */
  estimate: number | null;
  pValue: number | null;
  /** After multiplicity correction. Null when the family was never corrected. */
  qValue?: number | null;
  /**
   * Whether it survived that correction, as the server decided it — at the rate
   * its own run used. A figure that re-derived this with `q <= 0.05` coloured a
   * discovery promoted at 0.10 as a failure (T176).
   */
  survived?: boolean | null;
  ciLow?: number | null;
  ciHigh?: number | null;
};

/** A point for the Cartesian primitive, which draws all three of these. */
export type Point = {
  id: string;
  x: number;
  y: number;
  group?: string;
  label?: string;
};

/**
 * The smallest p-value this will plot, and the reason a cap is needed at all.
 *
 * `-log10(0)` is infinite, and a p-value underflows to exactly zero routinely —
 * a correlation of 0.9 across a few hundred points does it. Plotted, one such
 * point pushes the axis to infinity and flattens every other result onto the
 * baseline, so the figure showing the strongest finding is the figure that
 * hides all the others.
 *
 * Capped rather than dropped: the result is real and belongs on the chart. The
 * cap is far past any threshold anybody argues about, so nothing meaningful is
 * distorted by it.
 */
export const SMALLEST_P = 1e-300;

/** -log10, with the underflow handled rather than propagated. */
export function significance(p: number): number {
  return -Math.log10(Math.max(p, SMALLEST_P));
}

function usable(t: Tested): boolean {
  return t.estimate !== null && Number.isFinite(t.estimate)
      && t.pValue !== null && Number.isFinite(t.pValue)
      && t.pValue >= 0 && t.pValue <= 1;
}

/**
 * Effect against significance, with what survived correction marked.
 *
 * The picture a screen most needs and least often gets. Reading left to right
 * gives direction, bottom to top gives strength of evidence, and the grouping
 * says which of the tall points are still standing after the correction for
 * having tested everything — which is the difference between a finding and a
 * coincidence with a good view.
 *
 * Grouped by the q-value rather than the p-value, deliberately. A volcano drawn
 * with an uncorrected threshold is the exact figure that produces the false
 * discoveries this product exists to prevent: on a screen of two hundred tests,
 * ten points sit above p = 0.05 by chance alone and look identical to the real
 * one.
 */
export function volcano(tested: readonly Tested[]): Point[] {
  return tested.filter(usable).map((t) => ({
    id: t.id,
    label: t.label,
    x: t.estimate as number,
    y: significance(t.pValue as number),
    group:
      // Three states rather than two. "Not corrected" is not the same as "did
      // not survive correction", and collapsing them would let an uncorrected
      // screen present itself as one where nothing passed.
      t.qValue === null || t.qValue === undefined ? "not corrected"
      : t.survived === true ? "survives correction"
      : "does not survive",
  }));
}

/**
 * Observed p-values against the ones a screen with nothing in it would give.
 *
 * The most honest figure in this file and the least flattering. Under the null
 * — nothing here is real — p-values are uniform, so the sorted observations
 * fall on the diagonal. A curve bending above it means more small p-values than
 * chance produces, which is either genuine signal or an inflated test, and
 * distinguishing those is a judgement the figure hands to the researcher rather
 * than making for them.
 *
 * Both axes on the -log10 scale, because the interesting deviation is entirely
 * among the small p-values and a linear scale compresses all of it into one
 * corner.
 */
export function quantileQuantile(tested: readonly Tested[]): Point[] {
  const observed = tested.filter(usable)
    .map((t) => ({ id: t.id, label: t.label, p: t.pValue as number }))
    .sort((a, b) => a.p - b.p);

  const n = observed.length;
  return observed.map((o, i) => ({
    id: o.id,
    label: o.label,
    // The (i + 0.5) / n plotting position, not i / n. The latter starts at
    // exactly zero, whose -log10 is infinite, and would put the first point of
    // every screen off the top of the chart.
    x: significance((i + 0.5) / n),
    y: significance(o.p),
  }));
}

/** The diagonal a Q–Q plot is read against, for the same axes. */
export function nullDiagonal(points: readonly Point[]): Point[] {
  if (points.length === 0) return [];
  const limit = Math.max(...points.map((p) => Math.max(p.x, p.y)));
  return [
    { id: "null-start", x: 0, y: 0 },
    { id: "null-end", x: limit, y: limit },
  ];
}

/**
 * The standard error implied by a confidence interval.
 *
 * Recovered rather than stored, because the interval is what the analyses
 * record. Assumes the usual 95% normal interval, which is what produced these
 * bounds — stated here because a Wilson or bootstrap interval would make this
 * arithmetic wrong, and a funnel drawn from the wrong standard error is
 * asymmetric for reasons that have nothing to do with bias.
 */
export function standardErrorOf(t: Tested): number | null {
  const { ciLow, ciHigh } = t;
  if (ciLow === null || ciLow === undefined) return null;
  if (ciHigh === null || ciHigh === undefined) return null;
  if (!Number.isFinite(ciLow) || !Number.isFinite(ciHigh)) return null;
  const width = ciHigh - ciLow;
  if (width <= 0) return null;
  return width / (2 * 1.959964);
}

/**
 * Effect against precision, for spotting what is missing.
 *
 * A funnel is read by its symmetry. Precise results cluster near the top around
 * the true effect; imprecise ones scatter below. When the scatter leans one way
 * the usual explanation is that the results which would have balanced it were
 * never published — or, inside one project, never recorded.
 *
 * Precision as 1/SE rather than SE inverted on the axis, so the shape is the
 * familiar funnel with the certain results at the top. Anything without an
 * interval is dropped rather than given a guessed precision: a point placed at
 * an invented height is indistinguishable from a measured one, and this is a
 * figure people read for asymmetry.
 */
export function funnel(tested: readonly Tested[]): Point[] {
  const points: Point[] = [];
  for (const t of tested) {
    if (!usable(t)) continue;
    const se = standardErrorOf(t);
    if (se === null || se === 0) continue;
    points.push({
      id: t.id,
      label: t.label,
      x: t.estimate as number,
      y: 1 / se,
    });
  }
  return points;
}

/**
 * What the three figures say, in a sentence apiece.
 *
 * Written here rather than in the component because it is a claim about the
 * data, and a claim about data belongs where the data is understood. A figure a
 * researcher cannot read is a decoration, and these three are unfamiliar enough
 * that most people meet them for the first time in a reviewer's comment.
 */
export function readAs(kind: "volcano" | "qq" | "funnel",
                       points: readonly Point[]): string {
  if (points.length === 0) {
    return "Nothing here has both an effect and a p-value yet.";
  }
  switch (kind) {
    case "volcano": {
      const survived = points.filter((p) => p.group === "survives correction").length;
      const uncorrected = points.some((p) => p.group === "not corrected");
      if (uncorrected) {
        return `${points.length} results. These have not been corrected for `
             + "having tested many things at once, so height alone does not "
             + "say which are findings.";
      }
      return `${points.length} results tested; ${survived} still stand after `
           + "correcting for how many were tested. Height is strength of "
           + "evidence, left and right is direction.";
    }
    case "qq":
      return "Points on the diagonal are what a screen containing nothing "
           + "would produce. A curve bending above it means more small "
           + "p-values than chance gives — either signal, or a test that is "
           + "not behaving.";
    case "funnel":
      return "Precise results sit at the top. A lean to one side usually means "
           + "the results that would have balanced it are missing rather than "
           + "absent.";
  }
}
