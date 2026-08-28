"use client";

/**
 * Where this analysis came from, and what was tried from it.
 *
 * A sensitivity analysis is the relationship between runs, not any one of them.
 * A result with the outlier excluded means nothing on its own — it is only
 * informative beside the run that included it, and only honest if the reason
 * for excluding it was written down before the number was known. The schema has
 * recorded both since the beginning and nothing ever displayed them, so a
 * researcher could fork a run, change one filter, and afterwards have no way to
 * see the two were related.
 *
 * The chain reads oldest first, because it is a history. Each row says what
 * changed at that step rather than what the run was, since "why is this
 * different from the one before it" is the question a reader actually has.
 *
 * Nothing here counts branches at the researcher against them. Forking is how
 * sensitivity analysis is done; the dishonest version is not forking often, it
 * is forking and reporting only the branch that worked. Making all of them
 * visible is the entire contribution, and a screen that frowned at the eighth
 * variant would discourage exactly the behaviour it exists to support.
 */

import { useApi } from "@/lib/useApi";
import { Failure, Loading } from "./primitives";
import { CompareBranches, ForkAnalysis } from "./sensitivity";

type Ancestor = {
  id: string;
  status?: string;
  reason_for_the_fork_below: string;
  cycle: boolean;
};

type Child = { id: string; fork_reason: string; status: string };

type Lineage = {
  run_id: string;
  ancestors: Ancestor[];
  children: Child[];
  depth: number;
  note: string;
};

export function ForkLineage({ projectId, runId, method, onOpen }: {
  projectId: string;
  runId: string;
  /** The method this run used, so a branch can be offered that changes it. */
  method?: string | null;
  onOpen?: (runId: string) => void;
}) {
  const { data, error, loading, reload } = useApi<Lineage>(
    `/api/projects/${projectId}/analyses/${runId}/lineage`, [runId],
  );

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) return <Loading rows={2} label="Tracing where this came from" />;

  /*
   * Every run in the family: the chain above, this one, and the branches from
   * it. This is what a comparison is *of* — the relationship between the runs,
   * which is the thing a sensitivity analysis actually reports.
   */
  const family = [
    ...data.ancestors.filter((a) => !a.cycle).map((a) => a.id),
    data.run_id,
    ...data.children.map((c) => c.id),
  ];

  /*
   * An original analysis with no branches still has no relationship to
   * describe, and a panel saying so on every run would be noise on most of
   * them. But the button that *creates* the first branch has to be somewhere,
   * and hiding it here would hide it exactly where a researcher needs it
   * first — on a run nobody has forked yet. So the description stays
   * conditional and the action does not.
   */
  if (data.depth === 0 && data.children.length === 0) {
    return (
      <div style={{ marginTop: 20 }}>
        <ForkAnalysis runId={runId} method={method} onForked={reload} />
      </div>
    );
  }

  return (
    <section aria-labelledby="lineage-heading" style={{ marginTop: 20 }}>
      <h2 id="lineage-heading">Sensitivity branch</h2>
      <p className="note">{data.note}</p>

      <div className="row" style={{ gap: "0.5rem", marginBottom: 12 }}>
        <ForkAnalysis runId={runId} method={method} onForked={reload} />
      </div>
      <CompareBranches projectId={projectId} runIds={family} />

      {data.ancestors.length > 0 && (
        <ol style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13 }}>
          {data.ancestors.map((ancestor) => (
            <li key={ancestor.id} style={{ marginBottom: 6 }}>
              {ancestor.cycle ? (
                // The schema permits a loop and nothing prevents one. Saying so
                // beats presenting a truncated history as a complete one.
                <span>
                  This chain refers back to a run already in it, so the history
                  above this point cannot be read.
                </span>
              ) : (
                <>
                  <button type="button" className="mono"
                          onClick={() => onOpen?.(ancestor.id)}>
                    {ancestor.id}
                  </button>
                  <div style={{ color: "var(--ink-faint)" }}>
                    changed below this: {ancestor.reason_for_the_fork_below
                                          || "no reason was recorded"}
                  </div>
                </>
              )}
            </li>
          ))}
          <li><b>this run</b></li>
        </ol>
      )}

      {data.children.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 560, margin: "0 0 4px" }}>
            Branches taken from here:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {data.children.map((child) => (
              <li key={child.id} style={{ marginBottom: 4 }}>
                <button type="button" className="mono"
                        onClick={() => onOpen?.(child.id)}>
                  {child.id}
                </button>
                <span style={{ color: "var(--ink-faint)" }}>
                  {" — "}
                  {child.fork_reason || "no reason was recorded"}
                  {child.status !== "succeeded" && ` (${child.status})`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
