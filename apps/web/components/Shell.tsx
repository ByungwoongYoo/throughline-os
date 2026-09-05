"use client";

/**
 * The application shell (§65, §66).
 *
 *   left   — Research / Discover / Communicate
 *   top    — breadcrumb and the global command bar
 *   center — the current workspace
 *   right  — the context inspector
 *
 * The rail shows live counts because §70 wants the project's state legible at a
 * glance, and a nav item that never shows a number teaches nothing.
 */

import {
  DragEvent, ReactElement, ReactNode, useCallback, useState, useSyncExternalStore,
} from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { DiscoveryMap } from "@/lib/api";
import {
  INSPECTOR, INSPECTOR_DEFAULT, INSPECTOR_MAX, INSPECTOR_MIN,
  RAIL, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN, WORKSPACE,
  readLayout, writeLayout,
} from "@/lib/layout";
import { ThemeToggle } from "./Theme";
import {
  IconAnalyses, IconCompare, IconConnections, IconData, IconDiscover,
  IconFigures, IconFindings, IconGallery, IconGraph, IconHand, IconLiterature,
  IconNotebook, IconOverview, IconPatterns, IconReports, IconSearch,
  IconSettings, IconSources,
} from "./icons";

export type Section =
  | "board"
  | "overview" | "sources" | "variables" | "search"
  | "discover" | "compare" | "patterns" | "connections" | "findings"
  | "analyses" | "graph" | "embedding"
  | "reports" | "figures" | "gallery" | "notebook" | "journal" | "activity"
  | "literature"
  | "datasearch" | "readfigure" | "settings";

export type Crumb = { label: string; onClick?: () => void };

type RailItem = {
  id: Section; label: string; count?: keyof CountMap;
  /**
   * One clause on what the entry is for, shown beside the label when the rail
   * is wide enough to carry it (see `.rail-note`). Three consecutive one-word
   * labels sharing one glyph — Notebook, Journal, Activity — told a researcher
   * their names and nothing else; the distinction lived in code comments.
   */
  note?: string;
};

/*
 * Five groups. The first four are kinds of screen a researcher uses in the
 * order the work happens — the project itself, gathering, discovering and
 * testing, communicating — and the fifth is this machine. Groups are named,
 * never numbered: only four of the twenty-three sections are destinations of
 * a loop step, and a numbered eyebrow over Compare or the research graph would
 * claim a sequence the screen is not part of. The loop's numbering lives in
 * the step strip, which knows the project's state (T135).
 *
 * "Research" used to hold a canvas, a dashboard, two object lists and four
 * tools under one word. Splitting the two whole-project surfaces out is the
 * only structural change; every id, label, icon, count and within-group order
 * is unchanged, so no address, saved link or palette result changes meaning.
 */
