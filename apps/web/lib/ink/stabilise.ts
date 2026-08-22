/**
 * Making a fingertip steady enough to write with.
 *
 * A hand held in mid-air is not a pen on paper. It has no surface to rest
 * against, no friction, and a tremor of a few millimetres that a table would
 * absorb entirely — and the fingertip is the noisiest landmark on the hand,
 * because error accumulates along the chain from the wrist. Handed straight to a
 * renderer it produces a line that shakes and darts, which is precisely the
 * report this module exists to answer.
 *
 * §153 sets out the pipeline and this implements it in that order: confidence
 * filtering, then spike rejection, then adaptive smoothing, then dead-zone
 * handling. §154 sets the goal the tuning has to hit — *more* stabilisation when
 * the hand moves slowly, less when it moves fast, so handwriting is precise
 * without making a quick arrow feel delayed.
 *
 * **The pen does not share the gesture layer's smoothing, and that was one of
 * two defects.** `DEFAULT_ONE_EURO` has `beta: 0.4`, raised deliberately from
 * 0.03 to cure the scene visibly trailing the hand during rotation. It is nearly
 * flat across the speed range a pen works in, so it barely adapts where §154
 * needs it to.
 *
 * **But smoothing was not the fix, and measuring said so.** The first attempt
 * here lowered `minCutoff` hard, on the reasoning that slow movement wants more
 * stabilisation. Measured against a 60-pixel letter drawn by a hand with tremor,
 * that made things *worse*: the unfiltered hand has an RMS shape error of 1.6px,
 * and `minCutoff: 0.3` turns it into 11.4px. A low cutoff is lag, and lag on a
 * letter drawn in a second is a phase shift that reads as the shape being wrong.
 * Every smoothing setting tested cost shape accuracy; none bought any back. That
 * is §153's "avoid over-smoothing" as a number rather than a caution.
 *
 * **What actually removes the tremor is a very small dead zone.** A hand trying
 * to hold still moves less than a millimetre between frames; a hand writing
 * moves several times that. So a threshold far below the second and above the
 * first separates them almost perfectly, and unlike a filter it costs no lag at
 * all. A dead zone of 0.0015 takes still-hand travel from 625px of raw tracker
 * output — 75px after the inherited filter — down to about 4px, while changing
 * the letter's shape error by 0.05px. The first version of this file used 0.004
 * to 0.006, which is five to eight times too large: at that size it eats the
 * writing as well, and only 56% of a letter survived.
 *
 * So the levels below differ mainly in dead zone and gain. They keep a high
 * cutoff and a high beta throughout, because responsiveness turned out to be
 * free and steadiness turned out to come from somewhere else.
 *
 * **Gain, because a fingertip cannot be placed to the millimetre.** With hand
 * travel mapped one-to-one onto the canvas, a legible letter needs a centimetre
 * of unsupported mid-air precision, and the pen races away from any attempt at
 * fine control. Below 1, gain compresses travel *from where the stroke began*,
 * so the line starts exactly under the fingertip and only the distance
 * afterwards is scaled. Reach is not lost: releasing and re-pinching moves the
 * anchor, the same way lifting a mouse does.
 */

import { PointFilter, OneEuroSettings } from "@/lib/spatial/filter";
import { PredictSettings } from "./predict";

export type StabilisationLevel = "natural" | "steady" | "handwriting";

export type InkStabilisation = {
  /**
   * One Euro tuning for the pen. Deliberately not the gesture layer's.
   *
   * `minCutoff` governs steadiness when the hand is slow — which, for writing,
   * is nearly always — and `beta` governs how far the filter gets out of the way
   * when the hand is quick. A wide gap between them is what §154 is asking for.
   */
  filter: OneEuroSettings;
  /**
   * Movement below this, in normalised camera units, is treated as tremor.
   *
   * Subtracted from the movement rather than blocking it. A dead zone that
   * simply refuses to move produces stair-steps — the pen sits still, then jumps
   * the whole accumulated distance at once — which is more visible than the
   * tremor it removes.
   */
  deadZone: number;
  /**
   * A single-frame jump larger than this is a tracker glitch, not a hand.
   *
   * Judged on raw coordinates, before smoothing, because a filter turns one
   * large jump into a long smear across several frames and the guard never
   * fires. The gesture layer learned this at `spikeThreshold: 0.2`; the pen is
   * stricter, since no hand crosses a tenth of the frame in 33ms while writing.
   */
  spikeThreshold: number;
  /**
   * How much of the hand's travel becomes pen travel, measured from the point
   * the stroke started. 1 is one-to-one.
   */
  gain: number;
  /**
   * How far the visible line is allowed to run ahead of the last observation.
   *
   * Prediction exists to hide camera latency on a fast mark, and it is actively
   * harmful on a slow one: `maxStep: 0.04` is 29 pixels on a 720-wide canvas,
   * and 29 pixels of extrapolation on a letter is not latency compensation, it
   * is the line leaving the hand. Writing also changes direction constantly, and
   * every direction change is a place for an extrapolation to overshoot.
   *
   * So the horizon shortens as stabilisation rises, and at the handwriting
   * setting it is switched off entirely — the honest position of the pen is
   * where the hand was last seen.
   */
  predict: Partial<PredictSettings>;
};

