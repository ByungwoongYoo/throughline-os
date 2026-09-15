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

/**
 * Sections that became views of the screen that owns them, and where they went.
 *
 * Eight entries left the rail: searching the library, finding papers, finding
 * data and digitising a figure are views of Sources; the chart catalogue is a
 * view of Figures; the activity log is the second reading of the Record; and
 * the pattern sweep and the embedding space are two more readings of this
 * project's analyses. Each one still has a place, so every link anybody has
 * ever copied, and every reference in the ledger and the docs, still lands on
 * the thing it named.
 *
 * A redirect rather than a removal. Deleting them from `SECTION_IDS` would make
 * `?section=literature` fall back to Overview, which is the silent wrong answer
 * — a researcher following an old link would conclude the feature was gone.
 */
export const MOVED_TO: Partial<Record<Section, { section: Section; view: View }>> = {
  search: { section: "sources", view: "search" },
  literature: { section: "sources", view: "papers" },
  datasearch: { section: "sources", view: "data" },
  readfigure: { section: "sources", view: "figure" },
  gallery: { section: "figures", view: "primitives" },
  activity: { section: "journal", view: "done" },
  patterns: { section: "analyses", view: "patterns" },
  embedding: { section: "analyses", view: "embedding" },
};

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

/*
 * The section was the first thing to move into the address, and it stopped
 * one level short (D196). `?section=findings` names a screen, not a place: a
 * researcher with three projects who reloads it lands on the *newest*
 * project's findings, a colleague who follows the link lands on theirs, and
 * the finding that was open is gone either way. So the address now carries
 * three things — which project, which section, which object within it — and
 * the workspace reads all three back on load, on reload and on Back.
 *
 * `item` is the id of the thing a section is showing when it is showing one
 * thing: a finding, a connection, an analysis run, a source. Which *kind* of
 * thing it is follows from the section (`lib/selection.ts`), so the address
 * does not have to say — an id that does not belong to the section's kind
 * simply does not resolve, and the list renders instead.
 */

/** Where the workspace is: a section, and the one object it is open on. */
export type Place = { section: Section; item: string | null };

const ITEM_KEY = "item";
const PROJECT_KEY = "project";

/**
 * What an id in the address may look like.
 *
 * Every id this system issues is a short prefix, an underscore and hex
 * (`fnd_f77968c0b5d94e1cb8f2`). The check is looser than that on purpose — a
 * future id format should not break every bookmark — but it refuses anything
 * that is not plausibly an id, for the same reason `isSection` refuses an
 * unknown section: the value is typed by a stranger and flows into a request.
 */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function idFromSearch(search: string, key: string): string | null {
  const value = new URLSearchParams(search).get(key);
  return value && ID_SHAPE.test(value) ? value : null;
}

/** The object a URL asks to open, or null when it names none. */
export function itemFromSearch(search: string): string | null {
  return idFromSearch(search, ITEM_KEY);
}

/** The project a URL asks for, or null when it names none. */
export function projectFromSearch(search: string): string | null {
  return idFromSearch(search, PROJECT_KEY);
}

/** The section and item a URL asks for, with the same fallbacks as each. */
export function placeFromSearch(search: string): Place {
  const named = sectionFromSearch(search);
  // A section that has become a view resolves to the screen that owns it, so
  // an old link lands on the thing it named rather than on the front door.
  const moved = MOVED_TO[named];
  return { section: moved?.section ?? named, item: itemFromSearch(search) };
}

/** The view an old section's address resolves to, if it named one. */
export function viewForMovedSection(search: string): View | null {
  return MOVED_TO[sectionFromSearch(search)]?.view ?? null;
}

/**
 * The address for a place, preserving everything else already in the URL.
 *
 * The default section stays out of the address for the reason
 * `searchForSection` gives; an absent item is removed rather than written
 * empty, so closing a detail view leaves a clean list address behind.
 */
