"use client";

/**
 * Forking an analysis, and comparing the branches (§ sensitivity analysis).
 *
 * `components/forklineage.tsx` already showed where a run came from and what
 * was tried from it, and its own opening line says a sensitivity analysis is
 * the relationship between runs rather than any one of them. That relationship
 * had no screen: `POST /analyses/{id}/fork` had no caller, so the history could
 * not be added to, and `GET /projects/{id}/analyses/compare` had no caller, so
 * the branches could never be put side by side.
 *
 * The comparison is the part that matters. `compare_runs` already answers the
 * only question worth asking of a set of branches — whether they agree — and
 * says so in the case that counts: *"branches disagree on significance, the
 * conclusion depends on an analytical choice and should be reported as such."*
 * No researcher could reach that sentence.
 *
 * **A fork with nothing changed is a re-run, not a sensitivity test.** It would
 * produce an identical result, and a comparison of two identical runs reports a
 * stable conclusion — which is flattery, not evidence. So the form asks for a
 * change, and says plainly what happens if none is made.
 */

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { Failure } from "./primitives";
import { TermList } from "./term";

/**
 * The rank-based counterpart of each method, and back again.
 *
 * A fork copies the parent's spec and may override the method, but only a
 * method taking the same variable roles can replace another — `create_spec`
 * refuses the rest, and offering them would be offering a 422.
 *
 * Role compatibility is necessary and not sufficient: `chi_square` also takes
 * an x and a y, and proposing it as an alternative to a correlation would be
 * proposing a test for categorical data on continuous columns. What is offered
 * instead is the established pairing — the same question asked without the
 * distributional assumption, which is what a sensitivity analysis is for.
 */
export const WITHOUT_THE_ASSUMPTION: Record<string, string> = {
  pearson_correlation: "spearman_correlation",
  spearman_correlation: "pearson_correlation",
  t_test: "mann_whitney",
  mann_whitney: "t_test",
  anova: "kruskal_wallis",
  kruskal_wallis: "anova",
};

/** How a method reads in a sentence. */
export function methodName(method: string): string {
  return method.replace(/_/g, " ");
}

export type Branch = {
  run_id: string;
  status: string;
  method: string;
  fork_reason: string | null;
  estimate: number | null;
  estimate_name: string | null;
  ci_low: number | null;
  ci_high: number | null;
  p_value: number | null;
  sample_size: number | null;
  statistically_significant: boolean | null;
};

export type Comparison = {
  runs: Branch[];
  conclusion_stable: boolean;
  note: string;
};

/** A number as a reader wants it, or an honest dash. */
export function show(value: number | null, digits = 3): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) !== 0 && Math.abs(value) < 0.001) return value.toExponential(1);
  return String(Number(value.toFixed(digits)));
}

export function ForkAnalysis({ runId, method, onForked }: {
  runId: string;
  /** The method this run used, when it is known. */
  method?: string | null;
  onForked?: (newRunId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [swap, setSwap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alternative = method ? WITHOUT_THE_ASSUMPTION[method] : undefined;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const forked = await api.post<{ analysis_run_id: string }>(
        `/api/analyses/${runId}/fork`,
        { reason, method: swap && alternative ? alternative : null });
      setOpen(false);
      setReason("");
      setSwap(false);
      onForked?.(forked.analysis_run_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Try this a different way
      </button>
    );
  }

  return (
    <form className="card" onSubmit={submit} aria-label="Fork this analysis">
      <h3 style={{ marginTop: 0 }}>Try this a different way</h3>
      <p style={{ color: "var(--ink-faint)" }}>
        The new run keeps this one&apos;s question and data. Both are kept, and
        the reason is recorded against the branch — reporting only the version
        that worked is the thing this exists to make visible.
      </p>

      <label style={{ display: "block", marginBottom: 10 }}>
        Why are you trying it this way?
        <textarea
          required rows={2} value={reason} style={{ width: "100%" }}
          placeholder="The outcome is skewed, so a rank-based test is fairer."
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      {alternative ? (
        <label className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
          <input type="checkbox" checked={swap}
                 onChange={(e) => setSwap(e.target.checked)} />
          <span>
            Run it as {methodName(alternative)} instead of{" "}
            {methodName(method!)} — the same question without the
            distributional assumption.
          </span>
        </label>
      ) : (
        <p className="note">
          {/* Honest about the limit rather than silently producing a duplicate:
              the fork route can also override filters and variables, and this
              form cannot edit either yet. */}
          There is no rank-based counterpart to
          {method ? ` ${methodName(method)}` : " this method"} to offer here, so
          this branch will re-run the same analysis unchanged.
        </p>
      )}

      {alternative && !swap && (
        <p className="note">
          With nothing changed this re-runs the same analysis and will give the
          same answer. Two identical runs agree, and a comparison would report a
          stable conclusion — which would be flattery rather than evidence.
        </p>
      )}

      {error && <div className="notice" role="alert">{error}</div>}

      <div className="row" style={{ gap: "0.5rem", marginTop: 10 }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Queuing…" : "Run the branch"}
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CompareBranches({ projectId, runIds }: {
  projectId: string;
  /** Every run in the family: the ancestors, this one, and the branches. */
  runIds: string[];
}) {
  const [data, setData] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function compare() {
    setBusy(true);
    setError(null);
    try {
      const query = runIds.map((id) => `run_id=${encodeURIComponent(id)}`).join("&");
      setData(await api.get<Comparison>(
        `/api/projects/${projectId}/analyses/compare?${query}`));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  // Two is the minimum the server accepts, and the minimum that means
  // anything: one run compared with itself is not a sensitivity analysis.
  if (runIds.length < 2) return null;

  return (
    <div style={{ marginTop: 12 }}>
      {!data && (
        <button className="btn" disabled={busy} onClick={() => void compare()}>
          {busy ? "Comparing…" : `Compare these ${runIds.length} runs`}
        </button>
      )}
      {error ? <Failure error={error} retry={() => void compare()} /> : null}

      {data && (
        <section aria-label="Comparison of branches">
          {/*
            The verdict first. It is the answer to the only question a set of
            branches raises, and putting it under the table would leave the
            reader to work it out from seven columns of numbers.
          */}
          <p className={data.conclusion_stable ? "note" : "notice"}
             role={data.conclusion_stable ? undefined : "alert"}>
            {data.note}
          </p>

          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Run</th><th>Method</th><th>Why this branch</th>
                  <th>Estimate</th><th>95% CI</th><th>p</th><th>n</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.run_id}>
                    <td className="mono">{run.run_id}</td>
                    <td>{methodName(run.method)}</td>
                    <td>{run.fork_reason || "the original analysis"}</td>
                    <td>
                      {run.status === "completed" ? show(run.estimate)
                        // A branch that has not finished has no number, and a
                        // blank cell would read as one that found nothing.
                        : `not finished (${run.status})`}
                    </td>
                    <td>
                      {run.ci_low === null || run.ci_high === null ? "—"
                        : `${show(run.ci_low)} to ${show(run.ci_high)}`}
                    </td>
                    <td>{show(run.p_value, 4)}</td>
                    <td>{run.sample_size ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Four of the seven headings are symbols (T188). The branch column
              is already prose, so only the numeric ones need naming. */}
          <TermList ids={["estimate", "95% CI", "p-value", "n"]} />
        </section>
      )}
    </div>
  );
}
