"use client";

/**
 * The result card (Part C).
 *
 * The brief says design this before anything else, because it appears in the
 * canvas, in insights, in exports and on slides, and everything else is a
 * container for it. Four rules shape it:
 *
 * **The sentence comes first and is always visible.** Not a headline of
 * numbers. A researcher should be able to read what was found before deciding
 * whether to read how strongly.
 *
 * **Numbers are labelled in words.** "Effect", "Significance", "Evidence" —
 * never a bare `q = 5.17e-66`, which is a value with no claim attached.
 *
 * **`Evidence: weak` beside `r = 0.90` is the best moment in the product.**
 * Every competitor shows the correlation and stays silent. "See why" opens the
 * actual reason — violated assumptions, aggregation level, single time point.
 *
 * **Progressive disclosure is layering, never simplification.** Sentence always
 * visible → numbers one click → assumptions and sources one more. Nothing is
 * removed at any level: the moment an expert finds a hidden number they stop
 * trusting everything else on screen.
 */

import { useState } from "react";
import { Connection } from "@/lib/api";
import { TermList } from "./term";

/**
 * Internal lifecycle states are ours; these are the words a researcher uses.
 *
 * Showing `exploratory` taught the reader our vocabulary instead of telling
 * them what it means. "Tested — needs replication" needs no glossary.
 *
 * This table is the product's **only** lifecycle vocabulary (plan §4.6.3,
 * item 2.10). It lived here and was read only by this card, so the same six
 * states were also printed raw by the `Status` pill and by the transition
 * buttons, whose copy was the verb "move" plus the raw state word — three
 * vocabularies for one enum, and a researcher who met all three on one screen
 * had to work out that they named the same fact. Every
 * display of a lifecycle state now reads its words from here:
 * `primitives.tsx`'s `Status` and `lifecycle.tsx`'s buttons and headings.
 *
 * It stays in this file rather than moving to `lifecycle.tsx` because this
 * module imports nothing from `components/` — `lifecycle.tsx` imports
 * `primitives.tsx`, so a table there would have made `primitives` and
 * `lifecycle` import each other.
 *
 * `action` is the same fact as an imperative: what a button that moves a
 * finding *into* this state should say. It is here rather than beside the
 * buttons so that a state cannot be given a label in one file and a verb
 * that contradicts it in another. `tests/lifecycle-vocabulary.test.tsx`
 * reads `packages/schemas/src/throughline_schemas/enums.py` and fails if any
 * state the domain knows is missing from this table.
 */
export const LIFECYCLE: Record<string, { label: string; tone: string; action: string }> = {
  candidate:   { label: "Preliminary — not yet tested", tone: "caution",
                 action: "Send it back to preliminary" },
  exploratory: { label: "Tested — needs replication",   tone: "caution",
                 action: "Mark it tested, and needing replication" },
  // "Replicated" was this state's label too, which said a finding had been
  // reproduced when all it had done was survive the six robustness checks —
  // the same defect as calling an exploratory result validated, and the one
  // `ResultCard.test.tsx` guards in the other direction. Harmless while only
  // this card read the table; not harmless now that the transition buttons
  // and the standing line read it, where it offered to "record that it has
  // been replicated" for a finding already described as replicated.
  validated:   { label: "Checked — survived the robustness checks", tone: "positive",
                 action: "Validate it against the robustness checks" },
  replicated:  { label: "Replicated",                   tone: "positive",
                 action: "Record that it has been replicated" },
  conflicted:  { label: "Contradicted by other evidence", tone: "negative",
                 action: "Mark it contradicted by other evidence" },
  rejected:    { label: "Not supported",                tone: "negative",
                 action: "Record that it is not supported" },
  deprecated:  { label: "Withdrawn",                    tone: "muted",
                 action: "Retire this finding" },
};

/**
 * The words for one state, and a readable fallback for one we have not met.
 *
 * A state with no entry falls back to its own word rather than to nothing:
 * an unknown state is a deployment mismatch, and printing it is how somebody
 * finds out. The test above is what stops that fallback becoming the norm.
 */
export function lifecycleLabel(status: string) {
  return LIFECYCLE[status]
    ?? { label: status.replace(/_/g, " "), tone: "muted",
         action: `Move it to ${status.replace(/_/g, " ")}` };
}

