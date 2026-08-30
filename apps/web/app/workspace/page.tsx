"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AnalysisRunRow, ArtifactSummary, Capabilities, Connection, DiscoveryMap,
  Finding, Project, Source, api,
} from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Centered, Failure, Loading } from "@/components/primitives";
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
import { EmbeddingSpace } from "@/components/embeddingspace";
import { ProjectMenu } from "@/components/ProjectMenu";
import { AccountMenu, SignedInUser } from "@/components/AccountMenu";
import { FirstProject, NewProject } from "@/components/FirstProject";
import { DataSearch } from "@/components/datasearch";
import { Compare } from "@/components/compare";
import { Patterns } from "@/components/patterns";
import { Board } from "@/components/board/Board";
import { Literature } from "@/components/literature";
import { Notebook } from "@/components/notebook";
import { Settings } from "@/components/settings";
import { WithdrawnSources } from "@/components/withdrawn";
import { ExportedDocuments } from "@/components/exports";
import { Contradictions } from "@/components/contradictions";
import { Challenges } from "@/components/challenges";
import { ExplorationLedger } from "@/components/ledger";
import { Deviations } from "@/components/deviations";
import { Harvest } from "@/components/harvest";
import { LibraryNote } from "@/components/librarynote";
import { ForkLineage } from "@/components/forklineage";
import { FindingStanding } from "@/components/lifecycle";
import { Journal } from "@/components/journal";
import { Variables } from "@/components/variables";
import { AnalysisList, PlainReading } from "@/components/analyses";

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
  /*
   * The method of the analysis on screen, reported up by the detail view so the
   * branch panel below it can offer a fork that swaps it. Held here rather than
   * fetched again, so both panels describe the same run.
   */
  const [runMethod, setRunMethod] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingDiscovery, setPendingDiscovery] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);

  useEffect(() => {
    if (!projectId && projects.data?.length) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  const map = useApi<DiscoveryMap>(projectId ? `/api/projects/${projectId}/discovery-map` : null);
  const sources = useApi<Source[]>(projectId ? `/api/projects/${projectId}/sources` : null);
  /*
   * Every analysis in the project, not only the ones discovery turned into a
   * connection. The Figures screen draws a run, and a run a researcher
   * specified belongs to no connection.
   */
  const analyses = useApi<AnalysisRunRow[]>(
    projectId ? `/api/projects/${projectId}/analyses?limit=200` : null,
    [projectId]);
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
        {section === "board" && (
          /*
           * The central operating surface (§4). Cards are the project's own
           * research objects — an analysis, a figure, an excerpt — so arranging
           * the board arranges the work rather than a set of shortcuts to it.
           */
          <Board projectId={project.id} />
        )}

        {section === "overview" && (
          <>
            <Overview project={project} map={map.data} onGo={goSection} />
            {/*
              Directly under the meters, because the Contradictions meter is
              what this panel makes honest. The count read from a table nothing
              wrote to, so it showed zero for every project that has ever
              existed — and a meter a reader cannot click through to is a number
              they have to take on trust, which is how it stayed wrong.
            */}
            <Contradictions projectId={project.id} />
          </>
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
            : <>
                {/*
                  Above the list, not in a section of its own. A withdrawal is a
                  fact about these sources rather than a place to visit, and a
                  nav item is something you have to remember to click — which
                  nobody does until they already suspect something is wrong.
                  When nothing is withdrawn this renders a single quiet line.
                */}
                <WithdrawnSources projectId={project.id} />
                <Sources
                  sources={sources} onSelect={select("source")}
                  upload={upload} uploading={uploading} uploadError={uploadError}
                />
              </>
        )}
        {section === "variables" && <Variables projectId={project.id} />}
        {section === "search" && <Search projectId={project.id} />}
        {section === "discover" && (
          selection?.kind === "connection"
            ? <ConnectionDetail connectionId={selection.id} projectId={project.id}
                                  onRecordFinding={select("finding")} />
            : <Discover
                projectId={project.id} sources={sources}
                onSelectConnection={select("connection")}
                startWith={pendingDiscovery} onStarted={() => setPendingDiscovery(null)}
              />
        )}
        {section === "connections" && (
          selection?.kind === "connection"
            ? <ConnectionDetail connectionId={selection.id} projectId={project.id}
                                  onRecordFinding={select("finding")} />
            : <>
                <ConnectionList projectId={project.id} onSelect={select("connection")} />
                {/*
                  Under the connections rather than beside the results. The
                  count is context for what has just been read, and a reader who
                  has scrolled a list of candidate relationships is exactly the
                  reader who should see how many were tested to produce it.
                */}
                <ExplorationLedger projectId={project.id} />
                {/*
                  Beneath the ledger, because they answer two halves of one
                  question. The ledger says how much looking was done; this says
                  how much of it was the looking that was planned.
                */}
                <Deviations projectId={project.id} />
              </>
        )}
        {section === "findings" && (
          selection?.kind === "finding"
            ? <>
                <EvidenceGraphView findingId={selection.id}
                                   onOpenAnalysis={select("analysis")} />
                {/*
                  Directly under the evidence, because the evidence is what
                  decides whether it may move at all: anything past candidate
                  is a claim about the world and the domain refuses it without
                  something attached.
                */}
                <FindingStanding findingId={selection.id} />
                {/*
                  Below the evidence, deliberately. The case for a finding is
                  what a researcher came to read; the case against it is what
                  they need to have read before they cite it. Putting the
                  argument first would make the screen adversarial, and hiding
                  it behind a tab means it is never opened.
                */}
                <Challenges projectId={project.id} findingId={selection.id} />
                <LibraryNote projectId={project.id} findingId={selection.id} />
              </>
            : <Findings projectId={project.id} onSelect={select("finding")} />
        )}
        {section === "analyses" && (
          selection?.kind === "analysis"
            ? <>
                <AnalysisDetail runId={selection.id} onMethod={setRunMethod} />
                {/*
                  The plain reading was reachable only through a connection,
                  so an analysis a researcher specified had no legible version
                  of itself at all.
                */}
                <PlainReading runId={selection.id} />
                {/*
                  Beneath the run, because the branch is context for the number
                  above it. Renders nothing at all for an original analysis with
                  no variants, which is most of them — a panel that appears on
                  every run to say "no relationship" is noise.
                */}
                <ForkLineage projectId={project.id} runId={selection.id}
                             method={runMethod}
                             onOpen={(id) => select("analysis")(id)} />
              </>
            : <AnalysisList projectId={project.id} onSelect={select("analysis")} />
        )}
        {section === "reports" && (
          selection?.kind === "artifact"
            ? <ReportDetail artifactId={selection.id}
                            onOpenArtifact={select("artifact")} />
            : <>
                {/*
                  Above the list, for the same reason the withdrawal notice sits
                  above the sources: this is a fact about these documents, not a
                  place to visit. Nobody navigates to a staleness screen until
                  they already suspect something, and by then the wrong numbers
                  have been sent. It renders nothing at all until the project has
                  actually exported something.
                */}
                <ExportedDocuments projectId={project.id}
                                   onOpen={select("artifact")} />
                <Reports projectId={project.id} connections={connections}
                         onSelect={select("artifact")} />
              </>
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
        {section === "literature" && (
          <>
            <Literature projectId={project.id} />
            {/*
              Beneath search, not instead of it. Searching four databases and
              harvesting one repository are different acts — one asks a
              question, the other takes a copy — and a researcher arrives here
              wanting the first far more often than the second.
            */}
            <Harvest projectId={project.id} />
          </>
        )}
        {section === "notebook" && <Notebook projectId={project.id} />}
        {section === "journal" && (
          <Journal projectId={project.id} onOpenObject={select("analysis")} />
        )}
        {section === "settings" && <Settings />}
        {section === "graph" && (
          <GraphView projectId={project.id} onSelect={select("object")} />
        )}
        {section === "embedding" && <EmbeddingSpace projectId={project.id} />}
        {section === "gallery" && <Gallery />}
        {section === "datasearch" && <DataSearch />}

        {section === "figures" && (
          <Figures projectId={project.id} runs={analyses} />
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
// Exported for the test suite. T003 shipped this button with the caveat that
// nothing proved it reached the endpoint, and the reason was that it could not
// be imported — the component was module-private, so the one control standing
// between a new researcher and a working project was the one control no test
// could touch.
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
