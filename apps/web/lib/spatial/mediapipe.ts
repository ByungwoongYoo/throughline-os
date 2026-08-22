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
  /** Last video timestamp handed to MediaPipe, which requires them increasing. */
  private lastVideoTime = -1;

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
          delegate: "GPU",
        },
        numHands: 2,          // §6 — two-handed zoom needs both
        runningMode: "VIDEO",
        // Thresholds deliberately above MediaPipe's defaults. §31 is explicit
        // that a low-confidence detection must not act, and the state machine
        // gates on confidence again afterwards.
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
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

      const landmarker = this.landmarker;
      if (!landmarker) return;

      // A video that has not produced a frame yet has width 0, and MediaPipe
      // throws on it rather than returning nothing.
      if (!source.videoWidth || !source.videoHeight) return;

      const now = performance.now();
      if (now - this.lastInference < this.minInterval) return;
      this.lastInference = now;

      // MediaPipe requires strictly increasing timestamps in VIDEO mode and
      // throws otherwise. A paused or looping video repeats `currentTime`, so
      // the guard is against the source rather than against our own clock.
      const videoTime = source.currentTime;
      if (videoTime === this.lastVideoTime) return;
      this.lastVideoTime = videoTime;

      let result: HandLandmarkerResult;
      try {
        result = landmarker.detectForVideo(source, now);
      } catch {
        // One bad inference must not end the session. The camera is still on
        // and the next frame is 30ms away; tearing down here would drop the
        // researcher out of a gesture for a transient GPU hiccup.
        return;
      }

      onFrame(toHandFrame(result, now));
    };

    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.lastVideoTime = -1;
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
