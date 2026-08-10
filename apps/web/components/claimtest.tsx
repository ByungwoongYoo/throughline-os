"use client";

/**
 * The claim test — paper ↔ dataset (Part I).
 *
 * The brief calls this the differentiator, and the reason nobody does it well
 * is that doing it well means refusing. Three steps, each able to fail loudly,
 * and the interface has to make failing look like an answer rather than a
 * malfunction — otherwise a researcher reads "not testable" as "broken" and
 * stops using the feature that was protecting them.
 *
 * So the three steps are drawn as a visible sequence and the one that failed is
 * marked, with what would fix it. A refusal here is the product working.
 */

import { useState } from "react";
import { Source, api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";
import { VerdictBody, VerdictCard } from "./Verdict";

type Claim = {
  claim_id?: string;
  statement: string;
  exposure: string;
  outcome: string;
  direction: string;
  claimed_design: string;
  claimed_effect?: string;
  population?: string;
  locator?: string;
  source_id?: string;
};

type Located = {
  source_title: string;
  claims: Claim[];
  note: string;
  model: string;
  prompt: string;
};

type Result = {
  verdict: VerdictBody;
  claim: Claim;
  dataset: { id: string; name: string; design: string; rows: number };
  testable: boolean;
  exposure_column: string | null;
  outcome_column: string | null;
  /** Checks that did not run. Never merged with checks that passed. */
  unchecked: string[];
};

export function ClaimTest({ projectId, sources }: {
  projectId: string;
  sources: Source[];
}) {
  const papers = sources.filter((s) => !s.dataset);
  const datasets = sources.filter((s) => s.dataset);

  const [paper, setPaper] = useState<string | null>(null);
  const [located, setLocated] = useState<Located | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function locate(sourceId: string) {
    setPaper(sourceId);
    setLocated(null); setClaim(null); setResult(null); setError(null);
    setBusy("Reading the paper");
    try {
      setLocated(await api.post<Located>(
        `/api/sources/${sourceId}/claims?project_id=${projectId}`, {}));
    } catch (err) { setError(err); } finally { setBusy(null); }
  }

  async function test(chosen: Claim, datasetVersionId: string) {
    setClaim(chosen); setResult(null); setError(null);
    setBusy("Checking whether this data can test it");
    try {
      setResult(await api.post<Result>(
        `/api/projects/${projectId}/claim-test`,
        { claim: chosen, dataset_version_id: datasetVersionId }));
    } catch (err) { setError(err); } finally { setBusy(null); }
  }

  if (papers.length === 0 || datasets.length === 0) {
    return (
      <Empty
        title="A paper and a dataset are needed"
        hint="The claim test reads what a paper asserts, then works out whether your data could test it — and says plainly when it could not."
      />
    );
  }

  return (
    <>
      <p className="lede">
        Pick a paper. The system quotes the claims it makes, then checks — without
        computing anything — whether your data could test them at all.
      </p>

      <div className="cmp-picker">
        {papers.map((source) => (
          <button
            key={source.id}
            className="cmp-choice"
            data-chosen={paper === source.id}
            onClick={() => void locate(source.id)}
          >
            <span className="cmp-name">{source.title}</span>
            <span className="cmp-meta">paper</span>
          </button>
        ))}
      </div>

      {error ? <Failure error={error} /> : null}
      {busy && <Loading rows={2} label={busy} />}

      {located && located.claims.length === 0 && (
        <Empty
          title="No testable claim found"
          hint={located.note}
        />
      )}

      {located && located.claims.length > 0 && (
        <section className="ct-claims">
          <h3 className="eyebrow">What this paper asserts</h3>
          {located.claims.map((c, i) => (
            <article
              key={c.claim_id ?? i}
              className="ct-claim"
              data-chosen={claim?.statement === c.statement}
            >
              {/* The paper's words, quoted. Never paraphrased into something
                  the paper did not say (LAW 4). */}
              <blockquote>{c.statement}</blockquote>
              <p className="ct-constructs">
                <b>{c.exposure.replace(/_/g, " ")}</b>
                <span> → </span>
                <b>{c.outcome.replace(/_/g, " ")}</b>
                <span className="ct-design">
                  {c.claimed_design.replace(/_/g, " ")}
                </span>
              </p>
              <div className="ct-against">
                <span>Test against</span>
                {datasets.map((d) => (
                  <button
                    key={d.id}
                    className="ct-dataset"
                    onClick={() => void test(c, d.dataset!.dataset_version_id)}
                  >
                    {d.title}
                  </button>
                ))}
              </div>
            </article>
          ))}
          <p className="ct-provenance">
            Located by {located.model} · {located.prompt}. Claims are quoted from
            the paper and recorded as proposed — they are not findings.
          </p>
        </section>
      )}

      {result && claim && (
        <VerdictCard
          verdict={result.verdict}
          subject={<>against <b>{result.dataset.name}</b></>}
        >
          <Steps result={result} claim={claim} />
        </VerdictCard>
      )}
    </>
  );
}

/**
 * The three steps of the claim test, drawn as a sequence.
 *
 * A researcher needs to see *which* step stopped it, because the three failures
 * mean completely different things: a missing mapping is a chore, a design
 * mismatch is a fact about the question, and circularity is a warning about the
 * paper. Collapsing them into one "no" would throw that away.
 */
function Steps({ result, claim }: { result: Result; claim: Claim }) {
  const code = result.verdict.outcome;
  const failedAt =
    code === "P7" ? 0 : code === "P8" ? 1 : code === "P9" || code === "D14" ? 2
    : code === "P10" || code === "P11" ? 3 : -1;

  const steps = [
    { name: "Written independently of this data",
      detail: code === "P7" ? result.verdict.sentence
        : claim.source_id ? "No sign the paper was written from this dataset."
        : "Not checked — the claim was not linked to a paper." },
    { name: "Constructs measured here",
      detail: result.exposure_column
        ? `${claim.exposure.replace(/_/g, " ")} → ${result.exposure_column}, `
          + `${claim.outcome.replace(/_/g, " ")} → ${result.outcome_column}`
        : result.verdict.sentence },
    { name: "Design can carry the claim",
      detail: `${claim.claimed_design.replace(/_/g, " ")} claim, `
        + `${result.dataset.design.replace(/_/g, " ")} data` },
    { name: "Scope overlaps",
      detail: result.unchecked.length
        ? result.unchecked.join(" ")
        : "Population and period overlap." },
  ];

  return (
    <ol className="ct-steps">
      {steps.map((step, index) => {
        const state = failedAt === index ? "failed"
          : failedAt >= 0 && index > failedAt ? "skipped"
          : step.detail.startsWith("Not checked") || step.detail.includes("not checked")
          ? "unchecked" : "passed";
        return (
          <li key={step.name} data-state={state}
              style={{ animationDelay: `${Math.min(index * 70, 300)}ms` }}>
            <span className="ct-mark" aria-hidden>
              {state === "passed" ? "✓" : state === "failed" ? "✕"
                : state === "unchecked" ? "·" : "–"}
            </span>
            <div>
              <b>{step.name}</b>
              <span className="sr-only">
                {state === "passed" ? " — passed"
                  : state === "failed" ? " — this is where it stopped"
                  : state === "unchecked" ? " — not checked"
                  : " — not reached"}
              </span>
              <p>{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
