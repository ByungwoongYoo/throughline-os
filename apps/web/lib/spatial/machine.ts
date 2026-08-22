/**
 * Deciding whether the researcher meant it.
 *
 * This is the file the feature succeeds or fails on, and it is worth being
 * plain about why. Hand tracking is a solved problem — a library returns
 * landmarks and they are good enough. What is not solved, and what every
 * webcam-gesture demo gets wrong, is the difference between *a hand being
 * visible* and *a person intending to act*. A professor explaining a result
 * gestures constantly. If any of that moves the graph, the feature is worse
 * than useless: it is actively hostile during the exact moment it was supposed
 * to shine.
 *
 * So the machine's default answer is no. Movement reaches the visualization
 * only inside an explicit engagement, entered by a deliberate act — the pinch
 * is a clutch, exactly as a mouse button is (§5). An open hand waving across
 * the entire frame emits nothing at all.
 *
 * Four mechanisms, each guarding a different way this goes wrong:
 *
 * **Hysteresis** (§16). Pinch begins below one distance and ends above a wider
 * one. A single threshold sits exactly where a nearly-pinched hand hovers, and
 * the state flickers on and off several times a second — which the researcher
 * experiences as the graph convulsing while they hold still.
 *
 * **Dead zone** (§15). Sub-threshold movement is dropped rather than scaled
 * down. Scaling it down still moves the scene, and "the graph drifts while my
 * hand is still" is the complaint that ends trust in the feature.
 *
 * **Spike rejection** (§32). A tracking glitch can teleport a landmark across
 * the frame between two updates. Passed through, that is an enormous rotation
 * from a hand that never moved, and it is unrecoverable without a view reset.
 * Implausible jumps are discarded, not smoothed.
 *
 * **Immediate release on loss** (§31, §32). When tracking drops, every active
 * gesture ends that instant and nothing is extrapolated. Guessing through a gap
 * is how a hand leaving the frame becomes a spin the researcher did not ask
 * for.
 *
 * The machine is pure: frames in, commands out, no camera, no renderer, no
 * clock of its own. That is what allows the reliability claims to be tested
 * against synthetic streams rather than demonstrated once and hoped for.
 */

import { IntentCommand, ScreenPoint } from "./commands";
import { DEFAULT_ONE_EURO, OneEuroSettings, PointFilter } from "./filter";
import { Hand, HandFrame, distance } from "./types";
import { handScale, scaleThresholds } from "./calibration";

export type SpatialState =
  | "IDLE"
  | "TRACKING_LOST"
  | "READY"
  | "GRABBED"
  | "POINTING"
  | "TWO_HAND_READY"
  | "ZOOMING"
  | "PAUSED";

export type SpatialSettings = {
  /**
   * Pinch closes below this normalised distance — used only when the hand's own
   * span cannot be measured, or when adaptive thresholds are switched off.
   */
  pinchOn: number;
  /** ...and only opens again above this one. The gap is the hysteresis. */
  pinchOff: number;
  /**
   * Scale the pinch thresholds to the hand actually in frame.
   *
   * On by default, because the absolute numbers above silently assume one hand
   * at one distance from one camera. A smaller hand, or a researcher sitting
   * back from a large display, spans less of the frame — far enough back and a
   * merely *resting* hand is already inside the pinch threshold, so the machine
   * reads a grab nobody made and the scene follows idle movement, which is
   * exactly what Rule 2 forbids. Leaning close produces the mirror failure: a
   * real pinch never registers and the feature just does not work. Both look
   * like bad tracking, and neither is.
   */
  adaptiveThresholds: boolean;
  /** Pinch thresholds as fractions of the hand's own span — see `calibration`. */
  pinchRatioOn: number;
  pinchRatioOff: number;
  /** Movement below this (normalised) is treated as hand tremor. */
  deadZone: number;
  /**
   * Movement above this in one frame is treated as a tracking glitch.
   *
   * A real hand crosses maybe a fifth of the frame between two 30 Hz samples.
   * Beyond that is far more likely to be the tracker jumping to a different
   * hand — or to a different person (§31) — than a person moving.
   */
  spikeThreshold: number;
  /** Below this tracker confidence, nothing is acted on (§31). */
  minConfidence: number;
  /** Frames a hand may be missing before engagement is dropped. */
  lossGraceFrames: number;
  rotationSensitivity: number;
  zoomSensitivity: number;
  /** Total zoom range, so the scene cannot be lost (§32). */
  minScale: number;
  maxScale: number;
  /** Frames of steady pointing before hovering is believed (§17). */
  pointingHoldFrames: number;
  smoothing: OneEuroSettings;
};

