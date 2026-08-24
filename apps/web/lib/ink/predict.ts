/**
 * Hiding the latency that cannot be removed.
 *
 * Between the light hitting the sensor and a pixel changing there is exposure,
 * capture, inference, interpretation and a render — tens of milliseconds that no
 * amount of optimisation deletes. Drawn honestly, the ink trails a few
 * centimetres behind a moving fingertip, and that gap is the single thing that
 * makes air drawing feel like operating a remote pointer rather than holding a
 * pen (§145).
 *
 * So the visible line is extended a short way along the direction the hand is
 * already travelling. This is not guessing what the researcher will draw. It is
 * asserting that a hand moving at a measured speed will still be moving in a few
 * milliseconds, which is true of hands and false of almost nothing else.
 *
 * Three rules keep it honest, and each one is a way this goes wrong:
 *
 * **Clamped to roughly one frame.** Predicting further looks smoother in a
 * straight line and overshoots every corner, and an overshoot on a closed region
 * changes which observations are inside it.
 *
 * **Abandoned when the hand turns.** A sharp direction change means the velocity
 * estimate describes the past. Continuing to extrapolate would round off exactly
 * the corners a researcher drew deliberately.
 *
 * **Marked as predicted.** These points are never treated as observations —
 * `observedPoints` filters them out before any selection or measurement, so a
 * prediction can affect how a line *looks* and never what it *claims*.
 */

export type Velocity = { x: number; y: number; speed: number };

export type PredictSettings = {
  /**
   * How far ahead to predict, in milliseconds.
   *
   * About one frame at 60 Hz. Enough to close most of the perceptible gap,
   * short enough that a wrong guess is a sub-pixel error rather than a visible
   * hook on the end of the line.
   */
  horizonMs: number;
  /**
   * Above this turn angle (radians), prediction is dropped for the frame.
   *
   * ~40°. Below it a hand is following a curve and the velocity still describes
   * where it is going; above it the hand has changed its mind.
   */
  maxTurn: number;
  /**
   * Below this speed (normalised units per second) nothing is predicted.
   *
   * A nearly-still hand has a velocity dominated by tracker noise, and
   * extrapolating noise is how a stationary pen grows a twitching tail.
   */
  minSpeed: number;
  /** Hard ceiling on the predicted step, as a fraction of the frame. */
  maxStep: number;
};

export const DEFAULT_PREDICT: PredictSettings = {
  horizonMs: 16,
  maxTurn: 0.7,
  minSpeed: 0.05,
  maxStep: 0.04,
};

export function velocityBetween(
  from: { x: number; y: number; timestamp: number },
  to: { x: number; y: number; timestamp: number }): Velocity | null {
  const dt = (to.timestamp - from.timestamp) / 1000;
  // Two samples sharing a timestamp is a real thing when a tracker batches, and
  // dividing by it produces an infinite velocity and a point at the far edge of
  // the universe.
  if (!Number.isFinite(dt) || dt <= 0) return null;
  const x = (to.x - from.x) / dt;
  const y = (to.y - from.y) / dt;
  return { x, y, speed: Math.hypot(x, y) };
}

/**
 * Where the fingertip probably is right now, given where it was.
 *
 * Returns null whenever prediction would be a guess rather than an
 * extrapolation — too slow, too sharp a turn, or not enough history. A null is
 * not a failure: it means the honest answer is the last observed point.
 */
export function predictAhead(
  recent: Array<{ x: number; y: number; timestamp: number }>,
  settings: PredictSettings = DEFAULT_PREDICT,
): { x: number; y: number } | null {
  if (recent.length < 3) return null;

  const [a, b, c] = recent.slice(-3);
  const previous = velocityBetween(a, b);
  const current = velocityBetween(b, c);
  if (!previous || !current) return null;
  if (current.speed < settings.minSpeed) return null;

  // How far the direction has turned between the last two segments.
  if (previous.speed > 0) {
    const dot = (previous.x * current.x + previous.y * current.y)
                / (previous.speed * current.speed);
    const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (turn > settings.maxTurn) return null;
  }

  const seconds = settings.horizonMs / 1000;
  let dx = current.x * seconds;
  let dy = current.y * seconds;

  const step = Math.hypot(dx, dy);
  if (step > settings.maxStep) {
    const scale = settings.maxStep / step;
    dx *= scale;
    dy *= scale;
  }

  return { x: c.x + dx, y: c.y + dy };
}
