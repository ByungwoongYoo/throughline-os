"use client";

/**
 * The workspace views.
 *
 * These are presentation only: every number shown comes from the API, and
 * nothing is computed in the browser. §106 forbids shipping rows to React, and
 * more importantly a figure or a statistic recomputed here could disagree with
 * the analysis that produced it.
 */

import { useEffect, useRef, useState } from "react";
import {
  AnalysisRun, Connection, DatasetColumn, DiscoveryMap, EvidenceGraph, Finding,
  INGESTION_STAGES, Provenance, SearchResult, Source, ValidationReport, api,
  ingestionStep, isIngesting,
} from "@/lib/api";
import { ApiState, useApi } from "@/lib/useApi";
import { sessionId } from "@/lib/session";
import { Section } from "./Shell";
import { PlainSummary, ResultCard } from "./ResultCard";
import { Empty, Failure, Loading, Meter, Num, Stat, Status } from "./primitives";
import { RecordFinding } from "./recordfinding";

// ---------------------------------------------------------------------------
// Overview (§70)
// ---------------------------------------------------------------------------

export function Overview({ project, map, onGo }: {
  project: { name: string; research_question: string };
  map: DiscoveryMap | null;
  onGo: (section: Section) => void;
}) {
  if (!map) return <Loading rows={4} label="Reading the project" />;

  const connections = Object.values(map.connections).reduce((a, b) => a + b, 0);
  const findings = Object.values(map.findings).reduce((a, b) => a + b, 0);
  const validated = (map.connections.validated ?? 0) + (map.connections.replicated ?? 0);

  /*
   * The research loop as a checklist against real state (§70).
   *
   * A dashboard of six zeroes tells a new researcher nothing about what to do.
   * Each step here is ticked from the project's actual counts, so the list is
   * both an explanation of the method and the place you start the next step —
   * and it can never claim progress the database does not have.
   */
  const steps: Array<{ done: boolean; label: string; hint: string; go: Section }> = [
    {
      done: map.counts.sources > 0,
      label: "Add sources",
      hint: "Drop a dataset and the papers around it. Files never leave this machine.",
      go: "sources",
    },
    {
      done: map.counts.datasets > 0,
      label: "Profile a dataset",
      hint: "Discovery works from the profiled schema, so it needs tabular data.",
      go: "sources",
    },
    {
      done: connections > 0,
      label: "Generate and test candidates",
      hint: "Every pair is tested, then corrected for how many tests ran.",
      go: "discover",
    },
    {
      done: validated > 0,
      label: "Try to destroy what survived",
      hint: "Bootstrap, outliers, missingness, confounders. Promotion is earned.",
      go: "connections",
    },
    {
      done: findings > 0,
      label: "Record a finding",
      hint: "A finding must carry both the evidence for it and the evidence against it.",
      go: "findings",
    },
    {
      done: (map.counts.reports ?? 0) > 0,
      label: "Communicate it",
      hint: "A report references its evidence rather than copying it, so the two cannot drift apart.",
      go: "reports",
    },
  ];
  const next = steps.find((s) => !s.done);

  return (
    <>
      <h1>{project.name}</h1>
      <p className="lede serif" style={{ fontSize: 15 }}>
        {project.research_question || "No research question has been stated yet."}
      </p>

      {/*
        One readout strip rather than six bordered cards. Six numbers deserve
        one glance, not six hundred pixels of chrome — and a card per integer
        is the dashboard reflex this deliberately avoids.
      */}
      <div className="meters">
        <Meter label="Sources" value={map.counts.sources} />
        <Meter label="Datasets" value={map.counts.datasets} />
        <Meter label="Analyses" value={map.counts.analyses} />
        <Meter label="Connections" value={connections} />
        <Meter label="Findings" value={findings} />
        <Meter label="Contradictions" value={map.counts.contradictions} />
      </div>

      <div className="card">
        <h2>The loop</h2>
        <ol className="steps">
          {steps.map((step) => (
            <li key={step.label} data-done={step.done} data-next={step === next}>
              <button onClick={() => onGo(step.go)}>
                <span className="step-tick" aria-hidden />
                <span>
                  <b>{step.label}</b>
                  <em>{step.hint}</em>
                </span>
                {/* Never colour alone (§118): the state is also a word. */}
                <span className="step-state">
                  {step.done ? "done" : step === next ? "next" : "waiting"}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {/* §70 — the server's own recommendation, which knows things the
            checklist does not, such as which connection ranks highest. */}
        <p className="note" style={{ marginBottom: 0 }}>{map.recommended_next_action}</p>
      </div>

      <LifecycleBreakdown title="Connections" counts={map.connections} />
      <LifecycleBreakdown title="Findings" counts={map.findings} />
    </>
  );
}

function LifecycleBreakdown({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  return (
    <div className="card">
      <h2>{title} by lifecycle state</h2>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {entries.map(([state, count]) => (
          <div key={state}>
            <Status value={state} />
            <div className="numeric" style={{ fontSize: 17, fontWeight: 620 }}>{count}</div>
          </div>
        ))}
      </div>
      <p className="note">
        A candidate is not a discovery. Promotion through these states is earned by the
        robustness checks, never asserted.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources (§24, §26)
// ---------------------------------------------------------------------------

export function Sources({ sources, onSelect, upload, uploading, uploadError }: {
  /*
   * The list is owned by the workspace, not fetched here.
   *
   * This view used to call useApi for the same path the workspace already
   * fetched, which meant two independent copies of the same list and two
   * independent refresh paths. After an upload the workspace refreshed its copy
   * and this one kept showing the old rows: files landed on disk, were ingested,
   * and never appeared on screen. One owner, one refresh.
   */
  sources: ApiState<Source[]>;
  onSelect: (id: string) => void;
  upload: (files: FileList | null) => void;
  uploading: boolean;
  uploadError: unknown;
}) {
  const { data, error, loading, reload } = sources;

  /*
   * Ingestion is asynchronous, so the list has to move on its own or a source
   * sits at "queued" until the researcher thinks to refresh. Polling stops once
   * nothing is in flight — a workspace left open overnight should not keep
   * hitting the API.
   */
  const settling = (data ?? []).some((s) => isIngesting(s.ingestion_status));

  useEffect(() => {
    if (!settling && !uploading) return;
    const timer = setInterval(reload, 1500);
    return () => clearInterval(timer);
  }, [settling, uploading, reload]);

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <div>
          <h1>Sources</h1>
          <p style={{ margin: 0 }}>Papers and datasets. Everything here is treated as untrusted until parsed.</p>
        </div>
        <label className="btn btn-primary" style={{ display: "inline-block" }}>
          {uploading ? "Uploading…" : "Add sources"}
          <input
            type="file" multiple hidden disabled={uploading}
            accept=".pdf,.docx,.txt,.md,.csv,.tsv,.xlsx,.json"
            onChange={(e) => upload(e.target.files)}
          />
        </label>
      </div>

      {uploadError ? <Failure error={uploadError} /> : null}
      {error ? <Failure error={error} retry={reload} /> : null}
      {loading && !data && <Loading rows={4} label="Reading sources" />}

      {data && data.length === 0 && (
        <Empty
          title="No sources yet"
          hint="Drop files anywhere in this window, or use Add sources. A dataset is what discovery needs; a paper is what gives it context."
        />
      )}

      {data && data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th style={{ width: "55%" }}>Source</th>
              <th style={{ width: "14%" }}>State</th>
              <th>What was extracted</th>
            </tr>
          </thead>
          <tbody>
            {data.map((source) => (
              <tr key={source.id} style={{ cursor: "pointer" }} onClick={() => onSelect(source.id)}>
                <td>
                  <div style={{ fontWeight: 540, wordBreak: "break-word" }}>{source.title}</div>
                  {/* §35 — trust level travels with the source, not in its own column. */}
                  <span className="mono" style={{ color: "var(--ink-faint)" }}>
                    {source.source_type} · {source.trust_level}
                  </span>
                </td>
                <td>
                  <Status value={source.ingestion_status} />
                  {/* The bar shows position in the §24 pipeline, which the worker
                      genuinely reports. It is not a time estimate, and it never
                      invents a percentage from one. */}
                  {isIngesting(source.ingestion_status) && (
                    <Ingesting status={source.ingestion_status} />
                  )}
                </td>
                <td style={{ color: "var(--ink-soft)" }}>
                  {isIngesting(source.ingestion_status) && (
                    <span style={{ color: "var(--ink-faint)" }}>
                      {source.ingestion_detail || "Waiting for a worker to pick it up…"}
                    </span>
                  )}
                  {source.dataset && (
                    <span className="numeric">
                      {source.dataset.row_count} rows · {source.dataset.column_count} columns
                    </span>
                  )}
                  {source.paper && (
                    <span className="numeric">
                      {source.passage_count ?? "?"} passages · {source.paper.page_count} pages
                    </span>
                  )}
                  {!source.dataset && !source.paper && (source.ingestion_detail || "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * What ingestion actually made of a file (§24, §26).
 *
 * Clicking a source used to do nothing, which taught the researcher that the
 * row was the whole truth. It is not: a dataset row hides a profiled schema, and
 * that profile is what every later method choice depends on.
 */
export function SourceDetail({ projectId, sourceId, onDiscover }: {
  projectId: string;
  sourceId: string;
  onDiscover: (datasetVersionId: string) => void;
}) {
  const { data, error, loading, reload } =
    useApi<Source>(`/api/projects/${projectId}/sources/${sourceId}`);
  const columns = useApi<DatasetColumn[]>(
    data?.dataset ? `/api/dataset-versions/${data.dataset.dataset_version_id}/columns` : null,
  );

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) return <Loading rows={5} label="Reading the source" />;

  return (
    <>
      <h1 style={{ wordBreak: "break-word" }}>{data.title}</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        <Status value={data.ingestion_status} />
        <span className="mono" style={{ color: "var(--ink-faint)" }}>
          {data.source_type} · trust: {data.trust_level}
        </span>
      </div>

      {data.ingestion_status === "failed" && (
        <div className="error">{data.ingestion_detail || "Ingestion failed with no detail recorded."}</div>
      )}

      {data.paper && (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <Stat label="pages" value={data.paper.page_count} />
          <Stat label="passages indexed" value={data.passage_count ?? 0} />
        </div>
      )}

      {data.dataset && (
        <>
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <Stat label="rows" value={data.dataset.row_count} />
            <Stat label="columns" value={data.dataset.column_count} />
            <Stat label="version" value={data.dataset.version} />
          </div>

          <div className="card">
            <div className="row" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Profiled schema</h2>
              <button
                className="btn btn-primary"
                onClick={() => onDiscover(data.dataset!.dataset_version_id)}
              >
                Discover connections
              </button>
            </div>
            <p style={{ marginTop: 0 }}>
              Every candidate relationship, and every method chosen to test one, follows
              from these types.
            </p>

            {columns.loading && <Loading rows={4} label="Reading the profile" />}
            {columns.error ? <Failure error={columns.error} retry={columns.reload} /> : null}
            {columns.data && (
              <table>
                <thead>
                  <tr>
                    <th>Column</th><th>Type</th><th style={{ textAlign: "right" }}>Missing</th>
                    <th style={{ textAlign: "right" }}>Distinct</th><th>Sensitivity</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.data.map((column) => (
                    <tr key={column.name}>
                      <td className="mono" style={{ color: "var(--ink)" }}>{column.name}</td>
                      <td style={{ color: "var(--ink-soft)" }}>
                        {column.semantic_type || column.physical_type}
                        {column.unit ? ` · ${column.unit}` : ""}
                      </td>
                      <td className="numeric" style={{ textAlign: "right" }}>{column.missing_count}</td>
                      <td className="numeric" style={{ textAlign: "right" }}>{column.unique_count}</td>
                      <td style={{ color: "var(--ink-soft)" }}>{column.sensitivity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {!data.paper && !data.dataset && data.ingestion_status === "ready" && (
        <Empty
          title="Nothing structured was extracted"
          hint="The file was read, but it produced neither a paper nor a dataset."
        />
      )}
    </>
  );
}

/** Where a source has got to in the §24 pipeline, stated rather than spun. */
function Ingesting({ status }: { status: string }) {
  const step = ingestionStep(status);
  const total = INGESTION_STAGES.length;
  return (
    <span
      className="progress"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={step ?? undefined}
      aria-label={`Ingesting: ${status}`}
      style={step ? { ["--at" as string]: `${(step / total) * 100}%` } : undefined}
      data-known={step !== null}
      title={step ? `${status} — step ${step} of ${total}` : status}
    />
  );
}

// ---------------------------------------------------------------------------
// Search (§29, §30)
// ---------------------------------------------------------------------------

export function Search({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const path = submitted ? `/api/projects/${projectId}/search?q=${encodeURIComponent(submitted)}&limit=12` : null;
  const { data, error, loading, reload } = useApi<SearchResult>(path);

  return (
    <>
      <h1>Search</h1>
      <p className="lede">
        Keyword and meaning together. Every search is recorded, so an answer built on
        one can be traced back to the passages it came from.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim() || null); }}
        style={{ display: "flex", gap: 8, marginBottom: 16 }}
      >
        <input
          type="text" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. how many people took part in the trial"
          aria-label="Search the corpus"
        />
        <button className="btn btn-primary" type="submit" disabled={!query.trim()}>Search</button>
      </form>

      {error ? <Failure error={error} retry={reload} /> : null}
      {loading && <Loading rows={3} label="Retrieving passages" />}

      {data && (
        <>
          <div className="mono" style={{ color: "var(--ink-faint)", marginBottom: 12 }}>
            strategy: {data.strategy} · lexical {data.lexical_candidates} · semantic{" "}
            {data.semantic_candidates} · event {data.retrieval_event_id}
          </div>
          {data.results.length === 0 && <Empty title="Nothing matched" hint="Try different words, or add more sources." />}
          {data.results.map((hit) => (
            <div className="card card-tight" key={hit.passage_id}>
              <div className="row" style={{ marginBottom: 5 }}>
                <span className="mono" style={{ color: "var(--ink-faint)" }}>
                  #{hit.rank} · {hit.locator}{hit.section ? ` · ${hit.section}` : ""}
                </span>
                <span className="mono" style={{ color: "var(--ink-faint)" }}>
                  lex <Num value={hit.lexical_score} digits={3} /> · sem <Num value={hit.semantic_score} digits={3} />
                </span>
              </div>
              <div className="serif" style={{ fontSize: 13.5 }}>{hit.content.slice(0, 420)}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Discovery (§48, §49)
// ---------------------------------------------------------------------------

export function Discover({ projectId, sources, onSelectConnection, startWith, onStarted }: {
  projectId: string;
  /** Owned by the workspace — see the note on Sources. */
  sources: ApiState<Source[]>;
  onSelectConnection: (id: string) => void;
  /** Set when the researcher pressed "Discover connections" on a source. */
  startWith?: string | null;
  onStarted?: () => void;
}) {
  const connections = useApi<Connection[]>(`/api/projects/${projectId}/connections?limit=100`);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reused, setReused] = useState<string | null>(null);

  const datasets = (sources.data ?? []).filter((s) => s.dataset);

  /*
   * Carry the intent across the navigation, so pressing the button on a source
   * starts the run instead of landing on a screen with the same button again.
   *
   * The ref is load-bearing, not defensive noise: React's development StrictMode
   * mounts every component twice, which fires this effect twice and submitted
   * two discovery runs. The server now refuses the duplicate as well, but the
   * client should not be sending it.
   */
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!startWith || started.current === startWith) return;
    started.current = startWith;
    onStarted?.();
    void discover(startWith);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith]);

  async function discover(versionId: string, force = false) {
    setRunning(true);
    setError(null);
    setReused(null);
    try {
      const started = await api.post<{ reused: boolean; note?: string }>(
        `/api/projects/${projectId}/discoveries`,
        // The session travels with the request so the sweep joins the family
        // of everything else looked at in this sitting. Null in a private
        // window, where storage is refused — the run is then its own family,
        // which is what happened before any of this existed.
        { dataset_version_id: versionId, force, session_id: sessionId() },
      );
      // §123 — if the server declined to start a second run, say so. A button
      // that appears to work and quietly does nothing is worse than an error.
      if (started.reused) {
        setReused(started.note ?? "A run already exists for this dataset version.");
        connections.reload();
        return;
      }
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        connections.reload();
      }
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <h1>Discovery</h1>
      <p className="lede">
        Candidate relationships are generated from the profiled schema, tested in the
        sandbox, then corrected for how many tests ran. Rejected candidates stay
        visible — they were tested, they are simply not discoveries.
      </p>

      {error ? <Failure error={error} /> : null}

      {reused && (
        <div className="notice" role="status">
          <span>{reused}</span>
          <button
            className="btn"
            onClick={() => {
              const only = datasets[0];
              if (only) void discover(only.dataset!.dataset_version_id, true);
            }}
          >
            Run it again anyway
          </button>
        </div>
      )}

      {datasets.length === 0 && (
        <Empty title="No dataset to search" hint="Discovery needs tabular data. Add a CSV or spreadsheet." />
      )}

      {datasets.map((source) => (
        <div className="card row" key={source.id}>
          <div>
            <div style={{ fontWeight: 540 }}>{source.title}</div>
            <div className="mono" style={{ color: "var(--ink-faint)" }}>
              {source.dataset!.row_count} rows · {source.dataset!.column_count} columns
            </div>
          </div>
          <button
            className="btn btn-primary" disabled={running}
            onClick={() => discover(source.dataset!.dataset_version_id)}
          >
            {running ? "Testing candidates…" : "Discover connections"}
          </button>
        </div>
      ))}

      {running && <Loading rows={2} label="Generating candidates, running tests, correcting for multiple testing" />}

      <ConnectionsTable
        connections={connections.data} error={connections.error}
        loading={connections.loading} reload={connections.reload}
        onSelect={onSelectConnection}
      />
    </>
  );
}

export function ConnectionsTable({ connections, error, loading, reload, onSelect }: {
  connections: Connection[] | null;
  error: unknown; loading: boolean; reload: () => void;
  onSelect: (id: string) => void;
}) {
  if (error) return <Failure error={error} retry={reload} />;
  if (loading && !connections) return <Loading rows={4} label="Reading connections" />;
  if (!connections?.length) {
    return <Empty title="No connections yet" hint="Run discovery on a dataset to generate candidates." />;
  }

  return (
    <div style={{ marginTop: 18 }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: "34%" }}>Relationship</th>
            <th>Method</th>
            <th style={{ textAlign: "right" }}>Estimate</th>
            <th style={{ textAlign: "right" }}>q-value</th>
            <th style={{ textAlign: "right" }}>n</th>
            <th>Evidence</th><th>State</th>
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => (
            <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => onSelect(c.id)}>
              <td style={{ fontWeight: 530 }}>
                {c.left_variable} <span style={{ color: "var(--ink-faint)" }}>×</span> {c.right_variable}
              </td>
              <td className="mono">{c.method.replace(/_/g, " ")}</td>
              <td className="numeric" style={{ textAlign: "right" }}><Num value={c.estimate} /></td>
              <td className="numeric" style={{ textAlign: "right" }}><Num value={c.q_value} digits={3} /></td>
              <td className="numeric" style={{ textAlign: "right" }}>{c.sample_size ?? "—"}</td>
              <td style={{ color: "var(--ink-soft)" }}>{c.evidence_quality}</td>
              <td><Status value={c.lifecycle_status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        q-values are Benjamini-Hochberg corrected across every test in the discovery run.
        An uncorrected p-value would call roughly one in twenty of these significant by chance.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Findings (§13) and the evidence graph (§62)
// ---------------------------------------------------------------------------


/**
 * Make a non-button element behave like one, for a keyboard as well as a mouse.
 *
 * `cursor: pointer` and an `onClick` make something clickable and nothing more:
 * there is no tab stop, no Enter or Space handling, and a screen reader
 * announces a div. Measuring the click depth from a finding back to its rows is
 * what surfaced this — the one click that mattered on that path was reachable
 * only with a mouse, which makes the depth not five but unreachable.
 *
 * Deliberately not applied to the clickable table rows in this file. A row is
 * not a button, and `role="button"` on a `<tr>` trades one broken semantic for
 * another; those need a real control inside the row instead, which is a change
 * to the table markup rather than a prop spread.
 */
function activatable(onActivate: () => void) {
  return {
    role: "button",
    tabIndex: 0,
    style: { cursor: "pointer" },
    onClick: onActivate,
    onKeyDown: (event: React.KeyboardEvent) => {
      // Space scrolls the page by default, so it has to be prevented — the
      // omission is why "it works with Enter" is usually where this stops.
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate();
      }
    },
  };
}

export function Findings({ projectId, onSelect }: {
  projectId: string; onSelect: (id: string) => void;
}) {
  const { data, error, reload } = useApi<DiscoveryMap>(`/api/projects/${projectId}/discovery-map`);
  const findings = useApi<Finding[]>(`/api/projects/${projectId}/findings`);

  if (error) return <Failure error={error} retry={reload} />;
  return (
    <>
      <h1>Findings</h1>
      <p className="lede">
        A finding must link to supporting and contradicting evidence before it can be
        promoted past candidate.
      </p>
      {findings.loading && <Loading rows={3} label="Reading findings" />}
      {findings.error && <Failure error={findings.error} retry={findings.reload} />}
      {findings.data?.length === 0 && (
        <Empty title="No findings recorded" hint="Validate a connection, then record what it shows as a finding." />
      )}
      {findings.data?.map((finding) => (
        <div className="card" key={finding.id} {...activatable(() => onSelect(finding.id))}>
          <div className="row">
            <div style={{ fontWeight: 560 }}>{finding.title}</div>
            <Status value={finding.lifecycle_status} />
          </div>
          {finding.statement && <p style={{ margin: "6px 0 0" }}>{finding.statement}</p>}
          <div className="mono" style={{ color: "var(--ink-faint)", marginTop: 6 }}>
            {finding.finding_type} · causal status: {finding.causal_status.replace(/_/g, " ")}
          </div>
        </div>
      ))}
      {data && <LifecycleBreakdown title="Findings" counts={data.findings} />}
    </>
  );
}

export function EvidenceGraphView({ findingId, onOpenAnalysis }: {
  findingId: string;
  /**
   * Open the analysis a finding rests on.
   *
   * Without this the finding was a dead end. Measuring the provenance depth
   * found that its detail screen offered exactly one action — previewing a
   * library note — and no route to the computation, the dataset or the paper.
   * The chain was in the database; nothing on screen walked it.
   *
   * Optional so the panel still renders in contexts with nowhere to navigate
   * to, where a button that did nothing would be worse than a plain row.
   */
  onOpenAnalysis?: (runId: string) => void;
}) {
  const { data, error, loading, reload } = useApi<EvidenceGraph>(
    `/api/findings/${findingId}/evidence-graph`,
  );
  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) return <Loading rows={5} label="Assembling the evidence" />;

  return (
    <>
      <h1>{data.finding.title}</h1>
      <div className="row" style={{ marginBottom: 14 }}>
        <Status value={data.finding.lifecycle_status} />
        <span className="mono" style={{ color: "var(--ink-faint)" }}>
          {data.balance.supporting} supporting · {data.balance.contradicting} contradicting
        </span>
      </div>

      {data.note && <p className="note">{data.note}</p>}

      <h2>Claims and their evidence</h2>
      {data.claims.length === 0 && <Empty title="No claims attached" />}
      {data.claims.map((claim) => (
        <div className="card" key={claim.id}>
          <div className="mono" style={{ color: "var(--ink-faint)", marginBottom: 4 }}>
            {claim.claim_type.replace(/_/g, " ")}
          </div>
          <div style={{ fontWeight: 540, marginBottom: 8 }}>{claim.statement}</div>
          {claim.supporting.map((e, i) => (
            <div key={i} className="mono" style={{ color: "var(--validated)" }}>
              ↑ supports · {e.evidence_type} {e.source_document ? `· ${e.source_document}` : ""}
            </div>
          ))}
          {claim.contradicting.map((e, i) => (
            <div key={i} className="mono" style={{ color: "var(--conflicted)" }}>
              ↓ contradicts · {e.evidence_type} {e.source_document ? `· ${e.source_document}` : ""}
            </div>
          ))}
        </div>
      ))}

      {data.analyses.length > 0 && (
        <>
          <h2>Computations behind it</h2>
          {data.analyses.map((a) => (
            <div className="card card-tight" key={a.id}>
              <div className="row">
                {/*
                  The step that makes the chain walkable. From here the analysis
                  names its dataset, which names its source — so "why do we
                  believe this?" is answerable by clicking rather than by
                  knowing where to look.
                */}
                {onOpenAnalysis ? (
                  <button type="button"
                          onClick={() => onOpenAnalysis(a.id)}
                          style={{ border: "none", background: "none", padding: 0,
                                   font: "inherit", color: "var(--accent)",
                                   cursor: "pointer", textAlign: "left" }}>
                    <span className="mono">{a.method}</span>
                  </button>
                ) : <span className="mono">{a.method}</span>}
                <span className="mono" style={{ color: "var(--ink-faint)" }}>{a.id}</span>
              </div>
              {a.result?.interpretation ? (
                <div style={{ marginTop: 5, color: "var(--ink-soft)" }}>{a.result.interpretation}</div>
              ) : null}
            </div>
          ))}
        </>
      )}

      {data.challenges.length > 0 && (
        <>
          <h2>Challenges</h2>
          {data.challenges.map((c) => (
            <div className="card card-tight" key={c.id}>
              <Status value={c.verdict === "holds" ? "validated" : "conflicted"} />
              <div style={{ marginTop: 5 }}>{c.summary}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Analyses (§44, §47)
// ---------------------------------------------------------------------------

export function AnalysisDetail({ runId }: { runId: string }) {
  const { data, error, loading, reload } = useApi<AnalysisRun>(`/api/analyses/${runId}`);
  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) return <Loading rows={5} label="Reading the analysis" />;

  // A completed run always carries a result; the guard above proves it.
  const r = data.result;
  return (
    <>
      <h1>{data.method.replace(/_/g, " ")}</h1>
      {data.research_question && <p className="lede serif">{data.research_question}</p>}
      {data.status !== "completed" && (
        <div className="error">{data.error ?? `This run is ${data.status}.`}</div>
      )}

      {data.status === "completed" && r && (
        <>
          {/* §47 — four separate judgements, shown separately. */}
          <div className="grid-2" style={{ marginBottom: 14 }}>
            <Stat label={r.estimate_name ?? "estimate"} value={r.estimate?.toFixed(4) ?? "—"} />
            <Stat label="p-value" value={r.p_value != null ? r.p_value.toExponential(2) : "—"} />
            <Stat label="sample size" value={r.sample_size ?? "—"} />
            <Stat label="evidence quality" value={r.evidence_quality} />
          </div>

          <div className="card">
            <h2>Interpretation</h2>
            <p style={{ color: "var(--ink)" }}>{r.interpretation}</p>
            <div className="kv" style={{ marginTop: 10 }}>
              <dt>Statistically significant</dt><dd>{String(r.statistically_significant)}</dd>
              <dt>Practical significance</dt><dd>{r.practical_significance}</dd>
              <dt>Method chosen because</dt><dd>{data.method_rationale || "—"}</dd>
            </div>
            {r.limitations.length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "var(--ink-soft)" }}>
                {r.limitations.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            )}
          </div>

          <div className="card">
            <h2>Assumption checks</h2>
            <table>
              <thead><tr><th>Check</th><th>Outcome</th><th>Detail</th></tr></thead>
              <tbody>
                {data.assumption_checks.map((c) => (
                  <tr key={c.name}>
                    <td className="mono">{c.name}</td>
                    <td><Status value={c.outcome} /></td>
                    <td style={{ color: "var(--ink-soft)" }}>{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* §44 — everything needed to reproduce the number. */}
          <div className="card">
            <h2>Reproducibility</h2>
            <div className="kv">
              <dt>Random seed</dt><dd>{data.random_seed}</dd>
              <dt>Duration</dt><dd>{data.duration_ms} ms</dd>
              <dt>Dependencies</dt>
              <dd className="mono">
                {Object.entries(data.dependency_versions).map(([k, v]) => `${k} ${v}`).join(" · ")}
              </dd>
              <dt>Dataset hash</dt><dd className="mono">{data.input_hashes.dataset_content_hash?.slice(0, 16)}…</dd>
              <dt>Spec hash</dt><dd className="mono">{data.input_hashes.spec_content_hash?.slice(0, 16)}…</dd>
              <dt>Isolation</dt>
              <dd className="mono">
                {data.sandbox_policy.enforced?.separate_process ? "separate process" : "—"};
                network {data.sandbox_policy.best_effort?.network_egress_disabled ?? "—"}
              </dd>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Validation (§51)
// ---------------------------------------------------------------------------

export function ConnectionDetail({ connectionId, projectId, onRecordFinding }: {
  connectionId: string;
  projectId: string;
  /** Open the finding once it is recorded, so the researcher lands on it. */
  onRecordFinding?: (findingId: string) => void;
}) {
  const connections = useApi<Connection[]>(`/api/projects/${projectId}/connections?limit=200`);
  const connection = connections.data?.find((c) => c.id === connectionId);
  const reports = useApi<ValidationReport[]>(`/api/connections/${connectionId}/validations`);
  // Approved display names, so no raw column name reaches the card.
  const variables = useApi<{ labels: Record<string, string> }>(
    `/api/projects/${projectId}/variables`);
  // The stored reading. GET never generates — a card that fired a model call on
  // render would make every list of results cost inferences to look at.
  const summary = useApi<PlainSummary>(
    connection?.analysis_run_id
      ? `/api/analyses/${connection.analysis_run_id}/plain-summary` : null);

  const [chosen, setChosen] = useState<string[]>([]);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // The profiled schema, so confounders are picked rather than typed.
  const columns = useApi<DatasetColumn[]>(
    connection?.dataset_version_id
      ? `/api/dataset-versions/${connection.dataset_version_id}/columns`
      : null,
  );

  async function validate() {
    setValidating(true); setError(null);
    try {
      await api.post(`/api/connections/${connectionId}/validate`, { confounders: chosen });
      // The suite runs several sandboxed analyses. Poll for the report rather
      // than for the lifecycle state: a connection that fails validation keeps
      // its state, and watching the state would hang until the timeout.
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const latest = await api.get<ValidationReport[]>(`/api/connections/${connectionId}/validations`);
        if (latest.some((r) => r.status !== "running")) break;
      }
      connections.reload();
      reports.reload();
    } catch (err) {
      setError(err);
    } finally {
      setValidating(false);
    }
  }

  if (connections.loading && !connection) return <Loading rows={4} label="Reading the connection" />;
  if (!connection) return <Empty title="Connection not found" />;

  // Adjusting a variable for itself is not a confounder test; it is a mistake
  // the interface should make impossible rather than report afterwards.
  const candidates = (columns.data ?? []).filter(
    (c) => c.name !== connection.left_variable && c.name !== connection.right_variable,
  );

  function toggle(name: string) {
    setChosen((current) =>
      current.includes(name) ? current.filter((n) => n !== name) : [...current, name]);
  }

  const labels = variables.data?.labels ?? {};
  const left = labels[connection.left_variable] ?? connection.left_variable;
  const right = labels[connection.right_variable] ?? connection.right_variable;

  return (
    <>
      {/* Canonical names, never raw columns (Part C). */}
      <h1>{left} and {right}</h1>

      {/* The result card carries the sentence, the labelled numbers and the
          permanent provenance strip. It replaced four bare stat tiles, which
          made a reader decode `q = 5.17e-66` before learning what was found. */}
      <ResultCard
        connection={connection}
        labels={labels}
        summary={summary.data ?? null}
        sourceCount={{ sources: 0, datasets: connection.dataset_version_id ? 1 : 0 }}
      />

      <EvidenceGrade
        runId={connection.analysis_run_id}
        quality={connection.evidence_quality}
      />

      <div className="card">
        <h2>Try to destroy it</h2>
        <p>
          Bootstrap stability, sensitivity to outliers, missingness, and adjustment for
          confounders. Naming no confounders is recorded as <b>not tested</b> — not as clean.
        </p>

        <h3 className="eyebrow" style={{ marginTop: 16 }}>
          Adjust for {chosen.length > 0 && <span className="mono">· {chosen.length} selected</span>}
        </h3>

        {columns.loading && <Loading rows={2} label="Reading the dataset schema" />}
        {columns.error ? <Failure error={columns.error} retry={columns.reload} /> : null}

        {!connection.dataset_version_id && (
          <p className="note">
            This connection is not linked to a discovery run, so its dataset schema
            cannot be resolved. Validation can still run without adjustment.
          </p>
        )}

        {candidates.length > 0 && (
          <div className="picker">
            {candidates.map((column) => (
              <label className="pick" key={column.name} data-on={chosen.includes(column.name)}>
                <input
                  type="checkbox"
                  checked={chosen.includes(column.name)}
                  onChange={() => toggle(column.name)}
                />
                <span className="pick-name">
                  {(variables.data?.labels ?? {})[column.name] ?? column.name}
                </span>
                {/* The profile is shown because it is what makes a column a
                    plausible confounder — type, spread, and how much is missing. */}
                <span className="pick-meta">
                  {column.semantic_type || column.physical_type}
                  {column.unit ? ` · ${column.unit}` : ""}
                  {column.missing_count > 0 ? ` · ${column.missing_count} missing` : ""}
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <span className="note" style={{ margin: 0 }}>
            {chosen.length === 0
              ? "No adjustment — the report will say so."
              : `Adjusting for ${chosen.join(", ")}.`}
          </span>
          <button className="btn btn-primary" onClick={validate} disabled={validating}>
            {validating ? "Running checks…" : "Validate"}
          </button>
        </div>

        {error ? <div style={{ marginTop: 10 }}><Failure error={error} /></div> : null}
        {validating && (
          <div style={{ marginTop: 12 }}>
            <Loading rows={2} label="Running robustness checks in the sandbox" />
          </div>
        )}
      </div>

      <ValidationReports reports={reports} />

      {/*
        The last step of the §137 workflow, and the one that was missing. After
        validation the overview said "Record a finding — NEXT" while the
        interface offered no way to record one: the capability existed in the
        API and was exercised by the suite, and no `api.post` to `/findings`
        existed anywhere in this app. It belongs here rather than on the
        Findings list because a finding is recorded *from* a result, and the
        connection travels with it — which is what makes it checkable later.
      */}
      <RecordFinding
        projectId={projectId}
        connectionId={connectionId}
        defaultTitle={`${left} tracks ${right}`}
        validated={(reports.data ?? []).some((r) => r.status === "complete")}
        onRecorded={onRecordFinding}
      />
    </>
  );
}

/**
 * Why the evidence grade is what it is (§47).
 *
 * This is the screen's most confusing moment and its most important one. An
 * association can read r = 0.90 at q = 5e-66 and still be graded *weak*, because
 * §47 grades evidence from the assumptions the method needed — not from the
 * p-value. Shown as a bare word next to a huge correlation, that looks like a
 * bug; a researcher's first instinct is to distrust the tool rather than the
 * result. So the grade is never shown without the checks that produced it.
 */
function EvidenceGrade({ runId, quality }: { runId: string | null; quality: string }) {
  const { data, error, loading } = useApi<AnalysisRun>(runId ? `/api/analyses/${runId}` : null);

  if (!runId) return null;
  if (loading) return <Loading rows={2} label="Reading the assumption checks" />;
  if (error || !data) return null;

  const violated = data.assumption_checks.filter((c) => c.outcome === "violated");
  if (violated.length === 0) return null;

  return (
    <div className="card card-tight">
      <h3 className="eyebrow">Why the evidence is graded {quality}</h3>
      <p style={{ margin: "6px 0 8px", color: "var(--ink-soft)", fontSize: 12.5 }}>
        The grade comes from the assumptions the method required, not from the
        q-value. A very small q-value with violated assumptions is still weak
        evidence — which are four separate judgements and are kept separate here.
      </p>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 5 }}>
        {violated.map((check) => (
          <li key={check.name} style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
            <Status value={check.outcome} />
            <span className="mono" style={{ fontSize: 11.5 }}>{check.name}</span>
            <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>{check.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The §51 report, which until now the interface ran but never showed.
 *
 * A lifecycle state that changes with no visible reasoning is an unaccountable
 * verdict. Each check cites the analysis run that produced it, so the claim
 * "this survived outlier exclusion" is itself traceable (LAW 1).
 */
function ValidationReports({ reports }: {
  reports: { data: ValidationReport[] | null; error: unknown; loading: boolean; reload: () => void };
}) {
  if (reports.error) return <Failure error={reports.error} retry={reports.reload} />;
  if (reports.loading && !reports.data) return <Loading rows={3} label="Reading validation reports" />;
  if (!reports.data?.length) {
    return (
      <Empty
        title="Not validated yet"
        hint="Nothing has tried to break this connection. Until something does, it stays a candidate."
      />
    );
  }

  return (
    <>
      {reports.data.map((report) => (
        <div className="card" key={report.id}>
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Validation report</h2>
            <Status value={report.passed === null ? report.status : report.passed ? "passed" : "violated"} />
          </div>
          {report.summary && <p style={{ color: "var(--ink)" }}>{report.summary}</p>}

          {report.check_details.length > 0 && (
            <table>
              <thead>
                <tr><th style={{ width: "22%" }}>Check</th><th style={{ width: "14%" }}>Outcome</th><th>Detail</th><th style={{ width: "18%" }}>Computed by</th></tr>
              </thead>
              <tbody>
                {report.check_details.map((check) => (
                  <tr key={check.name}>
                    <td className="mono">{check.name.replace(/_/g, " ")}</td>
                    <td><Status value={check.outcome} /></td>
                    <td style={{ color: "var(--ink-soft)" }}>{check.detail}</td>
                    <td className="mono" style={{ color: "var(--ink-faint)" }}>
                      {check.analysis_run_id ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">
            A check recorded as <b>not tested</b> is not a pass. It means nothing was
            supplied for it to test.
          </p>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Provenance inspector (§93)
// ---------------------------------------------------------------------------

export function ProvenanceChain({ objectId }: { objectId: string }) {
  const { data, error, loading } = useApi<Provenance>(`/api/objects/${objectId}/provenance`);
  if (error) return <Failure error={error} />;
  if (loading || !data) return <Loading rows={3} />;

  return (
    <div>
      <h3 className="eyebrow">How was this made?</h3>
      <ul className="chain">
        <li style={{ color: "var(--ink)", fontWeight: 540 }}>
          {data.artifact.object_type} · {data.artifact.title}
        </li>
        {data.ancestors.map((a) => (
          <li key={a.artifact_id}>
            <span className="mono" style={{ color: "var(--ink-faint)" }}>depth {a.depth}</span>{" "}
            {a.object_type} · {a.title}
          </li>
        ))}
      </ul>
      {data.ancestors.length === 0 && (
        <p className="note">This is a source artifact — nothing was derived to make it.</p>
      )}
    </div>
  );
}
