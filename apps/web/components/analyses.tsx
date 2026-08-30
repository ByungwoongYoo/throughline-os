"use client";

/**
 * The project's analyses.
 *
 * This screen used to read `/connections` and keep the rows carrying an
 * `analysis_run_id`. That is a list of what *discovery* produced, and it was
 * the only list there could be, because discovery was the only thing that
 * produced analyses. Now that a researcher can specify one, listing by
 * connection would mean a run they asked for was queued, executed and recorded
 * — and never appeared. The list comes from `analysis_runs`.
 *
 * `origin` is shown rather than dropped. A run that came out of a sweep was
 * corrected inside a family of tests and a run specified on its own was not;
 * presenting the two as one undifferentiated list of numbers would flatten
 * exactly the distinction §47 turns on, and the flattened version is the more
 * flattering one.
 */

import { AnalysisRunRow, ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { PlainSummary } from "./ResultCard";
import { Empty, Failure, Loading, Num, Status } from "./primitives";
import { RunAnalysis } from "./runanalysis";

/** How each origin reads, and what it costs the run's standing. */
export const ORIGIN_NOTE: Record<string, string> = {
  discovery: "from a sweep — corrected across every test in that search",
  specified: "specified directly",
  fork: "a variant of an earlier run, not an independent look",
};

/**
 * What to call a run.
 *
 * A swept run is named by the pair it tested. A specified one belongs to no
 * pair, so it is named by the columns it actually used — falling back to the
 * method, which is the one thing every run has. The run id is never a name:
 * `arun_8f21…` tells a reader nothing about what was asked.
 */
export function nameOf(run: AnalysisRunRow): string {
  if (run.left_variable && run.right_variable) {
    return `${run.left_variable} × ${run.right_variable}`;
  }
  const named = Object.values(run.variables ?? {})
    .flatMap((v) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []))
    .filter(Boolean);
  if (named.length > 0) return named.join(" · ");
  return run.method.replace(/_/g, " ");
}

/**
 * The one number a row shows, or where the run has got to.
 *
 * Keyed off whether there is a result, not off a status string: `analysis_runs`
 * finishes as "completed" while `discovery_runs` finishes as "complete", so a
 * component testing for one word is wrong about the other table.
 *
 * But "has a result" is not "has an estimate". An ANOVA, a Kruskal-Wallis and a
 * chi-square produce no single point estimate — the domain stores `estimate` as
 * null and `estimate_name` as an empty string — so a first version of this
 * showed a *completed* ANOVA with a p-value of 0.81 as a status badge reading
 * "completed", which reads as still working. Half the runs in a real project
 * looked unfinished.
 *
 * So: the estimate when there is one, the p-value when there is not, and the
 * status only when there is neither — which is what a queued or failed run
 * actually is.
 */
export function Headline({ run }: { run: AnalysisRunRow }) {
  if (run.estimate !== null) {
    return (
      <span className="numeric">
        {/* `||`, not `??`: the name is stored as "" rather than null for a
            method that does not name its estimate. */}
        {run.estimate_name || "estimate"} <Num value={run.estimate} />
      </span>
    );
  }
  if (run.p_value !== null) {
    return (
      <span className="numeric">
        p <Num value={run.p_value} />
      </span>
    );
  }
  return <Status value={run.status} />;
}

export function AnalysisList({ projectId, onSelect }: {
  projectId: string;
  onSelect: (id: string) => void;
}) {
  const { data, error, loading, reload } = useApi<AnalysisRunRow[]>(
    `/api/projects/${projectId}/analyses?limit=200`, [projectId]);

  if (error) return <Failure error={error} retry={reload} />;
  if (loading) return <Loading rows={4} label="Reading analyses" />;

  const runs = data ?? [];

  return (
    <>
      <h1>Analyses</h1>
      <p className="lede">
        Every number here came from a recorded run in the sandbox, reproducible
        from its stored specification.
      </p>

      <div style={{ margin: "12px 0" }}>
        {/*
          Reloading rather than jumping to the run: a queued analysis has no
          result yet, and opening an empty detail screen would look like a
          failure. It appears in this list immediately, with its status.
        */}
        <RunAnalysis projectId={projectId} onQueued={() => reload()} />
      </div>

      {runs.length === 0 && (
        <Empty
          title="No analyses yet"
          hint="Run discovery to search for candidates, or specify one yourself."
        />
      )}

      {runs.map((run) => (
        <div className="card card-tight" key={run.id}
             style={{ cursor: "pointer" }} onClick={() => onSelect(run.id)}>
          <div className="row">
            <button type="button" className="pick"
                    style={{ fontWeight: 530, width: "auto" }}
                    onClick={() => onSelect(run.id)}>
              {nameOf(run)}
            </button>
            <span className="mono" style={{ color: "var(--ink-faint)" }}>
              {run.method.replace(/_/g, " ")}
            </span>
          </div>
          <div className="row">
            <span className="note">{ORIGIN_NOTE[run.origin] ?? run.origin}</span>
            <Headline run={run} />
          </div>
          {run.error && (
            /* Dropping failures would make the search look more successful
               than it was. */
            <p className="note" role="alert">{run.error}</p>
          )}
          {run.origin === "fork" && run.fork_reason && (
            <p className="note">Forked: {run.fork_reason}</p>
          )}
        </div>
      ))}
    </>
  );
}


/**
 * The plain-language reading of one run.
 *
 * `GET /analyses/{id}/plain-summary` is keyed on the run and has always been,
 * but the only thing that asked for it was `ResultCard`, which needs a
 * connection. So the one feature whose whole job is to make a result legible
 * to someone who does not read confidence intervals was reachable exactly when
 * a discovery sweep had produced the result — and unreachable for an analysis
 * a researcher specified, which is the case where they are most likely to be
 * showing it to somebody else.
 *
 * The card is not reused: it takes a connection, and inventing one to satisfy
 * a prop would put a fabricated q-value on screen.
 *
 * **A refusal is shown in the server's own words.** The route answers 409 for
 * two states a researcher can act on — no model is configured on this machine,
 * and the run has not finished — and both are facts rather than failures.
 * Restating them here would let the two drift, and "That did not work" is not
 * what either of them means.
 */
export function PlainReading({ runId }: { runId: string }) {
  const { data, error, loading, reload } = useApi<PlainSummary>(
    `/api/analyses/${runId}/plain-summary`, [runId]);

  if (loading) return <Loading rows={2} label="Reading the result in plain words" />;

  if (error) {
    if (error instanceof ApiError && error.status === 409) {
      return <p className="note" role="status">{error.message}</p>;
    }
    return <Failure error={error} retry={reload} />;
  }
  if (!data) return null;

  return (
    <section aria-labelledby="plain-heading" style={{ marginTop: 18 }}>
      <h2 id="plain-heading" className="eyebrow">In plain words</h2>
      <p style={{ fontWeight: 530 }}>{data.headline}</p>
      <p>{data.what_it_means}</p>
      <p className="note">{data.how_confident}</p>

      {/*
        Kept beside the reading rather than below the fold. The sentence a
        summary is most likely to be quoted out of is the causal one, and
        whether the design permits that language is not a detail of it.
      */}
      <h3 className="eyebrow">Does this say anything caused anything</h3>
      <p>{data.causal_reading}</p>
      {data.design && (
        <p className="note">
          {data.design.description}
          {data.design.permits_causal_language
            ? ""
            : " — which does not support causal language, whatever the size of "
              + "the effect."}
        </p>
      )}
    </section>
  );
}
