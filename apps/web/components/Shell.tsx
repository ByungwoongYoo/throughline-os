"use client";

/**
 * The application shell (§65, §66).
 *
 *   left   — Research / Discover / Communicate
 *   top    — the global command bar
 *   center — the current workspace
 *   right  — the research copilot and context inspector
 *
 * The rail shows live counts because §70 wants the project's state legible at a
 * glance, and a nav item that never shows a number teaches nothing.
 */

import { ReactNode } from "react";
import { DiscoveryMap } from "@/lib/api";

export type Section =
  | "overview" | "sources" | "search"
  | "discover" | "connections" | "findings" | "analyses" | "graph"
  | "figures";

const GROUPS: Array<{ label: string; items: Array<{ id: Section; label: string; count?: keyof CountMap }> }> = [
  {
    label: "Research",
    items: [
      { id: "overview", label: "Overview" },
      { id: "sources", label: "Sources", count: "sources" },
      { id: "search", label: "Search" },
    ],
  },
  {
    label: "Discover",
    items: [
      { id: "discover", label: "Discovery map" },
      { id: "connections", label: "Connections", count: "connections" },
      { id: "findings", label: "Findings", count: "findings" },
      { id: "analyses", label: "Analyses", count: "analyses" },
      { id: "graph", label: "Evidence graph" },
    ],
  },
  { label: "Communicate", items: [{ id: "figures", label: "Figures", count: "figures" }] },
];

type CountMap = { sources: number; connections: number; findings: number; analyses: number; figures: number };

export function Shell({
  section, onSection, map, children, inspector, onCommand, projectName,
}: {
  section: Section;
  onSection: (s: Section) => void;
  map: DiscoveryMap | null;
  children: ReactNode;
  inspector: ReactNode;
  onCommand: () => void;
  projectName: string;
}) {
  const counts: CountMap = {
    sources: map?.counts.sources ?? 0,
    analyses: map?.counts.analyses ?? 0,
    connections: Object.values(map?.connections ?? {}).reduce((a, b) => a + b, 0),
    findings: Object.values(map?.findings ?? {}).reduce((a, b) => a + b, 0),
    figures: map?.counts.figures ?? 0,
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          Throughline <small>{projectName}</small>
        </div>
        <button className="command" onClick={onCommand} aria-label="Open the command bar">
          Ask, analyze, compare, discover, visualize or create…
          <kbd>⌘K</kbd>
        </button>
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
                <span>{item.label}</span>
                {item.count && counts[item.count] > 0 && (
                  <span className="rail-count">{counts[item.count]}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <main className="workspace">{children}</main>
      <aside className="inspector" aria-label="Context inspector">{inspector}</aside>
    </div>
  );
}
