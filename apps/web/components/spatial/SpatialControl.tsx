"use client";

/**
 * The only place a camera is ever requested, and the explanation that precedes it.
 *
 * §4 asks that the researcher understands what is about to happen before the
 * browser's permission prompt appears. That ordering is the whole design here:
 * a research tool that springs a camera prompt has spent trust it cannot earn
 * back, and no amount of copy afterwards repairs it. So this component is a
 * button that explains, then a panel that asks, and never the reverse.
 *
 * The other constant is Rule 5: the mouse keeps every capability. Nothing in
 * this panel is the only route to anything — rotation, zoom, hover and selection
 * are all reachable by pointer, and the panel says so out loud rather than
 * leaving the researcher to discover it when the tracking fails.
 *
 * What this deliberately does **not** do is start anything on mount. Enabled
 * means the feature is offered; starting is an explicit act, every session.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { VisualizationController } from "@/lib/spatial/commands";
import { CameraDevice, CameraFailure, CameraManager } from "@/lib/spatial/camera";
import { SpatialState } from "@/lib/spatial/machine";
import { SpatialSession } from "@/lib/spatial/session";
import { MediaPipeHandTracker } from "@/lib/spatial/mediapipe";
import { CalibrationManager, CalibrationStep } from "@/lib/spatial/calibration";
import { HandFrame } from "@/lib/spatial/types";
import { HandPreview } from "./HandPreview";
import {
  DEFAULT_PREFERENCES, SpatialPreferences, readPreferences, writePreferences,
} from "@/lib/spatial/preferences";

/**
 * What each calibration step asks for.
 *
 * Phrased as an instruction rather than a status, because the researcher is
 * being asked to do something and "Step 1 of 2" tells them nothing about what.
 */
const CALIBRATION_PROMPT: Record<CalibrationStep, string> = {
  open: "Hold your hand open, fingers spread, and keep it still.",
  pinch: "Now touch your thumb and index finger together, and hold.",
  done: "Calibrated.",
};

/** What each state means, in the researcher's terms rather than the machine's. */
const EXPLAIN: Record<SpatialState, string> = {
  IDLE: "Not running.",
  TRACKING_LOST: "Your hand is not in the picture.",
  READY: "Ready — pinch to grab the scene.",
  GRABBED: "Holding the scene. Move to rotate it.",
  POINTING: "Pointing. Pinch to select what is under your finger.",
  TWO_HAND_READY: "Both hands held. Move them apart or together to zoom.",
  ZOOMING: "Zooming.",
  PAUSED: "Paused. Your hand is ignored until you resume.",
};

