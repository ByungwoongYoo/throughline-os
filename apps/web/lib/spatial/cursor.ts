/**
 * Where the hand is, and what it is about to do (§94, §95, §142, §191).
 *
 * This is the piece whose absence made everything else feel broken. A researcher
 * waves at a figure and nothing acknowledges them until ink appears — so when a
 * pinch does not register there is no way to tell whether the camera cannot see
 * the hand, whether it can see it and disagrees about what a pinch is, or
 * whether the hand is simply not over anything. Three completely different
 * faults, one symptom: nothing happened.
 *
 * §142 states the requirement as a sentence rather than a feature: *the user
 * must never wonder "am I drawing yet"*. Answering that well means answering it
 * **continuously** rather than at the moment of contact. A cursor that appears
 * when drawing starts confirms success and says nothing about failure; one that
 * shows how close the fingers are to the threshold turns "it didn't work" into
 * "I can see I'm at two thirds", which is a thing somebody can act on without
 * being told about hysteresis.
 *
 * Everything here is pure, and that is deliberate: this decides what a
 * researcher sees about their own hand thirty times a second, and it should be
 * possible to be sure it is right without a camera.
 */

import { Hand } from "./types";
import { SpatialSettings } from "./machine";
import { scaleThresholds } from "./calibration";

export type CursorPhase =
  /** No hand in the picture. */
  | "lost"
  /** A hand, open, not over anything it can act on. */
  | "idle"
  /** Over something. Pinching now would act on it. */
  | "hover"
  /** Fingers closed, not yet held long enough to count. */
  | "contact"
  /** Acting: drawing, erasing, lassoing, grabbing. */
  | "active";

export type CursorState = {
  phase: CursorPhase;
  /** Where the hand is, in the coordinates the caller asked for. */
  at: { x: number; y: number } | null;
  /**
   * How closed the pinch is, from 0 (open) to 1 (closed enough to act).
   *
   * The continuous answer to "am I drawing yet". A researcher whose pinch never
   * registers can see whether they are at a tenth or at nine tenths, which is
   * the difference between "the camera cannot see my hand" and "my pinch is not
   * quite what this expects" — two faults with the same symptom and completely
   * different fixes.
   */
  closeness: number;
  /** The tracker's confidence, so a marginal hand looks marginal. */
  confidence: number;
  /** What would happen on contact, for a person rather than a machine. */
  intent: string;
};

/** What the hand is holding, which decides what a pinch would mean (§95). */
export type CursorIntent = "draw" | "erase" | "lasso" | "grab" | "none";

const INTENT_WORDS: Record<CursorIntent, string> = {
  draw: "draw",
  erase: "rub out",
  lasso: "select",
  grab: "turn the figure",
  none: "nothing here",
};

/**
 * How closed the pinch is, as a fraction of the way to registering.
 *
 * Measured against the same span-relative thresholds the gesture machine uses,
 * so what the cursor shows and what the machine decides cannot disagree. A
 * readout that said "nearly there" while the machine had already acted, or the
 * reverse, would be worse than no readout — it would teach the researcher to
 * distrust the one thing telling them what is happening.
 *
 * Clamped at 1 rather than continuing: past the threshold the useful
 * information is "yes", not "very yes".
 */
export function closenessOf(hand: Hand, settings: SpatialSettings): number {
  const { pinchOn } = scaleThresholds(hand, settings);
  const gap = Math.hypot(hand.thumbTip.x - hand.indexTip.x,
                         hand.thumbTip.y - hand.indexTip.y);
  // An open hand sits at roughly twice the threshold; beyond that the exact
  // number stops meaning anything and the bar would just sit empty.
  const open = pinchOn * 2.4;
  if (gap <= pinchOn) return 1;
  if (gap >= open) return 0;
  return (open - gap) / (open - pinchOn);
}

export type CursorInput = {
  hand: Hand | null;
  settings: SpatialSettings;
  /** Whether the machine considers the hand engaged right now. */
  engaged: boolean;
  /** Whether the hand is over something it could act on. */
  overTarget: boolean;
  /** What a pinch would do, given the tool in hand. */
  intent: CursorIntent;
  /** Normalised hand position mapped into the caller's coordinates. */
  project: (point: { x: number; y: number }) => { x: number; y: number };
};

/**
 * The whole cursor, from one frame.
 *
 * `contact` and `active` are separated because they are different answers to the
 * same question: the fingers have met, and the system has accepted it. The gap
 * between them is the two-frame contact rule, and showing it is what stops a
 * researcher concluding that a pinch which was in fact registered a moment later
 * did not register at all.
 */
export function cursorFrom(input: CursorInput): CursorState {
  const { hand, settings, engaged, overTarget, intent, project } = input;

  if (!hand) {
    return { phase: "lost", at: null, closeness: 0, confidence: 0,
             intent: "your hand is not in the picture" };
  }

  const closeness = closenessOf(hand, settings);
  // The pinch centroid, matching where the pen actually is (T044). A cursor
  // drawn at the fingertip would sit 65px from the mark it is about to make.
  const at = project({ x: (hand.thumbTip.x + hand.indexTip.x) / 2,
                       y: (hand.thumbTip.y + hand.indexTip.y) / 2 });

  const phase: CursorPhase = engaged ? "active"
    : closeness >= 1 ? "contact"
    : overTarget ? "hover"
    : "idle";

  return {
    phase, at, closeness, confidence: hand.confidence,
    intent: phase === "active" ? `${INTENT_WORDS[intent]}ing`.replace("eing", "ing")
          : intent === "none" ? INTENT_WORDS.none
          : `pinch to ${INTENT_WORDS[intent]}`,
  };
}

/*
 * Magnetic targeting (§191) is not here, and that is deliberate.
 *
 * A generic "nearest mark within a radius" helper was written in this file and
 * then removed: each chart already does it, in `nearest`, because only a chart
 * knows where its own marks are on screen — and a second implementation working
 * from a copy of the projection is exactly how picking and painting drift apart.
 * A tested but unused helper is the defect this codebase keeps naming, so it
 * went rather than waiting for a caller.
 *
 * What this file owes §191 is the other half of it: "this attraction should
 * affect selection logic more than visible cursor movement. Do not make the
 * pointer visibly jump." The cursor is drawn where the hand is, always, and
 * never at whatever it would select — a pointer that leapt onto the nearest mark
 * would feel possessed, and the researcher would stop trusting the position they
 * can see.
 */
