"use client";

/**
 * The measurement row, read out loud (T187).
 *
 * The cockpit's result panel is four symbols and four numbers: `r 0.60`,
 * `95% CI [0.50, 0.69]`, `p-value <0.001`, `n 180`. To a reader who has met
 * them before that row is the densest and best thing on the screen. To a
 * reader who has not, it is four numbers with no sentence anywhere saying what
 * any of them claims — and the Interpretation line underneath is worse, not
 * better: "p = 4.461e-19, which is below the 0.05 threshold; effect size
 * pearson_r = 0.6013 (large)".
 *
 * So the same numbers are said again in words, underneath, built from the
 * result itself rather than written once and left to drift. It is the row's
 * meaning, not an aside, so it is prose at reading size and it is never
 * collapsed.
 *
 * Three things it must not do, because each is the usual way a plain-English
 * statistics sentence goes wrong:
 *
 *  - It must not call the p-value the probability that the result is chance,
 *    or that the relationship is real. It is the frequency of data this
 *    lopsided *if there were no relationship*, and that is what it says.
 *  - It must not call a confidence interval a 95% probability that the true
 *    value is inside it. It is a range built by a procedure that holds the
 *    true value nineteen times in twenty, and that is what it says.
 *  - It must not say a correlation shows one thing affects another, however
 *    large it is. Every reading of a correlation ends by saying it cannot.
 *
 * The strings are assembled by `readingOf`, a pure function, so a test can
 * read the sentences without rendering a cockpit.
 */

import type { ReactNode } from "react";

export type ReadingInput = {
  /** `pearson_correlation`, `linear_regression`, `anova`, … */
  method?: string | null;
  /** The recorded estimate's own name: `pearson_r`, `beta[yield_t_ha]`, … */
  estimateName?: string | null;
  estimate?: number | null;
  ciLow?: number | null;
  ciHigh?: number | null;
  confidenceLevel?: number | null;
  pValue?: number | null;
  sampleSize?: number | null;
  /** "small" | "moderate" | "large" as the analysis graded it. */
  practicalSignificance?: string | null;
  /** role → column, as the run recorded it. */
  variables?: Record<string, unknown> | null;
};

