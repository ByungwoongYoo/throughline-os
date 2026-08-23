/**
 * Speech and gesture on one clock (§37, §38, §199).
 *
 * The whole subsystem turns on a timing question, so these tests are about
 * timing rather than about language. The sentence "why are these different" is
 * trivial to parse and impossible to act on; knowing that "these" meant the
 * circle the hand was halfway through drawing is the entire feature.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW, ReferenceTimeline } from "@/lib/voice/timeline";
import { isDeictic, explain, resolveUtterance } from "@/lib/voice/deixis";
import { describeIntent, readIntent } from "@/lib/voice/intent";
import {
  NoSpeechSource, ScriptedSpeechSource, describeSource, typedTiming,
} from "@/lib/voice/source";
import { now } from "@/lib/spatial/clock";

/** An utterance whose words are spread over a duration, as speech is. */
function spoken(sentence: string, startAt: number, durationMs: number) {
  const words = sentence.split(/\s+/).filter(Boolean);
  const step = words.length > 1 ? durationMs / (words.length - 1) : 0;
  return {
    words: words.map((text, i) => ({ text, at: startAt + i * step })),
    final: true,
  };
}

describe("a word spoken during a gesture binds to it", () => {
  it("resolves the specification's own example", () => {
    /**
     *     gesture begins   t0
     *     speech "these"   t0 + 400ms
     *     gesture closes   t0 + 900ms
     *
     * The word arrives before the circle is finished. Resolving against
     * whatever is selected at that instant binds it to nothing — silently —
     * which is the failure this interval model exists to prevent.
     */
    const timeline = new ReferenceTimeline();
    const t0 = 10_000;
    const gesture = timeline.begin(t0, "region");

    const atSpeech = timeline.resolve(t0 + 400);
    expect(atSpeech).not.toBeNull();
    expect(atSpeech!.reason).toBe("during");
    expect(atSpeech!.pending).toBe(true);

    timeline.complete(gesture, t0 + 900, { targets: ["a", "b", "c"] });

    const settled = timeline.resolve(t0 + 400);
    expect(settled!.referent.targets).toEqual(["a", "b", "c"]);
    expect(settled!.pending).toBe(false);
  });

  it("prefers the gesture the hand is making now when two are open", () => {
    const timeline = new ReferenceTimeline();
    timeline.begin(1000, "region");
    timeline.begin(1500, "point");

    expect(timeline.resolve(1600)!.referent.kind).toBe("point");
  });
});

describe("a word spoken around a gesture still binds", () => {
  it("binds backward to a circle that just closed", () => {
    const timeline = new ReferenceTimeline();
    timeline.record(5_000, "region", { targets: ["x", "y"] });

    const binding = timeline.resolve(5_600);
    expect(binding!.reason).toBe("just-before");
    expect(binding!.referent.targets).toEqual(["x", "y"]);
  });

  it("binds forward to a circle about to be drawn", () => {
    // "Compare these" — then the hand goes to the chart.
    const timeline = new ReferenceTimeline();
    const id = timeline.begin(8_000, "region");
    timeline.complete(id, 8_400, { targets: ["p"] });

    const binding = timeline.resolve(7_000);
    expect(binding!.reason).toBe("just-after");
    expect(binding!.referent.targets).toEqual(["p"]);
  });

  it("gives up on the future sooner than on the past", () => {
    /**
     * Binding forward guesses what somebody is about to do; binding backward
     * describes what they just did. The first deserves a shorter rope, and the
     * asymmetry is deliberate rather than an accident of tuning.
     */
    expect(DEFAULT_WINDOW.forwardMs).toBeLessThan(DEFAULT_WINDOW.backwardMs);
  });
});

