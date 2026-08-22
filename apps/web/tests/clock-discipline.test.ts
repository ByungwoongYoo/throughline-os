/**
 * No `Date.now()` anywhere a hand frame's timestamp can reach.
 *
 * A structural check rather than a behavioural one, because the failure it
 * guards against is invisible at runtime. Two clocks, both called "now", eight
 * orders of magnitude apart: mixing them produces a subsystem that resolves
 * nothing for ever, with no error, no log, and nothing on screen that looks
 * wrong. It shipped once exactly that way.
 *
 * The same shape as `css-classes.test.ts` and `test_sql_references.py` — the
 * mistakes worth guarding structurally are the ones that fail silently.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Everything on the timing path: the gesture pipeline, the ink recorder and the
 * speech fusion. A timestamp created in any of these is compared against one
 * created in another.
 */
const TIMED = ["lib/spatial", "lib/ink", "lib/voice", "components/spatial", "app"];

/*
 * `app` is in that list because leaving it out is how the guard failed its own
 * first test. The original mixing was in `app/air-ink/page.tsx` — a page that
 * stamped an utterance with the wall clock and handed it to a timeline full of
 * frame timestamps — and a check that covered only the libraries would have
 * watched the exact bug it was written for go straight past it. Pages are where
 * two subsystems meet, which is precisely where clocks get mixed.
 */

/**
 * Where the wall clock is right, and why.
 *
 * `createdAt` on a stroke is metadata a person reads, never subtracted from a
 * frame. The feedback throttle compares `Date.now()` only with itself. Each of
 * these is listed rather than pattern-matched, so adding one is a decision.
 */
const ALLOWED: Record<string, string> = {
  "lib/spatial/clock.ts":
    "defines the shared clock, and names the wall clock to explain the choice",
  "lib/spatial/feedback.ts":
    "throttles detents against its own timestamps only, never against a frame",
  "lib/ink/recorder.ts":
    "createdAt is metadata a person reads, and is never compared with a frame",
  "lib/ink/stroke.ts":
    "seeds a unique stroke id; the value is an identifier, never a timestamp",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the timing path uses one clock", () => {
  it("never reaches for the wall clock outside the listed exceptions", () => {
    const offenders: string[] = [];
    for (const dir of TIMED) {
      for (const file of walk(dir)) {
        const relative = file.replace(/\\/g, "/");
        if (ALLOWED[relative]) continue;
        const source = readFileSync(file, "utf8");
        // Comments and string literals are allowed to name it — the error
        // message in `timeline.ts` tells a developer precisely not to use it,
        // and a check that flagged its own remedy would be a poor guard.
        const code = source
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/[^\n]*/g, "")
          .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
          .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
          .replace(/`(?:[^`\\]|\\.)*`/g, "``");
        if (/\bDate\.now\s*\(/.test(code)) offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("actually looked at the files, rather than passing on an empty list", () => {
    // A walker that found nothing would satisfy the check above forever.
    const seen = TIMED.flatMap(walk);
    expect(seen.length).toBeGreaterThan(15);
  });

  it("keeps every exception justified", () => {
    // An entry with no reason is a suppression rather than a decision.
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length).toBeGreaterThan(20);
      expect(() => readFileSync(file, "utf8")).not.toThrow();
    }
  });
});
