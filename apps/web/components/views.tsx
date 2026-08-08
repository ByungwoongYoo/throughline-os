"use client";

/**
 * The workspace views.
 *
 * These are presentation only: every number shown comes from the API, and
 * nothing is computed in the browser. §106 forbids shipping rows to React, and
 * more importantly a figure or a statistic recomputed here could disagree with
 * the analysis that produced it.
 */

import { useState } from "react";
import {
  AnalysisRun, Connection, DiscoveryMap, EvidenceGraph, Finding, Provenance,
  SearchResult, Source, api,
} from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading, Num, Stat, Status } from "./primitives";

// ---------------------------------------------------------------------------
// Overview (§70)
// ---------------------------------------------------------------------------

export function Overview({ project, map }: {
  project: { name: string; research_question: string };
  map: DiscoveryMap | null;
}) {
  if (!map) return <Loading rows={4} label="Reading the project" />;
  return (
    <>
      <h1>{project.name}</h1>
      <p className="lede serif" style={{ fontSize: 15 }}>
        {project.research_question || "No research question has been stated yet."}
      </p>

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <Stat label="Sources" value={map.counts.sources} />
        <Stat label="Datasets" value={map.counts.datasets} />
        <Stat label="Analyses" value={map.counts.analyses} />
        <Stat label="Connections" value={Object.values(map.connections).reduce((a, b) => a + b, 0)} />
        <Stat label="Findings" value={Object.values(map.findings).reduce((a, b) => a + b, 0)} />
        <Stat label="Contradictions" value={map.counts.contradictions} />
      </div>

      {/* §70 — one concrete next action, chosen from the project's real state. */}
      <div className="card">
        <h3 className="eyebrow">Recommended next</h3>
        <p style={{ color: "var(--ink)", margin: 0 }}>{map.recommended_next_action}</p>
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

export function Sources({ projectId, onSelect }: {
  projectId: string;
  onSelect: (id: string) => void;
}) {
  const { data, error, loading, reload } = useApi<Source[]>(`/api/projects/${projectId}/sources`);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        await api.upload(`/api/projects/${projectId}/sources`, file);
      }
      // Ingestion is asynchronous; poll briefly so the states are visible moving.
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        reload();
      }
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <div>
          <h1>Sources</h1>
          <p style={{ margin: 0 }}>Papers and datasets. Everything here is untrusted data (§35).</p>
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
          hint="Add a PDF and a CSV. The dataset is what discovery needs; the paper is what gives it context."
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
                <td><Status value={source.ingestion_status} /></td>
                <td style={{ color: "var(--ink-soft)" }}>
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
        Keyword and meaning together (§29). Every search is recorded so an answer built
        on it can be audited later (§30).
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

export function Discover({ projectId, onSelectConnection }: {
  projectId: string;
  onSelectConnection: (id: string) => void;
}) {
  const sources = useApi<Source[]>(`/api/projects/${projectId}/sources`);
  const connections = useApi<Connection[]>(`/api/projects/${projectId}/connections?limit=100`);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const datasets = (sources.data ?? []).filter((s) => s.dataset);

  async function discover(versionId: string) {
    setRunning(true);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/discoveries`, { dataset_version_id: versionId });
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
        sandbox, then corrected across the whole family (§49). Rejected candidates stay
        visible — they were tested, they are simply not discoveries.
      </p>

      {error ? <Failure error={error} /> : null}

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
        promoted past candidate (LAW 3).
      </p>
      {findings.loading && <Loading rows={3} label="Reading findings" />}
      {findings.error && <Failure error={findings.error} retry={findings.reload} />}
      {findings.data?.length === 0 && (
        <Empty title="No findings recorded" hint="Validate a connection, then record what it shows as a finding." />
      )}
      {findings.data?.map((finding) => (
        <div className="card" key={finding.id} style={{ cursor: "pointer" }} onClick={() => onSelect(finding.id)}>
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

export function EvidenceGraphView({ findingId }: { findingId: string }) {
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
                <span className="mono">{a.method}</span>
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

export function ConnectionDetail({ connectionId, projectId }: {
  connectionId: string; projectId: string;
}) {
  const connections = useApi<Connection[]>(`/api/projects/${projectId}/connections?limit=200`);
  const connection = connections.data?.find((c) => c.id === connectionId);
  const [confounders, setConfounders] = useState("");
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function validate() {
    setValidating(true); setError(null);
    try {
      const list = confounders.split(",").map((s) => s.trim()).filter(Boolean);
      await api.post(`/api/connections/${connectionId}/validate`, { confounders: list });
      // The suite runs several sandboxed analyses; give it time, then read the report.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const refreshed = await api.get<Connection[]>(`/api/projects/${projectId}/connections?limit=200`);
        const updated = refreshed.find((c) => c.id === connectionId);
        if (updated && updated.lifecycle_status !== connection?.lifecycle_status) break;
      }
      connections.reload();
    } catch (err) {
      setError(err);
    } finally {
      setValidating(false);
    }
  }

  if (connections.loading && !connection) return <Loading rows={4} />;
  if (!connection) return <Empty title="Connection not found" />;

  return (
    <>
      <h1>{connection.left_variable} × {connection.right_variable}</h1>
      <div className="row" style={{ marginBottom: 14 }}>
        <Status value={connection.lifecycle_status} />
        <span className="mono" style={{ color: "var(--ink-faint)" }}>{connection.method}</span>
      </div>

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <Stat label={connection.effect_size_name || "estimate"} value={connection.estimate?.toFixed(4) ?? "—"} />
        <Stat label="q-value (corrected)" value={connection.q_value?.toExponential(2) ?? "—"} />
        <Stat label="sample size" value={connection.sample_size ?? "—"} />
        <Stat label="evidence" value={connection.evidence_quality} />
      </div>

      <div className="card">
        <h2>Try to destroy it (§51)</h2>
        <p>
          Bootstrap stability, sensitivity to outliers, missingness, and adjustment for
          confounders. Naming no confounders is recorded as untested, not as clean.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            type="text" value={confounders} onChange={(e) => setConfounders(e.target.value)}
            placeholder="candidate confounders, comma separated"
            aria-label="Candidate confounders"
          />
          <button className="btn btn-primary" onClick={validate} disabled={validating}>
            {validating ? "Running checks…" : "Validate"}
          </button>
        </div>
        {error ? <div style={{ marginTop: 10 }}><Failure error={error} /></div> : null}
        {validating && <div style={{ marginTop: 12 }}><Loading rows={2} label="Running robustness checks in the sandbox" /></div>}
      </div>
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
