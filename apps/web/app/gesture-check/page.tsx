"use client";

/**
 * A page for finding out whether hand tracking works on this machine.
 *
 * It exists because the reliability claims in the gesture layer rest on
 * synthetic landmark data. Hysteresis, dead zones, spike rejection, the
 * confidence gate, the smoothing constants — every one of those numbers came
 * from reasoning rather than from a hand, and the only way to learn whether
 * they are right is for a person to use them in their own room, in their own
 * light, with their own hands.
 *
 * Three decisions make that testable by somebody with nobody to ask.
 *
 * **No account and no data.** Sitting behind a sign-in would mean the first
 * thing anyone testing tracking has to do is remember a password, and testing
 * on a colleague's laptop would mean making them an account. The cloud here is
 * synthetic and fixed, so the page reaches no project and reveals nothing.
 *
 * **Numbers, not adjectives.** "It feels laggy" is not something a researcher
 * should have to translate into a bug report. The frame rate, the gesture
 * counts and the current state are on screen, so what gets reported back is a
 * measurement.
 *
 * **The questions are written down.** §37 lists what success means, and a page
 * that asks "does it work?" gets "sort of". The checks below are the specific
 * things that are unknown, phrased so an answer is useful.
 */

import { useCallback, useRef, useState } from "react";
import { Volume } from "@/components/charts/Volume";
import { Surface } from "@/components/charts/Surface";
import { HandMeasurement, SpatialControl }
  from "@/components/spatial/SpatialControl";
import { VisualizationController } from "@/lib/spatial/commands";
import { SpatialTelemetry, emptyTelemetry } from "@/lib/spatial/session";
import { TrackerDiagnostics } from "@/lib/spatial/mediapipe";
import { LatencySummary } from "@/lib/spatial/latency";
import { askNativeCapability, deviceFeedback } from "@/lib/spatial/feedback";
import { useEffect } from "react";

/**
 * A fixed synthetic cloud with visible structure.
 *
 * Three loose lobes rather than uniform noise: rotating a formless cloud tells
 * you nothing about whether the rotation is tracking your hand, because every
 * orientation looks the same. Structure is what makes lag and jitter legible.
 */
const CLOUD = Array.from({ length: 180 }, (_, i) => {
  const lobe = i % 3;
  const t = (i / 180) * Math.PI * 2;
  const jitter = (n: number) => (Math.sin(n * 12.9898) * 43758.5453 % 1) - 0.5;
  return {
    id: `p${i}`,
    label: `Point ${i + 1}`,
    x: Math.cos(t) * (2 + lobe) + jitter(i) * 0.8,
    y: Math.sin(t) * (2 + lobe) + jitter(i + 99) * 0.8,
    z: (lobe - 1) * 2.2 + jitter(i + 7) * 0.8,
    value: lobe,
  };
});

/**
 * A saddle: a ridge one way, a valley the other.
 *
 * Chosen because it is the shape a flat contour plot most completely destroys,
 * and the one that makes rotation obviously worth doing rather than a flourish.
 * A single peak reads fine from above; a saddle does not.
 */
const SURFACE = (() => {
  const axis = Array.from({ length: 17 }, (_, i) => i / 2);
  return {
    x: axis,
    y: axis,
    z: axis.map((y) => axis.map((x) =>
      Math.pow(x - 4, 2) / 3 - Math.pow(y - 4, 2) / 3 + Math.sin(x) * 0.8)),
  };
})();

const SURFACE_OBSERVATIONS = Array.from({ length: 14 }, (_, i) => {
  const x = 1 + (i % 7) * 1.1;
  const y = 1.5 + Math.floor(i / 7) * 3.2;
  return {
    id: `obs${i}`,
    label: `Run ${i + 1}`,
    x, y,
    z: Math.pow(x - 4, 2) / 3 - Math.pow(y - 4, 2) / 3 + Math.sin(x) * 0.8
       + (Math.sin(i * 3.7) * 0.4),
  };
});

const CHECKS = [
  ["Does the scene stay still when your hand is still?",
   "Hold a pinch without moving. Any drift means the dead zone is too small."],
  ["Can you talk and gesture normally without moving it?",
   "Explain something out loud, with your hands. Nothing should move. This is "
   + "the single most important behaviour in the feature."],
  ["Does a normal pinch register first time?",
   "Pinch the way you would naturally, not deliberately. If you have to "
   + "exaggerate it, use Calibrate."],
  ["Is there visible lag between your hand and the scene?",
   "Move steadily and watch for the scene trailing behind."],
  ["Does it stop when your hand leaves the frame?",
   "Take your hand away mid-rotation. The scene should stop dead, not drift."],
  ["Does it recover after the camera is blocked?",
   "Cover the lens for a moment, then uncover it. It should carry on without a "
   + "restart."],
];


