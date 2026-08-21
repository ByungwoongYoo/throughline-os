/**
 * One spatial interaction session: camera, tracker, machine, chart.
 *
 * The wiring is deliberately thin. Every decision worth making already lives
 * somewhere else — intent in the machine, geometry in the chart, permission in
 * the camera manager — and a coordinator that started making its own would be
 * the place those decisions quietly diverge.
 *
 * What it does own is the ordering, and the ordering is the safety property:
 *
 *   stop the tracker, then release the camera, then clear the machine
 *
 * A session torn down in any other order can deliver one more frame after the
 * researcher switched the feature off, and a scene that moves after the camera
 * light goes out is the single most alarming thing this feature could do.
 */

import { VisualizationController, apply } from "./commands";
import { CameraFailure, CameraManager } from "./camera";
import { SpatialEvent, SpatialInteractionMachine, SpatialSettings, SpatialState } from "./machine";
import { HandTracker } from "./tracker";
import { HandFrame } from "./types";

/**
 * Counts, never imagery (§12, §36).
 *
 * Deliberately a bare tally rather than a stream of records: an event log with
 * timestamps and confidences is a behavioural trace of a person at their desk,
 * and this feature cannot ask to be trusted with a camera while quietly
 * building one. What a product needs to know is whether gestures are being
 * completed or abandoned, and totals answer that.
 */
export type SpatialTelemetry = Record<SpatialEvent | "frames", number>;

export function emptyTelemetry(): SpatialTelemetry {
  return {
    frames: 0,
    gesture_grab_started: 0, gesture_grab_completed: 0,
    gesture_zoom_started: 0, gesture_zoom_completed: 0,
    gesture_point_started: 0, gesture_selection_completed: 0,
    tracking_lost: 0, tracking_recovered: 0, gesture_cancelled: 0,
  };
}

export type SessionObserver = {
  onState?: (state: SpatialState) => void;
  onTelemetry?: (telemetry: SpatialTelemetry) => void;
  onFailure?: (failure: CameraFailure) => void;
};

export class SpatialSession {
  private readonly camera = new CameraManager();
  private readonly machine: SpatialInteractionMachine;
  private telemetry = emptyTelemetry();
  private running = false;
  /**
   * The last state handed to the observer.
   *
   * Observers are React setters in practice, and the state is unchanged on the
   * overwhelming majority of frames — a hand held in a grab reports `GRABBED`
   * thirty times a second. Publishing each one asks React to re-render the
   * workspace at tracker rate to say nothing new, which is a cost paid
   * continuously for the entire time the feature is switched on. Notifying only
   * on a change is the difference between a spatial mode that costs a repaint
   * when something happens and one that costs 30 renders a second forever.
   */
  private published: SpatialState | null = null;
  /**
   * Timestamp of the last frame actually processed, for the rate governor.
   *
   * `-Infinity` rather than 0, so the *first* frame is never mistaken for one
   * arriving too soon after a previous frame that does not exist. A tracker
   * whose clock starts at zero would otherwise have its opening frame silently
   * dropped, which is invisible at 30 Hz and would be maddening in a test.
   */
  private lastProcessed = -Infinity;

  constructor(
    private readonly tracker: HandTracker,
    private readonly controller: () => VisualizationController | null,
    private readonly observer: SessionObserver = {},
    settings: Partial<SpatialSettings> = {},
    /**
     * Shortest gap between two processed frames, in milliseconds.
     *
     * A ceiling of ~33 Hz, deliberately *not* 1000/30.
     *
     * The rate being targeted is 30 Hz, but a tracker nominally at 30 Hz
     * delivers frames about 33.3ms apart with jitter in both directions, and a
     * floor set at exactly 33.3 would reject every frame that arrived a
     * millisecond early — halving the rate of the very stream it was sized for,
     * intermittently, in a way that would present as the gesture feeling coarse
     * on some machines and fine on others. The slack costs nothing: a 60 Hz
     * tracker still has every other frame dropped, which is the case this
     * exists for.
     *
     * The rate matters beyond the cost: One Euro's cutoffs are expressed in
     * units of time, so feeding it at double the expected rate changes how much
     * it smooths, and the reliability work in T014 was measured at 30 Hz.
     */
    private readonly minFrameInterval = 1000 / 33,
  ) {
    this.machine = new SpatialInteractionMachine(settings);
  }

  isRunning(): boolean {
    return this.running;
  }

  counts(): SpatialTelemetry {
    return { ...this.telemetry };
  }