describe("a reference that cannot be resolved is refused, never guessed", () => {
  it("returns nothing when no gesture is anywhere near", () => {
    /**
     * The most damaging thing this could do is fall back to the current
     * selection, the last thing touched, or the whole dataset. Each produces a
     * fluent answer about something the researcher did not indicate, and
     * nothing about that answer looks wrong.
     */
    const timeline = new ReferenceTimeline();
    timeline.record(1_000, "region", { targets: ["old"] });

    expect(timeline.resolve(1_000 + DEFAULT_WINDOW.backwardMs + 1)).toBeNull();
  });

  it("returns nothing when a gesture exists but is out of reach", () => {
    /**
     * The case the first version of this file missed, and the miss mattered.
     *
     * The other refusal test used a gesture old enough to have been forgotten,
     * so the timeline was empty and *any* implementation returned null —
     * including one that falls back to the most recent entry. Mutating the
     * refusal into "return the last thing" passed every test. Here the entry is
     * present and simply too far away, which is the only shape that
     * distinguishes a real refusal from a fallback.
     */
    const timeline = new ReferenceTimeline();
    const id = timeline.begin(60_000, "region");           // far in the future
    timeline.complete(id, 60_400, { targets: ["later"] });

    expect(timeline.resolve(10_000)).toBeNull();
  });

  it("returns nothing when the only gesture is too old but still remembered", () => {
    const timeline = new ReferenceTimeline({ backwardMs: 4000, forwardMs: 500 });
    timeline.record(1_000, "region", { targets: ["old"] });
    const later = timeline.begin(20_000, "region");
    timeline.complete(later, 20_100, { targets: ["future"] });

    // 6s after the old one closed, 14s before the next begins: neither window.
    expect(timeline.resolve(7_000)).toBeNull();
  });

  it("forgets a gesture once its window has passed", () => {
    const timeline = new ReferenceTimeline();
    timeline.record(1_000, "region", { targets: ["old"] });
    expect(timeline.active(60_000)).toEqual([]);
  });

  it("keeps an unfinished gesture however long the hand rests", () => {
    // A hand can pause mid-stroke. Discarding the mark somebody is still making
    // would be a bug dressed up as housekeeping.
    const timeline = new ReferenceTimeline();
    timeline.begin(1_000, "region");
    expect(timeline.active(90_000)).toHaveLength(1);
  });

  it("drops an abandoned gesture rather than leaving it open", () => {
    /**
     * An open entry with no targets would capture every word spoken afterwards
     * and bind them to an empty referent — which is worse than not resolving,
     * because it looks like it worked.
     */
    const timeline = new ReferenceTimeline();
    const id = timeline.begin(2_000, "region");
    timeline.abandon(id);

    expect(timeline.resolve(2_100)).toBeNull();
  });
});

describe("reading a sentence", () => {
  it("knows which words point at something", () => {
    for (const word of ["this", "these", "That", "those.", "here"]) {
      expect(isDeictic(word)).toBe(true);
    }
    for (const word of ["cluster", "the", "why", "it", "them"]) {
      expect(isDeictic(word)).toBe(false);
    }
  });

  it("resolves each word at its own moment, not the sentence's", () => {
    /**
     * What makes "compare this with this" work at all: the two words were said
     * seconds apart over two different gestures. Resolving both at the end of
     * the sentence binds them to the same thing, and the comparison becomes a
     * cluster against itself.
     */
    const timeline = new ReferenceTimeline();
    const first = timeline.begin(1_000, "region");
    timeline.complete(first, 1_400, { targets: ["a1", "a2"] });
    const second = timeline.begin(3_000, "region");
    timeline.complete(second, 3_400, { targets: ["b1"] });

    const utterance = {
      words: [
        { text: "compare", at: 1_100 },
        { text: "this", at: 1_300 },
        { text: "with", at: 3_050 },
        { text: "this", at: 3_200 },
      ],
      final: true,
    };
    const resolved = resolveUtterance(utterance, timeline);

    expect(resolved.references).toHaveLength(2);
    expect(resolved.references[0].resolved && resolved.references[0].binding
      .referent.targets).toEqual(["a1", "a2"]);
    expect(resolved.references[1].resolved && resolved.references[1].binding
      .referent.targets).toEqual(["b1"]);
    expect(resolved.complete).toBe(true);
  });

  it("reports a plural word bound to one thing without refusing it", () => {
    // "These" over a single point is usually a mis-binding and worth showing.
    // But a researcher saying "this cluster" about forty points is speaking
    // normally, so plurality informs and never overrides.
    const timeline = new ReferenceTimeline();
    timeline.record(1_000, "region", { targets: ["only"] });
    const resolved = resolveUtterance(spoken("why are these different", 1_100, 300),
                                      timeline);

    const reference = resolved.references[0];
    expect(reference.resolved).toBe(true);
    if (!reference.resolved) return;
    expect(reference.countMismatch).toBe(true);
    expect(resolved.complete).toBe(true);
  });

  it("says what a binding was, for showing before acting", () => {
    const timeline = new ReferenceTimeline();
    timeline.record(1_000, "region", { targets: ["a", "b", "c"] });
    const resolved = resolveUtterance(spoken("why are these different", 1_200, 300),
                                      timeline);

    expect(explain(resolved.references[0]))
      .toContain("3 observations");
  });

  it("explains a failure in terms of what to do", () => {
    const timeline = new ReferenceTimeline();
    const resolved = resolveUtterance(spoken("why are these different", 50_000, 300),
                                      timeline);
    expect(explain(resolved.references[0])).toMatch(/nothing was indicated/i);
  });
});

