"use client";

/**
 * The cockpit's left column: what this run was computed FROM.
 *
 * UI_02 puts three things here and they are all the same kind of thing — the
 * working material, not the navigation. The project's sources, the variables in
 * play with the role each is serving, and the family of runs this one belongs
 * to. Together they answer the question a researcher actually has in front of a
 * result, which is "computed from what, and what else did I try".
 *
 * Everything here is real. The sources come from the project, the variables
 * from the run's own recorded specification, and the family from the project's
 * analyses. Nothing is invented to fill the column: a run with no siblings says
 * so, and a run that recorded no variable roles says that too. §09 is explicit
 * that an unavailable field is shown honestly rather than filled in.
 */

import type { AnalysisRunRow, Source } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Tabs } from "./Tabs";
import { StateMark } from "./primitives";
import { IconAnalyses, IconDataset, IconLiterature } from "./icons";

/** The colour a variable's role is drawn in, matching the workspace palette. */
function roleTone(role: string): string {
  const r = role.toLowerCase();
  if (r.includes("exposure") || r.includes("predictor") || r.includes("factor")) return "var(--accent)";
  if (r.includes("outcome") || r.includes("response") || r.includes("measure")) return "var(--info, var(--accent))";
  return "var(--ink-faint)";
}

export function AnalysisRail({ projectId, runId, variables, onOpenRun }: {
  projectId: string;
  /** The run on screen, so its siblings can be marked. */
  runId: string;
  /** The run's own recorded variable roles. */
  variables: Record<string, unknown>;
  onOpenRun?: (id: string) => void;
}) {
  const sources = useApi<Source[]>(`/api/projects/${projectId}/sources`);
  const runs = useApi<AnalysisRunRow[]>(`/api/projects/${projectId}/analyses`);

  const roles = Object.entries(variables ?? {});
  const family = runs.data ?? [];

  return (
    <>
    <Tabs
      label="Working data"
      tabs={[
        {
          id: "data",
          label: "Data",
          note: sources.data ? String(sources.data.length) : undefined,
          panel: () => (
            <>
              <h2 className="eyebrow">Project sources</h2>
              {sources.loading && <p className="note">Reading the project’s sources…</p>}
              {/* `error` is `unknown` by design here, so it is reported rather
                  than unwrapped: a failed source list must say it failed, and
                  must not be able to throw while saying so. */}
              {sources.error != null && (
                <p className="note" role="status">The project’s sources could not be read.</p>
              )}
              {sources.data?.length === 0 && (
                <p className="note">This project has no sources yet.</p>
              )}
              <ul className="rail-list">
                {sources.data?.map((source: Source) => (
                  <li key={source.id} className="rail-card">
                    {/* A paper and a dataset are marked differently, as UI_02
                        marks them: a column of identical rows is one a reader
                        has to read word by word, because nothing in it can be
                        scanned. The type is still written out beside it —
                        §04 forbids colour or shape as the sole carrier. */}
                    <span className="rail-icon" aria-hidden>
                      {source.source_type === "dataset"
                        ? <IconDataset size={14} /> : <IconLiterature size={14} />}
                    </span>
                    <span className="rail-card-name">{source.title || source.id}</span>
                    <span className="rail-card-meta mono">{source.source_type}</span>
                  </li>
                ))}
              </ul>
            </>
          ),
        },
        {
          id: "variables",
          label: "Variables",
          note: roles.length ? String(roles.length) : "none",
          panel: () => (
            <>
              <h2 className="eyebrow">Selected roles</h2>
              {roles.length === 0 ? (
                /* Not every method records roles, and inventing an
                   exposure/outcome pair for one that did not would be a small
                   lie about what was run. */
                <p className="note">This run recorded no variable roles.</p>
              ) : (
                <ul className="rail-list">
                  {roles.map(([role, name]) => (
                    <li key={role} className="rail-role">
                      <span className="rail-dot" style={{ background: roleTone(role) }} aria-hidden />
                      <span className="mono">{String(name)}</span>
                      {/* The role is a word, not only a colour: §04 forbids
                          colour as the sole carrier of meaning. A pill rather
                          than loose text, as UI_02 sets it — the role is a
                          property of the variable, and running it on as plain
                          words made the pair read as two variables. */}
                      <span className="rail-role-name" data-role={role}>
                        {role.replace(/_/g, " ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ),
        },
      ]}
    />

    {/*
      * The run family, beside the run rather than behind a tab.
      *
      * §08 asks the cockpit to keep "sources, active computation and evidence
      * context together", and UI_02 draws exactly that: Data and Variables are
      * tabs over the source list, and *Analysis runs* is its own section under
      * them, always there. Filed as a third tab it was never on screen at the
      * same time as the run it belongs to — so the column a reader glances at
      * to see what else has been tried showed one source and nothing else, and
      * the densest part of the master was the emptiest part of ours.
      */}
    <section className="rail-section">
      <h2 className="eyebrow">Analysis runs</h2>
      {runs.loading && <p className="note">Reading this project’s runs…</p>}
      {family.length === 0 && !runs.loading && (
        <p className="note">This project has no other runs.</p>
      )}
      <ul className="rail-list">
        {family.map((run: AnalysisRunRow) => (
          <li key={run.id}>
            <button
              type="button"
              className="rail-run"
              aria-current={run.id === runId}
              onClick={() => onOpenRun?.(run.id)}
            >
              <span className="rail-icon" aria-hidden><IconAnalyses size={14} /></span>
              <span className="rail-card-name">{run.method.replace(/_/g, " ")}</span>
              <span className="rail-card-meta">
                <StateMark value={run.status} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
    </>
  );
}
