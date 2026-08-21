/**
 * Calibration, and the reason the defaults cannot be right for everybody.
 *
 * The machine's thresholds are distances between two landmarks in normalised
 * image coordinates — `pinchOn: 0.035` means "the thumb and index tips are
 * within 3.5% of the frame width of each other". That number encodes an
 * assumption nobody stated: a particular hand, a particular distance from a
 * particular camera. Move any of the three and it stops meaning what it meant.
 *
 * A child's hand, or an adult sitting back from a large external display, spans
 * a smaller fraction of the frame — so a hand simply *resting*, fingers loosely
 * curled and the thumb near the index, is already inside the pinch threshold.
 * The machine reads a grab nobody made and the scene follows every idle
 * movement, which is precisely what Rule 2 forbids. Lean close on a laptop and
 * the opposite happens: a genuine pinch never gets small enough, and the feature
 * simply does not work, with nothing on screen to say why. Both failures look
 * like the tracking being bad.
 *
 * Two answers here, and the first matters more.
 *
 * **Scale-relative thresholds.** Every hand carries its own ruler: the distance
 * from the wrist to the base of the index finger is a rigid bone length, not a
 * pose, so it changes with how far away the hand is and not with what the hand
 * is doing. Expressing thresholds as a fraction of that span makes them mean the
 * same thing at any distance, for any hand, with no setup at all. This is the
 * default, and most people should never see a calibration screen.
 *
 * **Explicit calibration**, for when it is still wrong. §17 asks for a short
 * setup; the honest version of it is not a wizard that teaches the researcher
 * the gestures, it is two samples — hold your hand open, now pinch — from which
 * the threshold is placed between the two measured values rather than guessed.
 *
 * Both paths refuse to produce a result they cannot justify. A calibration from
 * samples that do not separate is not a worse calibration, it is a wrong one:
 * it would leave the researcher with a feature that misreads them and a screen
 * that told them they were finished.
 */

import { Hand, distance } from "./types";
import type { SpatialSettings } from "./machine";

/**
 * The hand's own ruler, in normalised image units.
 *
 * Wrist to index base: a bone length, so it varies with distance from the
 * camera and not with the gesture being made. Deliberately not the fingertip —
 * every fingertip distance changes as the hand opens and closes, which is the
 * thing being measured, and using one would make the ruler depend on the
 * measurement.
 */
export function handScale(hand: Hand): number {
  return distance(hand.wrist, hand.indexBase);
}

/**
 * A hand at rest occupies roughly a fifth of the frame this way. Used only to
 * decide whether a measured scale is plausible, never as the scale itself.
 */
const PLAUSIBLE_SCALE = { min: 0.03, max: 0.6 };

/**
 * The hand span the absolute defaults were written against.
 *
 * Stated rather than left implicit, because it is the assumption that makes
 * `pinchOn: 0.035` mean anything: it is 0.035 *of a 0.10 span*, so the ratios
 * below are the same two numbers divided by the same reference. If the absolute
 * defaults are ever retuned the ratios follow, instead of the two drifting into
 * disagreeing about what a pinch is.
 */
export const REFERENCE_SPAN = 0.1;

/**
 * Thresholds for the hand actually in frame, in the same normalised units the
 * machine compares against.
 *
 * Falls back to the absolute settings when the measured span is implausible. A
 * badly tracked frame reporting a 0.001 span would otherwise produce a threshold
 * no pinch could ever satisfy, and the feature would go dead for the rest of the
 * session with nothing on screen to say why — the failure mode this whole file
 * exists to prevent, reintroduced by the fix for it.
 */
export function scaleThresholds(
  hand: Hand, settings: SpatialSettings,
): { pinchOn: number; pinchOff: number } {
  const span = handScale(hand);
  if (!settings.adaptiveThresholds || !Number.isFinite(span)
      || span < PLAUSIBLE_SCALE.min || span > PLAUSIBLE_SCALE.max) {
    return { pinchOn: settings.pinchOn, pinchOff: settings.pinchOff };
  }
  return {
    pinchOn: span * settings.pinchRatioOn,
    pinchOff: span * settings.pinchRatioOff,
  };
}

// ---------------------------------------------------------------------------
// Explicit calibration
// ---------------------------------------------------------------------------

export type CalibrationStep = "open" | "pinch" | "done";

/**
 * The result is expressed as *ratios*, not absolute distances, because that is
 * what was measured: every sample is divided by the hand's own span before it is
 * recorded. A researcher who calibrates leaning forward and then sits back keeps
 * working, which an absolute threshold measured in that one position would not.
 */
export type CalibrationResult =
  | { ok: true;
      settings: Pick<SpatialSettings, "pinchRatioOn" | "pinchRatioOff">;
      openSpan: number; pinchSpan: number }
  | { ok: false; reason: CalibrationProblem; message: string };

