"use client";

/**
 * A word a first-time researcher meets before it is defined, glossed where
 * they meet it (D207).
 *
 * Every inventory group found the same thing independently: there is no
 * glossary anywhere, and the screens lean on q-value, Benjamini–Hochberg,
 * E-value, lifecycle state, causal status and estimand as if the reader had
 * brought the definitions with them. A glossary page would not have helped —
 * it is one more place to go and find — and a tooltip is a hidden label by
 * the same argument this codebase makes about `title` attributes on the rail.
 * So the gloss is a permanently visible clause beside the word, once per
 * screen, on first use. The caller decides which occurrence is first; this
 * component only renders the pair.
 *
 * The glosses are written here once so two screens cannot define the same
 * word two ways, and each is one clause: what the word means for the number
 * next to it, not a textbook entry.
 *
 * T187 widened the table from six words to the whole vocabulary a first-timer
 * actually hits, which was measured rather than guessed: the rendered text of
 * nine populated screens was read back, and every word on them that the screen
 * did not explain is here. The six that were here already are unchanged, so no
 * screen's wording shifts under it.
 *
 * Two shapes, because a table header has no room for a clause: `Term` sets the
 * word and its meaning inline in a sentence, and `TermList` sets several of
 * them as a legend under the table whose columns they name. Both print the
 * meaning as visible text; neither hides it behind a hover.
 */

import type { ReactNode } from "react";

export const GLOSSES = {
  "q-value": "corrected for how many tests ran",
  "Benjamini–Hochberg": "the correction that divides the tolerance for false positives across every test in the run",
  "E-value": "how much stronger than everything measured an unmeasured cause would have to be",
  "lifecycle state": "how far a result has got through validation",
  "causal status": "whether anything here licenses the word “causes”",
  "estimand": "the quantity the analysis is trying to estimate",

  // The measurement row, which is four symbols and no words at all.
  "r": "how tightly two numbers track each other, from −1 (opposite) through 0 (unrelated) to +1 (identical)",
  "p-value": "how often data this lopsided would turn up if there were no real relationship",
  "95% CI": "a range built so that ranges like it hold the true value nineteen times in twenty",
  "n": "how many rows this number was measured on",
  "β": "how far the outcome moves per unit of this predictor, with the others held fixed",
  "estimate": "the size of the relationship, as this method measures it",
  "effect size": "how big the relationship is, as opposed to how sure we are it exists",

  // The methods, which are named on every row of the discovery table.
  "Pearson correlation": "the straight-line strength of two number columns rising and falling together",
  "ANOVA": "a test of whether a group label shifts the average of a number",
  "linear regression": "the best straight line through the data, with the other columns held fixed",
  "bootstrap": "re-running the sum on thousands of resamples of the same rows to see how much it moves",

  // The words the product uses for its own machinery.
  "association": "two things move together, which cannot say whether either one moves the other",
  "confounder": "a third thing that moves both, and could produce the whole pattern by itself",
  "false-discovery rate": "the share of flagged results you are prepared to have be false alarms",
  "assumption check": "a test of whether the method’s preconditions actually hold in this data",
  "IQR": "the width of the middle half of the values, which outliers are measured against",
  "random seed": "the number that makes every random step repeat identically on a re-run",
  "sandbox": "a sealed process with no network, so an analysis cannot reach anything",
  "schema": "the column names and types a dataset was found to have",
  "untrusted": "not yet parsed, so nothing inside it has been allowed to affect anything",
  "validation": "the attempt to destroy a result, so that surviving it means something",
  "candidate": "recorded, and not yet stood up to anything",
  "statistical significance": "the pattern is stronger than the noise this test tolerates, nothing more",
  "practical significance": "whether the effect is large enough to matter, separately from whether it is certain",
  "evidence quality": "a grade from the sample size, the effect size and which assumptions held",

  // The reports screen's citation row, which is six integers and six words.
  "dangling": "cited here, but pointing at nothing this project holds",
  "supported": "the cited source was read, and it does say what the sentence says",
  "unsupported": "the cited source was read, and it does not say what the sentence says",
  "canonical variable": "one column confirmed to be the same measured thing across datasets that spell it differently",
} as const;

export type TermId = keyof typeof GLOSSES;

export function Term({ id, children }: {
  /** Which word; the gloss comes from `GLOSSES`. */
  id: TermId;
  /** The word as it should read in this sentence; defaults to the id. */
  children?: ReactNode;
}) {
  return (
    <span className="term">
      <span className="term-word">{children ?? id}</span>
      {/* Punctuated as a clause so it reads inside a sentence, and never
          hidden: "nothing hidden" applies to definitions too. */}
      <span className="term-gloss"> — {GLOSSES[id]}</span>
    </span>
  );
}

/**
 * The same glosses as a legend, for the tables an inline clause cannot fit.
 *
 * `Estimate`, `q-value` and `n` are column headings three characters wide; a
 * clause in the heading would set the column width. So the words are named
 * once underneath, in the order the columns run, and the reader's eye travels
 * down rather than into a tooltip.
 */
export function TermList({ ids, lead }: {
  /**
   * Which words, in the order they appear above. A pair names the word as the
   * heading above writes it — the discovery table's column is "State" and the
   * gloss is filed under "lifecycle state", and a legend that says one while
   * the column says the other makes the reader do the matching.
   */
  ids: readonly (TermId | readonly [TermId, string])[];
  /** An optional opening, e.g. "In this table". */
  lead?: string;
}) {
  return (
    <p className="term-legend">
      {lead ? <span className="term-legend-lead">{lead}: </span> : null}
      {ids.map((entry, index) => {
        const [id, word] = Array.isArray(entry)
          ? (entry as readonly [TermId, string]) : [entry as TermId, undefined];
        return (
          <span key={id} className="term-legend-item">
            {index > 0 ? <span aria-hidden="true" className="term-legend-sep"> · </span> : null}
            <Term id={id}>{word}</Term>
          </span>
        );
      })}
    </p>
  );
}

/**
 * Which gloss names a method, so a table can explain only the methods on it.
 *
 * A fixed legend under the discovery table would name ANOVA on a screen with
 * no ANOVA on it, which is one more thing to read and nothing to read it
 * against. Methods with no entry are simply not glossed rather than glossed
 * vaguely.
 */
export const METHOD_TERM: Record<string, TermId> = {
  pearson_correlation: "Pearson correlation",
  linear_regression: "linear regression",
  anova: "ANOVA",
  bootstrap_correlation: "bootstrap",
};

/** The glosses for the methods present, in the order they first appear. */
export function methodTerms(methods: readonly string[]): TermId[] {
  const out: TermId[] = [];
  for (const method of methods) {
    const id = METHOD_TERM[(method ?? "").toLowerCase()];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
