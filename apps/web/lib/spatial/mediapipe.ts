/**
 * Hand landmarks, from MediaPipe, served by this application.
 *
 * This is the implementation the `HandTracker` seam was defined for. Two things
 * about it are decisions rather than defaults.
 *
 * **Everything is loaded from `/mediapipe/`, never a CDN.** MediaPipe's own
 * examples hand `FilesetResolver` a jsdelivr URL and let the browser fetch the
 * runtime and the model on first use. For a feature whose entire claim is that
 * camera frames never leave the machine, a silent network request at the moment
 * the researcher switches it on is indefensible — and it would break on a plane,
 * on a locked-down university network, and the day the CDN path moves.
 * `scripts/vendor-hand-model.mjs` puts both on disk at install time.
 *
 * **The tracker runs on `requestAnimationFrame`, not a timer, and does its own
 * rate limiting.** rAF stops when the tab is hidden, which is the behaviour you
 * want from a camera loop, and it aligns inference with the renderer instead of
 * landing between frames. The session governs the rate a second time; this is
 * not redundancy, it is each layer being responsible for its own cost.
 *
 * What is *not* here: any interpretation of what the hand means. Landmarks go
 * out, decisions happen in the machine. That separation is what lets the
 * gesture logic be tested against synthetic streams with no camera.
 */

import type {
  HandLandmarker as HandLandmarkerType,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { HandTracker, TrackerStatus } from "./tracker";
import { Hand, HandFrame, Landmark } from "./types";

/** Where the vendored assets live, relative to the site root. */
const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/hand_landmarker.task";

/**
 * MediaPipe's landmark indices.
 *
 * Named rather than inlined, because `landmarks[17]` at a call site is a magic
 * number that nobody can check and everybody has to look up. The full topology
 * is 21 points; these are the ones this product's gestures are defined on.
 */
const LANDMARK = {
  wrist: 0,
  thumbTip: 4,
  indexMcp: 5,
  indexTip: 8,
  middleMcp: 9,
  middleTip: 12,
  ringMcp: 13,
  ringTip: 16,
  pinkyMcp: 17,
  pinkyTip: 20,
} as const;

import { LatencyRecorder, LatencySummary } from "./latency";
import { now as clockNow } from "./clock";

/**
 * How long one inference may block the main thread before it costs a frame.
 *
 * Half a 60Hz frame. Above this, the renderer and React are sharing what is
 * left of 16.7ms with everything else the page does, and the result is dropped
 * frames rather than a slower tracker — which is why this is budgeted apart
 * from end-to-end latency rather than folded into it.
 */
const MAIN_THREAD_BUDGET_MS = 8;

export type TrackerDiagnostics = {
  ticks: number;
  skippedNoVideo: number;
  skippedRate: number;
  inferences: number;
  inferenceErrors: number;
  handsSeen: number;
  /** The highest confidence any reported hand has carried. */
  bestConfidence: number;
  delegate: "GPU" | "CPU";
  lastError: string | null;
  status: TrackerStatus;
};

export type MediaPipeFailure =
  | { reason: "model-missing"; message: string }
  | { reason: "unsupported"; message: string }
  | { reason: "unknown"; message: string };

/**
 * The palm's centre, as the average of the wrist and the four knuckles.
 *
 * Deliberately not a fingertip and not the wrist alone. Fingertips move as the
 * hand opens and closes, so a "position" taken from one would drift during a
 * pinch — the scene would rotate slightly every time the researcher grabbed it,
 * which reads as the tracking being sloppy. The wrist alone is stable but sits
 * at the edge of the hand, so rotating the wrist swings it further than the hand
 * actually travelled. The knuckle centroid is the part of a hand that behaves
 * most like a rigid body.
 */
function palmCentre(points: Landmark[]): Landmark {
  const contributing = [
    points[LANDMARK.wrist], points[LANDMARK.indexMcp],
    points[LANDMARK.middleMcp], points[LANDMARK.ringMcp],
    points[LANDMARK.pinkyMcp],
  ];
  const total = contributing.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 });
  return { x: total.x / contributing.length, y: total.y / contributing.length };
}

/**
 * Turn one MediaPipe result into this product's `HandFrame`.
 *
 * Exported because it is the only part of this file that can be tested without
 * a camera, a GPU and a person — and it is also the part most likely to be
 * quietly wrong, since every landmark index is an opportunity to be off by one
 * in a way that produces plausible-looking nonsense.
 */