export type CalibrationProblem =
  | "too-few-samples"
  | "no-separation"
  | "unstable";

/** Enough frames to average out tracker jitter; ~half a second at 30 Hz. */
const REQUIRED_SAMPLES = 12;

/**
 * The two measurements have to be distinguishable by a margin, not merely
 * ordered. Samples 0.30 and 0.29 apart are two attempts at the same pose seen
 * through noise, and a threshold placed between them would flicker.
 */
const REQUIRED_SEPARATION = 1.6;    // open span at least 1.6x the pinched span

/**
 * How much a single pose is allowed to wander before the sample is untrustworthy.
 * A researcher who moved their hand across the frame while it was being measured
 * has not held a pose, and averaging the result would produce a confident number
 * describing nothing.
 */
const MAX_SPREAD = 0.45;            // as a fraction of the mean

export class CalibrationManager {
  private open: number[] = [];
  private pinch: number[] = [];
  private step: CalibrationStep = "open";

  current(): CalibrationStep {
    return this.step;
  }

  /** How far through the current step, for a progress indicator (§17). */
  progress(): number {
    const samples = this.step === "open" ? this.open.length : this.pinch.length;
    return Math.min(1, samples / REQUIRED_SAMPLES);
  }

  /**
   * Record one frame against the current step.
   *
   * Measured as a *ratio* to the hand's own span rather than as a raw distance,
   * so a researcher who drifts a little closer to the camera mid-calibration
   * does not bake that drift into their thresholds.
   */
  sample(hand: Hand): void {
    if (this.step === "done") return;
    const span = handScale(hand);
    const pinchDistance = distance(hand.thumbTip, hand.indexTip) / span;

    // One check, not two. A separate `span <= 0` guard stood here until a
    // mutation showed deleting it changed nothing: a zero span makes the ratio
    // `Infinity` (or `NaN`, if the distance is zero too), and this line already
    // rejects both. It read as defensive and was dead.
    if (!Number.isFinite(pinchDistance)) return;

    if (this.step === "open") this.open.push(pinchDistance);
    else this.pinch.push(pinchDistance);
  }

  /** Whether the current step has what it needs, so the interface can advance. */
  stepComplete(): boolean {
    return this.progress() >= 1;
  }

  advance(): void {
    if (this.step === "open") this.step = "pinch";
    else if (this.step === "pinch") this.step = "done";
  }

  reset(): void {
    this.open = [];
    this.pinch = [];
    this.step = "open";
  }

  /**
   * Turn the samples into thresholds, or say why they cannot be.
   *
   * Refusing is a real outcome here, not an error path to be smoothed over. A
   * calibration that cannot separate the two poses and returns a number anyway
   * hands the researcher a feature that misreads them plus a screen that told
   * them they were done — and the next thing they blame is the tracking.
   */
  finish(): CalibrationResult {
    if (this.open.length < REQUIRED_SAMPLES || this.pinch.length < REQUIRED_SAMPLES) {
      return { ok: false, reason: "too-few-samples",
        message: "Not enough of the hand was seen to measure it. Try again with "
               + "your hand fully in the picture." };
    }

    const openSpan = median(this.open);
    const pinchSpan = median(this.pinch);

    if (spread(this.open) > MAX_SPREAD || spread(this.pinch) > MAX_SPREAD) {
      return { ok: false, reason: "unstable",
        message: "Your hand moved while it was being measured. Hold each pose "
               + "still for a moment and try again." };
    }

    if (!(openSpan > pinchSpan * REQUIRED_SEPARATION)) {
      return { ok: false, reason: "no-separation",
        message: "The open and pinched hands measured almost the same. Open "
               + "your hand wide for the first pose, and touch your thumb and "
               + "index finger together for the second." };
    }

    // Placed between the two measurements rather than at either: at the open
    // value an idle hand grabs, at the pinched value the grab only registers
    // when the fingers are already touching. The gap between on and off is the
    // hysteresis §29 needs, and it is proportional to the separation actually
    // measured rather than a constant that may be wider than this researcher's
    // whole range.
    const pinchRatioOn = pinchSpan + (openSpan - pinchSpan) * 0.35;
    const pinchRatioOff = pinchSpan + (openSpan - pinchSpan) * 0.55;

    return { ok: true, settings: { pinchRatioOn, pinchRatioOff },
             openSpan, pinchSpan };
  }
}

/**
 * Median, not mean. One frame where the tracker briefly lost a fingertip
 * produces an outlier large enough to move a mean by more than the separation
 * being measured, and the whole point of taking twelve samples is to be immune
 * to that.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/** Interquartile-ish spread, relative to the middle, for the stability check. */
function spread(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)];
  const high = sorted[Math.floor(sorted.length * 0.9)];
  const middle = median(values);
  return middle > 0 ? (high - low) / middle : Infinity;
}
