"use client";

import { useEffect, useState } from "react";
import { Capabilities, Connection, DiscoveryMap, Project, api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "@/components/primitives";
import { Section, Shell } from "@/components/Shell";
import {
  AnalysisDetail, ConnectionDetail, ConnectionsTable, Discover, EvidenceGraphView,
  Findings, Overview, Search, Sources,
} from "@/components/views";

type AuthStatus = { needs_setup: boolean; authenticated: boolean; user: { display_name: string } | null };

export default function Home() {
  const auth = useApi<AuthStatus>("/api/auth/status");

  if (auth.loading) return <Centered><Loading rows={3} label="Starting Throughline" /></Centered>;
  if (auth.error) {
    return (
      <Centered>
        <Failure error={auth.error} retry={auth.reload} />
        <p className="note">
          The API is not answering. Start it with <code className="mono">./scripts/dev.sh</code>.
        </p>
      </Centered>
    );
  }
  if (!auth.data?.authenticated) return <Gate status={auth.data!} onDone={auth.reload} />;
  return <Workspace />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", padding: 24 }}>
      <div style={{ width: "min(420px, 100%)" }}>{children}</div>
    </div>
  );
}

/** First run creates the local account; afterwards it signs in. */
function Gate({ status, onDone }: { status: AuthStatus; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const setup = status.needs_setup;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(setup ? "/api/auth/setup" : "/api/auth/login",
        setup ? { email, display_name: name || "Researcher", password } : { email, password });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <div className="brand" style={{ marginBottom: 6 }}>Throughline</div>
      <p className="lede" style={{ fontSize: 13 }}>
        {setup
          ? "Create the local account for this machine. Your research never leaves it."
          : "Sign in to your local workspace."}
      </p>
      <form onSubmit={submit} className="card">
        {setup && (
          <label style={{ display: "block", marginBottom: 10 }}>
            <span className="eyebrow">Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr Chen" />
          </label>
        )}
        <label style={{ display: "block", marginBottom: 10 }}>
          <span className="eyebrow">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span className="eyebrow">Password</span>
          <input type="password" required minLength={setup ? 12 : 1} value={password}
                 onChange={(e) => setPassword(e.target.value)} />
          {setup && <span className="note" style={{ display: "block" }}>At least 12 characters.</span>}
        </label>
        {error ? <Failure error={error} /> : null}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Working…" : setup ? "Create account" : "Sign in"}
        </button>
      </form>
    </Centered>
  );
}

