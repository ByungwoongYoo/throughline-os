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
import { ApiError, api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Connection } from "@/lib/api";
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
  /** Always "deterministic": every check reads the record, none asks a model. */
  method: string;
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
      <AskAboutTwo projectId={projectId} />

      <p className="lede">
        {sweep.pairs_compared === 1
          ? "One relationship has been tested more than once."
          : `${sweep.pairs_compared} relationships have been tested more than once.`}{" "}
        Each pair is checked against everything recorded about how the two
        results were produced, so a disagreement arrives with its most likely
        explanation rather than as a mystery.
      </p>

      {/*
        Rendered by the same component as a directed comparison, so a report
        cannot come to read differently depending on which question produced
        it — the verdict is the same verdict either way.
      */}
      {sweep.reports.map((report) => (
        <OneReport key={`${report.left.id}-${report.right.id}`} report={report} />
      ))}

      <p className="pat-foot">
        {sweep.note}{" "}
        <span className="cmp-method">
          {sweep.method} — computed from the recorded results, not inferred
        </span>
      </p>
    </>
  );
}

/**
 * The manual picker this screen has always described and never had.
 *
 * The file opens by saying the sweep comes first "and the manual picker is
 * there for when they already have a suspicion". There was no picker:
 * `POST /projects/{id}/consistency`, which answers whether two *named* results
 * agree and what would explain it if they do not, had no caller anywhere. Only
 * the automatic sweep was reachable, so a researcher who already knew which
 * two results bothered them could not ask about them.
 */
function AskAboutTwo({ projectId }: { projectId: string }) {
  const connections = useApi<Connection[]>(
    `/api/projects/${projectId}/connections?limit=100`);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = connections.data ?? [];

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.post<Report>(
        `/api/projects/${projectId}/consistency`,
        { left_connection_id: left, right_connection_id: right }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (options.length < 2) return null;

  const label = (c: Connection) =>
    `${c.left_variable.replace(/_/g, " ")} and ${c.right_variable.replace(/_/g, " ")}`
    + ` · ${c.method?.replace(/_/g, " ") ?? "unrecorded"}`;

  return (
    <section aria-labelledby="ask-heading" style={{ marginBottom: 20 }}>
      <h2 id="ask-heading" className="eyebrow">Ask about two in particular</h2>

      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <label>
          One result
          <select value={left} onChange={(e) => setLeft(e.target.value)}>
            <option value="">choose one</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>{label(c)}</option>
            ))}
          </select>
        </label>
        <label>
          The other
          <select value={right} onChange={(e) => setRight(e.target.value)}>
            <option value="">choose one</option>
            {/*
              A result is trivially consistent with itself, and the domain
              refuses the comparison. Leaving it out of the second list makes
              that impossible to ask rather than something reported back after
              the researcher has already asked it.
            */}
            {options.filter((c) => c.id !== left).map((c) => (
              <option key={c.id} value={c.id}>{label(c)}</option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={!left || !right || busy}
                onClick={() => void ask()}>
          {busy ? "Checking…" : "Are these consistent?"}
        </button>
      </div>

      {error && <div className="notice" role="alert">{error}</div>}
      {report && <OneReport report={report} />}
    </section>
  );
}

/** One comparison, however it was asked for. */
function OneReport({ report }: { report: Report }) {
  return (
    <VerdictCard
      verdict={report.verdict}
      subject={
        <>
          {report.left.variables[0]?.replace(/_/g, " ")} and{" "}
          {report.left.variables[1]?.replace(/_/g, " ")}
        </>
      }
    >
      <div className="con-sides">
        <Result side={report.left} />
        <Result side={report.right} />
      </div>

      {report.checks_passed.length > 0 && (
        // The list that makes a contradiction mean something. Without it,
        // "these disagree" is just two numbers side by side.
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
