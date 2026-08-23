/**
 * Learning the four things by doing them (§97).
 *
 * The design question §97 leaves open is how a step completes, and it decides
 * whether any of this is worth having. A slideshow saying "now pinch" with a
 * Next button teaches nothing and confirms nothing: a researcher can click
 * through all four without the tracking having seen them once.
 *
 * Advancing on evidence makes finishing the sequence *proof* that gestures work
 * on this machine, with this camera, in this light, for this hand — and makes
 * being stuck a precise report rather than "it doesn't work".
 */

import { describe, expect, it } from "vitest";
import { GUIDANCE, Onboarding, STEP_ORDER } from "@/lib/spatial/onboarding";
import { DEFAULT_SETTINGS } from "@/lib/spatial/machine";
import { Hand, HandFrame } from "@/lib/spatial/types";

const SPAN = 0.12;

function hand(pinch: number, at = { x: 0.5, y: 0.5 }, confidence = 0.95): Hand {
  return {
    handedness: "right", confidence,
    wrist: { x: at.x, y: at.y + SPAN * 2 },
    indexBase: { x: at.x, y: at.y + SPAN },
    thumbTip: { x: at.x - pinch / 2, y: at.y },
    indexTip: { x: at.x + pinch / 2, y: at.y },
    middleTip: { x: at.x, y: at.y + SPAN * 1.7 },
    ringTip: { x: at.x, y: at.y + SPAN * 1.8 },
    pinkyTip: { x: at.x, y: at.y + SPAN * 1.9 },
    palmCenter: { x: at.x, y: at.y },
  };
}

const OPEN = 0.2, CLOSED = 0.005;

/** Feed the same hand for a while. */
function hold(guide: Onboarding, h: Hand | null, frames = 4) {
  let last = guide.step_({ timestamp: 0, hands: h ? [h] : [] } as HandFrame);
  for (let i = 1; i < frames; i += 1) {
    last = guide.step_({ timestamp: i * 33, hands: h ? [h] : [] } as HandFrame);
  }
  return last;
}

function fresh() {
  return new Onboarding(DEFAULT_SETTINGS);
}

describe("the four steps, in order, on evidence", () => {
  it("starts by asking for a hand", () => {
    expect(fresh().current()).toBe("point");
  });

  it("advances when an open hand is actually seen", () => {
    const guide = fresh();
    hold(guide, hand(OPEN));
    expect(guide.current()).toBe("pinch");
  });

  it("does not advance on a hand the tracker barely believes", () => {
    // Otherwise the sequence would certify tracking that is not working.
    const guide = fresh();
    hold(guide, hand(OPEN, { x: 0.5, y: 0.5 }, 0.1));
    expect(guide.current()).toBe("point");
  });

  it("does not count a hand that arrives already pinched as pointing", () => {
    /**
     * It would skip straight past the next step without ever teaching it, and
     * the researcher would be told they had learnt something they had not done.
     */
    const guide = fresh();
    hold(guide, hand(CLOSED));
    expect(guide.current()).toBe("point");
  });

  it("advances on a real pinch", () => {
    const guide = fresh();
    hold(guide, hand(OPEN));
    hold(guide, hand(CLOSED));
    expect(guide.current()).toBe("move");
  });

  it("advances when the pinched hand travels", () => {
    const guide = fresh();
    hold(guide, hand(OPEN));
    hold(guide, hand(CLOSED));
    hold(guide, hand(CLOSED, { x: 0.7, y: 0.5 }));
    expect(guide.current()).toBe("release");
  });

  it("does not count moving with the fingers open as moving", () => {
    // The lesson is that what you have hold of moves with you, which is not
    // demonstrated by a hand wandering about having let go.
    const guide = fresh();
    hold(guide, hand(OPEN));
    hold(guide, hand(CLOSED));
    hold(guide, hand(OPEN, { x: 0.8, y: 0.5 }));
    expect(guide.current()).toBe("move");
  });

  it("finishes when the fingers open again", () => {
    const guide = fresh();
    hold(guide, hand(OPEN));
    hold(guide, hand(CLOSED));
    hold(guide, hand(CLOSED, { x: 0.7, y: 0.5 }));
    hold(guide, hand(OPEN, { x: 0.7, y: 0.5 }));
    expect(guide.current()).toBe("done");
    expect(guide.finished()).toBe(true);
  });
});