/**
 * One sentence saying what is wrong, from the counters.
 *
 * The counters were already on screen and the researcher still had to work out
 * what they meant — which is a diagnostic that has offloaded the diagnosis. The
 * order matters: each check rules out a layer, so the first one that fires is
 * the innermost thing broken, and fixing anything further out would be wasted.
 */
function verdictFor(tracker: TrackerDiagnostics | null,
                    hand: HandMeasurement | null,
                    counts: SpatialTelemetry): { state: string; text: string } {
  if (!tracker) {
    return { state: "waiting",
             text: "The camera is not on yet. Press “Try hand gestures”, then "
                 + "“Turn on the camera”." };
  }
  if (tracker.status === "failed") {
    return { state: "bad",
             text: "Hand tracking failed to start on this machine. The error is "
                 + "below." };
  }
  if (tracker.inferences === 0) {
    return { state: "bad",
             text: tracker.skippedNoVideo > 0
               ? "The camera is on but producing no picture yet. If this does "
                 + "not change within a few seconds, another program may be "
                 + "holding the camera."
               : "No camera frames have been read yet. Give it a moment." };
  }
  if (tracker.inferenceErrors > 0 && tracker.handsSeen === 0) {
    return { state: "bad",
             text: `Hand tracking is failing on every frame (${tracker.inferenceErrors} `
                 + `errors). It has switched to ${tracker.delegate}. The last `
                 + "error is below." };
  }
  if (tracker.handsSeen === 0) {
    return { state: "bad",
             text: "Frames are being read, but no hand is being recognised. Try "
                 + "more light, a plainer background, and your whole hand in "
                 + "frame about an arm's length away." };
  }
  if (!hand) {
    return { state: "warn",
             text: "A hand was seen but is not in frame right now." };
  }
  if (counts.gesture_grab_started === 0) {
    return { state: "warn",
             text: hand.pinch < hand.pinchOn
               ? "Your pinch is closing. If the scene still does not move, that "
                 + "is a bug rather than a threshold — please report it."
               : `Your hand is tracked, but your pinch is not closing: fingers `
                 + `${hand.pinch.toFixed(3)} apart, and it has to be under `
                 + `${hand.pinchOn.toFixed(3)}. Press Calibrate — it measures `
                 + "your hand instead of assuming." };
  }
  return { state: "good",
           text: `Working. ${counts.gesture_grab_started} grab(s) started, `
               + `${counts.gesture_grab_completed} completed.` };
}