export const DEFAULT_SETTINGS: SpatialSettings = {
  pinchOn: 0.035,
  pinchOff: 0.05,
  adaptiveThresholds: true,
  // The same two numbers over the 0.10 span they were written against, so the
  // adaptive path agrees with the absolute one for a hand of reference size
  // rather than quietly redefining what a pinch is.
  pinchRatioOn: 0.35,
  pinchRatioOff: 0.5,
  deadZone: 0.004,
  spikeThreshold: 0.2,
  minConfidence: 0.6,
  lossGraceFrames: 3,
  rotationSensitivity: 2.2,
  zoomSensitivity: 1.0,
  minScale: 0.2,
  maxScale: 8,
  pointingHoldFrames: 3,
  smoothing: DEFAULT_ONE_EURO,
};

/** Named so telemetry (§36) can count them without describing imagery. */
export type SpatialEvent =
  | "gesture_grab_started" | "gesture_grab_completed"
  | "gesture_zoom_started" | "gesture_zoom_completed"
  | "gesture_point_started" | "gesture_selection_completed"
  | "tracking_lost" | "tracking_recovered"
  | "gesture_cancelled";

export type FrameResult = {
  state: SpatialState;
  commands: IntentCommand[];
  events: SpatialEvent[];
};

function isPointing(hand: Hand): boolean {
  // Index extended while the other fingers are curled. Comparing each tip to
  // the wrist rather than to an absolute distance keeps this working at any
  // hand size or camera distance, which is what makes it survive a researcher
  // leaning back (§47).
  const index = distance(hand.indexTip, hand.wrist);
  const others = [hand.middleTip, hand.ringTip, hand.pinkyTip]
    .map((tip) => distance(tip, hand.wrist));
  return others.every((d) => index > d * 1.25);
}

function pinchDistance(hand: Hand): number {
  return distance(hand.thumbTip, hand.indexTip);
}

export class SpatialInteractionMachine {
  private state: SpatialState = "IDLE";
  private settings: SpatialSettings;
  private readonly primary = new PointFilter();
  private pinching = false;
  private lastPoint: ScreenPoint | null = null;
  /**
   * The unfiltered palm position from the previous frame.
   *
   * Kept separately because spikes have to be judged on raw coordinates. The
   * first version compared *filtered* points, and the One Euro filter damps a
   * single large jump so thoroughly that the guard never fired — it was dead
   * code for precisely the case it exists to catch, and a tracker switching to
   * another person's hand produced a smooth, confident, entirely fictional
   * rotation.
   */
  private lastRawPoint: ScreenPoint | null = null;
  private lastSpan: number | null = null;
  private missingFrames = 0;
  private pointingFrames = 0;
  private scale = 1;

  constructor(settings: Partial<SpatialSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.primary.configure(this.settings.smoothing);
  }

  configure(settings: Partial<SpatialSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (settings.smoothing) this.primary.configure(settings.smoothing);
  }

  current(): SpatialState {
    return this.state;
  }

  /** Suspend without forgetting calibration — the user's own pause (§10). */
  pause(): void {
    this.releaseEverything();
    this.state = "PAUSED";
  }

  resume(): void {
    if (this.state === "PAUSED") this.state = "IDLE";
  }

  reset(): void {
    this.releaseEverything();
    this.state = "IDLE";
    this.scale = 1;
  }

  private releaseEverything(): void {
    this.pinching = false;
    this.lastPoint = null;
    this.lastRawPoint = null;
    this.lastSpan = null;
    this.pointingFrames = 0;
    this.primary.reset();
  }

  /**
   * One tracker frame in, whatever the researcher meant out.
   *
   * Every early return is a decision not to act. That asymmetry is deliberate:
   * a missed intentional gesture costs one repeat, and a false one costs the
   * researcher's confidence in every result they were looking at.
   */
  step(frame: HandFrame): FrameResult {
    const commands: IntentCommand[] = [];
    const events: SpatialEvent[] = [];

    if (this.state === "PAUSED") {
      return { state: this.state, commands, events };
    }

    const usable = frame.hands.filter(
      (hand) => hand.confidence >= this.settings.minConfidence);

    if (usable.length === 0) {
      this.missingFrames += 1;
      // A grace window, because one dropped frame is normal and ending a
      // rotation on every blink would make the gesture unusable. Past the
      // window it is a real loss, and everything stops at once.
      if (this.missingFrames > this.settings.lossGraceFrames) {
        if (this.state !== "TRACKING_LOST" && this.state !== "IDLE") {
          if (this.pinching) events.push("gesture_cancelled");
          events.push("tracking_lost");
        }
        this.releaseEverything();
        this.state = "TRACKING_LOST";
      }
      return { state: this.state, commands, events };
    }

    if (this.state === "TRACKING_LOST" || this.state === "IDLE") {
      // Only a recovery is worth an event. Arriving from IDLE is a hand simply
      // appearing for the first time, which is not something that happened *to*
      // the researcher and would only add noise to the telemetry.
      if (this.state === "TRACKING_LOST") events.push("tracking_recovered");
      this.state = "READY";
    }
    this.missingFrames = 0;

    if (usable.length >= 2) {
      return this.twoHands(usable, frame.timestamp, commands, events);
    }

    // Dropping out of two-handed engagement: the span is stale and reusing it
    // next time two hands appear would produce one huge zoom.
    if (this.state === "ZOOMING" || this.state === "TWO_HAND_READY") {
      if (this.state === "ZOOMING") events.push("gesture_zoom_completed");
      this.lastSpan = null;
      this.state = "READY";
    }

    return this.oneHand(usable[0], frame.timestamp, commands, events);
  }

