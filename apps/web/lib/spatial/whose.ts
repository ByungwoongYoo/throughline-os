/**
 * Which hand is the researcher's (§32).
 *
 * The tracker reports hands, not people. Until now the first one in the list
 * was taken unconditionally, which is correct exactly while one person is in
 * frame — and a laboratory, an office and a lecture room are none of them
 * reliably that. A colleague leaning over to look, somebody walking behind the
 * desk, a second monitor with a person reflected in it: any of these can add a
 * hand, and MediaPipe makes no promise about ordering between frames.
 *
 * The failure that produces is the worst kind. Mid-drag, the tracked hand
 * silently becomes somebody else's, and the object follows a stranger. It reads
 * as the system randomly losing control rather than as two people being
 * present, so it is diagnosed as jitter and tuned against forever.
 *
 * §32's own instruction is the design: *"Reliability beats cleverness."* So
 * this prefers continuity, then the calibrated hand, and when neither settles
 * it — **pauses rather than guessing**. A moment of nothing happening is a
 * state a person understands and waits out. An object that jumps to a stranger's
 * hand is one they cannot explain.
 */

import { Hand, HandFrame, Landmark, distance } from "./types";

export type HandChoice =
  /** This hand, and why it was chosen. */
  | { kind: "hand"; hand: Hand; because: "only" | "continuity" | "handedness" }
  /** Nothing usable in frame. */
  | { kind: "none" }
  /**
   * Two hands are equally plausible.
   *
   * Deliberately distinct from `none`: the caller must hold whatever it was
   * doing rather than treat it as the hand having left, because releasing a
   * grab is itself an action and doing it because somebody walked past is the
   * accidental action §87 counts.
   */
  | { kind: "ambiguous"; reason: string };

export type WhoseSettings = {
  /**
   * How far a hand may travel between frames and still be the same hand, in
   * normalised units.
   *
   * Generous, because a hand moves fast and the tracker runs at a third of the
   * render rate: at 30fps a deliberate sweep covers a good part of the frame
   * between samples. Tight enough that a second person standing elsewhere is
   * never nearer than the hand actually being tracked.
   */
  continuity: number;
  /** Below this a hand is not considered at all. */
  minConfidence: number;
};

export const DEFAULT_WHOSE: WhoseSettings = {
  continuity: 0.35,
  minConfidence: 0.5,
};

/** What was being tracked, so this frame can be matched against it. */
export type Tracked = {
  handedness: "left" | "right";
  /** Where it was, for continuity. */
  at: Landmark;
};

/**
 * Choose the researcher's hand from whatever is in frame.
 *
 * The order matters and is the whole of §32. Continuity first: the hand that
 * was being tracked a moment ago is almost certainly still the right one, and
 * preferring handedness first would hand control to a second person the instant
 * they raised the matching hand.
 */
export function chooseHand(
  frame: HandFrame,
  tracked: Tracked | null,
  calibrated: "left" | "right" | null = null,
  settings: WhoseSettings = DEFAULT_WHOSE,
): HandChoice {
  const usable = frame.hands.filter(
    (hand) => hand.confidence >= settings.minConfidence);

  if (usable.length === 0) return { kind: "none" };
  if (usable.length === 1) return { kind: "hand", hand: usable[0], because: "only" };

  /*
   * Continuity. The nearest hand to where the tracked one was, provided it is
   * near enough to be the same hand and clearly nearer than the alternatives.
   */
  if (tracked) {
    const ranked = usable
      .map((hand) => ({ hand, gap: distance(hand.palmCenter, tracked.at) }))
      .sort((a, b) => a.gap - b.gap);

    const [nearest, next] = ranked;
    if (nearest.gap <= settings.continuity) {
      // Clearly nearer, not merely nearer. Two hands the same distance from
      // the last position are exactly the case where picking one is a coin
      // toss performed silently.
      if (!next || next.gap > nearest.gap * 1.5) {
        return { kind: "hand", hand: nearest.hand, because: "continuity" };
      }
      return {
        kind: "ambiguous",
        reason: "Two hands are equally close to the one being tracked.",
      };
    }
  }

  /*
   * Nothing to continue from. Fall back to the hand the researcher calibrated
   * with, if exactly one hand matches it — two right hands in frame says two
   * people, and handedness cannot separate them.
   */
  if (calibrated) {
    const matching = usable.filter((hand) => hand.handedness === calibrated);
    if (matching.length === 1) {
      return { kind: "hand", hand: matching[0], because: "handedness" };
    }
    if (matching.length > 1) {
      return {
        kind: "ambiguous",
        reason: `More than one ${calibrated} hand is in view.`,
      };
    }
  }

  return {
    kind: "ambiguous",
    reason: "More than one hand is in view and none is clearly yours.",
  };
}