export function searchForPlace(place: Place, search: string): string {
  const params = new URLSearchParams(searchForSection(place.section, search));
  if (place.item) params.set(ITEM_KEY, place.item);
  else params.delete(ITEM_KEY);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * The address with the project set (or, given null, removed).
 *
 * Written whenever the workspace navigates, not the moment a project is
 * chosen: the front door stays `/workspace` on arrival, and the first click
 * puts the project in the address so that everything copied or reloaded from
 * then on comes back to the same place.
 */
export function searchForProject(projectId: string | null, search: string): string {
  const params = new URLSearchParams(search);
  if (projectId) params.set(PROJECT_KEY, projectId);
  else params.delete(PROJECT_KEY);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/*
 * A section's sub-view, for the one section that has more than one way of
 * reading the same objects.
 *
 * Research graph shows the project's objects twice: as a force-directed canvas
 * where proximity means similarity, and as the river, where the same objects
 * sit in six recorded stages with their derivations drawn. §08 is explicit
 * that the river is "a proposed lineage view, with a contextual entrance from
 * Overview and Research graph" and not a sixth primary group — so it is a view
 * of a section rather than a section of its own, and the secondary navigation
 * row stays the eight items the master shows.
 *
 * It goes in the address for the same four reasons the section did (D196): a
 * researcher reading the lineage can send that link, a reload comes back to
 * it, Back leaves it, and the Overview's entrance can name it. Validated
 * against a vocabulary for the same reason `isSection` is — the value is typed
 * by a stranger and chooses what renders.
 */
/**
 * Every sub-view a section can show.
 *
 * One vocabulary rather than one per section, for the reason `SECTION_IDS` is
 * one list: the value is typed by a stranger and decides what renders, so it
 * has to be checkable. A view that means nothing on the current section simply
 * falls back to that section's default, the same way an `item` that belongs to
 * another kind resolves to nothing.
 *
 * These exist because the product had twenty-three sections and a researcher
 * meeting five groups of them could not tell what any of it was for. A way of
 * getting a paper into the library is not a peer of the library; a catalogue of
 * chart kinds is not a peer of this project's figures. They are views of the
 * screen that owns them, and this is the list of them.
 */
export const VIEW_IDS = [
  // Research graph
  "graph", "river",
  // Sources: the library, and the four ways of getting something into it.
  "library", "search", "papers", "data", "figure",
  // Figures: the project's own — one lens per question a figure answers — and
  // the catalogue of what can be drawn at all.
  "saved", "matrix", "spread", "one", "map", "primitives",
  // Analyses: one run, and the two readings of all of them.
  "runs", "patterns", "embedding",
  // The project's record, written and done.
  "written", "done",
] as const;

export type View = (typeof VIEW_IDS)[number];

/**
 * Which view a section shows when the address names none, and which views it
 * will accept at all.
 *
 * Per section rather than one global default, because the views belong to the
 * screens that own them: `river` means something on Research graph and nothing
 * on Sources, and a link carrying one into the other should land on that
 * section's own front rather than on a blank. A section absent from this map
 * has no views.
 */
export const VIEWS_OF: Partial<Record<Section, readonly View[]>> = {
  graph: ["graph", "river"],
  sources: ["library", "search", "papers", "data", "figure"],
  /*
   * The five lenses of the figure builder, plus the catalogue.
   *
   * The builder held its lens in `useState`, so "How it all relates" could not
   * be linked to, did not survive a reload, and — the reason this changed —
   * could not be *arrived at*: the chart catalogue shows fourteen primitives
   * and had no way to say "draw my data this way", because there was no
   * address for the lens that would draw it.
   *
   * `saved` stays first and keeps its name so every existing link still lands:
   * it is the builder on its own default lens, everything the project tested.
   */
  figures: ["saved", "matrix", "spread", "one", "map", "primitives"],
  analyses: ["runs", "patterns", "embedding"],
  journal: ["written", "done"],
};

/** The first view of a section is the one it opens on. */
export function defaultView(section: Section): View | null {
  return VIEWS_OF[section]?.[0] ?? null;
}

const VIEW_KEY = "view";

export function isView(value: string | null | undefined): value is View {
  return !!value && (VIEW_IDS as readonly string[]).includes(value);
}

/**
 * The view a URL asks for, for a given section.
 *
 * A view the section does not own falls back to its default, for the same
 * reason `sectionFromSearch` falls back rather than throwing: the value is
 * typed by a stranger, and a stale link should land somewhere real.
 */
export function viewFromSearch(search: string, section: Section): View | null {
  const value = new URLSearchParams(search).get(VIEW_KEY);
  const allowed = VIEWS_OF[section];
  if (!allowed) return null;
  return isView(value) && allowed.includes(value) ? value : allowed[0];
}

/**
 * The address for a view, preserving everything else already in the URL.
 *
 * A section's own default is left out, so the ordinary address of every screen
 * keeps the shape it has always had and nobody's existing link grows a
 * parameter it did not need.
 */
export function searchForView(view: View | null, section: Section,
                              search: string): string {
  const params = new URLSearchParams(search);
  if (!view || view === defaultView(section)) params.delete(VIEW_KEY);
  else params.set(VIEW_KEY, view);
  const query = params.toString();
  return query ? `?${query}` : "";
}
