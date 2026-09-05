"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnalysisRunRow, ArtifactSummary, Capabilities, Connection, DiscoveryMap,
  Finding, Project, Source, api,
} from "@/lib/api";
import { useApi } from "@/lib/useApi";
import {
  DEFAULT_SECTION, Place, placeFromSearch, projectFromSearch, searchForPlace,
  searchForProject,
} from "@/lib/section-url";
import {
  Kind, lastProject, placeFor, rememberProject, selectionAt,
} from "@/lib/place";
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
import { ReadFigure } from "@/components/readfigure";
import { enterScreen, reportView } from "@/lib/view-context";
import { Compare } from "@/components/compare";
import { Patterns } from "@/components/patterns";
import { Board } from "@/components/board/Board";
import { Literature } from "@/components/literature";
import { ProjectActivity } from "@/components/activity";
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
import {
  ProvenanceLogLink, ReproductionScriptLink,
} from "@/components/provenancelog";
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

/**
 * How often the project's counts are re-read while something is running.
 *
 * Only while: the discovery map says how many workflow runs are still in
 * flight, and the interval exists for exactly as long as that is not zero. A
 * workspace left open overnight makes no requests.
 */
const REFRESH_WHILE_BUSY_MS = 2500;

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

  /*
   * Where the researcher is, read from the address bar rather than merely
   * mirrored into it — and all three parts of it, not one (D196).
   *
   * The section alone was put in the URL by T108, and four ordinary things
   * started working: the view could be linked to, a reload kept the screen,
   * reopening the app did too, and Back went back one section. But a section
   * is not a place. `?section=findings` named a screen in whichever project
   * happened to be newest, so a reload from deep inside one project landed
   * in another; and the finding that was open was not in the address at all,
   * so Back from a detail left the section instead of closing the detail.
   *
   * So the address carries the project, the section and the item. Which
   * project, in order of authority: the one the address names; failing that,
   * the one this account had open last on this browser; failing that, the
   * newest — and the list is the arbiter of all three, because an id from a
   * bookmark or from storage may belong to a project that was deleted, or to
   * a different account on the same machine.
   *
   * Initialised from `window.location` inside the initialiser rather than in
   * an effect, so a deep link renders its own place on the first paint
   * instead of showing Overview and then replacing it — a flash that reads as
   * the link having failed.
   */
  const [place, setPlaceState] = useState<Place>(() =>
    typeof window === "undefined"
      ? { section: DEFAULT_SECTION, item: null }
      : placeFromSearch(window.location.search));
  const [projectId, setProjectIdState] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : projectFromSearch(window.location.search) ?? lastProject(user.id));

  // Read by callbacks that must see the current value without being
  // recreated on every navigation.
  const placeRef = useRef(place);
  placeRef.current = place;
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  const project = projects.data?.find((p) => p.id === projectId) ?? null;
  const activeId = project?.id ?? null;

  /**
   * Move to a place, leaving a history entry behind.
   *
   * `pushState`, so Back goes back one step — one section, or from a detail
   * to its list. `replaceState` would fix the link and the reload and leave
   * Back doing what it did before, which was the complaint that started this.
   * The project goes into the address on every navigation, so that anything
   * copied or reloaded from here on comes back to the same project.
   */
  const go = useCallback((next: Place, options: { project?: string; replace?: boolean } = {}) => {
    setPlaceState(next);
    if (typeof window === "undefined") return;
    const search = searchForProject(
      options.project ?? projectRef.current,
      searchForPlace(next, window.location.search));
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    if (options.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }, []);

  /**
   * Open a thing of a kind, in the section that shows it (D195).
   *
   * This is the one rule every in-view link follows now. Before, a link set
   * the selection and left the section alone, and because each section renders
   * a detail only for its own kind, the finding's "computations behind it"
   * showed the Findings *list* with a run id in the breadcrumb, and recording a
   * finding from a connection left the researcher on the Connections list,
   * never seeing what they had just made.
   */
  const open = useCallback((kind: Kind, id: string, options: { replace?: boolean } = {}) => {
    go(placeFor(kind, id, placeRef.current.section), options);
  }, [go]);

  /** Switch project: a different project is a different place, so it starts at the front. */
  const chooseProject = useCallback((id: string) => {
    setProjectIdState(id);
    go({ section: DEFAULT_SECTION, item: null }, { project: id });
  }, [go]);

  /**
   * Take up a project that was just made — by the form or the worked example —
   * and open it. The row goes into the list at once so the shell can render it
   * before the refetch lands; the refetch then replaces the whole list with the
   * server's, which is the copy that counts.
   */
  const adopt = useCallback((created: Project) => {
    projects.setData([created, ...(projects.data ?? []).filter((p) => p.id !== created.id)]);
    setCreating(false);
    chooseProject(created.id);
    projects.reload();
  }, [projects, chooseProject]);

  /*
   * The list is the arbiter of which project is open.
   *
   * An id from the address or from storage may name a project that was
   * deleted, or one that belongs to another account on this machine. Either
   * way the newest project is the honest fallback — and if the *address* was
   * the source of the bad id, it is corrected in place, so a reload does not
   * repeat the same wrong turn.
   */
  useEffect(() => {
    const list = projects.data;
    if (!list?.length || project) return;
    setProjectIdState(list[0].id);
    if (typeof window !== "undefined" && projectFromSearch(window.location.search)) {
      const search = searchForProject(list[0].id, window.location.search);
      window.history.replaceState(null, "",
        `${window.location.pathname}${search}${window.location.hash}`);
    }
  }, [projects.data, project]);

  // Remembered per account, so opening the app fresh comes back here.
  useEffect(() => {
    if (activeId) rememberProject(user.id, activeId);
  }, [activeId, user.id]);

  /*
   * Back and Forward move between places rather than out of the product.
   *
   * `popstate` is the only signal for this: the browser changes the URL
   * without React hearing about it, so without this the address bar and the
   * screen disagree after a single Back — which is worse than not supporting
   * it at all, because the URL then lies about what is shown.
   */
  useEffect(() => {
    const onPop = () => {
      setPlaceState(placeFromSearch(window.location.search));
      const named = projectFromSearch(window.location.search);
      if (named) setProjectIdState(named);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const section = place.section;
  const selection = selectionAt(place);

  /*
   * §36. The assistant is told which screen the question was asked from, and
   * anything that screen reports about what it is showing. Announced on every
   * change so that leaving a screen withdraws its filters and counts — stale
   * context is worse than none, because it makes a true answer false by
   * qualifying it with a filter nobody has in force any more.
   */
  useEffect(() => { enterScreen(section); }, [section]);
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

  /*
   * Re-read on every navigation (the `[section]` dependency), because these
   * are what the rail's counts, the Overview's meters and the breadcrumbs are
   * drawn from, and a researcher looks at those precisely when they arrive
   * somewhere. Fetched once per project, they went stale the moment anything
   * happened in the background (D194): the worked example finished building
   * in seconds while the screen kept saying nothing had.
   */
  const map = useApi<DiscoveryMap>(
    activeId ? `/api/projects/${activeId}/discovery-map` : null, [section]);
  const sources = useApi<Source[]>(
    activeId ? `/api/projects/${activeId}/sources` : null, [section]);
  /*
   * Every analysis in the project, not only the ones discovery turned into a
   * connection. The Figures screen draws a run, and a run a researcher
   * specified belongs to no connection.
   */
  const analyses = useApi<AnalysisRunRow[]>(
    activeId ? `/api/projects/${activeId}/analyses?limit=200` : null, [section]);
  const connections = useApi<Connection[]>(
    activeId ? `/api/projects/${activeId}/connections?limit=200` : null, [section]);
  const findings = useApi<Finding[]>(
    activeId ? `/api/projects/${activeId}/findings` : null, [section]);
  // Approved display names, so breadcrumbs and the palette never show a raw
  // column name either (Part C: zero raw names outside the mapping screen).
  const variables = useApi<{ labels: Record<string, string> }>(
    activeId ? `/api/projects/${activeId}/variables` : null);
  const artifacts = useApi<ArtifactSummary[]>(
    activeId ? `/api/projects/${activeId}/artifacts` : null);

  /*
   * While the project has work in flight, keep the counts current; the moment
   * it finishes, re-read the lists the work will have changed.
   *
   * The server says how many workflow runs are still queued or running
   * (`counts.in_flight`), so this polls for exactly as long as that is true
   * and not a second longer — the alternative, guessing a duration, is how a
   * screen ends up either stale or hammering a local API forever. The lists
   * are refreshed once, on the transition to idle, because that is when the
   * analyses, connections and findings the run produced have all landed.
   */
  const inFlight = map.data?.counts.in_flight ?? 0;
  const wasBusy = useRef(false);
  const { reload: reloadMap } = map;
  const { reload: reloadSources } = sources;
  const { reload: reloadAnalyses } = analyses;
  const { reload: reloadConnections } = connections;
  const { reload: reloadFindings } = findings;
  useEffect(() => {
    if (inFlight > 0) {
      wasBusy.current = true;
      const timer = window.setInterval(reloadMap, REFRESH_WHILE_BUSY_MS);
      return () => window.clearInterval(timer);
    }
    if (wasBusy.current) {
      wasBusy.current = false;
      reloadSources(); reloadAnalyses(); reloadConnections(); reloadFindings();
    }
    return undefined;
  }, [inFlight, reloadMap, reloadSources, reloadAnalyses, reloadConnections, reloadFindings]);

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
        const current = placeRef.current;
        if (current.item) go({ section: current.section, item: null });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, go]);

  const upload = useCallback(async (files: FileList | null) => {
    if (!files?.length || !activeId) return;
    setUploading(true);
    setUploadError(null);
    go({ section: "sources", item: null });
    try {
      for (const file of Array.from(files)) {
        await api.upload(`/api/projects/${activeId}/sources`, file);
      }
      reloadSources();
      reloadMap();
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploading(false);
    }
  }, [activeId, go, reloadSources, reloadMap]);

  // `!projects.data`, not `loading` alone: the list is refetched after a
  // project is created or deleted, and a refetch must not blank the screen
  // that is already showing the rest of the workspace.
  if (projects.loading && !projects.data) {
    return <Centered><Loading rows={3} label="Loading projects" /></Centered>;
  }
  if (projects.error) return <Centered><Failure error={projects.error} retry={projects.reload} /></Centered>;
  if (!projects.data?.length) {
    return <FirstProject onCreated={adopt} user={user} />;
  }
  if (creating) {
    return <NewProject onCreated={adopt} onCancel={() => setCreating(false)}
                       offerExample />;
  }
  if (!project) return <Centered><Loading rows={2} /></Centered>;

  function select(kind: Kind) {
    return (id: string) => open(kind, id);
  }

  function goSection(next: Section) {
    go({ section: next, item: null });
  }

  // The breadcrumb is what makes a detail view escapable by mouse, and what
  // tells the researcher where a palette jump just landed them.
  const crumbs: Crumb[] = [{
    label: SECTION_LABEL[section],
    onClick: selection ? () => go({ section, item: null }) : undefined,
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
              : selection.kind === "analysis"
                // The method, as the detail's own heading spells it; a run id
                // in a breadcrumb tells the researcher nothing about where
                // they are.
                ? analyses.data?.find((a) => a.id === selection.id)?.method
                    .replace(/_/g, " ")
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
    open: (target, _kind, id) => go({ section: target, item: id }),
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
            currentId={project.id}
            onSelect={chooseProject}
            onChanged={() => {
              // The deleted project may be the one on screen. Refetch, and let
              // the effect above pick the first survivor.
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
                                  onRecordFinding={(id) => { reloadFindings(); open("finding", id); }} />
            : <Discover
                projectId={project.id} sources={sources}
                onSelectConnection={select("connection")}
                startWith={pendingDiscovery} onStarted={() => setPendingDiscovery(null)}
              />
        )}
        {section === "connections" && (
          selection?.kind === "connection"
            ? <ConnectionDetail connectionId={selection.id} projectId={project.id}
                                  onRecordFinding={(id) => { reloadFindings(); open("finding", id); }} />
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
                  §75. The evidence graph says why we believe it; this is what
                  somebody else would need to get the number again.
                */}
                <ProvenanceLogLink findingId={selection.id} />
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
                  §75. Beside the run, because "how was this computed" is
                  asked while looking at the number.
                */}
                <ReproductionScriptLink runId={selection.id} />
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
                             onOpen={select("analysis")} />
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
          /*
           * An entry is about a research object, and the place that shows one
           * is the research graph, with the object's own journal open beside
           * it. This used to hand the id to the analysis detail, which reads
           * run ids, and to leave the section on Journal — so the link changed
           * the breadcrumb and nothing else (D195).
           */
          <Journal projectId={project.id} onOpenObject={select("object")} />
        )}
        {section === "activity" && <ProjectActivity projectId={project.id} />}
        {section === "settings" && <Settings />}
        {section === "graph" && (
          /*
           * `replace`, not push: a graph is browsed by clicking node after
           * node, and a history entry per node would make Back walk through
           * every one of them before it left the screen. The address still
           * names the open object, so a reload or a copied link comes back to
           * it.
           */
          <GraphView projectId={project.id}
                     focus={selection?.kind === "object" ? selection.id : null}
                     onSelect={(id) => open("object", id, { replace: true })} />
        )}
        {section === "embedding" && <EmbeddingSpace projectId={project.id} />}
        {section === "gallery" && <Gallery />}
        {section === "datasearch" && <DataSearch />}
        {section === "readfigure" && <ReadFigure projectId={project.id} />}

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
  /*
   * The list is capped at two hundred, and a cap miscounts in exactly the way
   * a filter does: a project with four hundred connections shows two hundred,
   * and an assistant told "two hundred connections" will say the project found
   * two hundred. The total is deliberately not reported, because this screen
   * does not know it — the domain says so in those words rather than inventing
   * a denominator.
   */
  useEffect(() => {
    if (data) reportView({ showing: data.length });
  }, [data]);
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
