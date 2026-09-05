"use client";

/**
 * The workspace views.
 *
 * These are presentation only: every number shown comes from the API, and
 * nothing is computed in the browser. §106 forbids shipping rows to React, and
 * more importantly a figure or a statistic recomputed here could disagree with
 * the analysis that produced it.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import {
  AnalysisRun, Connection, DatasetColumn, DiscoveryMap, EvidenceGraph, Finding,
  objectTypeName,
  INGESTION_STAGES, Provenance, SearchResult, Source, ValidationReport, api,
  ingestionStep, isIngesting,
} from "@/lib/api";
import { columnNotices } from "@/lib/column-notices";
import { ApiState, useApi } from "@/lib/useApi";
import { SECTIONS, Section } from "./Shell";
import { PlainSummary, ResultCard } from "./ResultCard";
import { Empty, Failure, Loading, Meter, Num, Stat, Status } from "./primitives";
import { Fragility } from "./fragility";
import { DatabaseTables } from "./databasetables";
import { CohortTree } from "./cohorts";
import { RecordFinding } from "./recordfinding";
import { Approvals } from "./approvals";
import { WhatTheSweepDid } from "./sweep";
import { currentStep, loopSteps, stepTarget } from "@/lib/loop";
import { ObjectAction, ObjectActions } from "./objectactions";
import { canDraftReport, draftReport } from "./reports";

// ---------------------------------------------------------------------------
// Overview (§70)
// ---------------------------------------------------------------------------

export function Overview({ project, map, onGo, onOpen, onAddSources, labels }: {
  project: { name: string; research_question: string };
  map: DiscoveryMap | null;
  onGo: (section: Section) => void;
  /**
   * Open one object rather than the list it lives in.
   *
   * Steps 4 and 5 both act on a single connection, and the server already
   * ranks them. Without this the researcher is sent to a six-row table with
   * nothing saying which row the recommendation meant. Optional, and the
   * control falls back to the section when it is absent, so the button is
   * never dead — it just lands one screen short.
   */
  onOpen?: (kind: "connection", id: string) => void;
  /**
   * The Sources screen's own upload, so the first act of a new project can be
   * taken from the screen that asks for it rather than after a rail hop.
   */
  onAddSources?: (files: FileList | null) => void;
  /** Approved display names by raw column, so the control names a connection
   *  the way the strip above it does (Part C: no raw names outside Variables). */
  labels?: Record<string, string>;
}) {
  if (!map) return <Loading rows={4} label="Reading the project" />;

  /*
   * The research loop as a checklist against real state (§70).
   *
   * A dashboard of six zeroes tells a new researcher nothing about what to do.
   * Each step here is ticked from the project's actual counts, so the list is
   * both an explanation of the method and the place you start the next step —
   * and it can never claim progress the database does not have. The steps
   * themselves live in `lib/loop.ts`, so the shell and the inspector read the
   * same list and cannot disagree with this card about what comes next.
   */
  const steps = loopSteps(map);
  /*
   * The step the project is on, which is the server's recommendation when it
   * names one and the earliest gap otherwise — not `the first unticked row`.
   * The two differ, and the difference is visible: a finding may legitimately
   * be recorded from a connection nothing has validated yet, so step 5 ticks
   * above an unticked step 4 and a numbered checklist ends up contradicting
   * its own order. Marking the row the *project* is on keeps the numbers
   * describing the method rather than a sequence the work did not follow.
   */
  const current = currentStep(map);
  /*
   * A project with no sources cannot take its first step from here unless the
   * file picker is here. Sources still owns uploading; this is the same
   * handler, offered at the moment the list first says to use it.
   */
  const empty = (map.counts.sources ?? 0) === 0;
  // The meters below want totals across lifecycle states.
  const connections = Object.values(map.connections).reduce((a, b) => a + b, 0);
  const findings = Object.values(map.findings).reduce((a, b) => a + b, 0);

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
        <Meter label="Sources" one="Source" value={map.counts.sources} />
        <Meter label="Datasets" one="Dataset" value={map.counts.datasets} />
        <Meter label="Analyses" one="Analysis" value={map.counts.analyses} />
        <Meter label="Connections" one="Connection" value={connections} />
        <Meter label="Findings" one="Finding" value={findings} />
        <Meter label="Contradictions" one="Contradiction" value={map.counts.contradictions} />
      </div>

      <div className="card">
        <h2>The loop</h2>
        <ol className="steps">
          {steps.map((step) => {
            /*
             * By id, not by identity. `currentStep` derives its own list from
             * the map, so the step it returns is a different object from the
             * one in this list — comparing the two by reference marks nothing
             * as current and quietly returns the card to a state where no row
             * is next and no control is offered.
             */
            const here = step.id === current?.id;
            const target = stepTarget(step, map, labels);
            return (
              <li key={step.id} data-done={step.done} data-next={here}>
                <button onClick={() => onGo(step.go)}>
                  <span className="step-tick" aria-hidden />
                  <span>
                    <b>{step.label}</b>
                    <em>{step.hint}</em>
                  </span>
                  {/*
                    Where the row goes, said before it is pressed. Every row
                    here is a button and none of them looked like one, so the
                    only way to learn where a step led was to take it and read
                    the rail afterwards. The name comes from the rail's own
                    list, so a screen that is renamed is renamed here too.
                  */}
                  <span className="step-go">→ {sectionLabel(step.go)}</span>
                  {/* Never colour alone (§118): the state is also a word. */}
                  <span className="step-state">
                    {step.done ? "done" : here ? "next" : "waiting"}
                  </span>
                </button>

                {/*
                  The one real control on the card, and a sibling of the row
                  rather than a child of it: a button inside a button is not
                  valid HTML, and the two would fight over the same press.
                */}
                {here && (
                  <span className="step-action">
                    {empty && onAddSources ? (
                      <label className="btn btn-primary" style={{ display: "inline-block" }}>
                        Add sources
                        <input
                          type="file" multiple hidden
                          accept=".pdf,.docx,.txt,.md,.csv,.tsv,.xlsx,.json"
                          onChange={(e) => onAddSources(e.target.files)}
                        />
                      </label>
                    ) : (
                      <button
                        className="btn btn-primary"
                        onClick={() => (target.item && onOpen
                          ? onOpen("connection", target.item)
                          : onGo(target.section))}
                      >
                        {target.label} →
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {/*
          A numbered list reads as an order, and this one is not one. Said
          plainly, because the alternative is a first-timer concluding the
          numbers are decoration the first time step 5 ticks above step 4.
        */}
        <p className="note steps-note">
          The steps may be taken out of order — this is where the project is now.
        </p>
        {/* §70 — the server's own recommendation, which knows things the
            checklist does not, such as which connection ranks highest. */}
        <p className="note" style={{ marginBottom: 0 }}>{map.recommended_next_action}</p>
      </div>

      <LifecycleBreakdown title="Connections" counts={map.connections} />
      <LifecycleBreakdown title="Findings" counts={map.findings} />
    </>
  );
}

/**
 * What the rail calls a section.
 *
 * Read from `SECTIONS` rather than written out here, so a step's destination
 * cannot come to name a screen the rail no longer has — the failure being
 * avoided is a row promising "→ Findings" long after the entry was renamed,
 * which is unfalsifiable by eye and looks right in review.
 */
function sectionLabel(section: Section): string {
  return SECTIONS.find((entry) => entry.id === section)?.label ?? section;
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
                  <button type="button" className="pick"
                          style={{ fontWeight: 540, wordBreak: "break-word" }}
                          onClick={() => onSelect(source.id)}>
                    {source.title}
                  </button>
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

      {/*
        Text in this document addressed to an AI system.
        
        Shown near the top, because it changes how a reader should treat the
        whole source, and stated as a fact about the paper rather than as an
        alarm about the platform: nothing was blocked, nothing was edited, and
        the content was already fenced before any model saw it. The phrases are
        quoted so the researcher can judge them — a hidden instruction in a
        preprint is often the most interesting thing about it.
      */}
      {(data.metadata?.injection_signals?.length ?? 0) > 0 && (
        <section className="talkstomachine">
          <h2>This document contains text addressed to an AI system</h2>
          <p className="lede">
            Found while reading it. Nothing was blocked or removed, and no model
            has acted on it — retrieved content is fenced as data before it
            reaches one. It is shown because it is a fact about this source.
          </p>
          <ul>
            {data.metadata!.injection_signals!.map((phrase) => (
              <li key={phrase}><q>{phrase}</q></li>
            ))}
          </ul>
          <p className="note">
            Text like this in a paper is usually aimed at automated review or
            summarisation. Worth knowing before citing it.
          </p>
        </section>
      )}

      {/*
        A database that could not be ingested as one dataset is the case this
        answers: the message above says which tables it holds, and this is how
        one of them is chosen. It renders nothing for a source that is not a
        database, so it costs an ordinary failed ingestion nothing.
      */}
      {data.ingestion_status === "failed" && (
        <DatabaseTables projectId={projectId} sourceId={sourceId} />
      )}

      {data.paper && (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <Stat label="pages" one="page" value={data.paper.page_count} />
          <Stat label="passages indexed" one="passage indexed" value={data.passage_count ?? 0} />
        </div>
      )}

      {data.dataset && (
        <>
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <Stat label="rows" one="row" value={data.dataset.row_count} />
            <Stat label="columns" one="column" value={data.dataset.column_count} />
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

            {/*
              The subsetting decisions behind any number computed from this
              dataset. Above the schema because the chain determines which rows
              every column statistic below is about — a reader who meets the
              profile first has already been told a number without being told
              what it counted.
            */}
            <CohortTree projectId={projectId}
                        datasetVersionId={data.dataset.dataset_version_id} />

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
                  {columns.data.map((column) => {
                    /* What the profiler noticed, which it has always recorded
                       and never shown. A -999 standing for "missing" is in
                       every average until somebody is told about it. */
                    const notices = columnNotices(
                      column.statistics, column.physical_type);
                    return (
                    <Fragment key={column.name}>
                    <tr>
                      <td className="mono" style={{ color: "var(--ink)" }}>{column.name}</td>
                      <td style={{ color: "var(--ink-soft)" }}>
                        {column.semantic_type || column.physical_type}
                        {column.unit ? ` · ${column.unit}` : ""}
                      </td>
                      <td className="numeric" style={{ textAlign: "right" }}>{column.missing_count}</td>
                      <td className="numeric" style={{ textAlign: "right" }}>{column.unique_count}</td>
                      <td style={{ color: "var(--ink-soft)" }}>{column.sensitivity}</td>
                    </tr>
                    {notices.map((notice, index) => (
                      <tr key={`${column.name}-notice-${index}`}>
                        <td colSpan={5} style={{ paddingTop: 0 }}>
                          <p
                            className="note"
                            style={{
                              margin: 0, fontSize: 12,
                              color: notice.level === "warn"
                                ? "var(--caution)" : "var(--ink-faint)",
                            }}
                          >
                            {notice.text}
                          </p>
                        </td>
                      </tr>
                    ))}
                    </Fragment>
                    );
                  })}
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

export function Search({ projectId, onOpenSource }: {
  projectId: string;
  /**
   * Open the source a passage came from. Without this a hit was a dead end:
   * rank, locator and scores, and no way to the document (D203). A search
   * that cannot be followed back to its passage is a citation nobody can
   * check.
   */
  onOpenSource?: (sourceId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const path = submitted ? `/api/projects/${projectId}/search?q=${encodeURIComponent(submitted)}&limit=12` : null;
  const { data, error, loading, reload } = useApi<SearchResult>(path);

  return (
    <>
      <h1>Search sources</h1>
      <p className="lede">
        Searches the sources already in this project — keyword and meaning
        together. Every search is recorded, so an answer built on one can be
        traced back to the passages it came from. To bring in something the
        project does not have yet, use Find papers or Find data.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim() || null); }}
        style={{ display: "flex", gap: 8, marginBottom: 16 }}
      >
        <input
          type="text" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. how many people took part in the trial"
          aria-label="Search the sources in this project"
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
              {/* A real control rather than a clickable card: the card holds
                  a paragraph of the passage, and a paragraph that is also a
                  button is a trap for the keyboard and the screen reader. */}
              {onOpenSource && (
                <button type="button" className="pick" style={{ marginTop: 8 }}
                        onClick={() => onOpenSource(hit.source_id)}>
                  Open the source →
                </button>
              )}
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
  /*
   * Whether to stop the sweep before it writes anything into the project.
   *
   * Rule 10 — "AI does not secretly mutate important research state." The
   * tests run either way; what waits is the half that records connections and
   * promotes the survivors, so the results can be read before they become part
   * of the project's record rather than after.
   *
   * Off by default, and that is a decision rather than an oversight: a sweep
   * that stops on a fresh install leaves a new researcher looking at an empty
   * table wondering what went wrong.
   */
  const [hold, setHold] = useState(false);
  const [approvals, setApprovals] = useState(0);
  /** The sweep just run, so it can account for itself. */
  const [sweep, setSweep] = useState<string | null>(null);

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
      const started = await api.post<{ reused: boolean; note?: string;
                                       discovery_run_id: string }>(
        `/api/projects/${projectId}/discoveries`,
        // The session travels with the request so the sweep joins the family
        // of everything else looked at in this sitting. Null in a private
        // window, where storage is refused — the run is then its own family,
        // which is what happened before any of this existed.
        // No family is sent. The server resolves the project's open line of
        // enquiry, which is the same answer this used to compute from a UUID in
        // `sessionStorage` — except that it survives the tab and the researcher
        // can see what it is.
        { dataset_version_id: versionId, force,
          hold_before_recording: hold },
      );
      // §123 — if the server declined to start a second run, say so. A button
      // that appears to work and quietly does nothing is worse than an error.
      if (started.reused) {
        setReused(started.note ?? "A run already exists for this dataset version.");
        setSweep(started.discovery_run_id);
        connections.reload();
        return;
      }
      /*
       * Kept, where it used to be discarded.
       *
       * The run records what the sweep actually did — how many pairs it
       * considered, how many it dropped and why, how many it tested — and none
       * of that was reachable without the id. It is the denominator: a q-value
       * means nothing without the number of tests it was corrected across.
       */
      setSweep(started.discovery_run_id);
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        connections.reload();
        // A held run records nothing, so the connections table stays empty on
        // purpose. Without this the sweep would look like one that found
        // nothing, and the thing actually waiting would be off screen.
        if (hold) setApprovals((n) => n + 1);
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

      <Approvals
        key={approvals}
        projectId={projectId}
        onReleased={() => connections.reload()}
      />

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

      {datasets.length > 0 && (
        <label className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={hold}
            onChange={(event) => setHold(event.target.checked)}
          />
          <span>
            Show me the results before anything is recorded. The tests still
            run; nothing enters the project until you release it.
          </span>
        </label>
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

      {sweep && <WhatTheSweepDid runId={sweep} />}

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
          {/*
            Eight cells per row, so eight headers. This row declared seven —
            the dataset cell had no heading — and every value from the method
            rightward sat one column left of its label: the correlation
            coefficient under "q-value", the q-value under "n", the state past
            the last header. On the one screen whose stated purpose is the
            corrected q-value, the uncorrected effect size was shown in its
            place (D209). The test now counts cells against headers.
          */}
          <tr>
            <th style={{ width: "30%" }}>Relationship</th>
            <th>Dataset</th>
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
                <button type="button" className="pick"
                        onClick={() => onSelect(c.id)}>
                  {c.left_variable} <span style={{ color: "var(--ink-faint)" }}>×</span> {c.right_variable}
                </button>
              </td>
              <td style={{ color: "var(--ink-soft)" }}>
                {c.dataset_name ?? "—"}
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
        {/* "and contradicting" overstated the rule and disagreed with the
            server, which says "supporting or contradicting" when it refuses:
            `transition` requires the evidence total to be more than zero, not
            evidence in both directions. A researcher reading the stricter
            version would go looking for a contradiction to manufacture. */}
        A finding must link to evidence — supporting, contradicting, or both —
        before it can be promoted past candidate.
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
      {data.claims.length === 0 && <Empty
          title="No claims attached"
          hint="A finding recorded from a connection carries the analysis
                behind it as its evidence. This one was written by hand, so
                there is nothing yet for the balance above to weigh."
        />}
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

export function AnalysisDetail({ runId, onMethod }: {
  runId: string;
  /*
   * Reported upward rather than fetched twice. The panel below this one offers
   * a branch that swaps the method for its rank-based counterpart, and it needs
   * to know which method that is — a second hook on `/api/analyses/{id}` would
   * be a second copy of this run that can drift from the one on screen.
   */
  onMethod?: (method: string) => void;
}) {
  const { data, error, loading, reload } = useApi<AnalysisRun>(`/api/analyses/${runId}`);
  const method = data?.method;
  useEffect(() => { if (method) onMethod?.(method); }, [method, onMethod]);
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

/**
 * Whether the validation just requested has finished.
 *
 * This asked `latest.some((r) => r.status !== "running")` — is *any* report
 * not running — and the list holds every report a connection has ever had,
 * newest first. So the second time anybody validated a connection, the old
 * completed report satisfied it on the first poll: the wait ended after two
 * seconds, the spinner stopped, and the screen reloaded showing the *previous*
 * verdict while the new run was still going. A researcher re-checking a result
 * they had already validated would be shown the earlier answer as the current
 * one — and if the new run went the other way, they would never see it unless
 * they reloaded by hand.
 *
 * Three cases, all of them ordinary:
 *
 *  - a run is going, so a report is still `running` — keep waiting;
 *  - a report that was not there before has finished — that is the answer;
 *  - nothing new was queued at all, because the server deduplicates a repeat
 *    of the same request by idempotency key. Then no new report will ever
 *    appear, and waiting for one would spin until the timeout. Two polls with
 *    nothing running is enough to tell that apart from the brief window before
 *    the worker has written the row.
 */
export function settled(
  before: string[], latest: ValidationReport[], poll: number,
): boolean {
  if (latest.some((r) => r.status === "running")) return false;
  return latest.some((r) => !before.includes(r.id)) || poll >= 2;
}

/**
 * Take the reader to a block on this page, and take the keyboard with them.
 *
 * A "jump to" that only scrolls leaves a keyboard user exactly where they
 * were: the next Tab continues from the top of the document, past everything
 * the scroll just skipped. So focus moves too — onto the real control where
 * there is one, and onto the block itself otherwise, which is why the blocks
 * this points at carry `tabIndex={-1}`.
 *
 * `scrollIntoView` is checked rather than called: happy-dom and jsdom have no
 * layout engine, and a missing method here would take the whole screen down in
 * the test that is meant to be proving this works.
 */
function reveal(section: HTMLElement | null, control?: HTMLElement | null) {
  if (!section) return;
  if (typeof section.scrollIntoView === "function") {
    section.scrollIntoView({ block: "start" });
  }
  (control ?? section.querySelector<HTMLElement>("button") ?? section).focus();
}

export function ConnectionDetail({ connectionId, projectId, onRecordFinding,
                                  onDraftedReport }: {
  connectionId: string;
  projectId: string;
  /** Open the finding once it is recorded, so the researcher lands on it. */
  onRecordFinding?: (findingId: string) => void;
  /**
   * Open the report once it is drafted, for the same reason.
   *
   * Optional, and where it is absent the band says where the draft went
   * rather than offering a button that opens nothing.
   */
  onDraftedReport?: (artifactId: string) => void;
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
  /** Whether the derivation chain is open beneath the result. */
  const [tracing, setTracing] = useState(false);

  /*
   * The two blocks the actions band points at, and the control inside the
   * first of them. Held as refs rather than looked up by id at press time,
   * because the band must move focus to the control that is really there —
   * not to whatever happens to answer a selector after the page has changed
   * shape around a failed fetch.
   */
  const validateCard = useRef<HTMLDivElement | null>(null);
  const validateButton = useRef<HTMLButtonElement | null>(null);
  const recordCard = useRef<HTMLDivElement | null>(null);

  /** The report drafted from this connection, if one has been drafted here. */
  const [drafted, setDrafted] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<unknown>(null);

  /**
   * Draft a report from this connection.
   *
   * The same route the Reports screen posts to, with the same body: this is a
   * second door onto one capability, not a second implementation of it. The
   * eligibility rule is imported for the same reason.
   */
  // Named apart from the shared `draftReport` it calls: a local function of
  // the same name shadowed the import and called itself until the stack ran
  // out — found by the test that stubs the route.
  async function startDraft() {
    setDrafting(true);
    setDraftError(null);
    try {
      // The same routine the Reports screen uses, so a report drafted from
      // here has its citations checked exactly as one drafted from there.
      const created = await draftReport(projectId, connectionId);
      setDrafted(created.artifact_id);
      onDraftedReport?.(created.artifact_id);
    } catch (err) {
      setDraftError(err);
    } finally {
      setDrafting(false);
    }
  }

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
      //
      // Which reports existed *before* this request, because the list keeps
      // every one of them. Read from the server rather than from `reports.data`
      // so a stale render cannot make an old report look new.
      const before = (await api.get<ValidationReport[]>(
        `/api/connections/${connectionId}/validations`)).map((r) => r.id);
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const latest = await api.get<ValidationReport[]>(`/api/connections/${connectionId}/validations`);
        if (settled(before, latest, i)) break;
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
  if (!connection) return <Empty
      title="Connection not found"
      hint="It may have been deleted, or belong to another project."
    />;

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

  /*
   * §80's rule, asked rather than restated: a report starts from a result that
   * was computed. Where it cannot start, the control stays and says why —
   * removing it would leave a researcher unable to tell a capability that does
   * not exist from one they have failed to find.
   */
  const reportAction: ObjectAction = !canDraftReport(connection)
    ? {
        label: "Draft a report from this", kind: "note",
        note: "A report starts from a result that was computed. This connection"
          + " has no recorded analysis run, so there is nothing yet for a report"
          + " to reference.",
      }
    // Drafted here already: offered as the way back to it, never as a second
    // silent draft of the same result. Where nothing can open it, the band
    // says where it went instead of carrying a button that opens nothing.
    : drafted
      ? (onDraftedReport
          ? { label: "Drafted — open it", kind: "action",
              onSelect: () => onDraftedReport(drafted) }
          : { label: "Drafted", kind: "note",
              note: `it is on the Reports screen, as ${drafted}.` })
      : {
          label: drafting ? "Drafting…" : "Draft a report from this",
          kind: "action", busy: drafting, onSelect: () => void startDraft(),
        };

  /*
   * What can be done with this connection, listed where the reader arrives.
   *
   * The two ↓ entries move to the real controls further down rather than
   * repeating them — a second Validate button would be a second thing to keep
   * in step with the first, and the two would eventually disagree about what
   * had been selected.
   *
   * Validate leads. Fixed, not chosen from the connection's state: the band
   * would otherwise change rank as the work progressed, which turns one
   * control into two and is the §123 problem this band exists to remove. It is
   * also the honest order — a result nothing has tried to destroy is not one
   * to record first, and this screen is the easiest place in the product to
   * overclaim.
   */
  const actions: ObjectAction[] = [
    {
      label: "Validate ↓", kind: "scroll", primary: true,
      onSelect: () => reveal(validateCard.current, validateButton.current),
    },
    {
      label: "Record this as a finding ↓", kind: "scroll",
      onSelect: () => reveal(recordCard.current),
    },
    reportAction,
  ];

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
        /*
         * "Where did this come from", finally answerable.
         *
         * The card has always rendered a Trace control and no caller ever
         * supplied the handler, so the button could not appear — while
         * `ProvenanceChain`, which answers exactly that question, was written
         * and imported by nobody. Two halves of one feature, each complete,
         * never joined. Provenance is the claim this product rests on, so this
         * was the most valuable disconnected wire in the codebase.
         *
         * Offered only when there is an object to walk. A Trace button that
         * opened an empty chain would be worse than none: it would suggest the
         * lineage was checked and found empty.
         */
        onTrace={connection.analysis_object_id
          ? () => setTracing((open) => !open)
          : undefined}
      />

      {tracing && connection.analysis_object_id && (
        <div className="card">
          <ProvenanceChain objectId={connection.analysis_object_id} />
        </div>
      )}

      {/*
        Directly under the result, because this is the screen the Overview's
        loop sends a researcher to in order to take steps 4, 5 and 6, and on
        arrival two of the three were below the fold — recording a finding was
        the seventh block down.
      */}
      <ObjectActions items={actions} />
      {draftError ? <Failure error={draftError} /> : null}

      <EvidenceGrade
        runId={connection.analysis_run_id}
        quality={connection.evidence_quality}
      />

      {/* `tabIndex={-1}` so the band above can put the keyboard here even
          while the Validate control is still loading its schema. */}
      <div className="card" id="connection-validate" tabIndex={-1} ref={validateCard}>
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
          <button className="btn btn-primary" onClick={validate} disabled={validating}
                  ref={validateButton}>
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

      {/*
        Recording comes before the reading that supports it. This was the
        seventh block on the screen, roughly two screens below the fold, under
        both the fragility panel and the report history — so the act that
        *follows* a validation sat beneath two panels that are the reading
        around it rather than a gate before it. Nothing about the rule moved:
        the form still belongs to this result, and the connection still travels
        with it.
      */}
      {/*
        The last step of the §137 workflow, and the one that was missing. After
        validation the overview said "Record a finding — NEXT" while the
        interface offered no way to record one: the capability existed in the
        API and was exercised by the suite, and no `api.post` to `/findings`
        existed anywhere in this app. It belongs here rather than on the
        Findings list because a finding is recorded *from* a result, and the
        connection travels with it — which is what makes it checkable later.
      */}
      {/* Wrapped only so the band above has something to move the keyboard
          onto; the card itself is unchanged. */}
      <div id="connection-record" tabIndex={-1} ref={recordCard}>
        <RecordFinding
          projectId={projectId}
          connectionId={connectionId}
          defaultTitle={`${left} tracks ${right}`}
          /*
           * Whether a validation *passed*, not whether one finished.
           *
           * This read `status === "complete"`, which a report gets whichever way
           * it went: `validation.py` writes `status='complete'` for both
           * outcomes and records the verdict in `passed`, with a summary that
           * begins "Did not pass: " when it failed. So a connection whose
           * robustness checks *failed* was reported here as validated, and the
           * caveat below — "this connection has not survived a validation run
           * yet" — was suppressed for exactly the results that most need it.
           *
           * The same screen already prints "violated" for that report a few
           * lines down, so the two halves disagreed with each other, and the
           * half that disagreed in the flattering direction was the one sitting
           * next to the record button — which this file calls the single easiest
           * place in the product to overclaim.
           *
           * `=== true` because `passed` is null while a run is still going, and
           * a validation in flight has not survived anything yet.
           */
          validated={(reports.data ?? []).some((r) => r.passed === true)}
          onRecorded={onRecordFinding}
        />
      </div>

      {/*
        Above the validation reports, because it answers the question a reader
        arrives with. The reports say what was tried; this says what it would
        take for none of it to matter.
      */}
      <Fragility connectionId={connectionId} />
      <ValidationReports reports={reports} />
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
          {objectTypeName(data.artifact.object_type)} · {data.artifact.title}
        </li>
        {data.ancestors.map((a) => (
          <li key={a.artifact_id}>
            <span className="mono" style={{ color: "var(--ink-faint)" }}>depth {a.depth}</span>{" "}
            {objectTypeName(a.object_type)} · {a.title}
          </li>
        ))}
      </ul>
      {data.ancestors.length === 0 && <EmptyChain origin={data.origin} />}
    </div>
  );
}

/**
 * What an empty chain means — which is not one thing.
 *
 * This said "This is a source artifact — nothing was derived to make it" for
 * *any* empty ancestor list. An analysis whose lineage edges were never written
 * looks exactly the same from here, and that sentence reports the record as
 * complete rather than missing: it is a provenance claim the screen had no
 * basis for, in the flattering direction, on the one screen whose whole job is
 * not to flatter.
 *
 * The distinction comes from the server, which owns the list of object types
 * that enter a project from outside.
 */
export function EmptyChain({ origin }: { origin?: string }) {
  if (origin === "uploaded") {
    return (
      <p className="note">
        The chain starts here — this came into the project from outside rather
        than being made from something in it.
      </p>
    );
  }
  if (origin === "unrecorded") {
    return (
      <p className="notice" role="status">
        {/*
          A gap, and it reads as one. Something made this, and what made it was
          not written down — so this is a question about the record, not an
          answer about the artifact.
        */}
        Nothing is recorded as having made this. Something did: an artifact of
        this kind is derived from something else, so the chain was not written
        down rather than being empty.
      </p>
    );
  }
  // An older server sends no origin. Saying which of the two this is would be
  // a guess, and guessing wrong is how the original sentence got here.
  return (
    <p className="note">
      No derivation is recorded for this artifact.
    </p>
  );
}