describe("speech proposes and never performs", () => {
  function withRegion(targets: string[], at = 1_000) {
    const timeline = new ReferenceTimeline();
    timeline.record(at, "region", { targets });
    return timeline;
  }

  it("reads a question as a proposal", () => {
    const timeline = withRegion(["a", "b", "c"]);
    const result = readIntent(
      resolveUtterance(spoken("why are these different", 1_200, 400), timeline));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.kind).toBe("explain");
    expect(describeIntent(result)).toBe("Explain what distinguishes 3 observations?");
  });

  it("reads a comparison over two gestures", () => {
    const timeline = new ReferenceTimeline();
    const a = timeline.begin(1_000, "region");
    timeline.complete(a, 1_300, { targets: ["a1", "a2"] });
    const b = timeline.begin(3_000, "region");
    timeline.complete(b, 3_300, { targets: ["b1"] });

    const result = readIntent(resolveUtterance({
      words: [{ text: "compare", at: 1_100 }, { text: "this", at: 1_250 },
              { text: "with", at: 3_050 }, { text: "this", at: 3_200 }],
      final: true,
    }, timeline));

    expect(result.ok).toBe(true);
    expect(describeIntent(result))
      .toBe("Compare 2 observations with 1 observation?");
  });

  it("refuses a comparison with only one thing indicated", () => {
    const timeline = withRegion(["a"]);
    const result = readIntent(
      resolveUtterance(spoken("compare this", 1_100, 200), timeline));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/needs 2/);
  });

  it("refuses when the pointing word resolved to nothing", () => {
    /**
     * The refusal that matters most. Falling through to the current selection
     * here is how a spoken sentence ends up producing a confident answer about
     * a cluster nobody pointed at.
     */
    const timeline = new ReferenceTimeline();
    const result = readIntent(
      resolveUtterance(spoken("why are these different", 90_000, 300), timeline));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/point at it, or circle it/i);
  });

  it("refuses a sentence with no verb it can act on", () => {
    const timeline = withRegion(["a"]);
    const result = readIntent(
      resolveUtterance(spoken("lovely weather", 1_100, 200), timeline));
    expect(result.ok).toBe(false);
  });

  it("waits rather than acting while the gesture is unfinished", () => {
    const timeline = new ReferenceTimeline();
    timeline.begin(1_000, "region");
    const result = readIntent(
      resolveUtterance(spoken("why are these different", 1_200, 300), timeline));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/still waiting/i);
  });

  it("never returns anything that performs an action", () => {
    // §39: the assistant outputs intentions; the application executes them.
    const timeline = withRegion(["a", "b"]);
    const result = readIntent(
      resolveUtterance(spoken("select these", 1_100, 200), timeline));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.intent).sort())
      .toEqual(["kind", "references", "utterance"]);
  });
});