/**
 * Three levels, because the right amount of stabilisation is a property of the
 * person and the room rather than something derivable.
 *
 * `steady` is the default: it is the setting that makes writing possible at all
 * for most people, and the cost — a barely perceptible softening of very fast
 * marks — is much smaller than the cost of a line nobody can control.
 */
export const STABILISATION: Record<StabilisationLevel, InkStabilisation> = {
  /** One-to-one, for big gestural marks and arrows. */
  natural: {
    filter: { minCutoff: 1.8, beta: 1.6, derivativeCutoff: 1.0 },
    deadZone: 0.0012,
    spikeThreshold: 0.12,
    gain: 1,
    predict: { horizonMs: 16, maxStep: 0.02, minSpeed: 0.05 },
  },
  /** The default. Tremor removed, shape kept, marks still sharp. */
  steady: {
    filter: { minCutoff: 1.6, beta: 1.6, derivativeCutoff: 1.0 },
    deadZone: 0.0015,
    spikeThreshold: 0.10,
    gain: 0.9,
    // Half a frame, and a ceiling of about six pixels on a 720-wide canvas.
    predict: { horizonMs: 8, maxStep: 0.008, minSpeed: 0.25 },
  },
  /**
   * For small letters and equations.
   *
   * Note it does *not* smooth harder — it holds the cutoff high, because lag is
   * what damages a letter. It buys precision with a slightly larger dead zone
   * and with gain, which trades hand travel for fine control.
   */
  handwriting: {
    filter: { minCutoff: 1.8, beta: 1.4, derivativeCutoff: 1.0 },
    deadZone: 0.002,
    spikeThreshold: 0.08,
    gain: 0.65,
    // Off. `minSpeed` above any speed a hand writes at means `predictAhead`
    // declines every frame rather than being special-cased here.
    predict: { horizonMs: 0, maxStep: 0, minSpeed: 1e6 },
  },
};

export const DEFAULT_STABILISATION_LEVEL: StabilisationLevel = "steady";

export type StablePoint = { x: number; y: number };

/**
 * One stroke's worth of stabilisation state.
 *
 * Built fresh at every pen-down. Carrying it across strokes would drag the
 * start of a new mark toward wherever the last one ended, and would anchor the
 * gain to a position the hand has since left.
 */
export class Stabiliser {
  private readonly settings: InkStabilisation;
  private readonly smoother: PointFilter;
  /** The last raw sample, for judging whether the next one is plausible. */
  private lastRaw: StablePoint | null = null;
  /** The last point actually emitted, for the dead zone. */
  private held: StablePoint | null = null;
  /** Where the hand was, and where the pen was, when the stroke began. */
  private anchor: StablePoint | null = null;
  private rejected = 0;

  constructor(settings: InkStabilisation) {
    this.settings = settings;
    this.smoother = new PointFilter(settings.filter);
  }

  /** How many frames this stroke discarded as tracker glitches. */
  spikesRejected(): number {
    return this.rejected;
  }

  /**
   * A raw fingertip in normalised camera units, made steady.
   *
   * Returns null when the frame should be discarded entirely — a jump no hand
   * could have made. Discarded rather than smoothed: a glitch fed to the filter
   * pulls the line toward it for several frames afterwards, so one bad frame
   * becomes a visible hook rather than a dropped sample nobody notices.
   */
  push(raw: StablePoint, timestamp: number): StablePoint | null {
    if (this.lastRaw) {
      const jump = Math.hypot(raw.x - this.lastRaw.x, raw.y - this.lastRaw.y);
      if (jump > this.settings.spikeThreshold) {
        this.rejected += 1;
        // `lastRaw` is deliberately not updated. If the tracker has genuinely
        // moved to a new hand the next frame will be a small step from the
        // glitch and would also be rejected for ever, so the comparison stays
        // against the last point believed to be real — one frame is dropped,
        // not the rest of the stroke.
        return null;
      }
    }
    this.lastRaw = raw;

    const smoothed = this.smoother.filter(raw, timestamp);

    if (!this.held || !this.anchor) {
      this.held = smoothed;
      this.anchor = smoothed;
      return smoothed;
    }

    // Dead zone, applied to the movement rather than to the position: the pen
    // still follows the hand, it just gives up the first fraction of a
    // millimetre of every step, which is where tremor lives.
    const dx = smoothed.x - this.held.x;
    const dy = smoothed.y - this.held.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      const kept = Math.max(0, distance - this.settings.deadZone) / distance;
      this.held = { x: this.held.x + dx * kept, y: this.held.y + dy * kept };
    }

    const { gain } = this.settings;
    if (gain === 1) return this.held;
    return {
      x: this.anchor.x + (this.held.x - this.anchor.x) * gain,
      y: this.anchor.y + (this.held.y - this.anchor.y) * gain,
    };
  }
}
