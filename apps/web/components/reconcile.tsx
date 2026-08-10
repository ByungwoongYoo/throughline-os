"use client";

/**
 * Paper ↔ paper — the fourth comparison verb.
 *
 * The screen is built around one claim the taxonomy makes: every citation tool
 * can show that two papers relate, and none of them explains *why two papers
 * cannot be compared*. So the incommensurability verdicts (R9–R12) are not an
 * error state here — they are the product, and they get the same care as an
 * agreement.
 *
 * The two claims are shown side by side above the verdict, in the papers' own
 * words, with their estimands and populations visible. That layout is doing
 * argumentative work: when the verdict says "an odds ratio and a risk ratio are
 * different quantities", the reader can see both labels sitting there and does
 * not have to take it on faith.
 */

import { useState } from "react";
import { Source, api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";
import { VerdictBody, VerdictCard } from "./Verdict";

type ClaimSummary = {
  source_title: string | null;
  statement: string | null;
  exposure: string | null;
  outcome: string | null;
  direction: string | null;
  design: string | null;
  estimand: string | null;
  effect: string | null;
  interval: string | null;
  population: string | null;
  period: string | null;
};

type Reconciliation = {
  verdict: VerdictBody;
  left: ClaimSummary;
  right: ClaimSummary;
  checks_passed: string[];
};

type Result = {
  left: { title: string; claims: unknown[]; verdict: VerdictBody | null };
  right: { title: string; claims: unknown[]; verdict: VerdictBody | null };
  reconciliations: Reconciliation[];
  model: string;
};

export function Reconcile({ projectId, sources }: {
  projectId: string;
  sources: Source[];
}) {
  const papers = sources.filter((s) => !s.dataset);
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(left: string, right: string) {
    setBusy(true); setError(null); setResult(null);
    try {
      setResult(await api.post<Result>(
        `/api/projects/${projectId}/reconcile-papers`,
        { left_source_id: left, right_source_id: right }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  function pick(id: string) {
    // Two slots, filled in order — the same gesture as the dataset comparison,
    // because it is the same question asked of different objects.
    if (chosen.includes(id)) {
      setChosen(chosen.filter((c) => c !== id));
      setResult(null);
      return;
    }
    const next = [...chosen, id].slice(-2);
    setChosen(next);
    if (next.length === 2) void run(next[0], next[1]);
  }

  if (papers.length < 2) {
    return (
      <Empty
        title="Two papers are needed"
        hint="Add another paper and the system will work out whether their claims can honestly be compared — and say plainly why not when they cannot."
      />
    );
  }

  return (
    <>
      <p className="lede">
        Pick two papers. The claims are located, then compared without a model:
        whether they are about the same thing, in the same population, on the
        same scale — and only then whether they agree.
      </p>

      <div className="cmp-picker">
        {papers.map((source) => {
          const slot = chosen.indexOf(source.id);
          return (
            <button
              key={source.id}
              className="cmp-choice"
              data-chosen={slot >= 0}
              onClick={() => pick(source.id)}
            >
              {slot >= 0 && <span className="cmp-slot">{"AB"[slot]}</span>}
              <span className="cmp-name">{source.title}</span>
              <span className="cmp-meta">paper</span>
            </button>
          );
        })}
      </div>

      {error ? <Failure error={error} /> : null}
      {busy && <Loading rows={3} label="Reading both papers" />}

      {result && result.reconciliations.length === 0 && (
        <Empty
          title="No comparable claims found"
          hint={
            [result.left, result.right]
              .filter((p) => p.verdict)
              .map((p) => `${p.title}: ${p.verdict!.sentence}`)
              .join(" ")
            || "Neither paper states a claim in a form that could be compared."
          }
        />
      )}

      {result?.reconciliations.map((item, index) => (
        <VerdictCard
          key={index}
          verdict={item.verdict}
          subject={
            <>
              <b>{item.left.source_title}</b> and <b>{item.right.source_title}</b>
            </>
          }
        >
          <div className="rec-claims">
            <ClaimColumn claim={item.left} />
            <ClaimColumn claim={item.right} />
          </div>

          {item.checks_passed.length > 0 && (
            <section className="vd-section">
              <h3 className="eyebrow">Ruled out first</h3>
              <ul className="con-checks">
                {item.checks_passed.map((check) => <li key={check}>{check}</li>)}
              </ul>
            </section>
          )}
        </VerdictCard>
      ))}

      {result && (
        <p className="pat-foot">
          Claims located by {result.model}. Every comparison after that step is
          deterministic and does not depend on a model.
        </p>
      )}
    </>
  );
}

function ClaimColumn({ claim }: { claim: ClaimSummary }) {
  return (
    <div className="rec-claim">
      <p className="rec-title">{claim.source_title}</p>
      {/* The paper's own words, so a verdict about them can be checked. */}
      {claim.statement && <blockquote>{claim.statement}</blockquote>}
      <dl>
        <div><dt>says</dt><dd>
          {claim.exposure?.replace(/_/g, " ")} → {claim.outcome?.replace(/_/g, " ")}
          {claim.direction ? ` (${claim.direction})` : ""}
        </dd></div>
        {/* Shown even when it is the thing that blocked the comparison —
            especially then, so "different quantities" is visible, not asserted. */}
        <div><dt>reports</dt><dd>
          {claim.estimand?.replace(/_/g, " ") ?? "unstated"}
          {claim.effect ? ` · ${claim.effect}` : ""}
          {claim.interval ? ` · ${claim.interval}` : ""}
        </dd></div>
        <div><dt>design</dt><dd>{claim.design?.replace(/_/g, " ") ?? "unstated"}</dd></div>
        <div><dt>in</dt><dd>
          {claim.population || "population unstated"}
          {claim.period ? `, ${claim.period}` : ""}
        </dd></div>
      </dl>
    </div>
  );
}