describe("what is listening, and where the audio goes", () => {
  it("says plainly when audio stays on the machine", () => {
    expect(describeSource({ label: "Local model", privacy: "local" }))
      .toContain("never sent anywhere");
  });

  it("names the recipient when audio leaves the machine", () => {
    /**
     * The browser's built-in recogniser streams microphone audio to Google. It
     * is one line of code and it would break the first claim this project makes
     * about itself, so using it has to be a stated choice rather than a default.
     */
    const sentence = describeSource({
      label: "Browser recognition", privacy: "remote", recipient: "Google",
    });
    expect(sentence).toContain("sent to Google");
    expect(sentence).toMatch(/leaves this machine/i);
  });

  it("refuses a remote source that will not say who receives the audio", () => {
    // "May be processed externally" is phrasing that exists to avoid being
    // understood.
    expect(() => describeSource({ label: "Some service", privacy: "remote" }))
      .toThrow(/must name who receives/);
  });

  it("is off until a recogniser is chosen", async () => {
    const source = new NoSpeechSource();
    expect(source.listening()).toBe(false);
    await expect(source.start()).rejects.toThrow(/sends audio to Google/);
  });

  it("works without a microphone at all", async () => {
    /**
     * Rule 5 and §79: a capability reachable only by voice locks out anybody who
     * cannot use one, and is untestable in CI at the same time. The typed path
     * is the same path.
     */
    const source = new ScriptedSpeechSource();
    const heard: string[] = [];
    await source.start((event) => heard.push(event.text));
    source.utter("why are these different", 1_000, 600);

    expect(heard).toEqual(["why", "are", "these", "different"]);
    expect(source.info().privacy).toBe("local");
  });

  it("spreads a typed sentence over time, as speech arrives", () => {
    const source = new ScriptedSpeechSource();
    const at: number[] = [];
    source.start((event) => at.push(event.at));
    source.utter("compare this with this", 2_000, 900);

    expect(at[0]).toBe(2_000);
    expect(at[at.length - 1]).toBe(2_900);
    expect([...at]).toEqual([...at].sort((a, b) => a - b));
  });
});

describe("one clock, because two is silent", () => {
  /**
   * The bug these exist for shipped, and nothing anywhere reported it.
   *
   * Hand frames were stamped with `performance.now()` — about 10,000,
   * milliseconds since the page loaded — and a typed utterance with
   * `Date.now()`, about 1.76e12, milliseconds since 1970. Every word was
   * therefore 55 years after every gesture, no reference could ever bind, and
   * there was no error, no log and nothing on screen that looked wrong. The
   * end-to-end test passed throughout because synthetic timestamps are
   * consistent with themselves.
   */
  it("refuses a timestamp from a different clock rather than resolving nothing", () => {
    const timeline = new ReferenceTimeline();
    timeline.record(12_000, "region", { targets: ["a"] });

    expect(() => timeline.resolve(Date.now())).toThrow(/same clock/);
  });

  it("names the fix in the message, because the symptom names nothing", () => {
    const timeline = new ReferenceTimeline();
    timeline.record(12_000, "region", { targets: ["a"] });

    expect(() => timeline.resolve(Date.now()))
      .toThrow(/lib\/spatial\/clock/);
  });

  it("accepts a whole session on one clock", () => {
    // Hours apart is fine; decades apart is not. The check has to be blunt
    // enough that a long session never trips it.
    const timeline = new ReferenceTimeline({ backwardMs: 10 ** 9 });
    timeline.record(1_000, "region", { targets: ["a"] });
    expect(() => timeline.resolve(1_000 + 6 * 60 * 60 * 1000)).not.toThrow();
  });

  it("uses a monotonic clock, which the wall clock is not", () => {
    /**
     * `Date.now()` can move backwards — an NTP correction, a daylight-saving
     * change, a laptop waking with a stale clock. A timeline built on it would
     * bind a word to a gesture that had not happened yet, roughly once a
     * fortnight, in a way nobody could reproduce.
     */
    const first = now();
    const second = now();
    expect(second).toBeGreaterThanOrEqual(first);
    // Milliseconds since page load, not since 1970.
    expect(first).toBeLessThan(Date.now() / 1000);
  });
});