/** Effect magnitude in words, so the reader is not left to judge r themselves. */
function effectWord(estimate: number | null, name: string): string {
  if (estimate === null) return "not estimated";
  const magnitude = Math.abs(estimate);
  if (/^(pearson_r|spearman_rho|r|correlation)/i.test(name)) {
    if (magnitude >= 0.7) return "strong";
    if (magnitude >= 0.4) return "moderate";
    if (magnitude >= 0.2) return "weak";
    return "negligible";
  }
  return "see analysis";
}

/**
 * A q-value as a threshold statement rather than an exponent.
 *
 * `q = 5.17e-66` is unreadable to most readers and, worse, invites treating a
 * smaller exponent as a stronger finding. The threshold form says the only
 * thing the number licenses.
 */
export function significanceWord(
  connection: Pick<Connection, "q_value" | "survived_correction" | "false_discovery_rate">,
): string {
  // Whether it survived is the server's verdict, at the rate its run corrected
  // at. Re-deriving it here with `q < .05` told a discovery promoted at 0.10
  // that it was "not significant after correction" (T176).
  if (connection.q_value === null) return "not corrected";
  if (!connection.survived_correction) return "not significant after correction";
  const rate = connection.false_discovery_rate;
  return `survived correction at a false-discovery rate of ${rate}`;
}

export type PlainSummary = {
  headline: string;
  what_it_means: string;
  how_confident: string;
  /**
   * What would change this reading — the sentence the model is asked for and
   * this type did not name.
   *
   * `interpret.py` asks for four things: the headline, what it means, how
   * confident, and what would change it. The fourth was generated, validated
   * against a 600-character bound, stored, and sent to the browser, where no
   * screen could read it because this declaration stopped at three. So it was
   * dropped on arrival, on every result, since the route was connected.
   *
   * It is the one this product can least afford to lose. Registration records
   * `falsified_if` so that "goalposts nobody wrote down cannot be seen to
   * move", and the ledger refuses a directionless prediction because a
   * prediction that cannot be wrong is a description. This is that same idea
   * for a result nobody registered — and it was the half being thrown away.
   */
  what_would_change_it: string;
  causal_reading: string;
  design?: { description: string; permits_causal_language: boolean };
  /**
   * Who wrote this, and when. A model writes every sentence above; these say
   * which model, at which prompt, and whether the reading was kept from an
   * earlier call rather than written for this view.
   *
   * The route sent all of it and nothing showed it. The claim test already
   * attributes its reading — "Located by {model} · {prompt}" — because two
   * readings can disagree and the disagreement has to be attributable rather
   * than argued about; the same holds for a plain-language reading of a
   * result, which is the sentence most likely to be quoted.
   */
  model: string;
  prompt: string;
  cached: boolean;
  /** Present on a fresh reading only: the cached branch does not send it. */
  operational_summary?: string;
};

