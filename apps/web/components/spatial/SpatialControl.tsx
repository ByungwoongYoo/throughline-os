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
import { ScriptedHandTracker } from "@/lib/spatial/tracker";
import {
  DEFAULT_PREFERENCES, SpatialPreferences, readPreferences, writePreferences,
} from "@/lib/spatial/preferences";

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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<SpatialSession | null>(null);

  // Read on mount rather than during render: `localStorage` is not available on
  // the server, and reading it in the component body would make the first client
  // render disagree with the markup Next sent.
  useEffect(() => { setPreferences(readPreferences()); }, []);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
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

    const session = new SpatialSession(
      // The tracker is still the scripted one: MediaPipe fetches its model from
      // a CDN by default, and a silent network request on enabling a *privacy*
      // feature contradicts the first thing this product claims. Serving the
      // model locally is a packaging decision, not a gesture one.
      new ScriptedHandTracker([]),
      () => controllerRef.current,
      {
        onState: setState,
        onFailure: (reported) => { setFailure(reported); stop(); },
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
          <p className="spatial-state" role="status" aria-live="polite">
            {EXPLAIN[state]}
          </p>
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