  /**
   * Which hand is being used, when more than one is visible.
   *
   * A pinched hand is unambiguous: nobody pinches by accident, which is the
   * whole premise of the clutch. Otherwise the nearer hand, measured by its own
   * span — the one held out toward the camera is the one being used, and the
   * one resting on the desk is further away and smaller in frame.
   */
  private acting(hands: Hand[]): Hand {
    const pinched = hands.filter(
      (hand) => pinchDistance(hand) < scaleThresholds(hand, this.settings).pinchOn);
    const candidates = pinched.length ? pinched : hands;
    return candidates.reduce((nearest, hand) =>
      handScale(hand) > handScale(nearest) ? hand : nearest);
  }

  private twoHands(hands: Hand[], timestamp: number,
                   commands: IntentCommand[], events: SpatialEvent[]): FrameResult {
    // Both hands pinched is the engagement. Two visible hands are not: a
    // researcher gesturing while they talk has two hands in frame constantly,
    // and treating that as zoom is precisely the false action §17 forbids.
    // Each hand judged against its own span. Hands are rarely equidistant from
    // the camera — one is usually further forward — and one shared threshold
    // would make the nearer hand engage first, so the zoom would start from a
    // baseline taken while only half the gesture existed.
    const engaged = hands.every(
      (hand) => pinchDistance(hand) < scaleThresholds(hand, this.settings).pinchOn);
    if (!engaged) {
      if (this.state === "ZOOMING") events.push("gesture_zoom_completed");
      this.lastSpan = null;

      /*
       * Fall through to one hand rather than doing nothing, which is what this
       * did — and it is a bug that presents as the whole feature being broken.
       *
       * MediaPipe reports a second hand whenever any part of one is in frame:
       * resting on the desk, holding a pen, halfway out of shot. Two hands
       * visible sent every frame down this path, and a single-handed
       * pinch-and-rotate then did nothing at all, silently, because zoom
       * requires *both* pinched. The researcher pinches, nothing moves, and
       * there is no way to tell that the reason is a hand they were not using.
       *
       * Two hands in frame is not two hands in use. §17's point is that
       * visibility is not intent — which cuts both ways, and the version above
       * only applied it in one direction.
       */
      return this.oneHand(this.acting(hands), timestamp, commands, events);
    }

    const span = distance(hands[0].palmCenter, hands[1].palmCenter);
    if (this.lastSpan === null) {
      this.lastSpan = span;
      this.state = "TWO_HAND_READY";
      events.push("gesture_zoom_started");
      return { state: this.state, commands, events };
    }

    const change = span - this.lastSpan;
    if (Math.abs(change) < this.settings.deadZone) {
      return { state: this.state, commands, events };
    }
    if (Math.abs(change) > this.settings.spikeThreshold) {
      // One hand jumped. Re-baseline rather than zooming by the glitch.
      this.lastSpan = span;
      return { state: this.state, commands, events };
    }

    this.lastSpan = span;
    this.state = "ZOOMING";

    // Relative change, never absolute separation (§6): absolute would mean the
    // scene's zoom depended on how far apart the researcher happened to start.
    const factor = 1 + change * this.settings.zoomSensitivity * 2;
    const clamped = this.clampScale(factor);
    if (clamped !== 1) commands.push({ kind: "zoom", factor: clamped });
    return { state: this.state, commands, events };
  }

  /**
   * Keeps total scale inside its bounds and returns the factor that is actually
   * applicable — so the scene cannot be zoomed into nothing or out of sight,
   * and a researcher pushing past the limit simply stops rather than losing
   * their data off-screen (§32).
   */
  private clampScale(factor: number): number {
    const next = Math.min(Math.max(this.scale * factor, this.settings.minScale),
                          this.settings.maxScale);
    const applied = next / this.scale;
    this.scale = next;
    return applied;
  }

