/**
 * Learning the four things, by doing them (§97).
 *
 * §97 is unusually specific about what not to build: no thirty-minute tutorial,
 * progressive rather than up-front, and a first session covering exactly point,
 * pinch, move, release. What it does not say, and what decides whether this is
 * worth anything, is how a step is completed.
 *
 * **Each step advances on evidence from the hand, not on a button.** A slideshow
 * saying "now pinch" and offering Next teaches nothing and confirms nothing — a
 * researcher can click through all four without the tracking ever having seen
 * them. Waiting until the pinch actually registers means finishing the sequence
 * *is* proof that gestures work on this machine, with this camera, in this
 * light, for this hand.
 *
 * That makes it a diagnostic as much as a lesson, which matters more here than
 * it would elsewhere: every report of this feature "not working" so far has been
 * a symptom shared by three unrelated faults. Somebody stuck on *pinch* while
 * *point* completed knows the camera can see them and the pinch threshold is the
 * problem. That is a bug report instead of a shrug.
 *
 * **It never blocks anything.** §13 says the feature must never be required, and
 * a tutorial that has to be dismissed before the product works is a requirement
 * wearing a friendly hat. Every step can be skipped, the whole thing can be
 * skipped, and the scene responds to the hand throughout.
 */

import { Hand, HandFrame, distance } from "./types";
import { SpatialSettings } from "./machine";
import { scaleThresholds } from "./calibration";

export type OnboardingStep = "point" | "pinch" | "move" | "release" | "done";

export const STEP_ORDER: readonly OnboardingStep[] =
  ["point", "pinch", "move", "release", "done"];

export type StepGuidance = {
  /** What to do, in the imperative, because it is an instruction. */
  instruction: string;
  /** Why it is worth knowing, in one clause. */
  because: string;
};

export const GUIDANCE: Record<Exclude<OnboardingStep, "done">, StepGuidance> = {
  point: {
    instruction: "Hold your hand up, open, where the camera can see it.",
    because: "everything starts from the system seeing your hand at all",
  },
  pinch: {
    instruction: "Touch your thumb and index finger together.",
    because: "a pinch is how you take hold of something",
  },
  move: {
    instruction: "Keeping them together, move your hand.",
    because: "what you have hold of moves with you",
  },
  release: {
    instruction: "Open your fingers again.",
    because: "letting go is a separate act, so nothing follows your hand by accident",
  },
};

/**
 * Frames of steady evidence before a step counts as done.
 *
 * The same reasoning as the two-frame contact rule, for the same reason: one
 * frame of anything is indistinguishable from a hand passing through on its way
 * somewhere else, and a lesson that advanced on noise would teach a researcher
 * that it works when it does not.
 */
const STEADY_FRAMES = 3;

/** How far a hand must travel, in normalised units, to count as moving. */
const MOVE_DISTANCE = 0.06;

export type OnboardingState = {
  step: OnboardingStep;
  /** Progress within the current step, 0 to 1, for something to watch fill. */
  progress: number;
  /** True on the frame a step is completed, for a detent. */
  justCompleted: boolean;
};

/**
 * Watches the hand and advances when a step is genuinely done.
 *
 * Holds no timers and reads no clock: it is driven entirely by frames, so the
 * whole sequence can be exercised in a test without a camera — which is the only
 * way any of this could be checked at all.
 */
export class Onboarding {
  private step: OnboardingStep;
  private steady = 0;
  private pinchedAt: { x: number; y: number } | null = null;
  private settings: SpatialSettings;

  constructor(settings: SpatialSettings, from: OnboardingStep = "point") {
    this.settings = settings;
    this.step = from;
  }

  current(): OnboardingStep {
    return this.step;
  }

  finished(): boolean {
    return this.step === "done";
  }

  /**
   * Give up on the current step, or on the whole thing.
   *
   * Skipping a step rather than only the sequence matters: a researcher whose
   * pinch will not register should be able to see the rest rather than being
   * held at the one thing their hand or their camera is bad at.
   */
  skipStep(): void {
    const at = STEP_ORDER.indexOf(this.step);
    this.step = STEP_ORDER[Math.min(at + 1, STEP_ORDER.length - 1)];
    this.steady = 0;
    this.pinchedAt = null;
  }

  skipAll(): void {
    this.step = "done";
    this.steady = 0;
  }

  step_(frame: HandFrame): OnboardingState {
    if (this.step === "done") {
      return { step: "done", progress: 1, justCompleted: false };
    }

    const hand = frame.hands[0];
    if (!hand) {
      /*
       * A lost hand pauses the step rather than failing it.
       *
       * Resetting to the beginning because somebody's hand left the frame for a
       * moment would punish exactly the researcher this is meant to help — the
       * one whose camera or lighting is marginal, who is the reason the
       * sequence exists.
       */
      this.steady = 0;
      return { step: this.step, progress: 0, justCompleted: false };
    }

    const done = this.satisfied(hand);
    this.steady = done ? this.steady + 1 : 0;

    if (this.steady >= STEADY_FRAMES) {
      const at = STEP_ORDER.indexOf(this.step);
      this.step = STEP_ORDER[at + 1];
      this.steady = 0;
      if (this.step === "move") this.pinchedAt = { ...hand.indexTip };
      return { step: this.step, progress: 0, justCompleted: true };
    }

    return { step: this.step, progress: this.steady / STEADY_FRAMES,
             justCompleted: false };
  }

  /** Whether this frame satisfies the current step. */
  private satisfied(hand: Hand): boolean {
    const { pinchOn, pinchOff } = scaleThresholds(hand, this.settings);
    const gap = distance(hand.thumbTip, hand.indexTip);

    switch (this.step) {
      case "point":
        // Seen, believed, and open — so "point" is not satisfied by a hand that
        // happens to arrive already pinched, which would skip the next step
        // without teaching it.
        return hand.confidence >= this.settings.minConfidence && gap > pinchOn;
      case "pinch":
        return gap < pinchOn;
      case "move": {
        if (gap > pinchOff) return false;      // let go: not moving with it
        if (!this.pinchedAt) { this.pinchedAt = { ...hand.indexTip }; return false; }
        return Math.hypot(hand.indexTip.x - this.pinchedAt.x,
                          hand.indexTip.y - this.pinchedAt.y) > MOVE_DISTANCE;
      }
      case "release":
        // Against the *off* threshold, matching the hysteresis everything else
        // uses, so a hand hovering at the boundary is not told it has released
        // while the machine still considers it held.
        return gap > pinchOff;
      case "done":
        return true;
    }
  }
}