describe("what does not advance it", () => {
  it("needs steady evidence, not one frame", () => {
    /**
     * The same reasoning as the two-frame contact rule. One frame of anything is
     * indistinguishable from a hand passing through on its way somewhere else,
     * and a lesson that advanced on noise would teach a researcher it works when
     * it does not.
     */
    const guide = fresh();
    guide.step_({ timestamp: 0, hands: [hand(OPEN)] } as HandFrame);
    expect(guide.current()).toBe("point");
  });

  it("reports progress within a step, so it is visibly filling", () => {
    const guide = fresh();
    const first = guide.step_({ timestamp: 0, hands: [hand(OPEN)] } as HandFrame);
    const second = guide.step_({ timestamp: 33, hands: [hand(OPEN)] } as HandFrame);
    expect(second.progress).toBeGreaterThan(first.progress);
  });

  it("loses progress when the evidence stops", () => {
    const guide = fresh();
    guide.step_({ timestamp: 0, hands: [hand(OPEN)] } as HandFrame);
    const lost = guide.step_({ timestamp: 33, hands: [hand(CLOSED)] } as HandFrame);
    expect(lost.progress).toBe(0);
  });

  it("pauses rather than restarts when the hand leaves the frame", () => {
    /**
     * Resetting because a hand left for a moment would punish exactly the
     * researcher this exists to help: the one whose camera or lighting is
     * marginal, who is the reason for the sequence in the first place.
     */
    const guide = fresh();
    hold(guide, hand(OPEN));
    expect(guide.current()).toBe("pinch");

    hold(guide, null);
    expect(guide.current()).toBe("pinch");
  });

  it("says when a step has just been completed, for a detent", () => {
    const guide = fresh();
    const results = [0, 1, 2, 3].map((i) =>
      guide.step_({ timestamp: i * 33, hands: [hand(OPEN)] } as HandFrame));
    expect(results.filter((r) => r.justCompleted)).toHaveLength(1);
  });
});

describe("it is never a gate", () => {
  it("can be skipped a step at a time", () => {
    /**
     * §13: the feature must never be required, and a tutorial that has to be
     * dismissed before the product works is a requirement wearing a friendly
     * hat. Skipping *a step* matters as much as skipping the sequence: somebody
     * whose pinch will not register should be able to see the rest rather than
     * being held at the one thing their hand or their camera is bad at.
     */
    const guide = fresh();
    guide.skipStep();
    expect(guide.current()).toBe("pinch");
  });

  it("can be skipped entirely", () => {
    const guide = fresh();
    guide.skipAll();
    expect(guide.finished()).toBe(true);
  });

  it("cannot be skipped past the end", () => {
    const guide = fresh();
    for (let i = 0; i < 10; i += 1) guide.skipStep();
    expect(guide.current()).toBe("done");
  });

  it("does nothing once finished, rather than starting again", () => {
    const guide = fresh();
    guide.skipAll();
    const state = hold(guide, hand(OPEN));
    expect(state.step).toBe("done");
    expect(state.justCompleted).toBe(false);
  });

  it("can be resumed where it was left", () => {
    // A researcher who came back should not be made to do the parts they did.
    const guide = new Onboarding(DEFAULT_SETTINGS, "move");
    expect(guide.current()).toBe("move");
  });
});

describe("what it says", () => {
  it("gives an instruction and a reason for every step", () => {
    for (const step of STEP_ORDER) {
      if (step === "done") continue;
      const guidance = GUIDANCE[step];
      expect(guidance.instruction.length).toBeGreaterThan(10);
      // The reason matters: "pinch" without "this is how you take hold of
      // something" is a command rather than a lesson.
      expect(guidance.because.length).toBeGreaterThan(10);
    }
  });

  it("teaches release as its own act", () => {
    // The one step people skip, and the one that stops the scene following a
    // hand that has finished with it.
    expect(GUIDANCE.release.because).toMatch(/by accident/);
  });
});
