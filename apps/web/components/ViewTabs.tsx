"use client";

/**
 * One strip of view choices, and the panel it controls.
 *
 * Four screens had written this by hand — `compare`, `patterns`, `notebook`
 * and `notegraph` — in markup that was identical down to the class names, and
 * all four were wrong in the same two ways.
 *
 * **They declared `role="tablist"` and answered no arrow key.** That role is a
 * promise: a screen reader announces "tab, 2 of 5" and the arrow keys are then
 * expected to move between them, with only the selected tab in the tab order.
 * None of the four handled an arrow, and every tab was separately tabbable — so
 * a keyboard user heard a widget that does not behave like the widget they were
 * told about, and had to Tab through six choices to reach the content.
 *
 * **Nothing was a tab panel.** No `role="tabpanel"`, no `aria-controls`, no
 * `aria-labelledby`. A tab that controls nothing is only half the pattern: the
 * relationship between the choice and what it changes existed on screen and
 * nowhere in the accessibility tree.
 *
 * Built here rather than taken from a library, and that is a departure from the
 * switcher, which is now Radix. The reason is what each pattern costs. A menu
 * is genuinely hard — typeahead, portalling, collision, dismissal, focus
 * return — and hand-rolling it is what produced the bugs Radix fixed. A tab
 * strip is a roving tabindex and four keys, it has no popup and no focus to
 * restore, and Radix's own Tabs would impose a Root/List/Trigger/Content shape
 * on four call sites whose content is not structured as panels. The rule this
 * follows: delegate what is hard to get right, keep what is small enough to
 * read in one sitting.
 *
 * **Selection follows focus.** For a strip this small, with the panel already
 * rendered, arrowing to a tab and having to press Enter to see it is friction
 * with nothing behind it — and it is what the mouse already does on click.
 */

import { useRef } from "react";

/** A stable pair of ids, so a tab and its panel can point at each other. */
const tabId = (name: string, value: string) => `${name}-tab-${value}`;
const panelId = (name: string, value: string) => `${name}-panel-${value}`;

export function ViewTabs<T extends string>({
  name, label, value, onChange, options,
}: {
  /** Distinguishes this strip's ids from any other on the page. */
  name: string;
  /** What the choice is about, for anyone who cannot see the strip. */
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}) {
  const strip = useRef<HTMLDivElement>(null);

  function move(to: number) {
    const next = options[to];
    if (!next) return;
    onChange(next[0]);
    // Focus follows the selection, or the arrow key moves the highlight and
    // leaves focus behind — after which the next arrow key starts over from
    // wherever focus actually was.
    strip.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(name, next[0]))}`)
      ?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const at = options.findIndex(([id]) => id === value);
    if (at < 0) return;

    switch (event.key) {
      // Wrapping, because a strip that dead-ends at either end reads as broken
      // — the same choice the command bar makes for its list.
      case "ArrowRight": move((at + 1) % options.length); break;
      case "ArrowLeft": move((at - 1 + options.length) % options.length); break;
      case "Home": move(0); break;
      case "End": move(options.length - 1); break;
      default: return;
    }
    // Only for keys actually handled: Tab, Escape and everything else must keep
    // their meaning, and a blanket preventDefault would trap focus in the strip.
    event.preventDefault();
  }

  return (
    <div
      ref={strip}
      className="cmp-verbs"
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          id={tabId(name, id)}
          role="tab"
          type="button"
          aria-selected={value === id}
          aria-controls={panelId(name, id)}
          // The roving tabindex. One stop for the whole strip, so Tab moves
          // past the choices to the content rather than through every one.
          tabIndex={value === id ? 0 : -1}
          className="cmp-verb"
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * What the strip is controlling.
 *
 * Takes the current value rather than its own, so there is one source of truth
 * and a panel cannot be left labelled by a tab that is no longer selected.
 */
export function TabPanel({ name, value, children }: {
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={panelId(name, value)}
      role="tabpanel"
      aria-labelledby={tabId(name, value)}
      // Focusable, per the WAI-ARIA pattern: Tab out of the strip lands on the
      // panel, which is how a keyboard user gets to content that may hold
      // nothing focusable of its own.
      tabIndex={0}
    >
      {children}
    </div>
  );
}