/** The two columns a two-variable method ran on, in the order recorded. */
function columnsOf(variables: Record<string, unknown> | null | undefined): string[] {
  if (!variables) return [];
  // `x`/`y` first if they are named that way, then whatever else is recorded,
  // because a run may record `outcome`/`predictor` or `group`/`value` instead.
  const preferred = ["y", "outcome", "dependent", "x", "predictor", "independent", "group", "value"];
  const named = Object.entries(variables)
    .filter(([, value]) => typeof value === "string" && value)
    .map(([role, value]) => [role.toLowerCase(), String(value)] as const);
  const ordered = [...named].sort((a, b) => {
    const ia = preferred.indexOf(a[0]);
    const ib = preferred.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [, column] of ordered) {
    if (!seen.has(column)) { seen.add(column); out.push(column); }
  }
  return out;
}

/** "less than once in a thousand samples" — a p-value as a frequency. */
function howOften(p: number): string {
  if (p < 0.001) return "less than once in a thousand samples";
  if (p >= 0.5) return "more often than not";
  const oneIn = Math.round(1 / p);
  if (oneIn <= 1) return "most of the time";
  return `about once in every ${oneIn.toLocaleString()} samples`;
}

/** How a correlation of this size reads without a number. */
function strengthWord(size: number): string {
  if (size >= 0.7) return "a strong one";
  if (size >= 0.4) return "a moderate one";
  if (size >= 0.2) return "a weak one";
  return "a very weak one";
}

/**
 * The sentences, in reading order. Each is a complete sentence, so a caller
 * can drop the last one without leaving a fragment behind.
 *
 * Returns `[]` when the run recorded too little to say anything true — an
 * empty reading is right, and an invented one is not.
 */
export function readingOf(input: ReadingInput): string[] {
  const { estimate, pValue, sampleSize } = input;
  const columns = columnsOf(input.variables);
  const method = (input.method ?? "").toLowerCase();
  const estimateName = (input.estimateName ?? "").toLowerCase();
  const rows = sampleSize != null && sampleSize > 0
    ? `${sampleSize.toLocaleString()} rows`
    : "the rows recorded";
  const sentences: string[] = [];

  const isCorrelation = /correlation|pearson|spearman|kendall/.test(method + " " + estimateName);
  const coefficient = /^beta\[(.+)\]$/.exec(estimateName);
  const isRegression = !isCorrelation && (coefficient != null || /regression/.test(method));

  if (isCorrelation && estimate != null) {
    const [first, second] = columns.length >= 2 ? columns : ["the first column", "the second column"];
    const size = Math.abs(estimate);
    const direction = estimate >= 0
      ? `the higher ${first} is, the higher ${second} tends to be`
      : `the higher ${first} is, the lower ${second} tends to be`;
    sentences.push(
      `Across ${rows}, ${first} and ${second} move together: ${direction}.`,
      `The strength of that is ${estimate.toFixed(2)} on a scale where 0 is no straight-line link `
      + `and ${estimate >= 0 ? "1" : "−1"} would be a perfect one, so ${strengthWord(size)}.`);
  } else if (isRegression && estimate != null) {
    const outcome = columns[0] ?? "the outcome";
    const predictor = coefficient ? coefficient[1] : (columns[1] ?? "this predictor");
    const others = columns.filter((column) => column !== outcome && column !== predictor);
    const holding = others.length
      ? ` while holding ${others.join(" and ")} fixed`
      : " while holding the other recorded columns fixed";
    sentences.push(
      `Across ${rows}, each extra unit of ${predictor} goes with `
      + `${estimate >= 0 ? "" : "a fall of "}${Math.abs(estimate).toFixed(2)} `
      + `${estimate >= 0 ? "more " : ""}${outcome}${holding}.`);
  } else if (estimate == null && columns.length >= 2) {
    sentences.push(
      `This run compared ${columns.slice(1).join(", ")} across the groups of ${columns[0]} `
      + `over ${rows}, and recorded no single size for the difference.`);
  } else if (estimate != null) {
    sentences.push(`Across ${rows}, this run measured ${estimate.toFixed(2)}.`);
  }

  if (sentences.length === 0) return [];

  if (input.ciLow != null && input.ciHigh != null) {
    const level = Math.round((input.confidenceLevel ?? 0.95) * 100);
    sentences.push(
      `Measuring a different ${sampleSize != null ? sampleSize.toLocaleString() : ""} rows would not `
      + `land on exactly that number; ${input.ciLow.toFixed(2)} to ${input.ciHigh.toFixed(2)} is a range `
      + `worked out so that ranges like it hold the true value ${level} times in 100.`);
  }

  if (pValue != null && !Number.isNaN(pValue)) {
    const often = howOften(pValue);
    const weak = pValue >= 0.05;
    sentences.push(
      `If there were no relationship here at all, a sample this lopsided would still turn up ${often}`
      + (weak
        ? ", which is often enough that this on its own is not evidence of one."
        : ", which is why it is not being read as an accident of which rows were measured."));
  }

  if (isCorrelation) {
    sentences.push(
      "None of that says one causes the other: the same pattern is what a third, "
      + "unmeasured cause of both would produce.");
  } else if (isRegression) {
    sentences.push(
      "Adjusting for the columns in the dataset does not make this causal — "
      + "it only rules out the confounders that happen to have been measured.");
  }

  return sentences;
}

/**
 * The reading, rendered. Nothing when there is nothing true to say.
 */
export function PlainReading(input: ReadingInput & { lead?: string }): ReactNode {
  const sentences = readingOf(input);
  if (sentences.length === 0) return null;
  // The closing caution is set apart in colour, not hidden: it is the part a
  // reader most needs and least wants.
  const last = sentences[sentences.length - 1];
  const caution = /causes the other|make this causal/.test(last);
  const body = caution ? sentences.slice(0, -1) : sentences;
  return (
    <p className="plain-reading">
      <b>{input.lead ?? "In plain words"}: </b>
      {body.join(" ")}
      {caution ? <span className="plain-caveat"> {last}</span> : null}
    </p>
  );
}
