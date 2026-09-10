"use client";

/**
 * One object, several readings of it.
 *
 * The cockpit reads a single run through five panels — what it found, what was
 * asked for, what was checked, what else was tried, and how to run it again —
 * and they are readings of one thing rather than five places to go. That is
 * what makes tabs right here and wrong for navigation: a tab says "the same
 * object, seen differently", and a link says "somewhere else".
 *
 * Written out rather than reached for from a library because the keyboard
 * contract is the whole of it, and it is short: arrows move between tabs, Home
 * and End jump to the ends, and only the selected tab is in the page's tab
 * order so a keyboard reaches the panel in one press rather than five. A
 * tablist that answers only a mouse is the §30 defect this project has already
 * fixed twice elsewhere.
 *
 * A tab whose panel has nothing to show is still shown, and says so in the
 * panel. Hiding it would make the set of readings depend on the method, so a
 * reader could not tell "this method has no sensitivity family" from "this
 * screen forgot about sensitivity" — and §09 asks for unavailable fields shown
 * honestly rather than removed.
 */

import { useId, useRef, useState, type ReactNode } from "react";

export type Tab = {
  /** Stable across renders; used for the panel's id. */
  id: string;
  label: string;
  /** Rendered only while selected: a panel nobody is reading costs nothing. */
  panel: () => ReactNode;
  /**
   * Shown beside the label. A count, or a word like "none" — anything that
   * lets a reader decide whether a tab is worth opening before opening it.
   */
  note?: string;
};

export function Tabs({ tabs, label, initial }: {
  tabs: Tab[];
  /** Names the tablist for a screen reader: what these are readings OF. */
  label: string;
  initial?: string;
}) {
  const base = useId();
  const [active, setActive] = useState(() => initial ?? tabs[0]?.id ?? "");
  const buttons = useRef<Map<string, HTMLButtonElement>>(new Map());

  const index = Math.max(0, tabs.findIndex((t) => t.id === active));
  const current = tabs[index];

  function move(to: number) {
    const next = tabs[(to + tabs.length) % tabs.length];
    if (!next) return;
    setActive(next.id);
    // Follow-focus: the arrow keys select as they move, which is the pattern
    // for tabs whose panels are cheap to render.
    buttons.current.get(next.id)?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowRight": event.preventDefault(); move(index + 1); break;
      case "ArrowLeft": event.preventDefault(); move(index - 1); break;
      case "Home": event.preventDefault(); move(0); break;
      case "End": event.preventDefault(); move(tabs.length - 1); break;
      default: break;
    }
  }

  return (
    <div className="readings">
      {/* `.tabs` and `.tab` are this stylesheet's own tab-strip convention,
          already defined and — until now — rendered by nothing. Adopting them
          rather than inventing `.tabs-list` keeps one tab strip in the product
          and puts a dead rule back to work. */}
      <div role="tablist" aria-label={label} className="tabs" onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) buttons.current.set(tab.id, el);
                else buttons.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              // Only the selected tab is reachable by Tab; the arrows do the
              // rest. Five stops for one control is what this avoids.
              tabIndex={selected ? 0 : -1}
              className="tab"
              onClick={() => setActive(tab.id)}
            >
              <span>{tab.label}</span>
              {tab.note && <span className="tab-note">{tab.note}</span>}
            </button>
          );
        })}
      </div>

      {current && (
        <div
          role="tabpanel"
          id={`${base}-panel-${current.id}`}
          aria-labelledby={`${base}-tab-${current.id}`}
          className="tab-panel"
          // Focusable so a keyboard can scroll a panel it has just opened.
          tabIndex={0}
        >
          {current.panel()}
        </div>
      )}
    </div>
  );
}
