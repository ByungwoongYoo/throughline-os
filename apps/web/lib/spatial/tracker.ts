/**
 * Where hand landmarks come from, kept behind a seam.
 *
 * Two reasons this is an interface rather than a MediaPipe import.
 *
 * **The pipeline has to be testable without a camera.** Everything downstream —
 * the state machine, the filters, the controller, the chart — can be driven by
 * a scripted tracker replaying a known sequence, so the reliability claims in
 * §37 rest on assertions rather than on a demonstration that worked once.
 *
 * **The model is a decision that is not made yet, and should not be made
 * implicitly.** MediaPipe Hand Landmarker is the obvious choice and §11 names
 * it, but it loads a WASM bundle and a `.task` model at runtime, and by default
 * it fetches both from a CDN. For a product whose first line is that nothing
 * leaves the machine, a silent network fetch on enabling a *privacy* feature is
 * the wrong default — the model has to be served from this installation. That
 * is a packaging question, not a gesture question, and wiring the import before
 * answering it would bury it.
 *
 * So the interface is defined and honoured; the MediaPipe implementation lands
 * when its model can be served locally and tested against a real hand in real
 * lighting, which this environment cannot do.
 */

import { HandFrame } from "./types";

export type TrackerStatus = "idle" | "loading" | "running" | "failed";

export interface HandTracker {
  /**
   * Prepare the tracker. Separate from construction because loading a model is
   * slow and fallible, and the interface should be able to say which.
   */
  load(): Promise<void>;
  /**
   * Begin producing frames from a video source.
   *
   * The callback is invoked at the tracker's own rate, which §13 is explicit
   * should be lower than the renderer's — 20–30 FPS of landmarks feeding a 60
   * FPS scene, with the smoothing between them covering the difference.
   */
  start(source: HTMLVideoElement, onFrame: (frame: HandFrame) => void): void;
  stop(): void;
  status(): TrackerStatus;
}

/**
 * A tracker that replays a fixed sequence of frames.
 *
 * Used by the tests to drive the whole chain, and by a demo to show the
 * interaction without asking for a camera. It is not a stub standing in for
 * something missing: a deterministic source is the only way to assert that a
 * given hand movement produces a given scene change, because a real hand never
 * repeats itself exactly.
 */
export class ScriptedHandTracker implements HandTracker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: TrackerStatus = "idle";
  private index = 0;

  constructor(
    private readonly script: HandFrame[],
    /** Milliseconds between frames. 33 is roughly the 30 Hz §13 describes. */
    private readonly interval = 33,
    /** Whether to loop, for a demo that should keep moving. */
    private readonly loop = false,
  ) {}

  async load(): Promise<void> {
    this.state = "loading";
    this.state = "running";
  }

  start(_source: HTMLVideoElement | null, onFrame: (frame: HandFrame) => void): void {
    this.stop();
    this.state = "running";
    this.timer = setInterval(() => {
      if (this.index >= this.script.length) {
        if (!this.loop) {
          this.stop();
          return;
        }
        this.index = 0;
      }
      onFrame(this.script[this.index]);
      this.index += 1;
    }, this.interval);
  }

  /** Advance one frame without a timer, for tests that control their own clock. */
  step(onFrame: (frame: HandFrame) => void): boolean {
    if (this.index >= this.script.length) return false;
    onFrame(this.script[this.index]);
    this.index += 1;
    return true;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = "idle";
  }

  status(): TrackerStatus {
    return this.state;
  }
}