  private oneHand(hand: Hand, timestamp: number,
                  commands: IntentCommand[], events: SpatialEvent[]): FrameResult {
    const pinch = pinchDistance(hand);
    const { pinchOn, pinchOff } = scaleThresholds(hand, this.settings);

    // Hysteresis: different thresholds in and out, so a hand hovering near the
    // boundary cannot oscillate.
    if (!this.pinching && pinch < pinchOn) {
      this.pinching = true;
      this.lastPoint = null;
      this.lastRawPoint = null;
      this.primary.reset();

      if (this.state === "POINTING") {
        // Pointing then pinching is a selection, not a grab (§8). The pointer
        // is where the finger is, so the adapter resolves the same target the
        // researcher was just shown.
        const at = this.toScreen(hand.indexTip, timestamp);
        commands.push({ kind: "select", at });
        events.push("gesture_selection_completed");
        return { state: this.state, commands, events };
      }

      this.state = "GRABBED";
      events.push("gesture_grab_started");
      return { state: this.state, commands, events };
    }

    if (this.pinching && pinch > pinchOff) {
      this.pinching = false;
      this.lastPoint = null;
      this.lastRawPoint = null;
      if (this.state === "GRABBED") events.push("gesture_grab_completed");
      this.state = "READY";
      return { state: this.state, commands, events };
    }

    if (this.pinching) {
      return this.rotate(hand, timestamp, commands, events);
    }

    return this.point(hand, timestamp, commands, events);
  }

  private rotate(hand: Hand, timestamp: number,
                 commands: IntentCommand[], events: SpatialEvent[]): FrameResult {
    const raw = { x: hand.palmCenter.x, y: hand.palmCenter.y };

    // Spikes are judged before smoothing, and a rejected frame is never fed to
    // the filter. Letting it through would leave the fiction in the filter's
    // history, so the following few frames would drift toward a position the
    // hand was never in.
    if (this.lastRawPoint !== null) {
      const jump = Math.hypot(raw.x - this.lastRawPoint.x, raw.y - this.lastRawPoint.y);
      if (jump > this.settings.spikeThreshold) {
        this.lastRawPoint = raw;
        this.lastPoint = null;      // re-establish the origin from the next good frame
        this.primary.reset();
        return { state: this.state, commands, events };
      }
    }
    this.lastRawPoint = raw;

    const point = this.primary.filter(raw, timestamp);

    if (this.lastPoint === null) {
      // First frame of the grab establishes the origin. Emitting a delta here
      // would rotate by the hand's distance from wherever it was last time.
      this.lastPoint = point;
      return { state: this.state, commands, events };
    }

    const dx = point.x - this.lastPoint.x;
    const dy = point.y - this.lastPoint.y;
    const travelled = Math.hypot(dx, dy);

    if (travelled < this.settings.deadZone) {
      return { state: this.state, commands, events };
    }

    this.lastPoint = point;
    this.state = "GRABBED";

    // Gentle acceleration: slow movement is finer than linear, fast movement a
    // little coarser, so a researcher can both nudge and swing without changing
    // a sensitivity setting.
    const curve = (value: number) => Math.sign(value) * Math.pow(Math.abs(value), 1.15);
    commands.push({
      kind: "rotate",
      deltaX: curve(dx) * this.settings.rotationSensitivity,
      deltaY: curve(dy) * this.settings.rotationSensitivity,
    });
    return { state: this.state, commands, events };
  }

  private point(hand: Hand, timestamp: number,
                commands: IntentCommand[], events: SpatialEvent[]): FrameResult {
    if (!isPointing(hand)) {
      this.pointingFrames = 0;
      this.state = "READY";
      return { state: this.state, commands, events };
    }

    // Sustained, not instantaneous. A hand passing through a pointing shape on
    // its way somewhere else is not a question about a data point (§17).
    this.pointingFrames += 1;
    if (this.pointingFrames < this.settings.pointingHoldFrames) {
      return { state: this.state, commands, events };
    }

    if (this.state !== "POINTING") events.push("gesture_point_started");
    this.state = "POINTING";
    commands.push({ kind: "hover", at: this.toScreen(hand.indexTip, timestamp) });
    return { state: this.state, commands, events };
  }

  /**
   * Normalised landmark to viewport pixels.
   *
   * Mirrored in x because a webcam image is a mirror: the researcher's hand
   * moving right appears to move left in frame, and a scene that turned the
   * wrong way would feel broken in a way nobody could articulate.
   */
  private toScreen(landmark: { x: number; y: number },
                   timestamp: number): ScreenPoint {
    const point = this.primary.filter(landmark, timestamp);
    return { x: (1 - point.x) * this.viewport.width, y: point.y * this.viewport.height };
  }

  /** Set by the host so the machine can map into the visualization's pixels. */
  viewport = { width: 1, height: 1 };
}