export function SpatialControl({ controllerRef, label }: {
  controllerRef: React.RefObject<VisualizationController | null>;
  /** What this controls, so the button is not an unlabelled camera request. */
  label: string;
}) {
  const [preferences, setPreferences] =
    useState<SpatialPreferences>(DEFAULT_PREFERENCES);
  const [explaining, setExplaining] = useState(false);
  const [state, setState] = useState<SpatialState>("IDLE");
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [running, setRunning] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [step, setStep] = useState<CalibrationStep>("open");
  const [progress, setProgress] = useState(0);
  const [calibrationProblem, setCalibrationProblem] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<SpatialSession | null>(null);
  const trackerRef = useRef<MediaPipeHandTracker | null>(null);
  /**
   * The latest processed frame, as a ref rather than state.
   *
   * Frames arrive ~30 times a second. Putting one in `useState` would re-render
   * the workspace at tracker rate — the exact cost the session was rewritten to
   * remove — so the preview canvas reads this on its own animation frame and
   * React never hears about an individual frame at all.
   */
  const frameRef = useRef<HandFrame | null>(null);
  const calibrationRef = useRef<CalibrationManager | null>(null);
  /** What the bar was last told, so the throttle can tell when it has news. */
  const publishedProgressRef = useRef(0);

  // Read on mount rather than during render: `localStorage` is not available on
  // the server, and reading it in the component body would make the first client
  // render disagree with the markup Next sent.
  useEffect(() => { setPreferences(readPreferences()); }, []);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    // The session stops the tracker; closing it also frees the model's WASM
    // heap, which the session deliberately knows nothing about.
    trackerRef.current?.close();
    trackerRef.current = null;
    setRunning(false);
    setState("IDLE");
  }, []);

  // Whatever happens — navigation, a re-render, the tab closing — the camera is
  // released. A component that unmounts with a stream open leaves the indicator
  // light on with nothing left on screen to explain it.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setFailure(null);
    const video = videoRef.current;
    if (!video) return;

    // Created per start and closed on stop: the model holds tens of megabytes of
    // WASM heap, which is not something to keep alive for a feature the
    // researcher switched off.
    const tracker = new MediaPipeHandTracker();
    trackerRef.current = tracker;

    const session = new SpatialSession(
      tracker,
      () => controllerRef.current,
      {
        onState: setState,
        onFailure: (reported) => { setFailure(reported); stop(); },
        onFrame: (frame) => {
          frameRef.current = frame;

          // Calibration samples the same frames the gestures do, rather than
          // opening a second path to the tracker. Progress is published coarsely
          // — a percentage per frame would re-render at tracker rate to move a
          // bar by three pixels.
          const calibration = calibrationRef.current;
          if (!calibration || frame.hands.length === 0) return;
          calibration.sample(frame.hands[0]);

          const next = calibration.progress();
          const published = publishedProgressRef.current;
          // Completion is always published, whatever bucket it falls in. The
          // first version rounded to quarters and nothing else, so 11 of 12
          // samples and 12 of 12 landed in the same bucket — the bar stopped at
          // 92%, the button stayed disabled, and the researcher was left holding
          // a pose that had in fact already been measured. Throttling that drops
          // the final update drops the only one that unblocks anything.
          const crossedBucket =
            Math.round(next * 4) !== Math.round(published * 4);
          if (next !== published && (crossedBucket || next >= 1)) {
            publishedProgressRef.current = next;
            setProgress(next);
          }
        },
      },
      preferences.settings,
    );

    const problem = await session.start(video, preferences.deviceId ?? undefined);
    if (problem) {
      setFailure(problem);
      return;
    }
    sessionRef.current = session;
    setRunning(true);
    // Say something true immediately. No state is published until a frame is
    // processed, so without this the panel reads "Not running." at the exact
    // moment the camera light comes on — which is both false and the fastest
    // way to convince someone the feature is broken. The camera is on and no
    // hand has been seen yet, which is what this state says and what tells the
    // researcher what to do next.
    setState("TRACKING_LOST");
    setExplaining(false);
    // Labels are only readable once permission exists — browsers hide them
    // otherwise so sites cannot fingerprint hardware — so the picker can only
    // appear after the camera is already running.
    setDevices(await session.devices());
  }, [controllerRef, preferences.deviceId, preferences.settings, stop]);

  /**
   * Begin the two-pose calibration described in §18.
   *
   * Optional, always. The span-relative thresholds mean the defaults already
   * work for most hands at most distances, so this exists for the people they
   * do not work for — not as a gate everybody walks through before using the
   * feature for the first time.
   */
  function startCalibration() {
    calibrationRef.current = new CalibrationManager();
    setCalibrationProblem(null);
    setStep("open");
    setProgress(0);
    publishedProgressRef.current = 0;
    setCalibrating(true);
  }

  /**
   * Advance, or finish and apply.
   *
   * The result is applied to the live session as well as persisted, so the
   * researcher can feel the difference immediately rather than being told to
   * turn the feature off and on again.
   */
  function advanceCalibration() {
    const calibration = calibrationRef.current;
    if (!calibration) return;

    if (calibration.current() === "open") {
      calibration.advance();
      setStep("pinch");
      setProgress(0);
      publishedProgressRef.current = 0;
      return;
    }

    const result = calibration.finish();
    if (!result.ok) {
      // A refusal is the useful outcome here, not an error to be smoothed over:
      // thresholds derived from two poses that did not separate would misread
      // the researcher for the rest of the session, and they would blame the
      // tracking rather than the setup screen that told them they were done.
      setCalibrationProblem(result.message);
      calibrationRef.current = new CalibrationManager();
      setStep("open");
      setProgress(0);
      publishedProgressRef.current = 0;
      return;
    }

    update({ settings: { ...preferences.settings, ...result.settings } });
    sessionRef.current?.configure(result.settings);
    calibrationRef.current = null;
    setCalibrating(false);
  }

  function update(next: Partial<SpatialPreferences>) {
    const merged = { ...preferences, ...next };
    setPreferences(merged);
    writePreferences(merged);
  }

  // A browser that cannot provide a camera is told so once, here, rather than
  // offering a control that fails when pressed.
  if (!CameraManager.supported()) return null;

  if (!preferences.enabled) {
    return (
      <div className="spatial-offer">
        <button type="button" className="spatial-quiet"
                onClick={() => update({ enabled: true })}>
          Try hand gestures for {label}
        </button>
        <p className="spatial-note">
          Experimental. It uses your camera, and everything here already works
          with a mouse.
        </p>
      </div>
    );
  }

  return (
    <div className="spatial-panel">
      {/*
        * Hidden, but present and playing: the tracker needs a video element to
        * read frames from. Deliberately not shown by default — a self-view is a
        * picture of the researcher on their own screen, which several people
        * would rather not have while presenting. `muted` and `playsInline`
        * because a camera stream carries no audio and must not go fullscreen.
        */}
      <video ref={videoRef} autoPlay muted playsInline
             style={{ display: "none" }} aria-hidden />

      {!running && !explaining && (
        <div className="spatial-row">
          <button type="button" onClick={() => setExplaining(true)}>
            Set up hand gestures
          </button>
          <button type="button" className="spatial-quiet"
                  onClick={() => { stop(); update({ enabled: false }); }}>
            Turn this off
          </button>
        </div>
      )}

      {explaining && (
        // §4 — everything the researcher should know, before the browser asks.
        <div className="spatial-explain" role="group"
             aria-label="Before turning on the camera">
          <p><strong>Your camera stays on this machine.</strong></p>
          <ul>
            <li>Frames are read in this browser tab to find your hand. They are
                never uploaded, never written to disk, and never recorded.</li>
            <li>Nothing about how you move is stored. The only thing kept is a
                count of gestures completed, which describes no one.</li>
            <li>The camera runs only while this is switched on, and stops the
                moment you turn it off or leave the page.</li>
            <li>The mouse still does everything it did — this adds a way to
                work, it does not replace one.</li>
          </ul>
          <div className="spatial-row">
            <button type="button" onClick={start}>
              Turn on the camera
            </button>
            <button type="button" className="spatial-quiet"
                    onClick={() => setExplaining(false)}>
              Not now
            </button>
          </div>
        </div>
      )}

      {running && (
        <div className="spatial-live">
          {/*
            * §19 — shown while it is useful, hidden when it is not. During
            * setup the only question is "is my hand in frame and does the
            * tracker agree"; afterwards the research visualization is the thing
            * being looked at, and a webcam feed of your own face is a
            * distraction. Kept mounted rather than unmounted when hidden, so
            * toggling it back does not restart the preview's animation frame.
            */}
          {showPreview && (
            <HandPreview videoRef={videoRef} frameRef={frameRef}
                         showSkeleton={showSkeleton} />
          )}

          <p className="spatial-state" role="status" aria-live="polite">
            {calibrating ? CALIBRATION_PROMPT[step] : EXPLAIN[state]}
          </p>

          {calibrating && (
            <div className="spatial-calibrate">
              <div className="spatial-progress"
                   role="progressbar" aria-valuenow={Math.round(progress * 100)}
                   aria-valuemin={0} aria-valuemax={100}
                   aria-label="Calibration progress">
                <span style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="spatial-row">
                <button type="button" disabled={progress < 1}
                        onClick={advanceCalibration}>
                  {step === "open" ? "Next" : "Finish"}
                </button>
                <button type="button" className="spatial-quiet"
                        onClick={() => { calibrationRef.current = null;
                                         setCalibrating(false); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {calibrationProblem && (
            <p className="spatial-failure" role="alert">{calibrationProblem}</p>
          )}
          <div className="spatial-row">
            <button type="button"
                    onClick={() => {
                      if (state === "PAUSED") {
                        sessionRef.current?.resume();
                        setState("READY");
                      } else {
                        sessionRef.current?.pause();
                      }
                    }}>
              {state === "PAUSED" ? "Resume" : "Pause"}
            </button>
            <button type="button" onClick={stop}>
              Turn off the camera
            </button>
            {!calibrating && (
              <button type="button" className="spatial-quiet"
                      onClick={startCalibration}>
                Calibrate
              </button>
            )}
          </div>

          {/* §19 — the researcher decides how much of the camera they see. */}
          <div className="spatial-row spatial-toggles">
            <label>
              <input type="checkbox" checked={showPreview}
                     onChange={(event) => setShowPreview(event.target.checked)} />
              Camera preview
            </label>
            <label>
              <input type="checkbox" checked={showSkeleton}
                     onChange={(event) => setShowSkeleton(event.target.checked)} />
              Hand outline
            </label>
          </div>

          {devices.length > 1 && (
            <label className="spatial-device">
              Camera
              <select value={preferences.deviceId ?? ""}
                      onChange={(event) => {
                        update({ deviceId: event.target.value || null });
                        // Restart, because a stream is bound to one device.
                        stop();
                      }}>
                <option value="">Default</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {failure && (
        // A refusal is a decision, not a fault: it says what happened, what to
        // do, and that nothing else is affected.
        <p className="spatial-failure" role="alert">{failure.message}</p>
      )}
    </div>
  );
}