function Workspace() {
  const projects = useApi<Project[]>("/api/projects");
  const capabilities = useApi<Capabilities>("/api/system/capabilities");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [selection, setSelection] = useState<{ kind: string; id: string } | null>(null);

  useEffect(() => {
    if (!projectId && projects.data?.length) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  const map = useApi<DiscoveryMap>(projectId ? `/api/projects/${projectId}/discovery-map` : null);
  const project = projects.data?.find((p) => p.id === projectId);

  if (projects.loading) return <Centered><Loading rows={3} label="Loading projects" /></Centered>;
  if (projects.error) return <Centered><Failure error={projects.error} retry={projects.reload} /></Centered>;
  if (!projects.data?.length) return <NewProject onCreated={projects.reload} />;
  if (!project) return <Centered><Loading rows={2} /></Centered>;

  function select(kind: string) {
    return (id: string) => { setSelection({ kind, id }); };
  }

  return (
    <Shell
      section={section} onSection={(s) => { setSection(s); setSelection(null); }}
      map={map.data} projectName={project.name}
      onCommand={() => setSection("search")}
      inspector={
        <Inspector selection={selection} capabilities={capabilities.data} map={map.data} />
      }
    >
      {section === "overview" && <Overview project={project} map={map.data} />}
      {section === "sources" && <Sources projectId={project.id} onSelect={select("source")} />}
      {section === "search" && <Search projectId={project.id} />}
      {section === "discover" && (
        selection?.kind === "connection"
          ? <ConnectionDetail connectionId={selection.id} projectId={project.id} />
          : <Discover projectId={project.id} onSelectConnection={select("connection")} />
      )}
      {section === "connections" && (
        selection?.kind === "connection"
          ? <ConnectionDetail connectionId={selection.id} projectId={project.id} />
          : <ConnectionList projectId={project.id} onSelect={select("connection")} />
      )}
      {section === "findings" && (
        selection?.kind === "finding"
          ? <EvidenceGraphView findingId={selection.id} />
          : <Findings projectId={project.id} onSelect={select("finding")} />
      )}
      {section === "analyses" && (
        selection?.kind === "analysis"
          ? <AnalysisDetail runId={selection.id} />
          : <AnalysisList projectId={project.id} onSelect={select("analysis")} />
      )}
      {section === "graph" && <GraphPlaceholder />}
      {section === "figures" && <FiguresPlaceholder />}
    </Shell>
  );
}

function ConnectionList({ projectId, onSelect }: { projectId: string; onSelect: (id: string) => void }) {
  const { data, error, loading, reload } = useApi<Connection[]>(`/api/projects/${projectId}/connections?limit=200`);
  return (
    <>
      <h1>Connections</h1>
      <p className="lede">
        Every candidate that was tested, with its corrected q-value and lifecycle state.
      </p>
      <ConnectionsTable connections={data} error={error} loading={loading} reload={reload} onSelect={onSelect} />
    </>
  );
}

function AnalysisList({ projectId, onSelect }: { projectId: string; onSelect: (id: string) => void }) {
  const { data, error, loading, reload } = useApi<Connection[]>(`/api/projects/${projectId}/connections?limit=200`);
  const runs = (data ?? []).flatMap((c) =>
    c.analysis_run_id ? [{ ...c, analysis_run_id: c.analysis_run_id }] : []);
  if (error) return <Failure error={error} retry={reload} />;
  if (loading) return <Loading rows={4} label="Reading analyses" />;
  return (
    <>
      <h1>Analyses</h1>
      <p className="lede">
        Every number here came from a recorded run in the sandbox, reproducible from its
        stored specification (LAW 2, §44).
      </p>
      {runs.length === 0 && <Empty title="No analyses yet" hint="Run discovery to generate them." />}
      {runs.map((c) => (
        <div className="card card-tight" key={c.analysis_run_id}
             style={{ cursor: "pointer" }} onClick={() => onSelect(c.analysis_run_id)}>
          <div className="row">
            <span style={{ fontWeight: 530 }}>{c.left_variable} × {c.right_variable}</span>
            <span className="mono" style={{ color: "var(--ink-faint)" }}>{c.method}</span>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * §123 — an unbuilt view says so. A placeholder that looked like a working graph
 * would be exactly the fake surface the specification forbids.
 */
function GraphPlaceholder() {
  return (
    <>
      <h1>Evidence graph</h1>
      <Empty
        title="Not built yet"
        hint="The API serves the knowledge graph and the evidence graph, and the Findings view already renders a finding's evidence. An interactive node-link canvas is Phase 5 work."
      />
    </>
  );
}

function FiguresPlaceholder() {
  return (
    <>
      <h1>Figures</h1>
      <Empty
        title="Rendered server-side"
        hint="Publication figures (SVG, PDF, PNG) and Vega-Lite specs are produced by the API from a stored ResearchVisualSpec. Browsing and embedding them in this interface is the next piece of work."
      />
    </>
  );
}

function NewProject({ onCreated }: { onCreated: () => void }) {
  const [question, setQuestion] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post("/api/projects", {
        name: name || question.slice(0, 60) || "Untitled project",
        research_question: question,
      });
      onCreated();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  // §6 — the first screen asks what the researcher is trying to discover.
  return (
    <Centered>
      <h1 className="serif" style={{ fontSize: 24, marginBottom: 12 }}>
        What are you trying to discover?
      </h1>
      <form onSubmit={submit}>
        <textarea
          rows={4} value={question} onChange={(e) => setQuestion(e.target.value)}
          placeholder="I want to investigate whether antibiotic consumption is associated with resistance across countries, and whether GDP explains the relationship."
          aria-label="Research question"
          style={{ marginBottom: 10, fontFamily: "var(--serif)", fontSize: 14 }}
        />
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Project name (optional)" style={{ marginBottom: 10 }} />
        {error ? <Failure error={error} /> : null}
        <button className="btn btn-primary" type="submit" disabled={busy || !question.trim()}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </form>
    </Centered>
  );
}

/** The right rail: what is selected, and what this installation can actually do. */
function Inspector({ selection, capabilities, map }: {
  selection: { kind: string; id: string } | null;
  capabilities: Capabilities | null;
  map: DiscoveryMap | null;
}) {
  return (
    <>
      <h3 className="eyebrow">Context</h3>
      {selection?.kind === "connection" && (
        <p className="note">
          A connection is a tested relationship. Validate it to see whether it survives
          bootstrap resampling, outlier exclusion and adjustment for confounders.
        </p>
      )}
      {!selection && map && (
        <p className="note">{map.recommended_next_action}</p>
      )}

      <h3 className="eyebrow" style={{ marginTop: 20 }}>This installation</h3>
      {!capabilities && <Loading rows={2} />}
      {capabilities && (
        <div className="kv">
          <dt>Search</dt>
          <dd>{capabilities.retrieval.semantic ? "hybrid" : "lexical only"}</dd>
          <dt>Model</dt>
          <dd className="mono">{capabilities.retrieval.model ?? "none"}</dd>
          <dt>Sandbox</dt>
          <dd>{capabilities.analysis.sandbox ? "enabled" : "unavailable"}</dd>
          <dt>Methods</dt>
          <dd>{capabilities.analysis.methods?.length ?? 0}</dd>
          <dt>AI provider</dt>
          <dd>{capabilities.llm.configured ? "configured" : "none"}</dd>
        </div>
      )}
      {capabilities && !capabilities.llm.configured && (
        <p className="note">{capabilities.llm.note}</p>
      )}
      {capabilities?.retrieval.note && <p className="note">{capabilities.retrieval.note}</p>}
    </>
  );
}
