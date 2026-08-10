"use client";

/**
 * The theme toggle.
 *
 * Following the operating system is the right *default* and a poor *only*
 * option. Researchers work in rooms whose light does not match their laptop
 * settings, read at night on a machine set to light, and — the case that
 * actually matters here — build a figure they are about to export.
 *
 * Exports always render light regardless of app theme, so someone working in
 * dark mode is composing a figure they cannot see as it will appear. Being able
 * to flip the whole workspace to light for ten seconds is the cheapest possible
 * fix for that, and it is why this is a three-way control rather than a switch:
 * `system` has to remain reachable, because someone who only ever wanted a peek
 * should be able to give the choice back.
 *
 * The choice is written to `data-theme` on the document element and persisted.
 * CSS resolves it with `:root[data-theme="…"]` rules that outrank the media
 * query, so nothing has to be re-rendered and there is no flash on navigation.
 */

import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "throughline-theme";

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
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Private browsing, or storage disabled. Following the system is a fine
    // answer and is what would have happened anyway.
  }
  return "system";
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => setChoice(readTheme()), []);

  function choose(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
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