describe("when a typed sentence counts as having been said", () => {
  /**
   * The typed path is not a stand-in for speech — it is the path that works
   * today — so getting its timing wrong is getting the feature wrong.
   *
   * And it was wrong. Words were stamped relative to the moment the form was
   * submitted, so drawing a loop and then taking ten seconds to type put every
   * word ten seconds after the gesture, outside the backward window. Somebody
   * referring to the circle they had just drawn was told nothing was indicated.
   */
  it("dates the sentence from when it started being written", () => {
    // Speech does not have this problem because people speak while they
    // gesture. The equivalent for typing is when they started writing.
    const timing = typedTiming(10_000, 13_000);
    expect(timing.startAt).toBe(10_000);
  });

  it("keeps a typed sentence short, because typing is not speaking", () => {
    /**
     * Spreading the words across the typing interval was the second wrong
     * answer, and a test caught it: typing "why are these different" over five
     * seconds put *these* four and a third seconds after the gesture, still
     * outside the window.
     *
     * The deeper problem is that the spread models something that cannot
     * happen. Speech words are spread out because a person gestures *while*
     * speaking; a person cannot gesture while typing, because both hands are
     * busy. Every word of a typed sentence refers to the same moment.
     */
    expect(typedTiming(10_000, 20_000).durationMs).toBeLessThanOrEqual(700);
  });

  it("lets a reference reach the gesture it was about", () => {
    /**
     * The whole point, end to end: circle something, take a few seconds to
     * write the sentence, and "these" still finds it.
     */
    const timeline = new ReferenceTimeline();
    timeline.record(10_000, "region", { targets: ["a", "b"] });

    // Started typing at 11s, submitted at 16s — six seconds after the gesture,
    // which is past the backward window if dated from submission.
    const timing = typedTiming(11_000, 16_000);
    const source = new ScriptedSpeechSource();
    const words: Array<{ text: string; at: number }> = [];
    source.start((e) => words.push({ text: e.text, at: e.at }));
    source.utter("why are these different", timing.startAt, timing.durationMs);

    const resolved = resolveUtterance({ words, final: true }, timeline);
    expect(resolved.complete).toBe(true);
  });

  it("would have missed it dated from submission", () => {
    // Stated as its own assertion, so the fix is shown to matter rather than
    // assumed to.
    const timeline = new ReferenceTimeline();
    timeline.record(10_000, "region", { targets: ["a", "b"] });

    const source = new ScriptedSpeechSource();
    const words: Array<{ text: string; at: number }> = [];
    source.start((e) => words.push({ text: e.text, at: e.at }));
    source.utter("why are these different", 16_000 - 1000, 1000);

    expect(resolveUtterance({ words, final: true }, timeline).complete)
      .toBe(false);
  });

  it("keeps a sentence left half-written anchored to when it was begun", () => {
    /**
     * Dated from the first keystroke however long it took, because that is when
     * the researcher was looking at what they had just done. If the gesture has
     * since expired the reference refuses — which is the correct answer rather
     * than a fallback, and better than silently re-dating the sentence to now
     * and binding it to whatever happens to be recent.
     */
    const timing = typedTiming(1_000, 300_000);
    expect(timing.startAt).toBe(1_000);
    expect(timing.durationMs).toBeLessThanOrEqual(700);
  });

  it("handles a sentence pasted rather than typed", () => {
    const timing = typedTiming(5_000, 5_000);
    expect(timing.startAt).toBe(5_000);
    expect(timing.durationMs).toBe(0);
  });

  it("handles a clock that appears to run backwards", () => {
    // Never negative: a duration below zero would spread the words backwards
    // through the timeline and bind them to whatever was there first.
    const timing = typedTiming(9_000, 5_000);
    expect(timing.durationMs).toBe(0);
    expect(timing.startAt).toBe(5_000);
  });
});
