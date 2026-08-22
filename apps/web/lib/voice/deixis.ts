/**
 * Resolving "this", "these", "those" against what the hand was doing (§37).
 *
 * The specification calls this capability critical, and it is the difference
 * between talking to the room and dictating commands. "Why are these different"
 * is how a researcher actually speaks; "run a two-sample t-test on the selection
 * named cluster_4" is not, and a product that requires the second has not
 * removed any work.
 *
 * **A word carries its own timestamp, and that is the whole mechanism.** Speech
 * arrives as a stream with timing; gestures are intervals on the same clock; the
 * binding is a question about overlap, answered in `timeline.ts`. Everything
 * here is about being honest with the result.
 *
 * **An unresolved reference is a refusal, not a default.** The most damaging
 * thing this module could do is quietly bind "these" to the current selection,
 * or the last thing touched, or the whole dataset. Each would produce a fluent,
 * confident answer about something the researcher did not point at, and nothing
 * in that answer would look wrong. `throughline_domain.selection` refuses
 * malformed selections on exactly this reasoning and says so out loud; this does
 * the same.
 *
 * **Plurality is checked but never used to override.** "This" binding to 43
 * observations is usually a mis-binding and worth surfacing, but a researcher
 * saying "this cluster" about 43 points is speaking perfectly normally. So it is
 * reported as a mismatch for the interface to show, not treated as an error.
 */

import { Binding, ReferenceTimeline } from "./timeline";

/** A word, and when it was said. Timing is the point, so it is not optional. */
export type SpokenWord = {
  text: string;
  /** Milliseconds, monotonic, on the same clock as the gesture stream. */
  at: number;
};

export type Utterance = {
  words: SpokenWord[];
  /** Whether the speaker has stopped. A partial utterance is still resolvable. */
  final: boolean;
};

/**
 * The words that point at something.
 *
 * Deliberately small and closed. A larger list — "it", "them", "that one" —
 * would catch more real speech and also bind far more things wrongly, and a
 * wrong binding is silent. The narrow set is the one where the researcher is
 * unambiguously indicating rather than referring back to the conversation.
 */
const SINGULAR = new Set(["this", "that", "here", "there"]);
const PLURAL = new Set(["these", "those"]);

export function isDeictic(word: string): boolean {
  const bare = normalise(word);
  return SINGULAR.has(bare) || PLURAL.has(bare);
}

function normalise(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, "");
}

export type Reference = {
  word: string;
  at: number;
  /** Plural words expect more than one thing. Reported, never enforced. */
  expectsMany: boolean;
} & (
  | { resolved: true; binding: Binding; pending: boolean; countMismatch: boolean }
  | { resolved: false; why: string }
);

export type ResolvedUtterance = {
  text: string;
  references: Reference[];
  /** True when every deictic word found something. */
  complete: boolean;
  /** True while any reference is waiting on a gesture that has not finished. */
  pending: boolean;
};

/**
 * Resolve every pointing word in an utterance.
 *
 * Each word is resolved at *its own* timestamp rather than the utterance's,
 * which is what makes "compare this with this" work: the two words were spoken
 * seconds apart, over two different gestures, and resolving both at the moment
 * the sentence ended would bind them to the same thing.
 */
export function resolveUtterance(utterance: Utterance,
                                 timeline: ReferenceTimeline): ResolvedUtterance {
  const references: Reference[] = [];

  for (const word of utterance.words) {
    if (!isDeictic(word.text)) continue;
    const bare = normalise(word.text);
    const expectsMany = PLURAL.has(bare);
    const binding = timeline.resolve(word.at);

    if (!binding) {
      references.push({
        word: word.text, at: word.at, expectsMany,
        resolved: false,
        why: `Nothing was indicated around the time "${word.text}" was said.`,
      });
      continue;
    }

    references.push({
      word: word.text, at: word.at, expectsMany,
      resolved: true,
      binding: { referent: binding.referent, reason: binding.reason,
                 distanceMs: binding.distanceMs },
      pending: binding.pending,
      // A count of zero is not a mismatch: the gesture has not finished, so
      // there is nothing to disagree with yet.
      countMismatch: !binding.pending && binding.referent.targets.length > 0
        && expectsMany !== binding.referent.targets.length > 1,
    });
  }

  return {
    text: utterance.words.map((w) => w.text).join(" "),
    references,
    complete: references.length > 0 && references.every((r) => r.resolved),
    pending: references.some((r) => r.resolved && r.pending),
  };
}

/**
 * What to tell the researcher about a binding, in their own terms.
 *
 * Shown rather than assumed, because §197 applies to speech at least as much as
 * to drawing: a sentence that quietly resolved to the wrong cluster produces an
 * answer nobody can tell is about the wrong cluster.
 */
export function explain(reference: Reference): string {
  if (!reference.resolved) return reference.why;

  const count = reference.binding.referent.targets.length;
  const what = reference.pending
    ? "what you are indicating now"
    : count === 1 ? "1 observation" : `${count} observations`;

  const when = {
    during: "as you said it",
    "just-before": "just before you said it",
    "just-after": "just after you said it",
  }[reference.binding.reason];

  const mismatch = reference.countMismatch
    ? reference.expectsMany
      ? ' — though "' + reference.word + '" suggests more than one'
      : ' — though "' + reference.word + '" suggests a single one'
    : "";

  return `"${reference.word}" refers to ${what}, indicated ${when}${mismatch}.`;
}
