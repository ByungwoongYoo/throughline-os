"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArtifactSummary, Capabilities, Connection, DiscoveryMap, Finding, Project, Source, api,
} from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "@/components/primitives";
import { Crumb, SECTIONS, Section, Shell } from "@/components/Shell";
import { CommandPalette, buildCommands } from "@/components/CommandPalette";
import {
  AnalysisDetail, ConnectionDetail, ConnectionsTable, Discover, EvidenceGraphView,
  Findings, Overview, Search, SourceDetail, Sources,
} from "@/components/views";
import { ReportDetail, Reports } from "@/components/reports";
import { GraphView } from "@/components/graphview";
import { Figures } from "@/components/figures";
import { Gallery } from "@/components/gallery";
import { ProjectMenu } from "@/components/ProjectMenu";
import { AccountMenu, SignedInUser } from "@/components/AccountMenu";
import { IconPlus, IconSpark } from "@/components/icons";
import { DataSearch } from "@/components/datasearch";
import { Compare } from "@/components/compare";
import { Patterns } from "@/components/patterns";
import { Literature } from "@/components/literature";
import { Notebook } from "@/components/notebook";
import { Settings } from "@/components/settings";

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
  return <Workspace user={auth.data.user as SignedInUser} />;
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
  /*
   * Three modes, not two.
   *
   * `needs_setup` is the very first account on a fresh install. After that a
   * visitor may still need to *create* an account — previously they could not:
   * setup runs once and everything else required a session, so the second
   * person to open this installation had no way in at all.
   */
  const setup = status.needs_setup;
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const creating = setup || mode === "signup";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      if (setup) {
        await api.post("/api/auth/setup",
                       { email, display_name: name || "Researcher", password });
      } else if (mode === "signup") {
        await api.post("/api/auth/register",
                       { email, display_name: name || "Researcher", password });
      } else {
        await api.post("/api/auth/login", { email, password });
      }
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const message = error instanceof Error ? error.message : error ? String(error) : null;

  return (
    <div className="gate">
      {/* The entrance carries depth; the instrument beyond it does not (§115). */}
      <aside className="gate-art">
        <div className="gate-art-copy">
          <h2>An interesting pattern is not a discovery.</h2>
          <p>
            Everything you load stays on this machine — the database, the
            embeddings and the analysis sandbox all run locally. Nothing is
            uploaded anywhere.
          </p>
        </div>
      </aside>

      <div className="gate-form">
        <div className="gate-form-inner">
          <div className="gate-mark">
            <i aria-hidden />
            <span>Throughline</span>
          </div>

          <h1>
            {setup ? "Set up this machine"
                   : mode === "signup" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="gate-sub">
            {setup
              ? "The first account on this machine. It scopes your projects and signs the audit trail."
              : mode === "signup"
                ? "Your own workspace on this machine. You will not see anyone else's projects, and they will not see yours."
                : "Sign in to your local workspace."}
          </p>

          <form onSubmit={submit}>
            {creating && (
              <label className="gate-field">
                <span>Name</span>
                <input type="text" value={name} placeholder="Dr Chen"
                       onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <label className="gate-field">
              <span>Email</span>
              <input type="email" required autoComplete="username" value={email}
                     placeholder="you@lab.local"
                     onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="gate-field">
              <span>Password</span>
              <input type="password" required minLength={creating ? 12 : 1}
                     autoComplete={creating ? "new-password" : "current-password"}
                     value={password} onChange={(e) => setPassword(e.target.value)} />
              {creating && <span className="gate-hint">At least 12 characters. It protects an entire research corpus.</span>}
            </label>

            {message ? <div className="gate-error" role="alert">{message}</div> : null}

            <button className="gate-submit" type="submit" disabled={busy}>
              {busy ? "Working…"
                    : creating ? "Create account and continue" : "Sign in"}
            </button>
          </form>

          {/* Not shown during first-run setup: there is nothing to switch to
              until an account exists. */}
          {!setup && (
            <p className="gate-switch">
              {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
              <button type="button" onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}>
                {mode === "signin" ? "Create an account" : "Sign in instead"}
              </button>
            </p>
          )}

          <Link className="gate-back" href="/">← Back</Link>
        </div>
      </div>
    </div>
  );
}

const SECTION_LABEL: Record<Section, string> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s.label])) as Record<Section, string>;

