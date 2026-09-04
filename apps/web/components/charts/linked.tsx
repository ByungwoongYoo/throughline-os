"use client";

/**
 * A selection made on one figure, shown on every figure of the same data.
 *
 * Brushing a region and seeing those same observations light up elsewhere is
 * how a reader finds out what a group *is*: the dense clump on one pair of
 * axes turns out to be the low tail on another, and no summary statistic
 * would have said so.
 *
 * **Linking is opt-in and keyed, and that is the whole correctness of it.**
 * A chart takes a `linkKey` naming the observations it draws — a dataset
 * version, a run, whatever identifies the rows. A selection is shown only on
 * charts carrying the same key. Two figures of different datasets whose ids
 * happen to collide must not light each other up: that would be the figure
 * asserting "these are the same observations" when nothing has established
 * it. A chart with no key does not participate, so nothing links by accident.
 *
 * **A figure echoing somebody else's selection says so, and counts its own
 * marks.** A reader arriving at a half-dimmed chart with no explanation will
 * read the dimming as a property of the data. And the number quoted is how
 * many marks *this* figure is highlighting, not the size of the selection —
 * a figure drawing four hundred of a thousand selected observations that
 * announced "1,000 highlighted" would be reporting a number about somewhere
 * else.
 *
 * **A selection is not a finding**, here as everywhere: these are points a
 * person indicated, nothing was fitted, and no test was run.
 */

import {
  createContext, useCallback, useContext, useMemo, useState,
} from "react";

/** How much a mark outside the selection is dimmed. */
export const MUTED = 0.18;

type Selection = { key: string; from: string; ids: ReadonlySet<string> };

export type LinkedSelection = {
  selection: Selection | null;
  /**
   * Publish a selection.
   *
   * `key` names the observations; `from` identifies the chart, so a figure
   * can tell its own selection from one it is echoing. An empty list clears,
   * because a selection of nothing is not a selection.
   */
  select: (key: string, from: string, ids: readonly string[]) => void;
  clear: () => void;
  /**
   * Opacity for one mark on a chart with this key: 1 where there is no
   * selection, where the selection belongs to other observations, or where
   * this mark is in it; `MUTED` otherwise.
   */
  emphasisFor: (key: string | undefined, id: string) => number;
  /**
   * How many of these ids are in the current selection, or null when there is
   * nothing for this chart to echo — no selection, a selection about other
   * observations, or this chart's own.
   */
  echoCount: (key: string | undefined, chartId: string,
              ids: readonly string[]) => number | null;
};

const NOT_LINKED: LinkedSelection = {
  selection: null,
  select: () => {},
  clear: () => {},
  emphasisFor: () => 1,
  echoCount: () => null,
};

const Context = createContext<LinkedSelection>(NOT_LINKED);

/**
 * Charts inside this share selections; charts outside are unaffected.
 *
 * The default is a no-op rather than a thrown error: these components are
 * used alone in the gallery and in diagnostics, and a chart that refused to
 * render outside a provider would make linking a requirement rather than a
 * feature.
 */
export function LinkedCharts({ children }: { children: React.ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);

  const select = useCallback(
    (key: string, from: string, ids: readonly string[]) => {
      setSelection(ids.length ? { key, from, ids: new Set(ids) } : null);
    }, []);

  const clear = useCallback(() => setSelection(null), []);

  const emphasisFor = useCallback((key: string | undefined, id: string) => {
    if (!selection || !key || key !== selection.key) return 1;
    return selection.ids.has(id) ? 1 : MUTED;
  }, [selection]);

  const echoCount = useCallback(
    (key: string | undefined, chartId: string, ids: readonly string[]) => {
      if (!selection || !key || key !== selection.key) return null;
      if (selection.from === chartId) return null;
      return ids.reduce((n, id) => (selection.ids.has(id) ? n + 1 : n), 0);
    }, [selection]);

  const value = useMemo(
    () => ({ selection, select, clear, emphasisFor, echoCount }),
    [selection, select, clear, emphasisFor, echoCount]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLinkedSelection(): LinkedSelection {
  return useContext(Context);
}
