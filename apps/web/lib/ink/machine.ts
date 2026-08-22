/**
 * Deciding that the researcher meant to draw.
 *
 * The gesture machine already answers "did they mean to move the scene". This
 * answers a narrower and stricter question, because ink is worse than rotation
 * when it is wrong: a scene rotated by accident is corrected by rotating back,
 * while a stray mark on a colleague's figure is something somebody has to notice
 * and delete.
 *
 * So drawing is **two locks, not one** (§139). The tool must be armed
 * deliberately — from a button, a command, or the voice channel — and only then
 * does the pinch act as pen contact. A pointing finger produces no ink at any
 * time, because pointing is what people do while they talk.
 *
 * The pen-down clutch is the same pinch used everywhere else, which is the point:
 * §225 asks for one interaction language rather than a vocabulary per feature,
 * so the hand that grabs a chart is the hand that touches the page, and the
 * difference is which tool is in it.
 */

import { Hand, HandFrame, distance } from "@/lib/spatial/types";
import { scaleThresholds } from "@/lib/spatial/calibration";
import { DEFAULT_SETTINGS, SpatialSettings } from "@/lib/spatial/machine";

export type InkState =
  | "DISABLED"
  | "ARMED"
  | "HOVER"
  | "PEN_DOWN"
  | "DRAWING"
  | "TRACKING_LOST";

export type InkEvent =
  | "penDown"
  | "penUp"
  | "strokeCancelled"
  | "trackingLost"
  | "trackingRecovered";

export type InkPoint = { x: number; y: number; confidence: number };

export type InkFrameResult = {
  state: InkState;
  /** Where the pen is, in normalised camera coordinates, or null. */
  at: InkPoint | null;
  /** True only on frames that should extend a stroke. */
  drawing: boolean;
  events: InkEvent[];
};

export type InkSettings = {
  /**
   * Frames the pen must stay down before a stroke begins.
   *
   * One frame is enough to register a pinch and not enough to distinguish it
   * from a hand closing on its way somewhere else. Two costs about 60ms and
   * removes most accidental dots — and a dot is the most common piece of
   * unwanted ink.
   */
  contactFrames: number;
  /** Below this, no ink is produced and an open stroke ends (§31, Rule 23). */
  minConfidence: number;
  /** Frames a hand may vanish before an open stroke is abandoned. */
  lossGraceFrames: number;
};

export const DEFAULT_INK_SETTINGS: InkSettings = {
  contactFrames: 2,
  minConfidence: 0.6,
  lossGraceFrames: 2,
};

/**
 * The fingertip, not the palm.
 *
 * Rotation is measured from the knuckle centroid because that behaves like a
 * rigid body — but a pen is held at its tip, and a researcher aiming at a data
 * point is aiming with the end of their finger. Using the palm would put the ink
 * a couple of centimetres from where they are looking, which reads as the system
 * being inaccurate rather than as a different anchor.
 */
function penPoint(hand: Hand): InkPoint {
  return { x: hand.indexTip.x, y: hand.indexTip.y, confidence: hand.confidence };
}

export class InkStateMachine {
  private state: InkState = "DISABLED";
  private contact = 0;
  private missing = 0;
  private settings: InkSettings;
  private spatial: SpatialSettings;

  constructor(settings: Partial<InkSettings> = {},
              spatial: Partial<SpatialSettings> = {}) {
    this.settings = { ...DEFAULT_INK_SETTINGS, ...settings };
    this.spatial = { ...DEFAULT_SETTINGS, ...spatial };
  }

  configure(settings: Partial<InkSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  current(): InkState {
    return this.state;
  }

  /** Arm the tool. Nothing draws until this has been called deliberately. */
  arm(): void {
    if (this.state === "DISABLED") this.state = "ARMED";
  }

  /** Put the tool away. Any open stroke is ended by the caller. */
  disarm(): void {
    this.state = "DISABLED";
    this.contact = 0;
    this.missing = 0;
  }

  step(frame: HandFrame): InkFrameResult {
    const events: InkEvent[] = [];
    if (this.state === "DISABLED") {
      return { state: this.state, at: null, drawing: false, events };
    }

    const usable = frame.hands.filter(
      (hand) => hand.confidence >= this.settings.minConfidence);

    if (usable.length === 0) {
      this.missing += 1;
      if (this.missing > this.settings.lossGraceFrames) {
        // An open stroke ends here rather than resuming when the hand returns.
        // Bridging the gap would draw a straight line across whatever the hand
        // did while it was invisible — a mark the researcher never made, in the
        // middle of their figure.
        if (this.state === "DRAWING" || this.state === "PEN_DOWN") {
          events.push("penUp");
        }
        if (this.state !== "TRACKING_LOST") events.push("trackingLost");
        this.state = "TRACKING_LOST";
        this.contact = 0;
      }
      return { state: this.state, at: null, drawing: false, events };
    }

    if (this.state === "TRACKING_LOST") {
      events.push("trackingRecovered");
      this.state = "ARMED";
    }
    this.missing = 0;

    // The drawing hand is the pinched one where there is a choice: a second hand
    // steadying a model must not take the pen away from the one writing.
    const hand = this.drawingHand(usable);
    const at = penPoint(hand);
    const pinch = distance(hand.thumbTip, hand.indexTip);
    const { pinchOn, pinchOff } = scaleThresholds(hand, this.spatial);
    const down = this.state === "PEN_DOWN" || this.state === "DRAWING"
      ? pinch < pinchOff       // hysteresis: stays down until clearly released
      : pinch < pinchOn;

    if (!down) {
      if (this.state === "PEN_DOWN") {
        // Lifted before the stroke ever started: a pinch that was not a mark.
        events.push("strokeCancelled");
      } else if (this.state === "DRAWING") {
        events.push("penUp");
      }
      this.contact = 0;
      this.state = "HOVER";
      return { state: this.state, at, drawing: false, events };
    }

    this.contact += 1;
    if (this.contact < this.settings.contactFrames) {
      this.state = "PEN_DOWN";
      return { state: this.state, at, drawing: false, events };
    }

    if (this.state !== "DRAWING") {
      events.push("penDown");
      this.state = "DRAWING";
    }
    return { state: this.state, at, drawing: true, events };
  }

  private drawingHand(hands: Hand[]): Hand {
    const pinched = hands.filter(
      (hand) => distance(hand.thumbTip, hand.indexTip)
                < scaleThresholds(hand, this.spatial).pinchOn);
    return (pinched.length ? pinched : hands)[0];
  }
}