function Workspace({ user }: { user: SignedInUser }) {
  /*
   * `creating` opens the create-project flow on demand, so a researcher who
   * already has projects can still make another one — previously the create
   * screen was reachable only by having none, which meant the second project
   * had no route at all.
   */
  const [creating, setCreating] = useState(false);
  const projects = useApi<Project[]>("/api/projects");
  const capabilities = useApi<Capabilities>("/api/system/capabilities");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [selection, setSelection] = useState<{ kind: string; id: string } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingDiscovery, setPendingDiscovery] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);

  useEffect(() => {
    if (!projectId && projects.data?.length) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  const map = useApi<DiscoveryMap>(projectId ? `/api/projects/${projectId}/discovery-map` : null);
  const sources = useApi<Source[]>(projectId ? `/api/projects/${projectId}/sources` : null);
  const connections = useApi<Connection[]>(
    projectId ? `/api/projects/${projectId}/connections?limit=200` : null);
  const findings = useApi<Finding[]>(projectId ? `/api/projects/${projectId}/findings` : null);
  // Approved display names, so breadcrumbs and the palette never show a raw
  // column name either (Part C: zero raw names outside the mapping screen).
  const variables = useApi<{ labels: Record<string, string> }>(
    projectId ? `/api/projects/${projectId}/variables` : null);
  const artifacts = useApi<ArtifactSummary[]>(
    projectId ? `/api/projects/${projectId}/artifacts` : null);
  const project = projects.data?.find((p) => p.id === projectId);

  /*
   * Global keys. ⌘K opens the palette; Escape leaves a detail view for the list
   * it came from, which is the one navigation a keyboard user reaches for most
   * and the one a single-page shell most often forgets to provide.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        // Always opens, never toggles. Written as a toggle first, which meant a
        // second ⌘K on an already-open palette dismissed it — and since you
        // cannot see whether it is open while reaching for the shortcut, the
        // keystroke did the opposite of what you asked about half the time.
        // Escape is how it closes.
        setPaletteOpen(true);
        return;
      }
      if (event.key === "Escape" && !paletteOpen) {
        // Don't steal Escape from a field the researcher is typing in.
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        setSelection((current) => (current ? null : current));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  const upload = useCallback(async (files: FileList | null) => {
    if (!files?.length || !projectId) return;
    setUploading(true);
    setUploadError(null);
    setSection("sources");
    setSelection(null);
    try {
      for (const file of Array.from(files)) {
        await api.upload(`/api/projects/${projectId}/sources`, file);
      }
      sources.reload();
      map.reload();
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploading(false);
    }
  }, [projectId, sources, map]);

  if (projects.loading) return <Centered><Loading rows={3} label="Loading projects" /></Centered>;
  if (projects.error) return <Centered><Failure error={projects.error} retry={projects.reload} /></Centered>;
  if (!projects.data?.length) {
    return <FirstProject onCreated={() => { setCreating(false); projects.reload(); }}
                         user={user} />;
  }
  if (creating) {
    return <NewProject onCreated={() => { setCreating(false); projects.reload(); }}
                       onCancel={() => setCreating(false)} />;
  }
  if (!project) return <Centered><Loading rows={2} /></Centered>;

  function select(kind: string) {
    return (id: string) => { setSelection({ kind, id }); };
  }

  function goSection(next: Section) {
    setSection(next);
    setSelection(null);
  }

  // The breadcrumb is what makes a detail view escapable by mouse, and what
  // tells the researcher where a palette jump just landed them.
  const crumbs: Crumb[] = [{
    label: SECTION_LABEL[section],
    onClick: selection ? () => setSelection(null) : undefined,
  }];
  if (selection) {
    const named =
      selection.kind === "source"
        ? sources.data?.find((s) => s.id === selection.id)?.title
        : selection.kind === "connection"
          ? (() => {
              const c = connections.data?.find((x) => x.id === selection.id);
              return c ? `${c.left_variable} × ${c.right_variable}` : undefined;
            })()
          : selection.kind === "finding"
            ? findings.data?.find((f) => f.id === selection.id)?.title
            : selection.kind === "artifact"
              ? artifacts.data?.find((a) => a.id === selection.id)?.title
              : undefined;
    crumbs.push({ label: named ?? selection.id });
  }

  const commands = buildCommands({
    labels: variables.data?.labels ?? {},
    sections: SECTIONS,
    sources: sources.data ?? [],
    connections: connections.data ?? [],
    findings: findings.data ?? [],
    go: goSection,
    open: (target, kind, id) => { setSection(target); setSelection({ kind, id }); },
  });

  return (
    <>
      <Shell
        section={section} onSection={goSection}
        map={map.data} projectName={project.name}
        crumbs={crumbs}
        onDropFiles={upload}
        onCommand={() => setPaletteOpen(true)}
        projectMenu={
          <ProjectMenu
            projects={projects.data}
            currentId={projectId}
            onSelect={(id) => {
              // Clear anything scoped to the project being left, so nothing
              // from the previous one can render against the new one.
              setSelection(null);
              setSection("overview");
              setProjectId(id);
            }}
            onChanged={() => {
              // The deleted project may be the one on screen. Drop the
              // selection and let the effect below pick the first survivor.
              setSelection(null);
              setProjectId(null);
              projects.reload();
            }}
            onCreate={() => setCreating(true)}
          />
        }
        accountMenu={<AccountMenu user={user} />}
        inspector={
          <Inspector selection={selection} capabilities={capabilities.data} map={map.data} />
        }
      >
        {section === "overview" && (
          <Overview project={project} map={map.data} onGo={goSection} />
        )}
        {section === "sources" && (
          selection?.kind === "source"
            ? <SourceDetail
                projectId={project.id} sourceId={selection.id}
                onDiscover={(versionId) => {
                  setPendingDiscovery(versionId);
                  goSection("discover");
                }}
              />
            : <Sources
                sources={sources} onSelect={select("source")}
                upload={upload} uploading={uploading} uploadError={uploadError}
              />
        )}
        {section === "search" && <Search projectId={project.id} />}
        {section === "discover" && (
          selection?.kind === "connection"
            ? <ConnectionDetail connectionId={selection.id} projectId={project.id} />
            : <Discover
                projectId={project.id} sources={sources}
                onSelectConnection={select("connection")}
                startWith={pendingDiscovery} onStarted={() => setPendingDiscovery(null)}
              />
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
        {section === "reports" && (
          selection?.kind === "artifact"
            ? <ReportDetail artifactId={selection.id} />
            : <Reports projectId={project.id} connections={connections}
                       onSelect={select("artifact")} />
        )}
        {section === "compare" && (
          <Compare projectId={project.id} sources={sources} />
        )}
        {section === "patterns" && (
          <Patterns
            projectId={project.id}
            datasetVersionId={
              (sources.data ?? []).find((s) => s.dataset)?.dataset
                ?.dataset_version_id ?? null}
            columns={Object.keys(variables.data?.labels ?? {})}
          />
        )}
        {section === "literature" && <Literature projectId={project.id} />}
        {section === "notebook" && <Notebook projectId={project.id} />}
        {section === "settings" && <Settings />}
        {section === "graph" && (
          <GraphView projectId={project.id} onSelect={select("object")} />
        )}
        {section === "gallery" && <Gallery />}
        {section === "datasearch" && <DataSearch />}

        {section === "figures" && (
          <Figures projectId={project.id} connections={connections} />
        )}
      </Shell>

      <CommandPalette
        open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands}
      />
    </>
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
        stored specification.
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
 * The first thing a brand-new account sees.
 *
 * Deliberately not an empty list with a button in the corner. An account with
 * no projects has nothing to look at, so the screen's whole job is to get the
 * researcher to the one action that makes the rest of the product exist — and
 * to say what will happen when they take it, because "create a project" does
 * not tell anyone what a project here is for.
 *
 * The three cards are what the system actually does with a question, in order.
 * They are descriptions of the real pipeline rather than marketing: a
 * researcher who reads them and then uses the product should find it did
 * exactly this.
 */
function FirstProject({ onCreated, user }: {
  onCreated: () => void; user: SignedInUser;
}) {
  const [started, setStarted] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [exampleError, setExampleError] = useState("");

  // The request returns as soon as the sources are queued; the workspace then
  // shows them ingesting, which is the point — the researcher watches the
  // pipeline run rather than being handed a finished screen.
  const openExample = async () => {
    setLoadingExample(true);
    setExampleError("");
    try {
      const response = await fetch("/api/projects/example", { method: "POST" });
      if (!response.ok) {
        throw new Error(await response.text() || `HTTP ${response.status}`);
      }
      onCreated();
    } catch (error) {
      // §104 — say what failed. A dead button teaches nothing.
      setExampleError(
        `The example could not be created: ${
          error instanceof Error ? error.message : String(error)}`);
      setLoadingExample(false);
    }
  };

  if (started) return <NewProject onCreated={onCreated}
                                  onCancel={() => setStarted(false)} />;

  return (
    <div className="first">
      <div className="first-inner">
        <span className="badge badge-quiet">
          <IconSpark size={12} /> New workspace
        </span>
        <h1 className="serif">
          Welcome{user.display_name ? `, ${user.display_name.split(" ")[0]}` : ""}.
          <br />Let&apos;s start with a question.
        </h1>
        <p className="first-lede">
          A project is one research question and everything gathered to answer
          it — the papers, the data, every analysis that ran, and every finding
          that survived. Nothing here is shared with anyone else on this
          machine.
        </p>

        {/* Part B6 — something to open before committing anything.
            Offered first, and deliberately not as the quiet secondary option:
            a form is the highest-effort possible first action, and it explains
            nothing about what the product does with the answer. The example is
            a real project built by the real pipeline, so everything it shows
            is something the researcher's own sources will also do. */}
        <div className="first-actions">
          <button className="btn btn-primary btn-lg"
                  onClick={openExample}
                  disabled={loadingExample}>
            <IconSpark size={16} />
            {loadingExample ? "Building the example…" : "Open a worked example"}
          </button>
          <button className="btn btn-lg" onClick={() => setStarted(true)}>
            <IconPlus size={16} />
            Start with your own question
          </button>
        </div>
        {exampleError && <p className="first-error" role="alert">{exampleError}</p>}
        <p className="first-note">
          The example is a real project — two sources, ingested and analysed the
          same way yours will be. Delete it whenever you like.
        </p>

        <ul className="first-steps">
          <li>
            <b>1 · Bring evidence</b>
            Drop in papers and datasets. Papers are parsed to exact character
            spans; datasets are profiled column by column.
          </li>
          <li>
            <b>2 · Let it look</b>
            Candidate relationships are generated from variable types, then
            computed for real in a sandboxed process.
          </li>
          <li>
            <b>3 · Keep what survives</b>
            Corrected for every test that ran, then attacked. What is left is
            linked to the rows it came from, permanently.
          </li>
        </ul>
      </div>
    </div>
  );
}


function NewProject({ onCreated, onCancel }: {
  onCreated: () => void; onCancel?: () => void;
}) {
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
        <div className="np-actions">
          <button className="btn btn-primary" type="submit"
                  disabled={busy || !question.trim()}>
            <IconPlus size={15} />
            {busy ? "Creating…" : "Create project"}
          </button>
          {onCancel && (
            <button className="btn" type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
        </div>
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