export default function GestureCheck() {
  const controllerRef = useRef<VisualizationController | null>(null);
  const surfaceRef = useRef<VisualizationController | null>(null);
  const [counts, setCounts] = useState<SpatialTelemetry>(emptyTelemetry());
  const [fps, setFps] = useState<number | null>(null);
  /**
   * How long a frame waits before the scene answers (§149).
   *
   * Polled rather than pushed, and only while somebody is looking: computing
   * percentiles per frame would cost more than the delay being measured.
   */
  const readLatency = useRef<(() => LatencySummary | null) | null>(null);
  const [latency, setLatency] = useState<LatencySummary | null>(null);
  const readInference = useRef<(() => LatencySummary | null) | null>(null);
  const [inference, setInference] = useState<LatencySummary | null>(null);

  const onTelemetry = useCallback((telemetry: SpatialTelemetry) => {
    setCounts(telemetry);
  }, []);
  const onFrameRate = useCallback((rate: number) => setFps(rate), []);

  /**
   * The tracker's counters, polled twice a second while it is running.
   *
   * Polled rather than pushed: these exist for the case where *nothing* is
   * happening, and a push-based reading would go quiet exactly when it was
   * needed. Twice a second is often enough to watch a number climb and rare
   * enough to cost nothing.
   */
  const readTracker = useRef<(() => TrackerDiagnostics | null) | null>(null);
  const [tracker, setTracker] = useState<TrackerDiagnostics | null>(null);
  const onTracker = useCallback(
    (read: () => TrackerDiagnostics | null) => { readTracker.current = read; }, []);

  const [haptics, setHaptics] =
    useState<{ available: boolean; feltWhere: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    void askNativeCapability().then((native) => { if (live) setHaptics(native); });
    return () => { live = false; };
  }, []);

  const [hand, setHand] = useState<HandMeasurement | null>(null);
  const onMeasurement = useCallback((m: HandMeasurement) => setHand(m), []);

  useEffect(() => {
    const timer = setInterval(() => {
      setTracker(readTracker.current?.() ?? null);
      setLatency(readLatency.current?.() ?? null);
      setInference(readInference.current?.() ?? null);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <main className="gc-page">
      <h1>Gesture check</h1>
      <p className="gc-lede">
        A page for finding out whether hand tracking works on this machine. It
        uses no project data and needs no account. Camera frames are read in
        this tab and never leave it.
      </p>

      {(() => {
        const verdict = verdictFor(tracker, hand, counts);
        return (
          <p className={`gc-verdict gc-${verdict.state}`} role="status">
            {verdict.text}
          </p>
        );
      })()}

      <Volume points={CLOUD} controllerRef={controllerRef}
              onDetent={(moment) => deviceFeedback.emit(moment)}
              xLabel="x" yLabel="y" zLabel="z" valueLabel="group"
              title="A synthetic cloud, for testing the controls" />

      <h2>A fitted surface</h2>
      <p className="gc-note">
        The other shape where three dimensions are the honest choice: a response
        over two predictors is a surface in the data, not a flat chart with depth
        added. Drag it, or use the same gestures — every 3D chart here is driven
        through one seam, so a gesture that works on one works on all of them.
      </p>
      <Surface grid={SURFACE} observations={SURFACE_OBSERVATIONS}
               controllerRef={surfaceRef}
               onDetent={(moment) => deviceFeedback.emit(moment)}
               xLabel="dose" yLabel="duration" zLabel="response"
               title="A saddle, fitted over two predictors" />

      {/*
        * Both figures, so the hand can address either (§189).
        *
        * `surfaceRef` existed and was passed to the chart and to nothing else,
        * which meant the saddle was dead to every gesture on this page — the
        * "written by one part of the system and read by none" defect the README
        * names, in the one place where it looks like broken tracking rather
        * than a missing wire.
        */}
      <SpatialControl controllerRef={controllerRef}
                      alsoControls={[surfaceRef]}
                      label="this test cloud"
                      onTelemetry={onTelemetry} onFrameRate={onFrameRate}
                      onTracker={onTracker} onMeasurement={onMeasurement}
                      onLatency={(read) => { readLatency.current = read; }}
                      onInferenceLatency={(read) => { readInference.current = read; }} />

      <section className="gc-numbers">
        <h2>What the tracker is doing</h2>
        <dl>
          <div>
            <dt>Frames processed each second</dt>
            <dd>{fps === null ? "—" : fps}</dd>
          </div>
          <div>
            <dt>Delay from frame to response</dt>
            <dd>{latency === null
              ? "—"
              : `${Math.round(latency.p50)} / ${Math.round(latency.p95)} / `
                + `${Math.round(latency.p99)} ms`}</dd>
          </div>
          <div>
            <dt>Of that, hand detection</dt>
            <dd>{inference === null
              ? "—"
              : `${Math.round(inference.p50)} / ${Math.round(inference.p95)} ms`}</dd>
          </div>
          <div>
            <dt>Frames seen in total</dt>
            <dd>{counts.frames}</dd>
          </div>
          <div>
            <dt>Grabs started / completed</dt>
            <dd>{counts.gesture_grab_started} / {counts.gesture_grab_completed}</dd>
          </div>
          <div>
            <dt>Zooms started / completed</dt>
            <dd>{counts.gesture_zoom_started} / {counts.gesture_zoom_completed}</dd>
          </div>
          <div>
            <dt>Selections</dt>
            <dd>{counts.gesture_selection_completed}</dd>
          </div>
          <div>
            <dt>Tracking lost / recovered</dt>
            <dd>{counts.tracking_lost} / {counts.tracking_recovered}</dd>
          </div>
        </dl>
        <p className="gc-note">
          Counts only. Nothing here records what you look like or how you moved
          — a tally answers whether gestures are being completed or abandoned,
          which is the question, and a log of timings and confidences would be a
          record of somebody at their desk.
        </p>
        <p className="gc-note">
          A healthy rate is around 30. Well below that on a busy machine is
          expected; well below that on an idle one is worth reporting. Many more
          grabs started than completed usually means the pinch threshold is
          wrong for your hand — try Calibrate.
        </p>
      </section>

      {hand && (
        <section className="gc-numbers">
          <h2>Your hand, as the tracker sees it</h2>
          <p className="gc-note">
            Pinch and watch the bar. It has to cross the line for a grab to
            start. If it never gets close, the threshold is wrong for your
            hand — press <em>Calibrate</em>, which measures you instead of
            assuming.
          </p>
          <div className="gc-gauge">
            <div className="gc-gauge-track">
              <span className="gc-gauge-fill"
                    style={{ width: `${Math.min(100, (hand.pinch / (hand.pinchOff * 2)) * 100)}%` }} />
              <span className="gc-gauge-mark"
                    style={{ left: `${Math.min(100, (hand.pinchOn / (hand.pinchOff * 2)) * 100)}%` }} />
            </div>
            <p className={hand.pinch < hand.pinchOn ? "gc-closed" : "gc-open"}>
              {hand.pinch < hand.pinchOn ? "Pinch closed" : "Pinch open"}
            </p>
          </div>
          <dl>
            <div>
              <dt>Fingers apart</dt>
              <dd>{hand.pinch.toFixed(3)}</dd>
            </div>
            <div>
              <dt>Closes below</dt>
              <dd>{hand.pinchOn.toFixed(3)}</dd>
            </div>
            <div>
              <dt>Hand span</dt>
              <dd>{hand.span.toFixed(3)}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{hand.confidence.toFixed(2)}</dd>
            </div>
          </dl>
        </section>
      )}

      {tracker && (
        <section className="gc-numbers">
          <h2>Why nothing is happening, if nothing is happening</h2>
          <dl>
            <div>
              <dt>Camera frames read</dt>
              <dd>{tracker.inferences}</dd>
            </div>
            <div>
              <dt>Frames with a hand in them</dt>
              <dd>{tracker.handsSeen}</dd>
            </div>
            <div>
              <dt>Skipped — no picture yet</dt>
              <dd>{tracker.skippedNoVideo}</dd>
            </div>
            <div>
              <dt>Inference errors</dt>
              <dd>{tracker.inferenceErrors}</dd>
            </div>
            <div>
              <dt>Running on</dt>
              <dd>{tracker.delegate}</dd>
            </div>
            <div>
              <dt>Tracker</dt>
              <dd>{tracker.status}</dd>
            </div>
          </dl>
          {tracker.lastError && (
            <p className="gc-error" role="alert">
              Last error from the tracker: {tracker.lastError}
            </p>
          )}
          <p className="gc-note">
            <strong>Camera frames read stuck at 0</strong>, with skipped climbing:
            the video is producing no picture. <strong>Frames read climbing but
            no hand</strong>: the tracker is running and not recognising a hand —
            try more light, or moving closer. <strong>Inference errors
            climbing</strong>: the model is failing on this machine; it switches
            from GPU to CPU by itself after ten failures, and *Running on* says
            which it settled on.
          </p>
        </section>
      )}

      {haptics && (
        <section className="gc-numbers">
          <h2>Touch feedback</h2>
          {haptics.available ? (
            <>
              <p className="gc-note">
                This machine has a real actuator, and the tap is produced in{" "}
                {haptics.feltWhere}. <strong>Rest a finger on the trackpad and
                press the button</strong> — that is the same tap a gesture
                fires.
              </p>
              <p className="gc-note">
                It is worth being plain about the limit: a hand held in mid-air
                has no actuator near it, so the pinch itself cannot be felt. What
                this improves is the pointer path — dragging, and landing on a
                point — which is a hand on the trackpad.
              </p>
              <button type="button" onClick={() => {
                void fetch("/api/haptics/tap", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ pattern: "alignment" }),
                }).catch(() => {});
              }}>
                Tap the trackpad
              </button>
            </>
          ) : (
            <p className="gc-note">
              No haptic actuator this program can reach. Nothing is broken —
              most machines have none, and the browser cannot produce one on its
              own. Confirmation here is visual, and sound if you switch it on.
            </p>
          )}
        </section>
      )}

      <section className="gc-checks">
        <h2>What to judge</h2>
        <p className="gc-note">
          These are the things that are genuinely unknown. Every one of them is
          currently answered by synthetic data rather than by a hand.
        </p>
        <ol>
          {CHECKS.map(([question, how]) => (
            <li key={question}>
              <strong>{question}</strong>
              <span>{how}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="gc-note">
        The mouse does everything the gestures do: drag to rotate, scroll to
        zoom, click to select. If a gesture is not working, that is a bug in the
        gesture layer and not a reason you cannot use the chart.
      </p>
    </main>
  );
}
