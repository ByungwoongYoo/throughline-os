"use client";

/**
 * Finding ↔ finding — the third comparison verb.
 *
 * This screen opens on the sweep rather than on a picker, and that is the
 * design decision that matters. A researcher does not know which two of their
 * results disagree — that is precisely the thing a project of two hundred
 * comparisons hides. So the system does the pairing and shows what it found,
 * and the manual picker is there for when they already have a suspicion.
 *
 * Each report shows **what was ruled out** to reach the verdict. For F7 that is
 * the whole claim: the disagreement is real only because staleness, lifecycle
 * stage, shared data, harmonisation, version and method have all been excluded.
 * A contradiction asserted without that list is just two numbers next to each
 * other.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";
import { VerdictBody, VerdictCard } from "./Verdict";

type Side = {
  id: string;
  variables: string[];
  direction: string;
  significant: boolean;
  method: string;
  lifecycle_status: string;
  sample_size: number | null;
  dataset: string | null;
  dataset_version: number | null;
};

type Report = {
  verdict: VerdictBody;
  left: Side;
  right: Side;
  multiplicity: { tests_run: number; survived_correction: number };
  checks_passed: string[];
};

type Sweep = {
  pairs_compared: number;
  reports: Report[];
  multiplicity: { tests_run: number };
  note: string;
};

export function Consistency({ projectId }: { projectId: string }) {
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    api.get<Sweep>(`/api/projects/${projectId}/consistency`)
      .then((s) => { if (live) setSweep(s); })
      .catch((err) => { if (live) setError(err); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId]);

  if (loading) return <Loading rows={4} label="Comparing every result against every other" />;
  if (error) return <Failure error={error} />;

  if (!sweep || sweep.pairs_compared === 0) {
    return (
      <Empty
        title="Nothing to compare yet"
        hint="Once the same relationship has been tested more than once — in a second dataset, a later version, or under a different method — this works out whether the two results agree, and what would explain it if they do not."
      />
    );
  }

  return (
    <>
      <p className="lede">
        {sweep.pairs_compared === 1
          ? "One relationship has been tested more than once."
          : `${sweep.pairs_compared} relationships have been tested more than once.`}{" "}
        Each pair is checked against everything recorded about how the two
        results were produced, so a disagreement arrives with its most likely
        explanation rather than as a mystery.
      </p>

      {sweep.reports.map((report) => (
        <VerdictCard
          key={`${report.left.id}-${report.right.id}`}
          verdict={report.verdict}
          subject={
            <>
              {report.left.variables[0].replace(/_/g, " ")} and{" "}
              {report.left.variables[1].replace(/_/g, " ")}
            </>
          }
        >
          <div className="con-sides">
            <Result side={report.left} />
            <Result side={report.right} />
          </div>

          {report.checks_passed.length > 0 && (
            // The list that makes an F7 mean something. Without it, "these
            // contradict" is just two numbers side by side.
            <section className="vd-section">
              <h3 className="eyebrow">Ruled out first</h3>
              <ul className="con-checks">
                {report.checks_passed.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            </section>
          )}
        </VerdictCard>
      ))}

      <p className="pat-foot">{sweep.note}</p>
    </>
  );
}

function Result({ side }: { side: Side }) {
  return (
    <div className="con-side">
      <p className="con-dir">
        {side.direction === "negative" ? "↘" : side.direction === "positive" ? "↗" : "—"}
        <span>{side.significant ? "survived correction" : "did not survive"}</span>
      </p>
      <dl>
        <div><dt>data</dt><dd>
          {side.dataset ?? "unrecorded"}
          {side.dataset_version ? ` v${side.dataset_version}` : ""}
        </dd></div>
        <div><dt>method</dt><dd>{side.method?.replace(/_/g, " ")}</dd></div>
        <div><dt>stage</dt><dd>{side.lifecycle_status?.replace(/_/g, " ")}</dd></div>
        {side.sample_size ? (
          <div><dt>n</dt><dd className="numeric">{side.sample_size.toLocaleString()}</dd></div>
        ) : null}
      </dl>
    </div>
  );
}
