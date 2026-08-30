"use client";

/**
 * Reports and citation integrity (§79, §80, §58, §93).
 *
 * The design question here is what a reader should be shown *besides* the
 * prose, and the answer follows from what the artifact actually guarantees.
 *
 * Numbers on this screen carry their origin, because the guarantee is that each
 * was read from a recorded row rather than typed — and a guarantee nobody can
 * see is indistinguishable from a claim. Citations carry their entailment
 * state, including `unverified`, because a reference list that only showed the
 * checked ones would imply the rest had passed.
 */

import { useState } from "react";
import {
  Artifact, ArtifactBlock, ArtifactSummary, Citation, CitationReport, Connection,
  Integrity, api,
} from "@/lib/api";
import { ApiState, useApi } from "@/lib/useApi";
import { Empty, Failure, Loading, Status } from "./primitives";

const FORMATS = ["markdown", "html", "docx", "pptx"] as const;

export function Reports({ projectId, connections, onSelect }: {
  projectId: string;
  connections: ApiState<Connection[]>;
  onSelect: (id: string) => void;
}) {
  const artifacts = useApi<ArtifactSummary[]>(`/api/projects/${projectId}/artifacts`);
  const citations = useApi<CitationReport>(`/api/projects/${projectId}/citations/verify`);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // §80 — a report is written from something that was tested, so the only
  // starting points offered are connections that have a recorded analysis.
  const eligible = (connections.data ?? []).filter((c) => c.analysis_run_id);

  async function draft(connectionId: string) {
    setDrafting(true);
    setError(null);
    try {
      const created = await api.post<{ artifact_id: string }>(
        `/api/projects/${projectId}/artifacts/draft`, { connection_id: connectionId });
      await api.post(`/api/artifacts/${created.artifact_id}/check-citations`);
      artifacts.reload();
      citations.reload();
      onSelect(created.artifact_id);
    } catch (err) {
      setError(err);
    } finally {
      setDrafting(false);
    }
  }

  return (
    <>
      <h1>Reports</h1>
      <p className="lede">
        A report references its findings rather than copying them. Every number
        in it is read from a recorded analysis when the document is produced, so the
        page cannot disagree with the computation.
      </p>

      {error ? <Failure error={error} /> : null}
      <CitationHealth state={citations} />

      <div className="card">
        <h2>Write a report</h2>
        {eligible.length === 0 && (
          <Empty
            title="Nothing has been tested yet"
            hint="A report is written from a connection with a recorded analysis. Run discovery first."
          />
        )}
        {eligible.slice(0, 8).map((connection) => (
          <div className="row" key={connection.id} style={{ padding: "7px 0" }}>
            <div>
              <span style={{ fontWeight: 530 }}>
                {connection.left_variable} × {connection.right_variable}
              </span>{" "}
              <Status value={connection.lifecycle_status} />
            </div>
            <button className="btn" disabled={drafting}
                    onClick={() => draft(connection.id)}>
              {drafting ? "Assembling…" : "Draft report"}
            </button>
          </div>
        ))}
      </div>

      {artifacts.error ? <Failure error={artifacts.error} retry={artifacts.reload} /> : null}
      {artifacts.loading && !artifacts.data && <Loading rows={3} label="Reading reports" />}
      {artifacts.data?.length === 0 && (
        <Empty title="No reports yet" hint="Draft one from a tested connection above." />
      )}
      {artifacts.data && artifacts.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th style={{ width: "44%" }}>Title</th><th>Type</th>
              <th style={{ textAlign: "right" }}>Blocks</th>
              <th style={{ textAlign: "right" }}>Exports</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {artifacts.data.map((artifact) => (
              <tr key={artifact.id} style={{ cursor: "pointer" }}
                  onClick={() => onSelect(artifact.id)}>
                <td style={{ fontWeight: 530 }}>
                  <button type="button" className="pick"
                          onClick={() => onSelect(artifact.id)}>
                    {artifact.title}
                  </button>
                </td>
                <td className="mono">{artifact.artifact_type}</td>
                <td className="numeric" style={{ textAlign: "right" }}>{artifact.block_count}</td>
                <td className="numeric" style={{ textAlign: "right" }}>{artifact.render_count}</td>
                <td><Status value={artifact.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** §58 — the project's citation health, stated without flattery. */
function CitationHealth({ state }: { state: ApiState<CitationReport> }) {
  if (state.error) return <Failure error={state.error} retry={state.reload} />;
  if (!state.data) return <Loading rows={2} label="Checking citations" />;

  const report = state.data;
  const unchecked = (report.by_entailment.unverified ?? 0)
    + (report.by_entailment.not_checkable ?? 0);

  return (
    <div className="card card-tight">
      <h3 className="eyebrow">Citation integrity</h3>
      <div className="meters" style={{ marginTop: 10, marginBottom: 10 }}>
        <div className="meter"><b>{report.total}</b><span>citations</span></div>
        <div className="meter"><b>{report.resolved}</b><span>resolve</span></div>
        <div className="meter" data-zero={report.dangling.length === 0}>
          <b>{report.dangling.length}</b><span>dangling</span>
        </div>
        <div className="meter"><b>{report.by_entailment.supported ?? 0}</b><span>supported</span></div>
        <div className="meter" data-zero={(report.by_entailment.unsupported ?? 0) === 0}>
          <b>{report.by_entailment.unsupported ?? 0}</b><span>unsupported</span>
        </div>
        <div className="meter"><b>{unchecked}</b><span>unchecked</span></div>
      </div>
      <p className="note" style={{ marginBottom: 0 }}>{report.note}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export function ReportDetail({ artifactId, onOpenArtifact }: {
  artifactId: string;
  /**
   * Where to send the reader once a talk exists.
   *
   * Supplied rather than optional-and-ignored: without it, re-cutting a report
   * would create a second document and leave the reader on the first, with no
   * way to reach the thing they just made. That is the shape of dead surface
   * this codebase keeps producing.
   */
  onOpenArtifact: (artifactId: string) => void;
}) {
  const { data, error, loading, reload } = useApi<Artifact>(`/api/artifacts/${artifactId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [exported, setExported] = useState<Record<string, string>>({});

  async function render(fmt: string) {
    setBusy(fmt);
    setFailure(null);
    try {
      const result = await api.post<{ storage_key: string; byte_size: number }>(
        `/api/artifacts/${artifactId}/render?fmt=${fmt}`);
      setExported((current) => ({
        ...current,
        [fmt]: `${result.storage_key} · ${(result.byte_size / 1024).toFixed(1)} kB`,
      }));
      reload();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Re-cut this report as a talk.
   *
   * §75: a presentation is the same evidence at a different length, so it is
   * derived from the report rather than assembled again — the slides and the
   * paper end up referencing the same analysis runs, and re-running an
   * analysis moves both. Two documents assembled separately drift into two
   * accounts of one result.
   */
  async function recut() {
    setBusy("talk");
    setFailure(null);
    try {
      const talk = await api.post<{ artifact_id: string }>(
        `/api/artifacts/${artifactId}/presentation`);
      onOpenArtifact(talk.artifact_id);
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) return <Loading rows={5} label="Resolving every value in the report" />;

  return (
    <>
      <h1>{data.title}</h1>
      <div className="row" style={{ marginBottom: 14 }}>
        <Status value={data.status} />
        <span className="mono" style={{ color: "var(--ink-faint)" }}>
          {data.artifact_type} · version {data.version} · {data.blocks.length} blocks
        </span>
      </div>

      <IntegrityPanel integrity={data.integrity} />

      {/*
        Offered on a report and not on a talk: a presentation re-cut from a
        presentation would be a copy, and the route derives slides from a
        report's findings.
      */}
      {data.artifact_type === "report" && (
        <div className="card">
          <h2>As a talk</h2>
          <p style={{ marginTop: 0 }}>
            The same evidence at a different length. The slides reference the
            same analysis runs as this report, so re-running one moves both —
            rather than leaving two accounts of one result.
          </p>
          <button className="btn" disabled={busy !== null}
                  onClick={() => void recut()}>
            {busy === "talk" ? "Cutting…" : "Re-cut as a talk"}
          </button>
        </div>
      )}

      <div className="card">
        <h2>Export</h2>
        <p style={{ marginTop: 0 }}>
          Every format is produced from the same resolved artifact, so none of them can
          state a different number from the others.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {FORMATS.map((fmt) => (
            <button key={fmt} className="btn" disabled={busy !== null || !data.integrity.publishable}
                    onClick={() => render(fmt)}>
              {busy === fmt ? "Rendering…" : fmt}
            </button>
          ))}
        </div>
        {!data.integrity.publishable && (
          <p className="note">
            Export is blocked while the integrity check reports problems. A file outlives
            the warning that would have accompanied it on screen.
          </p>
        )}
        {failure ? <div style={{ marginTop: 10 }}><Failure error={failure} /></div> : null}
        {Object.entries(exported).map(([fmt, detail]) => (
          <div key={fmt} className="mono" style={{ color: "var(--ink-faint)", marginTop: 6 }}>
            {fmt} → {detail}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>The report</h2>
        {data.blocks.map((block) => (
          <Block key={block.id} block={block} />
        ))}
      </div>
    </>
  );
}

function IntegrityPanel({ integrity }: { integrity: Integrity }) {
  const [open, setOpen] = useState(false);

  /*
   * Warnings are grouped by kind, not listed one per block.
   *
   * Rendered flat, one unverified citation attached to six sentences produced
   * six identical cards and pushed the report itself below the fold. Repetition
   * is not emphasis — it buried the thing the reader came for while telling
   * them nothing they had not read in the first card. The count carries the
   * scale; the detail is one click away.
   */
  const grouped = new Map<string, { count: number; detail: string }>();
  for (const warning of integrity.warnings) {
    const existing = grouped.get(warning.kind);
    if (existing) existing.count += 1;
    else grouped.set(warning.kind, { count: 1, detail: warning.detail });
  }

  return (
    <div className="card card-tight">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 className="eyebrow" style={{ margin: 0 }}>Integrity</h3>
        {/* §118 — the state is a word, not only a colour. */}
        <Status value={integrity.publishable ? "passed" : "violated"} />
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        {integrity.blocks_checked} blocks checked. Problems block export; warnings do not,
        because an unverified citation is an honest gap rather than an error.
      </p>

      {integrity.problems.map((problem, i) => (
        <div className="error" key={i} style={{ marginTop: 6 }}>
          <b>{problem.kind.replace(/_/g, " ")}</b> — {problem.detail}
        </div>
      ))}

      {[...grouped.entries()].map(([kind, group]) => (
        <div className="notice" key={kind}>
          <span>
            <b>{kind.replace(/_/g, " ")}</b>
            {group.count > 1 && <> · {group.count} blocks</>}
            {open && <div className="note" style={{ margin: "4px 0 0" }}>{group.detail}</div>}
          </span>
        </div>
      ))}

      {integrity.warnings.length > 0 && (
        <button className="block-trace" onClick={() => setOpen((v) => !v)}
                style={{ marginTop: 8 }} aria-expanded={open}>
          {open ? "Hide detail" : "What these mean"}
        </button>
      )}
    </div>
  );
}

function Block({ block }: { block: ArtifactBlock }) {
  const [open, setOpen] = useState(false);
  const heading = block.block_type === "heading" || block.block_type === "slide_title";
  const traceable = block.value_provenance.length > 0 || block.citations.length > 0;

  return (
    <div className="block" data-kind={block.block_type}>
      {heading ? <h3>{block.text}</h3> : <p className="block-text">{block.text}</p>}

      {traceable && (
        <button className="block-trace" onClick={() => setOpen((v) => !v)}
                aria-expanded={open}>
          {open ? "Hide" : "Where this came from"}
          {block.value_provenance.length > 0 &&
            ` · ${block.value_provenance.length} value${block.value_provenance.length > 1 ? "s" : ""}`}
          {block.citations.length > 0 && ` · ${block.citations.length} cited`}
        </button>
      )}

      {open && (
        <div className="block-prov">
          {block.value_provenance.map((ref) => (
            <div key={ref.name} className="mono">
              {ref.name} = {String(block.resolved[ref.name])}
              <span style={{ color: "var(--ink-faint)" }}> ← {ref.source}.{ref.path}</span>
            </div>
          ))}
          {block.citations.map((citation) => (
            <CitationLine key={citation.id} citation={citation} />
          ))}
          {block.value_provenance.length > 0 && (
            <p className="note" style={{ marginBottom: 0 }}>
              Read from the recorded row when this page loaded — not stored in the report.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CitationLine({ citation }: { citation: Citation }) {
  const target = citation.target as Record<string, string | undefined>;
  const label = citation.target_kind === "analysis_run"
    ? `${target.id} (${(target.method ?? "analysis").replace(/_/g, " ")})`
    : target.source_title ?? citation.target_kind;

  return (
    <div style={{ marginTop: 6 }}>
      <Status value={citation.entailment} />{" "}
      <span className="mono" style={{ fontSize: 11.5 }}>{label}</span>
      {citation.locator && (
        <span style={{ color: "var(--ink-faint)" }}> · {citation.locator}</span>
      )}
      {citation.entailment_detail && (
        <div className="note" style={{ margin: "2px 0 0" }}>{citation.entailment_detail}</div>
      )}
    </div>
  );
}