/**
 * What to show a researcher when the hand cannot be identified.
 *
 * Said plainly, because the alternative is a system that stops responding for
 * no stated reason — and the conclusion a person draws from that is that
 * tracking is unreliable, not that a colleague walked behind them.
 */
export function describeChoice(choice: HandChoice): string {
  switch (choice.kind) {
    case "hand": return "";
    case "none": return "Your hand is not in the picture.";
    case "ambiguous": return `${choice.reason} Paused until one is.`;
  }
}

/** What one frame means for the hand being followed. */
export type Following = {
  /** The hand to measure and address a chart with, if any. */
  hand: Hand | undefined;
  /**
   * Change nothing this frame.
   *
   * Distinct from `hand: undefined`, and the distinction is the whole point:
   * releasing a grab is itself an action, and doing it because somebody walked
   * behind the desk is the accidental action §87 counts.
   */
  hold: boolean;
  /** Why nothing is happening, when nothing is. Null when something is. */
  message: string | null;
  /** What to remember for the next frame's continuity. */
  tracked: Tracked | null;
};

/**
 * Follow a hand across frames, including through a deliberate two-handed
 * gesture.
 *
 * Separate from `chooseHand` because it answers a different question, and the
 * difference is a mistake that was actually made. `chooseHand` asks which
 * single hand is the researcher's, and treats two as ambiguous — correct on its
 * own terms. But this system also has a two-handed zoom, which the machine
 * reasons about separately (§17: "two hands in frame is not two hands in use"),
 * and wiring the choice straight in held during every legitimate pinch-zoom and
 * then explained the break with a message about somebody walking past: a fix
 * that broke a working feature and misdescribed the damage.
 *
 * `twoHanded` is the machine's own answer to whether both hands are in use. It
 * is a parameter rather than something derived here because this file cannot
 * see gesture state, and guessing at it from hand positions is what produced
 * the mistake in the first place.
 */
export function followFrame(
  frame: HandFrame,
  tracked: Tracked | null,
  twoHanded: boolean,
  calibrated: "left" | "right" | null = null,
  settings: WhoseSettings = DEFAULT_WHOSE,
): Following {
  const choice = chooseHand(frame, tracked, calibrated, settings);

  if (choice.kind === "hand") {
    return {
      hand: choice.hand, hold: false, message: null,
      tracked: { handedness: choice.hand.handedness,
                 at: choice.hand.palmCenter },
    };
  }

  if (twoHanded) {
    /*
     * Both hands are the researcher's and the gesture is under way. The only
     * question left is which one this frame's measurement describes, and the
     * answer is the one nearer to where the followed hand was — not whichever
     * the tracker happened to list first, which is what this whole function
     * exists to stop.
     */
    return { hand: nearest(frame, tracked), hold: false, message: null, tracked };
  }

  if (choice.kind === "ambiguous") {
    return { hand: undefined, hold: true, message: describeChoice(choice), tracked };
  }

  /*
   * No hand. No message: the panel already says "your hand is not in the
   * picture" from the machine's own state, and two sentences saying the same
   * thing in different words read as two different problems.
   */
  return { hand: undefined, hold: false, message: null, tracked: null };
}

function nearest(frame: HandFrame, tracked: Tracked | null): Hand | undefined {
  if (frame.hands.length === 0) return undefined;
  if (tracked === null) return frame.hands[0];
  return [...frame.hands].sort(
    (a, b) => distance(a.palmCenter, tracked.at) - distance(b.palmCenter, tracked.at),
  )[0];
}
