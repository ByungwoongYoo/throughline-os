/**
 * Which hand is the researcher's (§32).
 *
 * The tracker reports hands, not people, and the code took the first one in the
 * list — correct exactly while one person is in frame, which an office, a lab
 * and a lecture room are none of them reliably.
 *
 * The failure this prevents is the worst kind available to a gesture system:
 * mid-drag, the tracked hand silently becomes somebody else's and the object
 * follows a stranger. It reads as randomly losing control rather than as two
 * people being present, so it gets diagnosed as jitter and tuned against
 * forever.
 *
 * §32 says reliability beats cleverness, so the tests that matter most here are
 * the ones asserting it *pauses* rather than choosing.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_WHOSE, chooseHand, describeChoice } from "@/lib/spatial/whose";
import { Hand, HandFrame } from "@/lib/spatial/types";

function hand(x: number, y: number, over: Partial<Hand> = {}): Hand {
  const at = { x, y };
  return {
    handedness: "right", confidence: 0.9,
    wrist: at, thumbTip: at, indexTip: at, middleTip: at, ringTip: at,
    pinkyTip: at, indexBase: at, palmCenter: at,
    ...over,
  };
}

const frame = (hands: Hand[]): HandFrame => ({ timestamp: 0, hands });

describe("one person in frame", () => {
  it("takes the only hand", () => {
    const choice = chooseHand(frame([hand(0.5, 0.5)]), null);
    expect(choice.kind).toBe("hand");
    if (choice.kind === "hand") expect(choice.because).toBe("only");
  });

  it("has nothing to choose from an empty frame", () => {
    expect(chooseHand(frame([]), null).kind).toBe("none");
  });

  it("ignores a hand the tracker is unsure of", () => {
    // A low-confidence hand is as likely to be a face, a chair back or a
    // reflection as a hand, and acting on one is how an object moves because
    // somebody walked past a window.
    expect(chooseHand(frame([hand(0.5, 0.5, { confidence: 0.2 })]), null).kind)
      .toBe("none");
  });
});

describe("two people in frame", () => {
  it("keeps following the hand it was already following", () => {
    /*
     * Continuity first, and the ordering is the whole of §32. Preferring
     * handedness would hand control to a second person the instant they raised
     * the matching hand.
     */
    const mine = hand(0.30, 0.50);
    const theirs = hand(0.80, 0.50);
    const choice = chooseHand(
      frame([theirs, mine]), { handedness: "right", at: { x: 0.28, y: 0.50 } });

    expect(choice.kind).toBe("hand");
    if (choice.kind === "hand") {
      expect(choice.hand.palmCenter.x).toBeCloseTo(0.30, 6);
      expect(choice.because).toBe("continuity");
    }
  });

  it("does not care what order the tracker listed them in", () => {
    // MediaPipe makes no promise about ordering between frames, which is
    // precisely why taking hands[0] fails intermittently rather than always.
    const mine = hand(0.30, 0.50);
    const theirs = hand(0.80, 0.50);
    const tracked = { handedness: "right" as const, at: { x: 0.28, y: 0.50 } };

    for (const hands of [[mine, theirs], [theirs, mine]]) {
      const choice = chooseHand(frame(hands), tracked);
      if (choice.kind !== "hand") throw new Error("expected a hand");
      expect(choice.hand.palmCenter.x).toBeCloseTo(0.30, 6);
    }
  });

  it("pauses when two hands are equally close to the tracked one", () => {
    /*
     * The coin toss this exists to refuse. Choosing here would be right half
     * the time and would move a researcher's work with a stranger's hand the
     * other half.
     */
    const choice = chooseHand(
      frame([hand(0.40, 0.50), hand(0.60, 0.50)]),
      { handedness: "right", at: { x: 0.50, y: 0.50 } });
    expect(choice.kind).toBe("ambiguous");
  });

  it("pauses when nothing was being tracked and both hands match", () => {
    // Two right hands says two people, and handedness cannot separate them.
    const choice = chooseHand(
      frame([hand(0.3, 0.5), hand(0.8, 0.5)]), null, "right");
    expect(choice.kind).toBe("ambiguous");
    if (choice.kind === "ambiguous") {
      expect(choice.reason).toContain("right hand");
    }
  });

  it("uses the calibrated hand when only one matches", () => {
    const choice = chooseHand(
      frame([hand(0.3, 0.5, { handedness: "left" }), hand(0.8, 0.5)]),
      null, "right");
    expect(choice.kind).toBe("hand");
    if (choice.kind === "hand") expect(choice.because).toBe("handedness");
  });

  it("pauses when there is nothing to go on at all", () => {
    const choice = chooseHand(frame([hand(0.3, 0.5), hand(0.8, 0.5)]), null);
    expect(choice.kind).toBe("ambiguous");
  });
});

