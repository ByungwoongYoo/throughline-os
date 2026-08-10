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
  IconFigures, IconFindings, IconGallery, IconGraph, IconLiterature,
  IconNotebook, IconOverview, IconPatterns, IconReports, IconSearch,
  IconSettings, IconSources,
} from "./icons";

export type Section =
  | "overview" | "sources" | "search"
  | "discover" | "compare" | "patterns" | "connections" | "findings"
  | "analyses" | "graph"
  | "reports" | "figures" | "gallery" | "notebook" | "literature"
  | "datasearch" | "settings";

export type Crumb = { label: string; onClick?: () => void };

const GROUPS: Array<{ label: string; items: Array<{ id: Section; label: string; count?: keyof CountMap }> }> = [
  {
    label: "Research",
    items: [
      { id: "overview", label: "Overview" },
      { id: "sources", label: "Sources", count: "sources" },
      { id: "search", label: "Search" },
      { id: "literature", label: "Find papers" },
      { id: "datasearch", label: "Find data" },
    ],
  },
  {
    label: "Discover",
    items: [
      { id: "discover", label: "Discovery map" },
      { id: "compare", label: "Compare" },
      { id: "patterns", label: "Patterns" },
      { id: "connections", label: "Connections", count: "connections" },
      { id: "findings", label: "Findings", count: "findings" },
      { id: "analyses", label: "Analyses", count: "analyses" },
      { id: "graph", label: "Evidence graph" },
    ],
  },
  {
    label: "Communicate",
    items: [
      { id: "reports", label: "Reports", count: "reports" },
      { id: "figures", label: "Figures", count: "figures" },
      { id: "gallery", label: "Chart primitives" },
      { id: "notebook", label: "Notebook" },
    ],
  },
  {
    label: "This machine",
    items: [
      { id: "settings", label: "Settings" },
    ],
  },
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
  overview: IconOverview, sources: IconSources, search: IconSearch,
  literature: IconLiterature, datasearch: IconData, discover: IconDiscover,
  compare: IconCompare, patterns: IconPatterns, connections: IconConnections,
  findings: IconFindings, analyses: IconAnalyses, graph: IconGraph,
  reports: IconReports, figures: IconFigures, gallery: IconGallery,
  notebook: IconNotebook, settings: IconSettings,
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