export function ResultCard({
  connection, labels = {}, summary, figure, sourceCount, onTrace,
  // Always false today, and correctly so: every finding really was found by
  // browsing, because the pre-registration gate does not exist yet. The prop is
  // here because the marker belongs on the card rather than being retrofitted
  // once the gate lands — and because a reader must be able to tell the two
  // apart the moment both are possible.
  preRegistered = false,
}: {
  connection: Connection;
  /**
   * Canonical display names. A raw column name on a card is a defect — but a
   * card that throws is a worse one, and the lookup below already degrades to
   * the raw name per column. Defaulting the whole map keeps that same
   * degradation when the map itself has not arrived yet.
   */
  labels?: Record<string, string>;
  summary?: PlainSummary | null;
  figure?: React.ReactNode;
  sourceCount?: { sources: number; datasets: number };
  onTrace?: () => void;
  preRegistered?: boolean;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);

  const lifecycle = lifecycleLabel(connection.lifecycle_status);
  const left = labels[connection.left_variable] ?? connection.left_variable;
  const right = labels[connection.right_variable] ?? connection.right_variable;

  const effect = effectWord(connection.estimate, connection.effect_size_name || "");
  const significance = significanceWord(connection);

  // The sentence. Uses the model's plain reading when there is one, and falls
  // back to a constructed sentence that is still a sentence — never a bare
  // headline of numbers.
  const sentence = summary?.headline && summary.headline.length > 24
    ? summary.what_it_means || summary.headline
    : `${left} and ${right} move together across this data — but these data cannot `
      + `tell you whether one affects the other.`;

  return (
    <article className="rc">
      <header className="rc-top">
        <span className={`rc-chip rc-${lifecycle.tone}`}>{lifecycle.label}</span>
        <span className="rc-meta">
          {connection.sample_size ? `${connection.sample_size} observations` : "—"}
        </span>
      </header>

      {/* Always first, always visible. */}
      <p className="rc-sentence">{sentence}</p>

      {figure && <div className="rc-figure">{figure}</div>}

      <dl className="rc-stats">
        <div>
          <dt>Effect</dt>
          <dd>
            {effect}
            {connection.estimate !== null && (
              <span className="rc-exact numeric">
                {" "}({(connection.effect_size_name || "estimate").replace(/_/g, " ")}
                {" = "}{connection.estimate.toFixed(2)})
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Significance</dt>
          <dd>{significance}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            <span className={connection.evidence_quality === "weak"
              ? "rc-flag" : undefined}>{connection.evidence_quality}</span>
            {" "}
            <button className="rc-why" onClick={() => setShowWhy((v) => !v)}
                    aria-expanded={showWhy}>
              see why {showWhy ? "▴" : "▾"}
            </button>
          </dd>
        </div>
        <div>
          <dt>Design</dt>
          <dd>{summary?.design?.description?.split("—")[0].trim() ?? "not recorded"}</dd>
        </div>
      </dl>

      {/* The labels are words, which is half of it; the values under them are
          not. "survived correction at a false-discovery rate of 0.05" and
          "(pearson r = 0.60)" are the two phrases on this card that assume a
          reader who has met them before (T188). */}
      <TermList ids={["effect size", "false-discovery rate"]} />

      {showWhy && (
        <div className="rc-why-panel">
          {/*
            The product's best moment, made explicit: a very strong correlation
            can still be weak evidence, and the reason is never the coefficient.
          */}
          <p>
            Evidence quality is judged from what the method assumed, not from how
            large the effect is or how small the p-value is. A very strong
            correlation on data that violates the method&apos;s assumptions is still
            weak evidence.
          </p>
          {summary?.how_confident && <p>{summary.how_confident}</p>}
          {/* Beside the confidence rather than below the figures: how much to
              trust a reading and what would overturn it are one thought, and
              splitting them lets the first be read without the second. */}
          {summary?.what_would_change_it && (
            <p className="rc-would-change">
              <span>What would change this</span> {summary.what_would_change_it}
            </p>
          )}
          {summary?.model && (
            <p className="note">
              Written by {summary.model} · {summary.prompt}
              {summary.cached ? ", kept from an earlier reading" : ""}.
            </p>
          )}
          {summary?.design && !summary.design.permits_causal_language && (
            <p className="rc-caveat">
              {summary.design.description}. Nothing here can establish that one
              variable affects the other.
            </p>
          )}
        </div>
      )}

      <button className="rc-more" onClick={() => setShowNumbers((v) => !v)}
              aria-expanded={showNumbers}>
        {showNumbers ? "Hide the exact figures" : "Show the exact figures"}
      </button>

      {showNumbers && (
        <dl className="rc-exact-list">
          <dt>Estimate</dt>
          <dd className="numeric">{connection.estimate ?? "—"}</dd>
          <dt>Corrected q</dt>
          <dd className="numeric">{connection.q_value?.toExponential(3) ?? "—"}</dd>
          <dt>Uncorrected p</dt>
          <dd className="numeric">{connection.p_value?.toExponential(3) ?? "—"}</dd>
          <dt>Sample size</dt>
          <dd className="numeric">{connection.sample_size ?? "—"}</dd>
          <dt>Method</dt>
          <dd className="mono">{connection.method}</dd>
        </dl>
      )}

      {/* Permanent, and it survives every export. */}
      <footer className="rc-prov">
        <span>
          ⛓ {sourceCount?.sources ?? 0} sources · {sourceCount?.datasets ?? 0} dataset
          {(sourceCount?.datasets ?? 0) === 1 ? "" : "s"}
        </span>
        {onTrace && <button className="rc-trace" onClick={onTrace}>Trace →</button>}
        {/* How this was found is part of the card, not metadata hidden
            elsewhere: a browsed finding and a pre-registered one carry very
            different weight and the reader must see which this is. */}
        <span className="rc-origin">
          {preRegistered ? "Pre-registered" : "Found by browsing"}
        </span>
      </footer>
    </article>
  );
}
