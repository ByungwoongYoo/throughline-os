/**
 * One clock, for everything that has to be compared with everything else.
 *
 * §219 says to timestamp everything, and the reason that instruction is not
 * trivial is that a browser offers two clocks which are both called "now" and
 * are eight orders of magnitude apart. This module exists because mixing them is
 * silent, and it was mixed: hand frames were stamped with `performance.now()`
 * (about 10,000 — milliseconds since the page loaded) while a spoken utterance
 * was stamped with `Date.now()` (about 1.76e12 — milliseconds since 1970). Every
 * reference resolved against a gesture 55 years in the past, so **no word could
 * ever bind to any gesture**, and nothing threw, logged, or looked wrong. The
 * end-to-end test missed it because synthetic timestamps are consistent with
 * themselves.
 *
 * `performance.now()` is the right one, and not only because it was chosen
 * first:
 *
 * **It is monotonic.** `Date.now()` is wall-clock time and can move *backwards*
 * — an NTP correction, a daylight-saving change, a laptop waking from sleep with
 * a stale clock. A fusion timeline built on a clock that can jump backwards will
 * bind a word to a gesture that had not happened yet, or drop a referent that is
 * still on screen, and it will do it once a fortnight in a way nobody can
 * reproduce.
 *
 * **It has the resolution the question needs.** Deciding whether a word landed
 * inside a 400ms gesture is a sub-frame question, and `Date.now()` is specified
 * only to the millisecond.
 *
 * **Everything else already uses it.** The tracker, the One Euro filters and the
 * frame-rate governor all run on it, so it is the clock the gesture stream is
 * genuinely expressed in. Converting speech to match is a one-line change;
 * converting the whole gesture pipeline would not be.
 *
 * The rule this file exists to enforce: **anything whose timestamp is ever
 * compared with a hand frame calls `now()` here.** `Date.now()` remains correct
 * for anything a person will read — a `createdAt`, an entry in the audit log —
 * because those want the wall clock and are never subtracted from a frame.
 */

/**
 * Milliseconds on the shared monotonic clock.
 *
 * Falls back to the wall clock only where `performance` does not exist at all,
 * which in practice means a server render — where there are no hand frames to be
 * compared with, so the fallback cannot cause a mismatch.
 */
export function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * Whether two timestamps are plausibly on the same clock.
 *
 * A blunt instrument for a blunt failure. The two clocks differ by decades, so
 * any genuine pair of timestamps from one session is within hours of the other
 * and any mixed pair is not remotely close. Used at the seams where a timestamp
 * arrives from outside, so a mismatch is caught where it happens rather than
 * showing up as a feature that silently never works.
 */
export function sameClock(a: number, b: number): boolean {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.abs(a - b) < DAY_MS;
}
