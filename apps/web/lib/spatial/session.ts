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

  constructor(
    private readonly tracker: HandTracker,
    private readonly controller: () => VisualizationController | null,
    private readonly observer: SessionObserver = {},
    settings: Partial<SpatialSettings> = {},
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

    const target = this.controller();
    if (!target) return;

    this.machine.viewport = target.viewport();
    const result = this.machine.step(frame);

    this.telemetry.frames += 1;
    for (const event of result.events) this.telemetry[event] += 1;

    for (const command of result.commands) apply(target, command);

    this.observer.onState?.(result.state);
    if (result.events.length) this.observer.onTelemetry?.(this.counts());
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
    this.observer.onState?.("IDLE");
  }

  /** The researcher's own pause — §10. Keeps the camera, stops acting on it. */
  pause(): void {
    this.machine.pause();
    this.observer.onState?.("PAUSED");
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