describe("the hand that left and came back", () => {
  it("does not claim continuity across a jump", () => {
    /*
     * A hand that vanished and reappeared on the other side of the frame is
     * not the same gesture continuing. Treating it as one would let a drag
     * resume from wherever a hand next happened to appear.
     */
    const choice = chooseHand(
      frame([hand(0.90, 0.10), hand(0.85, 0.15)]),
      { handedness: "right", at: { x: 0.10, y: 0.90 } });
    expect(choice.kind).toBe("ambiguous");
  });

  it("refuses a distant hand even when it is clearly the nearest", () => {
    /*
     * The distance bound on its own, isolated from the tie rule.
     *
     * The test above it has two equally-distant hands, so it is the tie check
     * that answers and a mutation removing the distance bound survived it. Here
     * one hand is unambiguously nearest — and still too far to be the hand that
     * was being tracked a frame ago, so continuity must not be claimed.
     */
    const choice = chooseHand(
      frame([hand(0.35, 0.35), hand(0.90, 0.90)]),
      { handedness: "right", at: { x: 0, y: 0 } });
    expect(choice.kind).toBe("ambiguous");
  });

  it("allows the distance a hand really covers between frames", () => {
    /*
     * The tracker runs at about 30fps, so a sample is ~33ms. Across a 0.6m
     * field of view a hand moving 3 m/s — a very fast deliberate sweep —
     * travels about 0.17 of the frame. The 0.35 threshold covers roughly
     * 6 m/s, which is beyond anything a person does on purpose.
     *
     * An earlier version of this test used a gap of 0.354 and failed, having
     * poked the boundary rather than the intent. These are the numbers a hand
     * actually produces.
     */
    const sweep = 0.17;
    const choice = chooseHand(
      frame([hand(0.30 + sweep, 0.30), hand(0.95, 0.95)]),
      { handedness: "right", at: { x: 0.30, y: 0.30 } },
      null,
      DEFAULT_WHOSE);
    expect(choice.kind).toBe("hand");
    if (choice.kind === "hand") {
      expect(choice.hand.palmCenter.x).toBeCloseTo(0.47, 6);
    }
  });

  it("covers a far faster sweep than anybody performs", () => {
    // Stated as a property rather than a magic number, so changing the
    // threshold has to be a decision about hand speed rather than a nudge.
    const sampleSeconds = 1 / 30;
    const fieldOfViewMetres = 0.6;
    const covered = (DEFAULT_WHOSE.continuity * fieldOfViewMetres) / sampleSeconds;
    expect(covered).toBeGreaterThan(3);
  });
});

describe("saying why nothing is happening", () => {
  it("explains an ambiguous frame rather than going quiet", () => {
    /*
     * A system that simply stops responding teaches a researcher that tracking
     * is unreliable. Naming the cause — more than one hand — is the difference
     * between a fault and a situation.
     */
    const choice = chooseHand(frame([hand(0.3, 0.5), hand(0.8, 0.5)]), null);
    expect(describeChoice(choice)).toContain("Paused");
  });

  it("says plainly when no hand is in view", () => {
    expect(describeChoice(chooseHand(frame([]), null)))
      .toContain("not in the picture");
  });

  it("says nothing when there is a hand", () => {
    // Silence is correct here: an interface that narrates success is noise.
    expect(describeChoice(chooseHand(frame([hand(0.5, 0.5)]), null))).toBe("");
  });
});
