"use client";

/**
 * The theme toggle.
 *
 * Dark is the default, and that is a claim about identity rather than about
 * ambient light. The public site and this app's own landing page are drawn in
 * one palette — a near-black ground, pale mist text, an amber accent — and a
 * researcher who followed either of them into the workspace used to arrive
 * somewhere that looked like a different product, because the default was
 * `system` and most machines say light. Deferring to the operating system is
 * the polite answer to "which of our two looks do you want?", and the honest
 * answer is that there is only supposed to be one.
 *
 * It is a default, not a lock. All three options stay, and each earns its keep:
 *
 *  - *light* is one press away, and it has to be, because exports always render
 *    light regardless of app theme. Someone composing a figure in dark mode
 *    cannot see it as it will appear, and flipping the workspace for ten
 *    seconds is the cheapest possible fix for that.
 *  - *system* stays reachable so someone who only ever wanted a peek can give
 *    the choice back — including back to a machine that says dark, which is not
 *    the same state as choosing dark here.
 *
 * The choice is written to `data-theme` on the document element and persisted.
 * CSS resolves it with `:root[data-theme="…"]` rules that outrank the media
 * query, so nothing has to be re-rendered and there is no flash on navigation.
 *
 * The default is duplicated in the inline script in `app/layout.tsx`, which has
 * to run before this module is loaded at all; `tests/theme-default.test.tsx`
 * runs that script and this function against the same inputs and fails if they
 * ever disagree.
 */

import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";

/** Exported so the layout's inline script cannot drift onto another key. */
export const THEME_STORAGE_KEY = "throughline-theme";

/**
 * What an unconfigured reader gets: the product's own look.
 *
 * Exported so a test can state the decision once, rather than each of the two
 * places that implement it asserting its own version of it.
 */
export const DEFAULT_THEME: ThemeChoice = "dark";

const LABEL: Record<ThemeChoice, string> = {
  system: "Match this machine",
  light: "Light",
  dark: "Dark",
};

/**
 * Applied before React hydrates, from the inline script in the layout, so a
 * dark-mode user never sees a white flash on first paint. Exported so the
 * script and the component cannot drift apart.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

export function readTheme(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Private browsing, or storage disabled. Nothing was chosen, so the
    // default applies — the same answer as for a reader who has never touched
    // the control, which is what a failed read actually means.
  }
  return DEFAULT_THEME;
}

export function ThemeToggle() {
  // The same default the pre-hydration script used, so the pressed button does
  // not move on the first effect.
  const [choice, setChoice] = useState<ThemeChoice>(DEFAULT_THEME);

  useEffect(() => setChoice(readTheme()), []);

  function choose(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The theme still applies for this session; only persistence is lost.
    }
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {(["system", "light", "dark"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className="theme-option"
          aria-pressed={choice === option}
          title={LABEL[option]}
          onClick={() => choose(option)}
        >
          <span aria-hidden>
            {option === "system" ? "◐" : option === "light" ? "☀" : "☾"}
          </span>
          <span className="sr-only">{LABEL[option]}</span>
        </button>
      ))}
    </div>
  );
}
