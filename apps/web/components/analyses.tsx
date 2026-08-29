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

import { AnalysisRunRow } from "@/lib/api";
import { useApi } from "@/lib/useApi";
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
            <span style={{ fontWeight: 530 }}>{nameOf(run)}</span>
            <span className="mono" style={{ color: "var(--ink-faint)" }}>
              {run.method.replace(/_/g, " ")}
            </span>
          </div>
          <div className="row">
            <span className="note">{ORIGIN_NOTE[run.origin] ?? run.origin}</span>
            {/*
              Keyed off whether there is a number, not off a status string.
              `analysis_runs` finishes as "completed" and `discovery_runs`
              finishes as "complete" — two tables, two words — so a component
              that tests for one of them is wrong about the other and silently
              shows a status badge where a result belongs. A run with an
              estimate has one; a run without says where it is instead.
            */}
            {run.estimate !== null ? (
              <span className="numeric">
                {run.estimate_name ?? "estimate"} <Num value={run.estimate} />
              </span>
            ) : <Status value={run.status} />}
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