export function toHandFrame(result: HandLandmarkerResult,
                            timestamp: number): HandFrame {
  const hands: Hand[] = [];

  for (let i = 0; i < result.landmarks.length; i += 1) {
    const points = result.landmarks[i] as Landmark[];
    // A partial hand is not a hand. MediaPipe returns all 21 or none, but a
    // truncated array here would index `undefined` into every downstream
    // distance calculation and produce NaN rotations rather than an error.
    if (!points || points.length <= LANDMARK.pinkyTip) continue;

    const handedness = result.handednesses?.[i]?.[0];

    hands.push({
      // MediaPipe reports handedness from the *camera's* point of view, so an
      // unmirrored front-facing camera calls the researcher's right hand "Left".
      // The gesture logic does not currently branch on this, but recording it
      // wrongly would make the first feature that does subtly incorrect.
      handedness: handedness?.categoryName === "Left" ? "right" : "left",
      confidence: handedness?.score ?? 1,
      wrist: points[LANDMARK.wrist],
      thumbTip: points[LANDMARK.thumbTip],
      indexTip: points[LANDMARK.indexTip],
      middleTip: points[LANDMARK.middleTip],
      ringTip: points[LANDMARK.ringTip],
      pinkyTip: points[LANDMARK.pinkyTip],
      indexBase: points[LANDMARK.indexMcp],
      palmCenter: palmCentre(points),
    });
  }

  return { timestamp, hands };
}

export class MediaPipeHandTracker implements HandTracker {
  private landmarker: HandLandmarkerType | null = null;
  private state: TrackerStatus = "idle";
  private frame = 0;
  private lastInference = 0;
  private delegate: "GPU" | "CPU" = "GPU";
  /** How long inference blocks the main thread, as a distribution (§52). */
  private readonly inference = new LatencyRecorder(240, MAIN_THREAD_BUDGET_MS);

  /** The recent inference-duration distribution, or null before any ran. */
  inferenceLatency(): LatencySummary | null {
    return this.inference.summary();
  }
  private reloading = false;
  /**
   * Why nothing is happening, when nothing is happening.
   *
   * Every guard in the loop below is a `return`, and a loop made of silent
   * returns is untestable by the person it is failing for: the camera light is
   * on, the panel says no hand is in the picture, and there is no way to tell
   * whether the video is blank, the inference is throwing, or the hand simply
   * is not being recognised. These counters are the difference between "it does
   * not work" and a diagnosis.
   */
  private readonly counters = {
    ticks: 0,
    skippedNoVideo: 0,
    skippedRate: 0,
    inferences: 0,
    inferenceErrors: 0,
    handsSeen: 0,
  };
  /**
   * The highest confidence any hand has been reported with.
   *
   * Without it, "the tracker never saw a hand" and "the tracker saw a hand and
   * something downstream discarded it" produce the same reading of zero, and
   * they have completely different causes.
   */
  private bestConfidence = 0;
  private lastError: string | null = null;

  constructor(
    /**
     * Inference interval. ~30 Hz, which §13 asks for: landmarks are useful well
     * below the renderer's rate, and inference is the expensive half.
     */
    private readonly minInterval = 1000 / 33,
  ) {}

  status(): TrackerStatus {
    return this.state;
  }