const GROUPS: Array<{ label: string; items: RailItem[] }> = [
  {
    label: "The project",
    items: [
      /*
       * First, because §4 calls the workboard "the central operating surface
       * of the product" and §109 puts it at Phase 0. It was never built, so
       * every object a project accumulated lived in a list and never in a
       * place.
       */
      { id: "board", label: "Workboard" },
      { id: "overview", label: "Overview" },
    ],
  },
  {
    label: "Gather",
    items: [
      { id: "sources", label: "Sources", count: "sources" },
      /*
       * Beside Sources, because that is what it is about: what the columns of
       * the data mean. Approving a label is also the only way any chart in
       * this system stops being titled `resistance_pct`, and until this screen
       * existed nothing could approve one.
       */
      { id: "variables", label: "Variables" },
      /*
       * "Search sources", not "Search", because of the two entries directly
       * below it. Three consecutive search-shaped labels — Search, Find papers,
       * Find data — and only one of them said what it searched, so the bare one
       * read as the general case and the other two as special cases of it. They
       * are not: this one searches the passages already in the project, and the
       * other two go outside it to find things the project does not have. The
       * distinction is have-it versus get-it, and the label now carries it.
       */
      { id: "search", label: "Search sources" },
      { id: "literature", label: "Find papers" },
      { id: "datasearch", label: "Find data" },
      /*
       * Beside "Find data" for the same have-it/get-it reason the comment
       * above gives: this is how a project gets numbers it does not have, out
       * of a paper that printed them as a picture instead of publishing them.
       * It is not under Communicate with "Figures" — that screen *makes* a
       * figure from data, and this one does the opposite.
       */
      { id: "readfigure", label: "Read a figure" },
    ],
  },
  {
    label: "Discover and test",
    items: [
      /*
       * "Discovery", matching the screen. The rail said "Discovery map",
       * which promises a picture; the screen is where a sweep is started and
       * where its candidates are read.
       */
      { id: "discover", label: "Discovery" },
      { id: "compare", label: "Compare" },
      { id: "patterns", label: "Patterns" },
      /*
       * Analyses, then connections, then findings — the order the work
       * actually happens in, and the only group in this rail whose order had
       * no reason attached to it.
       *
       * It read Connections, Findings, Analyses, which puts the producer last:
       * a finding is assembled `from_connections`, and every connection joins
       * to an `analysis_run`. So a researcher scanning the rail met the two
       * things a run produces before the run itself, and the list implied a
       * sequence that runs backwards through its own data model.
       *
       * The three counts make that legible from the rail alone: six analyses
       * behind six connections behind two findings is the shape of honest
       * work, and the same three numbers in the old order said nothing.
       */
      { id: "analyses", label: "Analyses", count: "analyses" },
      { id: "connections", label: "Connections", count: "connections" },
      { id: "findings", label: "Findings", count: "findings" },
      /*
       * "Research graph", which is what the screen has always been titled and
       * what it shows: every object in the project and how they relate.
       *
       * It was labelled "Evidence graph", which collided with a different
       * screen that genuinely is one — the per-finding "why do we believe
       * this", reached by opening a finding. Two surfaces answering different
       * questions under one name, and the one in the rail was not the one the
       * name described.
       */
      { id: "graph", label: "Research graph" },
      { id: "embedding", label: "Embedding space" },
    ],
  },
  {
    label: "Communicate",
    items: [
      { id: "reports", label: "Reports", count: "reports" },
      { id: "figures", label: "Figures", count: "figures" },
      { id: "notebook", label: "Notebook", note: "your pages, and what they link to" },
      /*
       * Beside the notebook, because both are writing — but they are not the
       * same view of it. The notebook is pages and links; the journal is
       * everything written in the project in the order it was written,
       * including what a model wrote, which is the only place that can be
       * read across objects rather than one object at a time.
       */
      { id: "journal", label: "Journal", note: "everything written, in order" },
      /*
       * Beside the journal for the same reason the journal sits beside the
       * notebook, and the distinction is the same one: the journal is
       * everything *written* in the project in the order it was written,
       * this is everything *done* in it in the order it was done.
       *
       * It exists because `audit_log` had nine writers and no readers — a
       * record kept by one part of the system and read by none, which is
       * this repository's named recurring defect at table scale. A route
       * without a screen would have recreated it one layer up.
       */
      { id: "activity", label: "Activity", note: "everything done, in order" },
    ],
  },
  {
    /*
     * Rendered as the rail's pinned footer rather than as its last scrolling
     * group. At 1440×900 the rail has 848 px for about 1,020 px of entries,
     * and what fell off the bottom was this group — Settings, model choice,
     * feature packs, the version, and the three pages that were URL-only
     * until they were filed here. A group that exists to rescue entries from
     * being unreachable must itself stay on screen.
     */
    label: "This machine",
    items: [
      /*
       * Moved out of Communicate, where it sat between Figures and Notebook.
       *
       * It is the one entry in this navigation that is not a step in research:
       * it renders every primitive against illustrative data — no project is
       * involved — so that "it renders" is checkable rather than asserted. That
       * is a real thing to be able to do, and it is the same kind of thing as
       * the two pages already filed here: does the camera see my hands, can I
       * draw in the air, do the charts draw.
       *
       * There is also a smaller argument. The Figures screen chooses a chart
       * from the shape of the data and says why; a gallery invites browsing
       * charts detached from any data, which is the habit §10 warns against.
       * Keeping it away from the figure-making surface keeps the two from
       * reading as alternatives.
       */
      { id: "gallery", label: "Chart primitives", note: "every chart, drawn against illustrative data" },
      { id: "settings", label: "Settings" },
    ],
  },
];

/** The group rendered as the rail's pinned footer. */
const MACHINE = "This machine";