  /**
   * Start, or report why it could not.
   *
   * Returns rather than throws: a failure here is something the researcher
   * reads and decides about, and an exception would take the visualization down
   * with a feature that is explicitly optional.
   */
  async start(video: HTMLVideoElement, deviceId?: string): Promise<CameraFailure | null> {
    if (this.running) return null;

    const result = await this.camera.start(deviceId);
    if (!result.ok) {
      this.observer.onFailure?.(result.failure);
      return result.failure;
    }

    try {
      await this.tracker.load();
    } catch {
      // The camera is already open at this point. Releasing it before
      // returning matters: a failed start that leaves the light on looks
      // exactly like the feature running.
      this.camera.stop();
      const failure: CameraFailure = {
        reason: "unknown",
        message: "Hand tracking could not be loaded. The visualization is "
               + "unaffected and every other control still works.",
      };
      this.observer.onFailure?.(failure);
      return failure;
    }

    video.srcObject = result.stream;
    this.running = true;
    this.tracker.start(video, (frame) => this.onFrame(frame));
    return null;
  }

  private onFrame(frame: HandFrame): void {
    // A frame that arrives during teardown is dropped rather than processed.
    // Tracker callbacks are asynchronous and one can be in flight when the
    // researcher switches off; acting on it would move the scene after the
    // camera light went out.
    if (!this.running) return;

    // Nothing is rendered while the tab is in the background, so processing a
    // frame there is work whose only observable effect is battery. `rAF` stops
    // on its own; a tracker driven by a timer does not, so the session has to
    // say no. The camera is deliberately *not* stopped — a researcher who
    // switched to another window for ten seconds did not ask to be logged out
    // of the feature, and re-requesting the stream on return is worse.
    if (typeof document !== "undefined" && document.hidden) return;

    // Rate governor (§13). Landmarks are useful at 20–30 Hz; the renderer wants
    // 60. A tracker delivering at camera rate — 60 Hz is common, and some
    // webcams offer more — would drive the machine and the chart at twice the
    // rate the smoothing was tuned for, for no additional fidelity.
    //
    // Dropping is safe here for a specific reason rather than by luck: every
    // command this produces is a *delta* measured from the last processed
    // position, so a skipped frame does not lose motion, it merely makes the
    // next delta larger. That is the property that makes a governor legitimate
    // rather than a source of missing movement.
    if (frame.timestamp - this.lastProcessed < this.minFrameInterval) return;
    this.lastProcessed = frame.timestamp;

    const target = this.controller();
    if (!target) return;

    this.machine.viewport = target.viewport();
    const result = this.machine.step(frame);

    this.telemetry.frames += 1;
    for (const event of result.events) this.telemetry[event] += 1;

    for (const command of result.commands) apply(target, command);

    this.publish(result.state);
    if (result.events.length) this.observer.onTelemetry?.(this.counts());
  }

  /** Tell the observer only when there is something it does not already know. */
  private publish(state: SpatialState): void {
    if (state === this.published) return;
    this.published = state;
    this.observer.onState?.(state);
  }

  /**
   * Stop everything, in the order that cannot deliver a stray frame.
   *
   * Tracker first so no new frame is produced; camera second so the light goes
   * out; machine last so any gesture still held is released rather than left
   * for a future session to inherit.
   */
  stop(): void {
    this.running = false;
    this.tracker.stop();
    this.camera.stop();
    this.machine.reset();
    // Through `publish`, so the observer's picture and this session's idea of
    // what the observer knows cannot disagree — and so a stop after a stop stays
    // quiet rather than re-announcing a state nothing left.
    this.publish("IDLE");
    /**
     * Forget the clock, which matters more than it looks.
     *
     * Frame timestamps come from the tracker, and a tracker's clock is its own —
     * a fresh one may start near zero, from a frame counter or a new video
     * element's time base. Carrying `lastProcessed` across a restart would then
     * make every new frame look like it arrived *before* the last one the
     * previous session saw, so the governor would reject all of them until the
     * new clock climbed past the old one's final value. A session stopped after
     * ten minutes would appear to start and then do nothing for ten minutes,
     * with the camera light on the whole time.
     *
     * Done here rather than in `start()` because teardown is what restores the
     * invariant; setting it in both places left neither one testable.
     */
    this.lastProcessed = -Infinity;
  }

  /** The researcher's own pause — §10. Keeps the camera, stops acting on it. */
  pause(): void {
    this.machine.pause();
    this.publish("PAUSED");
  }

  resume(): void {
    this.machine.resume();
  }

  configure(settings: Partial<SpatialSettings>): void {
    this.machine.configure(settings);
  }

  devices() {
    return this.camera.devices();
  }
}
