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
 */

import type { ReactNode } from "react";

export const GLOSSES = {
  "q-value": "corrected for how many tests ran",
  "Benjamini–Hochberg": "the correction that divides the tolerance for false positives across every test in the run",
  "E-value": "how much stronger than everything measured an unmeasured cause would have to be",
  "lifecycle state": "how far a result has got through validation",
  "causal status": "whether anything here licenses the word “causes”",
  "estimand": "the quantity the analysis is trying to estimate",
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
