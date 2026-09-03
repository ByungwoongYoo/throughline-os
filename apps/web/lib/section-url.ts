/**
 * Which section the workspace is showing, kept in the address bar.
 *
 * It lived in `useState` alone, and four ordinary things did not work as a
 * result. A researcher could not send a colleague the Connections view —
 * every screen in the product is `/workspace`. Reloading dumped them back at
 * Overview, however deep they were. Reopening the app after lunch did the
 * same. And **Back left the product**: the only history entry was the landing
 * page, so the browser's own back gesture, used after clicking through six
 * sections, did not go back one section — it left.
 *
 * This is D128 one level up, and the argument is already recorded there. The
 * panel layout was persisted precisely because "dragging a divider stored a
 * value and the next reload went back to the defaults." The same reload puts
 * the researcher's *place* back to the default too, which is the larger half
 * of the same complaint.
 *
 * **The URL, not `localStorage`.** Storage would fix the reload and none of
 * the rest — a stored section cannot be linked to, cannot be gone back
 * through, and is actively wrong on a second tab, where two windows fight over
 * one key. The address bar answers all four, and it is the mechanism a browser
 * already has for "where am I".
 *
 * Nothing here touches the DOM or React, so what the address bar means can be
 * tested as arithmetic — see `section-url.test.ts`.
 */

import type { Section } from "@/components/Shell";

/**
 * Every section that may appear in a URL.
 *
 * A runtime copy of a compile-time union, which is a duplication worth naming.
 * A `Section` is a TypeScript type and vanishes at build; a query string is
 * typed by a stranger. Without a list to check against, `?section=<script>`
 * would flow straight into the switch that chooses a screen. `test_vocabularies
 * _agree`'s reasoning applies to it — where a vocabulary is written twice, a
 * test holds the copies together — and `section-url.test.ts` does that here.
 */
export const SECTION_IDS = [
  "board",
  "overview", "sources", "variables", "search",
  "discover", "compare", "patterns", "connections", "findings",
  "analyses", "graph", "embedding",
  "reports", "figures", "gallery", "notebook", "journal", "activity",
  "literature",
  "datasearch", "readfigure", "settings",
] as const;

/** Where a visitor lands when the address names no section. */
export const DEFAULT_SECTION: Section = "overview";

const KEY = "section";

export function isSection(value: string | null | undefined): value is Section {
  return !!value && (SECTION_IDS as readonly string[]).includes(value);
}

/**
 * The section a URL asks for, or the default.
 *
 * An unknown section falls back rather than throwing. A link can go stale —
 * a section renamed after somebody bookmarked it — and the right answer to a
 * stale bookmark is the front of the product, not an error page. It is a
 * *silent* fallback only because the alternative reads as a fault of the
 * researcher's, which it is not.
 */
export function sectionFromSearch(search: string): Section {
  const value = new URLSearchParams(search).get(KEY);
  return isSection(value) ? value : DEFAULT_SECTION;
}

/**
 * The address for a section, preserving everything else already in the URL.
 *
 * Rebuilt from the current search string rather than assembled from scratch,
 * because the workspace is not the only thing that may write here and a
 * navigation that silently drops another feature's parameter is a bug that
 * surfaces far from its cause.
 *
 * The default section is written as a *bare* path. Landing on `/workspace`
 * and immediately being rewritten to `/workspace?section=overview` makes the
 * front door look like a redirect, and puts a parameter in every link anybody
 * copies from the home screen.
 */
export function searchForSection(section: Section, search: string): string {
  const params = new URLSearchParams(search);
  if (section === DEFAULT_SECTION) params.delete(KEY);
  else params.set(KEY, section);
  const query = params.toString();
  return query ? `?${query}` : "";
}