  async load(): Promise<void> {
    if (this.landmarker) return;
    this.state = "loading";

    try {
      // Imported here rather than at module scope so the ~1MB of MediaPipe glue
      // is not in the bundle of a workspace whose owner never enables this.
      const { FilesetResolver, HandLandmarker } =
        await import("@mediapipe/tasks-vision");

      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_PATH,
          // GPU where available; MediaPipe falls back on its own. Hand tracking
          // on the CPU competes with the rendering it exists to serve.
          delegate: this.delegate,
        },
        numHands: 2,          // §6 — two-handed zoom needs both
        runningMode: "VIDEO",
        /*
         * MediaPipe's own defaults, and lowering them back to these is a
         * correction of a real mistake.
         *
         * I had raised all three to 0.6, reasoning from §31 that a
         * low-confidence detection must not act. That confused two different
         * jobs. These thresholds decide whether the tracker *reports a hand at
         * all*; the state machine decides whether to act on one. Raising them
         * does not make the system more careful — it makes it blind, and blind
         * in the way that is hardest to diagnose: in ordinary room lighting the
         * hand is simply never reported, the diagnostics show zero hands seen,
         * and that is indistinguishable from no hand being in front of the
         * camera.
         *
         * §31's requirement is met where it belongs and where it is tested: the
         * machine refuses to act below `minConfidence`, and releases every held
         * gesture the moment tracking drops. Seeing a hand and choosing not to
         * act on it is a decision. Never seeing it is a blindfold.
         */
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.state = "running";
    } catch (error) {
      this.state = "failed";
      throw new Error(describeLoadFailure(error));
    }
  }

  start(source: HTMLVideoElement, onFrame: (frame: HandFrame) => void): void {
    if (!this.landmarker) {
      throw new Error("load() must succeed before start()");
    }
    this.stop();
    this.state = "running";

    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      this.counters.ticks += 1;

      const landmarker = this.landmarker;
      if (!landmarker) return;

      // A video that has not produced a frame yet has width 0, and MediaPipe
      // throws on it rather than returning nothing.
      if (!source.videoWidth || !source.videoHeight) {
        this.counters.skippedNoVideo += 1;
        return;
      }

      const now = performance.now();
      if (now - this.lastInference < this.minInterval) {
        this.counters.skippedRate += 1;
        return;
      }
      this.lastInference = now;

      // There was a guard here that skipped whenever `video.currentTime` had
      // not changed since the last inference. It was an optimisation — avoid
      // re-reading an identical frame — and it could deadlock the entire
      // feature: on any source where `currentTime` does not advance the way this
      // assumed, *every* frame is skipped for ever, the camera light stays on
      // and nothing responds, with no error anywhere. MediaPipe only requires
      // the timestamp we pass it to increase, and `performance.now()` always
      // does. Re-inferring the occasional identical frame is a rounding error
      // next to a feature that silently does nothing.

      let result: HandLandmarkerResult;
      /*
       * Timed around the call itself, because this is the one piece of work in
       * the loop that runs on the main thread and cannot be interrupted.
       *
       * §52 asks for hand-detection latency as its own budget, separately from
       * end-to-end, and the reason that separation matters here is §53: nothing
       * has been moved off the UI thread. Whatever this costs is time React and
       * the canvas painter do not have, thirty times a second. Migrating
       * inference to a worker is a real change with real risk, so it should be
       * justified by a measurement rather than by the fact that the
       * specification lists workers — which is what this number is for.
       */
      const startedAt = clockNow();
      try {
        result = landmarker.detectForVideo(source, now);
        this.inference.record(startedAt, clockNow());
        this.counters.inferences += 1;
      } catch (error) {
        // One bad inference must not end the session — the camera is still on
        // and the next frame is 30ms away. But it is recorded, because an
        // inference that throws on *every* frame is indistinguishable, from the
        // outside, from a hand that is never recognised.
        this.counters.inferenceErrors += 1;
        this.lastError = error instanceof Error ? error.message : String(error);
        this.recoverFromRepeatedFailure(source, onFrame);
        return;
      }

      if (result.landmarks.length) {
        this.counters.handsSeen += 1;
        const score = result.handednesses?.[0]?.[0]?.score ?? 1;
        if (score > this.bestConfidence) this.bestConfidence = score;
      }
      onFrame(toHandFrame(result, now));
    };

    this.frame = requestAnimationFrame(tick);
  }

  /**
   * If every inference is failing, try the CPU before giving up on the feature.
   *
   * The GPU delegate is the right default — hand tracking on the CPU competes
   * with the rendering it exists to serve — but it is also the part most likely
   * to be unavailable, on an old browser, a locked-down machine, or a driver
   * that reports support it does not have. That failure arrives as an exception
   * on every frame, which without this reads as "the camera is on and nothing
   * happens".
   *
   * One attempt, once. A loop that kept rebuilding the model would turn a
   * broken GPU path into a broken machine.
   */
  private recoverFromRepeatedFailure(
    source: HTMLVideoElement, onFrame: (frame: HandFrame) => void): void {
    if (this.delegate === "CPU" || this.reloading) return;
    if (this.counters.inferenceErrors < 10) return;

    this.reloading = true;
    this.delegate = "CPU";
    void (async () => {
      try {
        this.landmarker?.close();
        this.landmarker = null;
        await this.load();
        this.start(source, onFrame);
      } catch (error) {
        this.state = "failed";
        this.lastError = error instanceof Error ? error.message : String(error);
      } finally {
        this.reloading = false;
      }
    })();
  }

  /** What the loop has been doing, for a page whose job is to say why not. */
  diagnostics(): TrackerDiagnostics {
    return { ...this.counters, delegate: this.delegate, lastError: this.lastError,
             status: this.state, bestConfidence: this.bestConfidence };
  }

  stop(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    if (this.state === "running") this.state = "idle";
  }

  /** Release the model. The WASM heap is tens of megabytes. */
  close(): void {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
    this.state = "idle";
  }
}

/**
 * Say what went wrong in terms of what to do about it.
 *
 * The overwhelmingly likely cause is a fresh clone where the vendoring step has
 * not run, and the raw failure for that is a 404 on a `.task` file, which tells
 * a researcher nothing at all.
 */
function describeLoadFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);

  if (/404|not found|failed to fetch|NetworkError/i.test(detail)) {
    return "The hand-tracking model is not installed. It is downloaded once at "
         + "install time rather than fetched while you work, so nothing leaves "
         + "your machine when you use this. Run `npm run vendor:hand-model` in "
         + "apps/web, then try again.";
  }
  return `Hand tracking could not start: ${detail}`;
}
