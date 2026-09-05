/**
 * Which screen shows a thing, and what a screen is showing.
 *
 * The workspace keeps two facts about where the researcher is: the section
 * (Findings, Analyses, …) and the one object that section is open on, if any.
 * They used to be kept apart — the section in one piece of state, a
 * `{ kind, id }` selection in another — and every in-view link changed only
 * the second (D195). A finding's "computations behind it" set the selection to
 * an analysis while the section stayed on Findings, and since each section
 * renders a detail only for its own kind of object, the screen showed the
 * Findings *list* with a run id in the breadcrumb. Recording a finding from a
 * connection did the same in the other direction: the researcher was left on
 * the Connections list and never saw the finding they had just made.
 *
 * The command palette had it right all along — it set the section *and* the
 * selection — because it had to say where it was sending somebody. The rule
 * it followed is written down here once so that every link follows it: a
 * thing is opened in the section that shows its kind, staying put when the
 * current section already does.
 */

import type { Section } from "@/components/Shell";
import type { Place } from "./section-url";

/** The kinds of object a section can be open on. */
export type Kind =
  | "source" | "connection" | "finding" | "analysis" | "artifact" | "object";

export type Selection = { kind: Kind; id: string };

/**
 * What each section shows when it is asked to show one thing.
 *
 * Sections absent from this map show lists or tools only; an `item` in the
 * address for one of them resolves to nothing and the list renders, which is
 * the right answer to a stale or hand-edited link.
 */
export const KIND_OF_SECTION: Partial<Record<Section, Kind>> = {
  sources: "source",
  // Discovery shows the connection a sweep produced, in place, so a
  // researcher reading candidates is not bounced to another screen per row.
  discover: "connection",
  connections: "connection",
  findings: "finding",
  analyses: "analysis",
  reports: "artifact",
  graph: "object",
};

/** Where a kind of thing is shown when the current screen cannot show it. */
export const HOME_OF_KIND: Record<Kind, Section> = {
  source: "sources",
  connection: "connections",
  finding: "findings",
  analysis: "analyses",
  artifact: "reports",
  object: "graph",
};

/**
 * The place that shows `id`, from wherever the researcher is now.
 *
 * Stays in the current section when it already shows this kind — opening a
 * connection from the Discovery screen keeps them on Discovery — and otherwise
 * goes to the kind's home. Never returns a place whose section cannot render
 * the item, which is the whole defect this module exists to end.
 */
export function placeFor(kind: Kind, id: string, current: Section): Place {
  const section = KIND_OF_SECTION[current] === kind ? current : HOME_OF_KIND[kind];
  return { section, item: id };
}

/** What a place is open on, or null when it is showing a list. */
export function selectionAt(place: Place): Selection | null {
  const kind = KIND_OF_SECTION[place.section];
  return kind && place.item ? { kind, id: place.item } : null;
}

/*
 * The last project this account had open, kept per account and per browser.
 *
 * The address is the authority (`?project=`), and it is absent in exactly one
 * ordinary case: opening the app fresh at `/workspace`, which the launcher
 * does on every start. Without a memory, that case landed on whichever
 * project was newest, so a researcher with three projects who closed the
 * laptop on the oldest one came back to a different project every morning
 * (D196). Keyed by account because one machine can hold several, and one
 * account's remembered project must not be the first thing another sees.
 *
 * Storage is a convenience layer, never the record: it can be empty or
 * unavailable, and the workspace has to be right without it.
 */
const key = (userId: string) => `throughline.project.${userId}`;

export function lastProject(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

export function rememberProject(userId: string, projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(userId), projectId);
  } catch {
    // Storage blocked or full. The address still carries the project once
    // the researcher navigates, so nothing is lost that cannot be recovered.
  }
}
