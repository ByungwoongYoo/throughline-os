/**
 * Speech becoming a structured intention, and never becoming an action (§39).
 *
 * The specification is explicit: the assistant "should not secretly mutate
 * application state", it "outputs structured intentions", and "application-level
 * validation executes it". That boundary is doing four jobs at once — safety,
 * reproducibility, auditing, testing — and it is worth stating why it matters
 * more here than in an ordinary chat product.
 *
 * A spoken sentence is *ambiguous by nature* and arrives with no confirmation
 * step. "Remove these" said while looking at a cluster could mean filter the
 * view, drop the rows, or exclude them from one model. If speech reached state
 * directly, the cost of a misheard word would be a destroyed analysis; with a
 * validated intent in between, the cost is a proposal the researcher declines.
 *
 * So nothing in this module performs anything. It reads an utterance whose
 * references have already been resolved against the hand, and returns a
 * described proposal, or a refusal saying what was missing. The application
 * decides.
 */

import { Reference, ResolvedUtterance } from "./deixis";

/**
 * The verbs a spoken sentence may propose.
 *
 * A closed set, and small. An open-ended natural-language command surface would
 * be more impressive to demonstrate and much worse to rely on: every verb this
 * list does not contain is one the system will decline clearly instead of
 * misinterpreting confidently.
 *
 * Each maps to something the platform can already do and already records in
 * provenance. A verb with no implementation behind it would be a promise the
 * interface makes and the product cannot keep.
 */
export type IntentKind =
  | "describe"      // "what is this", "tell me about these"
  | "compare"       // "compare this with this"
  | "select"        // "select these"
  | "explain";      // "why are these different"

export type Intent = {
  kind: IntentKind;
  /**
   * What the verb applies to, in the order they were spoken.
   *
   * Order matters and is preserved: "compare this with that" is not the same
   * proposal as its reverse once the answer starts talking about a difference in
   * a direction.
   */
  references: Reference[];
  /** The sentence this came from, kept for the audit trail. */
  utterance: string;
};

export type IntentResult =
  | { ok: true; intent: Intent }
  | { ok: false; reason: string };

/** Verb patterns, longest first so "compare" beats a bare "this". */
const VERBS: Array<{ kind: IntentKind; pattern: RegExp; needs: number }> = [
  { kind: "compare", pattern: /\b(compare|versus|against|difference between)\b/i,
    needs: 2 },
  { kind: "explain", pattern: /\b(why|explain|how come|what explains)\b/i, needs: 1 },
  { kind: "select", pattern: /\b(select|choose|pick|take)\b/i, needs: 1 },
  { kind: "describe", pattern: /\b(what|describe|tell me|summar)\w*\b/i, needs: 1 },
];

/**
 * Read a resolved utterance as a proposal, or say why it is not one.
 *
 * Refuses rather than guesses in every ambiguous case, and the refusals are
 * written for a person because they are what the researcher will see.
 */
export function readIntent(resolved: ResolvedUtterance): IntentResult {
  const verb = VERBS.find((v) => v.pattern.test(resolved.text));
  if (!verb) {
    return {
      ok: false,
      reason: "That is not something I can act on. Try asking what something is, "
            + "why two things differ, or to compare or select them.",
    };
  }

  const unresolved = resolved.references.filter((r) => !r.resolved);
  if (unresolved.length) {
    // The important refusal. Falling back to the current selection here would
    // produce a confident answer about something nobody pointed at.
    return {
      ok: false,
      reason: unresolved.map((r) => (r.resolved ? "" : r.why)).join(" ")
            + " Point at it, or circle it, while you say the word.",
    };
  }

  if (resolved.references.length === 0) {
    return {
      ok: false,
      reason: `"${resolved.text}" does not say what it is about. Indicate `
            + "something while you speak.",
    };
  }

  if (resolved.references.length < verb.needs) {
    return {
      ok: false,
      reason: `"${verb.kind}" needs ${verb.needs} things and only `
            + `${resolved.references.length} was indicated.`,
    };
  }

  if (resolved.pending) {
    return {
      ok: false,
      reason: "Still waiting for the gesture to finish before that can be read.",
    };
  }

  return {
    ok: true,
    intent: { kind: verb.kind, references: resolved.references,
              utterance: resolved.text },
  };
}

/**
 * The proposal in one sentence, for confirming before anything happens (§197).
 *
 * A spoken command has no natural confirmation step — the researcher has already
 * finished speaking by the time it is understood — so the interface has to
 * supply one. "Compare 43 observations with 17 — go ahead?" is answerable;
 * something that simply occurred is not.
 */
export function describeIntent(result: IntentResult): string {
  if (!result.ok) return result.reason;

  const counts = result.intent.references.map((r) =>
    r.resolved ? r.binding.referent.targets.length : 0);
  const parts = counts.map((n) => (n === 1 ? "1 observation" : `${n} observations`));

  switch (result.intent.kind) {
    case "compare":
      return `Compare ${parts[0]} with ${parts[1]}?`;
    case "explain":
      return `Explain what distinguishes ${parts[0]}?`;
    case "select":
      return `Select ${parts[0]}?`;
    case "describe":
      return `Describe ${parts[0]}?`;
  }
}