/**
 * Pages that are routes of their own rather than sections of the workspace.
 *
 * Both existed and neither was linked from anywhere — a researcher could only
 * reach them by typing the URL, so the largest and most carefully built part of
 * this codebase was, in practice, unreachable from the product.
 *
 * They sit under "This machine" rather than in the research groups because
 * that is what they are: one asks whether hand tracking works on this camera in
 * this room, the other is where drawing in the air can be tried. Neither is a
 * step in a piece of research, and filing them between Findings and Reports
 * would say they were.
 *
 * The spatial catalogue was a third instance of the same defect, found by a
 * guard that now walks from the landing page and reports anything nobody can
 * click to. It belongs here on the same reasoning as the other two: it draws
 * every catalogued chart against generated shapes so that "this renders" is
 * checkable rather than asserted, and no project is involved. It is
 * deliberately not filed beside Figures — the Figures screen chooses a chart
 * from the shape of the data and says why, and a browsable catalogue sitting
 * next to it would read as an alternative way of choosing, which is the habit
 * §10 exists to discourage.
 */
const MACHINE_PAGES: Array<{ href: string; label: string; note: string }> = [
  { href: "/charts-3d", label: "Spatial charts",
    note: "Every catalogued chart, drawn — and what each one cannot show" },
  { href: "/gesture-check", label: "Check hand tracking",
    note: "Does the camera see your hands, and how quickly" },
  { href: "/air-ink", label: "Draw in the air",
    note: "Marking up a figure by hand" },
];

/** Flattened for the command palette, which needs the group name too. */
export const SECTIONS = GROUPS.flatMap((g) =>
  g.items.map((i) => ({ id: i.id, label: i.label, group: g.label })));

/**
 * The three machine pages, for the command palette (plan §4.3.6).
 *
 * Deliberately a second export rather than three more rows in `SECTIONS`, and
 * the reason is what a caller has to *do* with one. A section is a view of
 * this page, reached by calling `onSection`; these are routes of their own,
 * reached by a real page load. Folding them together would hand the palette a
 * list whose entries need two different mechanisms and no way to tell which —
 * and `tests/rail-follows-the-work.test.ts` reads `SECTIONS` as the rail's own
 * order and asserts that no id in it is `charts-3d`, which is right to.
 *
 * The rail already links to all three (`MACHINE_PAGES`, and the links are real
 * `<a>`s so a new tab still works). This is the second door: 26 rail rows do
 * not fit 848 px, and somebody who reaches for ⌘K should not have to know
 * which of them scrolled off the bottom.
 */
export const PAGES: Array<{ href: string; label: string; group: string }> =
  MACHINE_PAGES.map((page) => ({
    href: page.href, label: page.label, group: MACHINE,
  }));

type CountMap = { sources: number; connections: number; findings: number;
                  analyses: number; figures: number; reports: number };

/**
 * One icon per section.
 *
 * Kept in a map beside the groups rather than on each item so that a section
 * added without an icon is a visible gap here rather than a silently
 * unillustrated row in the rail.
 */
const ICONS: Record<Section, (p: { size?: number }) => ReactElement> = {
  board: IconGallery, overview: IconOverview, sources: IconSources,
  // Reuses the sources glyph: variables are what the sources turned out to
  // contain, and a second glyph for the same idea makes a sidebar harder to
  // scan rather than easier.
  variables: IconSources,
  search: IconSearch,
  literature: IconLiterature, datasearch: IconData, discover: IconDiscover,
  compare: IconCompare, patterns: IconPatterns, connections: IconConnections,
  findings: IconFindings, analyses: IconAnalyses, graph: IconGraph,
  // Reuses the graph icon: both are 'the corpus as a shape', and inventing
  // a second glyph for the same idea makes a sidebar harder to scan.
  embedding: IconGraph,
  reports: IconReports, figures: IconFigures, gallery: IconGallery,
  // Reuses the figures glyph, and the reuse is the argument: this screen and
  // that one operate on the same object from opposite directions — one draws a
  // chart from data, this one recovers data from a chart. A different glyph
  // would imply a different kind of thing.
  readfigure: IconFigures,
  notebook: IconNotebook,
  // Reuses the notebook glyph: they are the same notes read two ways, and a
  // second glyph would suggest two different kinds of thing.
  journal: IconNotebook,
  // Reuses the journal glyph: both are the project's own record read in
  // order — one of what was written, one of what was done — and a second
  // glyph for the same idea makes a sidebar harder to scan, which is the
  // reasoning `variables` already follows above.
  activity: IconNotebook,
  settings: IconSettings,
};

