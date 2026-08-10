"use client";

/**
 * The verdict renderer — six states, not sixty.
 *
 * Every comparison in the system produces the same shape, so there is one
 * component here rather than one per pair. Adding an outcome to the taxonomy
 * changes no rendering code at all, which is the only way ~60 outcomes stays
 * maintainable and, more importantly, stays *consistent*: a researcher learns
 * to read one verdict and can then read all of them.
 *
 * Two rules are load-bearing.
 *
 * **Not testable is styled as a designed result, not an error.** It is the
 * strongest trust signal the product can send. A refusal rendered as a failure
 * teaches a researcher that the tool is limited; a refusal rendered as an
 * answer teaches them something about their question.
 *
 * **`failed` never looks like `contradicted`.** A crashed job and a null result
 * are opposite things, and conflating them destroys trust the first time
 * someone notices. Run state is rendered separately and takes over the card.
 */

import { ReactNode } from "react";

export type VerdictBody = {
  outcome: string;
  outcome_name: string;
  family: "supported" | "qualified" | "contradicted" | "not_testable"
        | "undetermined" | "needs_review";
  family_label: string;
  tone: string;
  sentence: string;
  guidance: string;
  reason_code: string;
  confidence: number;
  evidence_refs: string[];
  transform_log: string[];
  caveats: string[];
  remedies: string[];
  still_possible: string[];
  state: string;
  method: string;
  pair: string;
};

/**
 * A word and a shape for every family. Never colour alone (Part P) — roughly
 * one in twelve men cannot reliably separate the positive and negative tints,
 * and a verdict is exactly the wrong thing to communicate by hue.
 */
const MARK: Record<VerdictBody["family"], string> = {
  supported: "✓",
  qualified: "≈",
  contradicted: "✕",
  not_testable: "⊘",
  undetermined: "?",
  needs_review: "!",
};

/**
 * How sure the system is *of this verdict* — distinct from any statistic inside
 * it. A design mismatch read from recorded metadata is certain; a claim pulled
 * out of prose is not. Showing them identically would make the certain one look
 * negotiable and the uncertain one look settled.
 */
function confidenceWord(confidence: number): string {
  if (confidence >= 0.9) return "high confidence in this verdict";
  if (confidence >= 0.7) return "moderate confidence in this verdict";
  return "low confidence in this verdict — treat as a prompt to look, not a result";
}

export function VerdictCard({ verdict, subject, children }: {
  verdict: VerdictBody;
  /** What was compared, in the researcher's own words. */
  subject?: ReactNode;
  children?: ReactNode;
}) {
  // A system error is not a scientific verdict and does not get one's styling.
  if (verdict.state === "failed") {
    return (
      <article className="vd vd-failed" role="alert">
        <header>
          <h2>This comparison did not run</h2>
        </header>
        <p>
          Something broke on our side. This is not a result about your data, and
          nothing should be concluded from it.
        </p>
        <p className="vd-reason">{verdict.reason_code}</p>
      </article>
    );
  }

  const stale = verdict.state === "stale";

  return (
    <article className={`vd vd-${verdict.family}`} data-stale={stale}>
      <header className="vd-head">
        <span className="vd-mark" aria-hidden>{MARK[verdict.family]}</span>
        <div>
          {/* The family first — one of six words the researcher already knows —
              then the specific outcome underneath it. */}
          <h2>{verdict.family_label}</h2>
          <p className="vd-outcome">
            {verdict.outcome_name}
            <span className="vd-code"> · {verdict.outcome}</span>
          </p>
        </div>
      </header>

      {subject && <p className="vd-subject">{subject}</p>}

      {/* Deterministic, written in advance, identical on every installation. */}
      <p className="vd-sentence">{verdict.sentence}</p>

      {verdict.guidance && <p className="vd-guidance">{verdict.guidance}</p>}

      {stale && (
        <p className="vd-stale">
          A source changed after this ran, so the verdict may no longer hold.
          Re-run before relying on it.
        </p>
      )}

      {children}

      {verdict.transform_log.length > 0 && (
        <Section title="What was changed to make this comparison possible">
          <ol className="vd-list vd-transforms">
            {verdict.transform_log.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </Section>
      )}

      {verdict.remedies.length > 0 && (
        <Section title="What would fix it">
          <ul className="vd-list">
            {verdict.remedies.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </Section>
      )}

      {verdict.still_possible.length > 0 && (
        // The half most tools omit. A researcher told only "no" concludes the
        // tool is limited; one told what remains possible learns the method.
        <Section title="What you can still do">
          <ul className="vd-list vd-possible">
            {verdict.still_possible.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </Section>
      )}

      {verdict.caveats.length > 0 && (
        <Section title="What this does not say">
          <ul className="vd-list vd-caveats">
            {verdict.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </Section>
      )}

      <footer className="vd-foot">
        <span>{confidenceWord(verdict.confidence)}</span>
        <span className="vd-method">
          {verdict.method === "deterministic"
            ? "deterministic — this verdict does not depend on a model"
            : verdict.method}
        </span>
      </footer>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="vd-section">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}
