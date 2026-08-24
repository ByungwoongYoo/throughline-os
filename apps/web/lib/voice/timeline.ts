/**
 * Binding "these" to what the hand was doing when the word was said (§199).
 *
 * This is the part of speech-plus-gesture that is actually difficult, and it is
 * not speech recognition. Turning audio into words is a solved problem somebody
 * else has solved; deciding *what a word referred to* is the thing that makes
 * the interaction feel like being understood rather than like operating a
 * command line with your voice.
 *
 * The specification's own example is the trap, stated plainly:
 *
 *     gesture begins      t0
 *     speech "these"      t0 + 400ms
 *     gesture closes      t0 + 900ms
 *
 * The word arrives **while the circle is still being drawn**. An implementation
 * that resolves a reference against the selection existing at the moment the
 * word is heard binds "these" to nothing at all, because the region has not
 * closed yet — and it does so silently, producing an answer about the wrong
 * thing or no thing. So a referent here is an *interval*, not an instant, and a
 * word falling inside a gesture's interval binds to it however late the gesture
 * finishes.
 *
 * Three rules, in order, and the order is the design:
 *
 * **A gesture in progress wins.** If the word was spoken between the start and
 * end of a gesture, it refers to that gesture. This is the specification's case
 * and the commonest one in speech: people start the sentence and the movement
 * together.
 *
 * **Otherwise the most recent completed gesture, if it is recent enough.** "Why
 * are these different" said just after a circle closes.
 *
 * **Otherwise a gesture that begins shortly afterwards.** "Compare these" — then
 * the circle. Given a shorter window than the backward one, deliberately:
 * binding forward is a guess about what somebody is *about to* do, and it should
 * give up sooner than a guess about what they just did.
 *
 * **And otherwise nothing, said out loud.** An unresolved reference is returned
 * as unresolved. It must never fall back to the current selection, the whole
 * dataset, or the last thing touched — those produce a confident answer about
 * something the researcher did not indicate, which is the failure this codebase
 * treats as the worst available. `selection.py` refuses malformed selections for
 * exactly the same reason, and says so.
 */

import { sameClock } from "@/lib/spatial/clock";

export type Referent = {
  /** What the gesture resolved to. Opaque here; the caller knows what it means. */
  targets: readonly string[];
  /** Anything the caller wants to carry along, such as the selection payload. */
  detail?: unknown;
  /** What kind of gesture produced it, for explaining a binding to a person. */
  kind: "region" | "point" | "selection";
};

export type ReferenceWindow = {
  /**
   * How long after a gesture ends it can still be referred to, in milliseconds.
   *
   * Long enough for somebody to finish circling and then say what they wanted;
   * short enough that a reference does not attach to something from a minute
   * ago. §199 asks for "short-lived contextual windows", and stale binding is
   * the failure it is guarding against.
   */
  backwardMs: number;
  /**
   * How long before a gesture begins it can already be referred to.
   *
   * Shorter than backward, because this is a guess about what somebody is about
   * to do rather than what they have just done.
   */
  forwardMs: number;
};

export const DEFAULT_WINDOW: ReferenceWindow = {
  backwardMs: 4000,
  forwardMs: 2500,
};

type Entry = Referent & {
  id: number;
  startedAt: number;
  /** Null while the gesture is still happening. */
  endedAt: number | null;
};

export type Binding = {
  referent: Referent;
  /** Why this one, in terms a person can be shown. */
  reason: "during" | "just-before" | "just-after";
  /** Milliseconds between the word and the gesture. Zero when it was during. */
  distanceMs: number;
};

/**
 * What the hand has indicated, and when.
 *
 * Deliberately holds only the recent past. A timeline that grew for the length
 * of a session would make every resolution a scan of the whole day's work, and
 * would keep alive references that §199 says should expire.
 */
export class ReferenceTimeline {
  private entries: Entry[] = [];
  private nextId = 1;
  private window: ReferenceWindow;

  constructor(window: Partial<ReferenceWindow> = {}) {
    this.window = { ...DEFAULT_WINDOW, ...window };
  }

  /**
   * The most recent timestamp seen, for catching a stray clock.
   *
   * Cheap insurance against the failure this subsystem is most exposed to: two
   * callers on two different clocks produce a timeline that resolves nothing,
   * for ever, without an error anywhere. See `clock.ts`.
   */
  private lastSeen: number | null = null;

