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

/**
 * Internal lifecycle states are ours; these are the words a researcher uses.
 *
 * Showing `exploratory` taught the reader our vocabulary instead of telling
 * them what it means. "Tested — needs replication" needs no glossary.
 */
export const LIFECYCLE: Record<string, { label: string; tone: string }> = {
  candidate:   { label: "Preliminary — not yet tested", tone: "caution" },
  exploratory: { label: "Tested — needs replication",   tone: "caution" },
  validated:   { label: "Replicated",                   tone: "positive" },
  replicated:  { label: "Replicated",                   tone: "positive" },
  conflicted:  { label: "Contradicted by other evidence", tone: "negative" },
  rejected:    { label: "Not supported",                tone: "negative" },
  deprecated:  { label: "Withdrawn",                    tone: "muted" },
};

export function lifecycleLabel(status: string) {
  return LIFECYCLE[status] ?? { label: status.replace(/_/g, " "), tone: "muted" };
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
function significanceWord(q: number | null): string {
  if (q === null) return "not corrected";
  if (q < 0.001) return "p < .001 (BH corrected)";
  if (q < 0.01) return "p < .01 (BH corrected)";
  if (q < 0.05) return "p < .05 (BH corrected)";
  return "not significant after correction";
}

export type PlainSummary = {
  headline: string;
  what_it_means: string;
  how_confident: string;
  causal_reading: string;
  design?: { description: string; permits_causal_language: boolean };
};

export function ResultCard({
  connection, labels = {}, summary, figure, sourceCount, onTrace,
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
  const significance = significanceWord(connection.q_value);

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
