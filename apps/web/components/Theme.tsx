"use client";

/**
 * The theme choice.
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
 *
 * Where the choice is *offered* moved in T139. The topbar used to carry a
 * three-button segmented toggle of its own beside an account avatar — two
 * controls at the right of every screen, for two questions a researcher asks
 * about once a session. The three choices are now one row inside the single
 * account control (`Shell.tsx`), which is why the state and the labels are
 * exported from here rather than living inside `ThemeToggle`: the toggle and
 * the menu row are two renderings of one piece of state, and a second copy of
 * `choose` would be a second place for the storage key to drift.
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

/**
 * The order the three are offered in, darkest first.
 *
 * Dark leads because it is the default and the product's own look; "match this
 * machine" is last because it is the answer that hands the question back.
 */
export const THEME_CHOICES: readonly ThemeChoice[] = ["dark", "light", "system"];

export const THEME_LABEL: Record<ThemeChoice, string> = {
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

/**
 * The chosen theme, and the one way to change it.
 *
 * The initial value is the default the pre-hydration script already used, not
 * the stored one: reading storage during render would differ from what the
 * server rendered. The effect corrects it on the first client frame, which is
 * before anything is painted twice because the *attribute* was stamped by the
 * head script long before this runs.
 */
export function useThemeChoice(): [ThemeChoice, (next: ThemeChoice) => void] {
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

  return [choice, choose];
}

/**
 * The standalone segmented toggle.
 *
 * No longer rendered in the topbar — the theme is one row inside the account
 * control now — but kept because it is the smallest complete rendering of the
 * choice, and because a settings screen or a sign-in page has somewhere to put
 * three buttons and nowhere to put a menu.
 */
export function ThemeToggle() {
  const [choice, choose] = useThemeChoice();

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {(["system", "light", "dark"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className="theme-option"
          aria-pressed={choice === option}
          title={THEME_LABEL[option]}
          onClick={() => choose(option)}
        >
          <span aria-hidden>
            {option === "system" ? "◐" : option === "light" ? "☀" : "☾"}
          </span>
          <span className="sr-only">{THEME_LABEL[option]}</span>
        </button>
      ))}
    </div>
  );
}
