/**
 * Turning a shaking hand into a steady pointer.
 *
 * Raw landmarks cannot drive a visualization. A hand held deliberately still
 * still moves a few millimetres a frame, and the tracker adds its own noise on
 * top — so a graph wired straight to fingertip coordinates vibrates constantly,
 * which reads as the software being broken rather than the hand being human.
 *
 * The naive fix is a heavy low-pass filter, and it trades one failure for a
 * worse one: the jitter goes, and so does the responsiveness. A researcher
 * moves their hand and the scene follows half a second later, which feels like
 * lag and is unusable for pointing.
 *
 * The One Euro filter (Casiez, Roussel & Vogel, 2012) resolves that by making
 * the smoothing *adaptive*: it filters hard when the hand is nearly still,
 * where jitter is all there is, and barely at all when the hand is moving
 * fast, where lag is what hurts. That is exactly the trade a pointing device
 * needs, which is why it is the standard choice for this problem rather than a
 * clever idea of ours.
 *
 * Implemented here rather than taken as a dependency: it is thirty lines, it
 * has to be unit-testable with synthetic streams, and a package would put a
 * supply-chain risk in the interaction path for no gain.
 */

/** Smoothing factor for a given cutoff and timestep. */
function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

class LowPass {
  private value: number | null = null;

  filter(sample: number, a: number): number {
    this.value = this.value === null ? sample : a * sample + (1 - a) * this.value;
    return this.value;
  }

  get last(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

export type OneEuroSettings = {
  /**
   * Cutoff at rest, in Hz. Lower is steadier and laggier.
   *
   * The dominant knob for "does the graph sit still while my hand sits still",
   * which §51 asks about directly.
   */
  minCutoff: number;
  /**
   * How quickly the filter opens up as the hand speeds up. Higher means more
   * responsive to fast motion and more jitter admitted with it.
   */
  beta: number;
  /** Cutoff for the derivative estimate. Rarely worth changing. */
  derivativeCutoff: number;
};

/**
 * Defaults tuned for normalised (0..1) landmark coordinates at ~30 Hz.
 *
 * These are a starting point, not a result. §16 is right that thresholds should
 * be calibrated against real hands rather than trusted from a paper, and
 * `CalibrationManager` will overwrite them per user. They are recorded here so
 * the system has sane behaviour before anyone calibrates, and so a regression
 * in tuning is visible as a diff.
 */
export const DEFAULT_ONE_EURO: OneEuroSettings = {
  minCutoff: 1.2,
  beta: 0.03,
  derivativeCutoff: 1.0,
};

/** One scalar signal, adaptively smoothed. */
export class OneEuroFilter {
  private readonly x = new LowPass();
  private readonly dx = new LowPass();
  private lastTime: number | null = null;

  constructor(private settings: OneEuroSettings = DEFAULT_ONE_EURO) {}

  configure(settings: Partial<OneEuroSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * @param sample the raw value
   * @param timestamp milliseconds, monotonic
   */
  filter(sample: number, timestamp: number): number {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      this.dx.filter(0, 1);
      return this.x.filter(sample, 1);
    }

    // A non-advancing clock would divide by zero and produce Infinity, which
    // then propagates into the scene transform as NaN and destroys the view.
    // Two frames sharing a timestamp is a real thing that happens when a
    // tracker batches, so it is handled rather than assumed away.
    const dt = Math.max((timestamp - this.lastTime) / 1000, 1e-4);
    this.lastTime = timestamp;

    const previous = this.x.last;
    const rate = previous === null ? 0 : (sample - previous) / dt;
    const smoothedRate = this.dx.filter(rate, alpha(this.settings.derivativeCutoff, dt));

    // The adaptive part: speed opens the cutoff, so fast deliberate motion is
    // followed closely while a still hand is held steady.
    const cutoff = this.settings.minCutoff + this.settings.beta * Math.abs(smoothedRate);
    return this.x.filter(sample, alpha(cutoff, dt));
  }

  /**
   * Forget history.
   *
   * Called on tracking loss. Resuming with a stale value would blend the hand's
   * position from before the gap with its position after it, producing one
   * large fabricated movement at exactly the moment the system is least sure of
   * itself — §32's "huge rotations from tracking spikes".
   */
  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }
}

/** Two independent One Euro filters, for a point. */
export class PointFilter {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;

  constructor(settings: OneEuroSettings = DEFAULT_ONE_EURO) {
    this.fx = new OneEuroFilter(settings);
    this.fy = new OneEuroFilter(settings);
  }

  configure(settings: Partial<OneEuroSettings>): void {
    this.fx.configure(settings);
    this.fy.configure(settings);
  }

  filter(point: { x: number; y: number }, timestamp: number): { x: number; y: number } {
    return {
      x: this.fx.filter(point.x, timestamp),
      y: this.fy.filter(point.y, timestamp),
    };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}
