/**
 * Placing a project's objects into the river's six stages.
 *
 * Pure, and separate from the component, because this is the part that can be
 * wrong in a way nobody would see. §09 is blunt about it: edge direction, time
 * ordering and link meaning come from the data, and a river that invents a
 * chronology is worse than no river. Everything here is a mapping from a
 * recorded `object_type` to a column; nothing infers, orders or connects.
 *
 * The stage an object sits in is NOT when it happened. The master says so on
 * its own face — "stage placement does not imply execution order" — and the
 * reason is that a project revisits its sources after recording a finding all
 * the time. The columns are kinds of thing, read left to right because that is
 * how the work usually flows, not a timeline.
 */

/** The six columns of UI_03, in order. */
export const STAGES = [
  { id: "sources", label: "Sources", blurb: "Data, documents, and other inputs" },
  { id: "claims", label: "Claims", blurb: "Stated hypotheses and observations" },
  { id: "connections", label: "Connections", blurb: "Links between variables" },
  { id: "analyses", label: "Analyses", blurb: "Methods and results" },
  { id: "validation", label: "Validation", blurb: "Robustness and sensitivity checks" },
  { id: "findings", label: "Findings", blurb: "Synthesised insights" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

/**
 * Which column a recorded object type belongs in.
 *
 * Written out rather than inferred from a prefix, because the vocabulary is
 * `ObjectType` in the domain and it is long: a rule like "anything with
 * 'analysis' in it" would silently misfile `research_gap` the day somebody adds
 * `analysis_template`. An unlisted type is not forced into a column — see
 * `stageOf` — because a wrong column is a claim about the work.
 */
const STAGE_OF_TYPE: Record<string, StageId> = {
  paper: "sources",
  dataset: "sources",
  dataset_variable: "sources",
  table: "sources",
  image: "sources",
  code: "sources",
  notebook: "sources",
  excerpt: "sources",
  figure: "sources",

  claim: "claims",
  hypothesis: "claims",
  concept: "claims",

  analysis: "analyses",
  method: "analyses",
  model: "analyses",
  experiment: "analyses",

  finding: "findings",
  contradiction: "findings",
  research_gap: "findings",
};

/**
 * The stage for an object type, or null when the vocabulary does not say.
 *
 * Null rather than a default column. An object of an unrecognised type placed
 * under "Sources" would be a statement about the project that nothing recorded,
 * and the screen shows those separately instead so the gap is visible.
 */
export function stageOf(objectType: string): StageId | null {
  return STAGE_OF_TYPE[objectType] ?? null;
}

/** How a connection's lifecycle reads as a state the river can colour. */
export type RiverState = "validated" | "exploratory" | "rejected" | "neutral";

/**
 * The state vocabulary, mapped once.
 *
 * The three the master colours are validated, exploratory and rejected, and
 * they are genuinely different claims about a piece of work: one survived
 * checks, one has not been checked, one was checked and did not survive. §09
 * forbids conflating them, which is why an unknown status becomes `neutral`
 * rather than being rounded to the nearest of the three.
 */
export function stateOf(status: string | null | undefined): RiverState {
  const s = (status ?? "").toLowerCase();
  if (s.includes("validated") || s.includes("confirmed")) return "validated";
  if (s.includes("reject") || s.includes("refuted") || s.includes("failed")) return "rejected";
  if (s.includes("exploratory") || s.includes("candidate") || s.includes("pending")) return "exploratory";
  return "neutral";
}
