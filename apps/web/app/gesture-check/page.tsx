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
import { HandMeasurement, SpatialControl }
  from "@/components/spatial/SpatialControl";
import { VisualizationController } from "@/lib/spatial/commands";
import { SpatialTelemetry, emptyTelemetry } from "@/lib/spatial/session";
import { TrackerDiagnostics } from "@/lib/spatial/mediapipe";
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

export default function GestureCheck() {
  const controllerRef = useRef<VisualizationController | null>(null);
  const [counts, setCounts] = useState<SpatialTelemetry>(emptyTelemetry());
  const [fps, setFps] = useState<number | null>(null);

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

  const [hand, setHand] = useState<HandMeasurement | null>(null);
  const onMeasurement = useCallback((m: HandMeasurement) => setHand(m), []);

  useEffect(() => {
    const timer = setInterval(
      () => setTracker(readTracker.current?.() ?? null), 500);
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

      <Volume points={CLOUD} controllerRef={controllerRef}
              xLabel="x" yLabel="y" zLabel="z" valueLabel="group"
              title="A synthetic cloud, for testing the controls" />

      <SpatialControl controllerRef={controllerRef} label="this test cloud"
                      onTelemetry={onTelemetry} onFrameRate={onFrameRate}
                      onTracker={onTracker} onMeasurement={onMeasurement} />

      <section className="gc-numbers">
        <h2>What the tracker is doing</h2>
        <dl>
          <div>
            <dt>Frames processed each second</dt>
            <dd>{fps === null ? "—" : fps}</dd>
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
