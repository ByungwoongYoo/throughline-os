"use client";

/**
 * The command bar (§69), as far as it can honestly go without a model provider.
 *
 * §69 wants natural-language intent parsing — "compare the two cohorts" resolving
 * to an analysis. That needs a model, and there isn't one configured, so this
 * does not pretend to. What it *does* do is real: everything in the project is
 * reachable by name in two keystrokes, and the palette says plainly at the
 * bottom that intent parsing is not available yet (§123).
 *
 * The value is navigational, and it is not small. A researcher with forty
 * connections should never scroll a table to find `resistance_pct`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Connection, Finding, Source } from "@/lib/api";
import { Section } from "./Shell";

export type Command = {
  id: string;
  label: string;
  /** Where it lives — shown right-aligned so the list reads as a map. */
  group: string;
  hint?: string;
  run: () => void;
};

/**
 * Subsequence match, the same rule editors use: the typed letters must appear in
 * order but need not be adjacent, so `rsp` finds `resistance_pct`. Returns a
 * score (lower is better) or null for no match.
 */
function fuzzy(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const direct = t.indexOf(q);
  // A contiguous run always beats a scattered one, and matching at a word
  // boundary beats matching mid-word.
  if (direct >= 0) return direct === 0 ? 0 : /[\s_×·/-]/.test(t[direct - 1] ?? "") ? 1 : 2 + direct;

  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const next = t.indexOf(ch, ti);
    if (next < 0) return null;
    gaps += next - ti;
    ti = next + 1;
  }
  return 40 + gaps;
}

/** Score every command against the query and return the survivors, best first. */
function rank(commands: Command[], query: string): Command[] {
  return commands
    .map((c) => ({ c, score: fuzzy(query, `${c.label} ${c.group}`) }))
    .filter((m): m is { c: Command; score: number } => m.score !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, 40)
    .map((m) => m.c);
}

export function CommandPalette({ open, onClose, commands }: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  /*
   * The query, kept in a ref that is written synchronously wherever it changes.
   *
   * Neither React state nor the DOM input value is trustworthy at the instant a
   * key is handled: state has not committed yet, and the input is controlled so
   * its value only catches up on commit. Typing "findings" and pressing Enter in
   * the same frame therefore ran the command list as it stood before any typing
   * — return opened Overview. This ref is the one thing that is correct
   * immediately, so every keyboard decision reads it.
   */
  const queryRef = useRef("");
  const setQueryNow = useCallback((next: string) => {
    queryRef.current = next;
    setQuery(next);
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => rank(commands, query), [commands, query]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    setQueryNow("");
    setActive(0);
    // Focus immediately, and again after paint. The first call covers the
    // normal case; the retry covers the window in which the element exists but
    // the document has not settled.
    inputRef.current?.focus({ preventScroll: true });
    const raf = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [open, setQueryNow]);

  /*
   * Navigation keys are handled on the document, not on the input.
   *
   * Binding them to the input assumes focus landed there, and focus is not
   * guaranteed — an unfocused document, a browser that defers it, an extension
   * that steals it. When that assumption failed, arrow keys and Enter silently
   * did nothing, which is the worst possible failure for a keyboard surface:
   * the palette looked fine and simply ignored you. The document always gets
   * the event.
   */
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      // Wrap against the live list for the same reason Enter does.
      const count = rank(commands, queryRef.current).length;
      if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
        event.preventDefault();
        setActive((i) => (count ? (i + 1) % count : 0));
        return;
      }
      if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
        event.preventDefault();
        setActive((i) => (count ? (i - 1 + count) % count : 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        /*
         * Rank against the input's live value, not against `matches`.
         *
         * React rebinds this listener only after a commit, so typing and
         * pressing Enter within the same frame — which is simply how fast
         * people type — ran the command list from *before* the keystrokes.
         * Typing "findings" and hitting return opened Overview. The DOM value
         * is the truth at the moment the key is pressed; nothing else is.
         */
        const live = rank(commands, queryRef.current);
        const chosen = live[Math.min(active, live.length - 1)];
        if (chosen) { onClose(); chosen.run(); }
        return;
      }

      // If focus never reached the input, typing would otherwise vanish. Route
      // printable characters into the query and pull focus back, so the palette
      // is usable even when the browser declined to focus it.
      if (document.activeElement === inputRef.current) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Backspace") {
        event.preventDefault();
        setQueryNow(queryRef.current.slice(0, -1));
        inputRef.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        setQueryNow(queryRef.current + event.key);
        inputRef.current?.focus({ preventScroll: true });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // Rebinding on every change of `matches`/`active` is deliberate. Reading
    // them through refs instead looks cheaper and is how this was written
    // first, but the listener then acted on whatever the refs held at the last
    // commit it happened to observe — Enter opened the first unfiltered command
    // rather than the highlighted one. Correctness over a saved rebind.
  }, [open, onClose, commands, active, setQueryNow]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command bar"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(e) => setQueryNow(e.target.value)}
          placeholder="Jump to a source, connection, finding or section…"
          aria-label="Search the project"
          aria-controls="palette-list"
          aria-activedescendant={matches[active] ? `cmd-${matches[active].id}` : undefined}
        />

        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {matches.length === 0 && (
            <div className="palette-none">
              Nothing in this project matches “{query}”.
            </div>
          )}
          {matches.map((command, index) => (
            <div
              key={command.id}
              id={`cmd-${command.id}`}
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              className="palette-row"
              onMouseEnter={() => setActive(index)}
              onClick={() => { onClose(); command.run(); }}
            >
              <span className="palette-label">
                {command.label}
                {command.hint && <em>{command.hint}</em>}
              </span>
              <span className="palette-group">{command.group}</span>
            </div>
          ))}
        </div>

        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> close</span>
          <span>Navigation only — asking questions in words needs a model provider.</span>
        </div>
      </div>
    </div>
  );
}

/** Builds the palette contents from the project's actual state. */
export function buildCommands({ sections, sources, connections, findings, go, open,
                                labels = {} }: {
  sections: Array<{ id: Section; label: string; group: string }>;
  /** Approved display names. A palette full of raw columns is unsearchable. */
  labels?: Record<string, string>;
  sources: Source[];
  connections: Connection[];
  findings: Finding[];
  go: (section: Section) => void;
  open: (section: Section, kind: string, id: string) => void;
}): Command[] {
  return [
    ...sections.map((s) => ({
      id: `s:${s.id}`, label: s.label, group: s.group, run: () => go(s.id),
    })),
    ...sources.map((s) => ({
      id: `src:${s.id}`,
      label: s.title,
      group: "Source",
      hint: s.dataset
        ? `${s.dataset.row_count} rows`
        : s.paper
          ? `${s.paper.page_count} pages`
          : s.ingestion_status,
      run: () => open("sources", "source", s.id),
    })),
    ...connections.map((c) => ({
      id: `con:${c.id}`,
      label: `${labels[c.left_variable] ?? c.left_variable} × `
           + `${labels[c.right_variable] ?? c.right_variable}`,
      group: "Connection",
      hint: c.lifecycle_status,
      run: () => open("connections", "connection", c.id),
    })),
    ...findings.map((f) => ({
      id: `fin:${f.id}`,
      label: f.title,
      group: "Finding",
      hint: f.lifecycle_status,
      run: () => open("findings", "finding", f.id),
    })),
  ];
}