/**
 * Whether there is room for the context panel at all.
 *
 * §117 is desktop-first, and below 1100px the inspector is dropped rather than
 * crushed — the same threshold the stylesheet used when this was a CSS grid.
 * It has to be answered in JavaScript now, because a flex panel that is hidden
 * with CSS still holds its share of the width.
 *
 * `useSyncExternalStore` rather than `useEffect`, so React reads the real
 * viewport on the first client render instead of painting the desktop layout
 * and correcting it a frame later. The server snapshot is `true` because the
 * export is prerendered with no viewport to measure, and desktop-first is the
 * documented default.
 */
const WIDE = "(min-width: 1101px)";

function useRoomForInspector(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined") return () => {};
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

export function Shell({
  section, onSection, map, children, inspector, onCommand, projectName, crumbs,
  onDropFiles, projectMenu, accountMenu, strip,
}: {
  section: Section;
  onSection: (s: Section) => void;
  map: DiscoveryMap | null;
  children: ReactNode;
  inspector: ReactNode;
  onCommand: () => void;
  projectName: string;
  crumbs: Crumb[];
  onDropFiles: (files: FileList) => void;
  /** The project switcher. Rendered here so the topbar owns its layout. */
  projectMenu?: ReactNode;
  accountMenu?: ReactNode;
  /**
   * The step strip (`StepStrip`), rendered above the workspace's scroll
   * region so the loop's next action cannot be scrolled out of sight.
   */
  strip?: ReactNode;
}) {
  const counts: CountMap = {
    sources: map?.counts.sources ?? 0,
    analyses: map?.counts.analyses ?? 0,
    connections: Object.values(map?.connections ?? {}).reduce((a, b) => a + b, 0),
    findings: Object.values(map?.findings ?? {}).reduce((a, b) => a + b, 0),
    figures: map?.counts.figures ?? 0,
    reports: map?.counts.reports ?? 0,
  };

  /*
   * Drop anywhere.
   *
   * dragenter/dragleave fire for every child element the cursor crosses, so a
   * boolean flag flickers the overlay off the moment you move over the table
   * inside it. Counting enter/leave pairs is the standard fix.
   */
  const [depth, setDepth] = useState(0);

  const hasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const onDragEnter = useCallback((event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDepth((d) => d + 1);
  }, []);

  const onDragLeave = useCallback((event: DragEvent) => {
    if (!hasFiles(event)) return;
    setDepth((d) => Math.max(0, d - 1));
  }, []);

  const onDrop = useCallback((event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDepth(0);
    if (event.dataTransfer.files.length) onDropFiles(event.dataTransfer.files);
  }, [onDropFiles]);

  const roomForInspector = useRoomForInspector();
  // Read once per mount rather than on every render: this is the value the
  // Group starts from, and re-reading it while dragging would fight the drag.
  const [saved] = useState(readLayout);

  const renderGroup = (group: { label: string; items: RailItem[] }) => (
    <div className="rail-group" key={group.label}>
      <span className="eyebrow">{group.label}</span>
      {group.items.map((item) => (
        <button
          key={item.id}
          className="rail-item"
          aria-current={section === item.id}
          onClick={() => onSection(item.id)}
        >
          {/* Decorative: the label beside it is the accessible name. */}
          <span className="rail-icon" aria-hidden>
            {ICONS[item.id]?.({ size: 16 })}
          </span>
          <span>
            {item.label}
            {item.note && <small className="rail-note">{item.note}</small>}
          </span>
          {item.count && counts[item.count] > 0 && (
            <span className="rail-count">{counts[item.count]}</span>
          )}
        </button>
      ))}

      {/* Real links, because these are separate pages and leaving the
          workspace is what pressing them does. A button that navigated
          would break opening one in a new tab. */}
      {group.label === MACHINE && MACHINE_PAGES.map((page) => (
        <a key={page.href} className="rail-item" href={page.href}
           title={page.note}>
          <span className="rail-icon" aria-hidden>
            {IconHand({ size: 16 })}
          </span>
          <span>
            {page.label}
            <small className="rail-note">{page.note}</small>
          </span>
        </a>
      ))}
    </div>
  );

  return (
    <div
      className="shell"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDrop={onDrop}
    >
      <header className="topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          <span className="brand-mark" aria-hidden />
          {projectMenu ?? <span className="crumb-root">{projectName}</span>}
          {crumbs.map((crumb, i) => (
            <span key={i} className="crumb">
              <i aria-hidden>/</i>
              {crumb.onClick
                ? <button onClick={crumb.onClick}>{crumb.label}</button>
                : <b aria-current="page">{crumb.label}</b>}
            </span>
          ))}
        </nav>
        <button className="command" onClick={onCommand} aria-label="Open the command bar">
          <span>Jump to anything</span>
          <kbd>⌘K</kbd>
        </button>
        {/* Next to the command bar rather than buried in Settings: the reason
            to reach for it is usually "I am about to export a figure and
            exports render light", which is a ten-second errand. */}
        <ThemeToggle />
        {/*
          The account menu keeps its three items — the identity readout, the
          local-only reassurance and sign out — behind the menu, and that is a
          **stated exception** to "nothing is hidden" rather than an oversight
          (plan §6, §4.16.2).

          Two reasons, and both are about what the items are. They are
          properties of the *session*, not of a research object, so the
          placement law — an action lives on the object that produced it — has
          no object to put them on; there is no source, connection or finding
          that "sign out" acts upon. And a sign-out control sitting permanently
          in the topbar is a hazard, not a capability: the only thing a
          persistent one can do to a researcher three hours into an analysis is
          end their session by accident.

          "New project" went the other way for the opposite reason — it acts on
          the project, which is the object the topbar is already naming, so it
          is now a visible button beside the name (`ProjectMenu.tsx`). An
          omission that is argued is not a hidden capability; this comment is
          the argument, and `librarynote.tsx:92-97` is the template for it.
        */}
        {accountMenu}
      </header>

      <Group
        className="shell-panels"
        orientation="horizontal"
        defaultLayout={saved}
        onLayoutChanged={writeLayout}
      >
      <Panel id={RAIL} className="rail-panel"
             defaultSize={RAIL_DEFAULT} minSize={RAIL_MIN} maxSize={RAIL_MAX}>
      {/*
        Two navs, not one. The first scrolls; the second is pinned. The obvious
        alternative — `margin-top: auto` on the last group — is inert while
        `.rail` is a block, and resolves to zero the moment a flex column
        overflows, which is the only case that matters. A sibling outside the
        scroll region is the mechanism that actually holds.
      */}
      <nav className="rail" aria-label="Sections">
        {GROUPS.filter((group) => group.label !== MACHINE).map(renderGroup)}
      </nav>
      <nav className="rail-footer" aria-label={MACHINE}>
        {GROUPS.filter((group) => group.label === MACHINE).map(renderGroup)}
      </nav>

      </Panel>

      {/* Named so a screen reader hears what is being resized, not "separator".
          The library gives it `role="separator"` with the value semantics; the
          label is ours because only we know what sits on either side. */}
      <Separator className="shell-divider" aria-label="Resize the navigation" />

      <Panel id={WORKSPACE} className="workspace-panel" minSize={320}>
        {strip}
        {/* `key` restarts the enter transition on navigation, so a view change
            reads as a change rather than a silent content swap (§116). */}
        <main className="workspace" key={section}>{children}</main>
      </Panel>

      {/*
        §117 is desktop-first: below 1100px the inspector is dropped rather
        than crushed. That used to be `display: none` in a media query, which a
        flex-based panel group cannot use — a hidden panel leaves its share of
        the width behind as empty space. So the panel is not rendered at all,
        and the divider with it, which is also the honest version: a divider
        that resizes nothing is a control that lies.
      */}
      {roomForInspector && (
        <>
          <Separator className="shell-divider" aria-label="Resize the context panel" />
          <Panel id={INSPECTOR} className="inspector-panel"
                 defaultSize={INSPECTOR_DEFAULT}
                 minSize={INSPECTOR_MIN} maxSize={INSPECTOR_MAX}>
            <aside className="inspector" aria-label="Context inspector">{inspector}</aside>
          </Panel>
        </>
      )}
      </Group>

      {depth > 0 && (
        <div className="dropzone" aria-hidden>
          <div className="dropzone-card">
            <strong>Drop to add sources</strong>
            <span>PDF, DOCX, TXT, MD, CSV, TSV, XLSX or JSON</span>
          </div>
        </div>
      )}
    </div>
  );
}
