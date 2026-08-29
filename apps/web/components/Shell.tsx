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

import { DragEvent, ReactElement, ReactNode, useCallback, useState } from "react";
import { DiscoveryMap } from "@/lib/api";
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
  | "reports" | "figures" | "gallery" | "notebook" | "journal" | "literature"
  | "datasearch" | "settings";

export type Crumb = { label: string; onClick?: () => void };

const GROUPS: Array<{ label: string; items: Array<{ id: Section; label: string; count?: keyof CountMap }> }> = [
  {
    label: "Research",
    items: [
      /*
       * First, because §4 calls the workboard "the central operating surface
       * of the product" and §109 puts it at Phase 0. It was never built, so
       * every object a project accumulated lived in a list and never in a
       * place.
       */
      { id: "board", label: "Workboard" },
      { id: "overview", label: "Overview" },
      { id: "sources", label: "Sources", count: "sources" },
      /*
       * Beside Sources, because that is what it is about: what the columns of
       * the data mean. Approving a label is also the only way any chart in
       * this system stops being titled `resistance_pct`, and until this screen
       * existed nothing could approve one.
       */
      { id: "variables", label: "Variables" },
      { id: "search", label: "Search" },
      { id: "literature", label: "Find papers" },
      { id: "datasearch", label: "Find data" },
    ],
  },
  {
    label: "Discover",
    items: [
      /*
       * "Discovery", matching the screen. The rail said "Discovery map",
       * which promises a picture; the screen is where a sweep is started and
       * where its candidates are read.
       */
      { id: "discover", label: "Discovery" },
      { id: "compare", label: "Compare" },
      { id: "patterns", label: "Patterns" },
      { id: "connections", label: "Connections", count: "connections" },
      { id: "findings", label: "Findings", count: "findings" },
      { id: "analyses", label: "Analyses", count: "analyses" },
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
      { id: "notebook", label: "Notebook" },
      /*
       * Beside the notebook, because both are writing — but they are not the
       * same view of it. The notebook is pages and links; the journal is
       * everything written in the project in the order it was written,
       * including what a model wrote, which is the only place that can be
       * read across objects rather than one object at a time.
       */
      { id: "journal", label: "Journal" },
    ],
  },
  {
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
      { id: "gallery", label: "Chart primitives" },
      { id: "settings", label: "Settings" },
    ],
  },
];

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
  notebook: IconNotebook,
  // Reuses the notebook glyph: they are the same notes read two ways, and a
  // second glyph would suggest two different kinds of thing.
  journal: IconNotebook,
  settings: IconSettings,
};

export function Shell({
  section, onSection, map, children, inspector, onCommand, projectName, crumbs,
  onDropFiles, projectMenu, accountMenu,
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
        {accountMenu}
      </header>

      <nav className="rail" aria-label="Sections">
        {GROUPS.map((group) => (
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
                <span>{item.label}</span>
                {item.count && counts[item.count] > 0 && (
                  <span className="rail-count">{counts[item.count]}</span>
                )}
              </button>
            ))}

            {/* Real links, because these are separate pages and leaving the
                workspace is what pressing them does. A button that navigated
                would break opening one in a new tab. */}
            {group.label === "This machine" && MACHINE_PAGES.map((page) => (
              <a key={page.href} className="rail-item" href={page.href}
                 title={page.note}>
                <span className="rail-icon" aria-hidden>
                  {IconHand({ size: 16 })}
                </span>
                <span>{page.label}</span>
              </a>
            ))}
          </div>
        ))}
      </nav>

      {/* `key` restarts the enter transition on navigation, so a view change
          reads as a change rather than a silent content swap (§116). */}
      <main className="workspace" key={section}>{children}</main>
      <aside className="inspector" aria-label="Context inspector">{inspector}</aside>

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