  private check(at: number): void {
    if (this.lastSeen !== null && !sameClock(this.lastSeen, at)) {
      throw new Error(
        `timestamp ${at} is not on the same clock as ${this.lastSeen}. `
        + "Everything compared against a hand frame must use `now()` from "
        + "lib/spatial/clock, not Date.now().");
    }
    this.lastSeen = at;
  }

  /**
   * A gesture has started. Returns a handle to close it with.
   *
   * Opened and closed rather than recorded on completion, because the whole
   * point is that a word spoken *during* the gesture can bind to it — which is
   * impossible if the timeline only hears about gestures once they finish.
   */
  begin(at: number, kind: Referent["kind"]): number {
    this.check(at);
    const id = this.nextId;
    this.nextId += 1;
    this.entries.push({ id, startedAt: at, endedAt: null, kind, targets: [] });
    this.forget(at);
    return id;
  }

  /** The gesture finished, and this is what it turned out to mean. */
  complete(id: number, at: number, referent: Omit<Referent, "kind">): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.endedAt = at;
    entry.targets = referent.targets;
    entry.detail = referent.detail;
  }

  /**
   * The gesture was abandoned and refers to nothing.
   *
   * Removed rather than left open. An open entry with no targets would keep
   * capturing every word spoken after it, for ever, and bind them to an empty
   * referent — a reference that resolves to nothing is worse than one that does
   * not resolve, because it looks like it worked.
   */
  abandon(id: number): void {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  /** A gesture that resolved instantly, with no meaningful duration. */
  record(at: number, kind: Referent["kind"],
         referent: Omit<Referent, "kind">): void {
    const id = this.begin(at, kind);
    this.complete(id, at, referent);
  }

  /**
   * What a deictic word spoken at this moment refers to, if anything.
   *
   * A gesture still in progress is a legitimate answer: the researcher is
   * circling as they speak, and the referent will be known shortly. The caller
   * decides whether to wait for it — `pending` says which case this is.
   */
  resolve(spokenAt: number): (Binding & { pending: boolean }) | null {
    this.check(spokenAt);
    this.forget(spokenAt);

    // 1. A gesture the word was spoken inside. The specification's own case.
    const during = this.entries.filter((e) =>
      e.startedAt <= spokenAt && (e.endedAt === null || e.endedAt >= spokenAt));
    if (during.length) {
      // The one that started most recently: if two are open, the word belongs
      // to the movement the hand is making now, not the one it began earlier.
      const entry = during.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b));
      return {
        referent: { targets: entry.targets, detail: entry.detail, kind: entry.kind },
        reason: "during",
        distanceMs: 0,
        pending: entry.endedAt === null,
      };
    }

    // 2. The most recently completed gesture, if it is recent enough.
    const before = this.entries
      .filter((e) => e.endedAt !== null && e.endedAt <= spokenAt)
      .filter((e) => spokenAt - (e.endedAt as number) <= this.window.backwardMs);
    if (before.length) {
      const entry = before.reduce((a, b) =>
        ((a.endedAt as number) >= (b.endedAt as number) ? a : b));
      return {
        referent: { targets: entry.targets, detail: entry.detail, kind: entry.kind },
        reason: "just-before",
        distanceMs: spokenAt - (entry.endedAt as number),
        pending: false,
      };
    }

    // 3. A gesture that begins shortly after the word. "Compare these" — circle.
    const after = this.entries
      .filter((e) => e.startedAt > spokenAt)
      .filter((e) => e.startedAt - spokenAt <= this.window.forwardMs);
    if (after.length) {
      const entry = after.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
      return {
        referent: { targets: entry.targets, detail: entry.detail, kind: entry.kind },
        reason: "just-after",
        distanceMs: entry.startedAt - spokenAt,
        pending: entry.endedAt === null,
      };
    }

    // 4. Nothing. Deliberately not the current selection, not the last thing
    //    touched, and not the whole dataset.
    return null;
  }

  /** Everything still inside the windows, oldest first. For explaining a binding. */
  active(now: number): Referent[] {
    this.forget(now);
    return this.entries.map((e) => ({
      targets: e.targets, detail: e.detail, kind: e.kind,
    }));
  }

  clear(): void {
    this.entries = [];
  }

  /**
   * Drop what can no longer be referred to.
   *
   * An open gesture is never dropped however old: a hand can rest mid-drawing,
   * and discarding the stroke somebody is still making would be a bug rather
   * than housekeeping. Only completed entries expire.
   */
  private forget(now: number): void {
    this.entries = this.entries.filter((e) =>
      e.endedAt === null || now - e.endedAt <= this.window.backwardMs);
  }
}
