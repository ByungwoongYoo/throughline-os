/**
 * What the tracker hands over, and nothing about how it got there.
 *
 * The gesture engine reads landmarks, never pixels — §11. That is a privacy
 * property as much as an architectural one: if the only thing that crosses this
 * boundary is twenty-one coordinates per hand, then no layer above it is even
 * *capable* of forwarding an image, and §12's promise stops depending on
 * everyone downstream remembering to keep it.
 *
 * It is also what makes the whole system testable. A synthetic stream of these
 * frames exercises every threshold, every state transition and every safety
 * rule with no camera, no lighting, and no human — which is the only reason the
 * reliability claims in §37 can be evidenced rather than asserted.
 */

/** Normalised to the frame: 0..1 across and down, z relative to the wrist. */
export type Landmark = { x: number; y: number; z?: number };

/**
 * The subset of the twenty-one MediaPipe landmarks this system reads.
 *
 * Named rather than indexed. `landmarks[4]` is the thumb tip and every reader
 * has to know that; `thumbTip` is the same fact written down where it is used.
 */
export type Hand = {
  handedness: "left" | "right";
  /** The tracker's own confidence, 0..1. */
  confidence: number;
  wrist: Landmark;
  thumbTip: Landmark;
  indexTip: Landmark;
  middleTip: Landmark;
  ringTip: Landmark;
  pinkyTip: Landmark;
  /** Index knuckle. Used with the fingertip to tell pointing from a fist. */
  indexBase: Landmark;
  palmCenter: Landmark;
};

/** One tracker output. An empty `hands` means nothing was seen this frame. */
export type HandFrame = {
  timestamp: number;
  hands: Hand[];
};

export function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
