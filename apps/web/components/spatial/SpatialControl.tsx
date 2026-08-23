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
import { SpatialSession, SpatialTelemetry } from "@/lib/spatial/session";
import { LatencySummary } from "@/lib/spatial/latency";
import { chooseTarget, pointerFor } from "@/lib/spatial/targeting";
import { CursorIntent, cursorFrom } from "@/lib/spatial/cursor";
import { GUIDANCE, Onboarding, OnboardingStep } from "@/lib/spatial/onboarding";
import { HandCursor, HandCursorHandle } from "./HandCursor";
import { MediaPipeHandTracker, TrackerDiagnostics } from "@/lib/spatial/mediapipe";
import {
  CalibrationManager, CalibrationStep, handScale, scaleThresholds,
} from "@/lib/spatial/calibration";
import { DEFAULT_SETTINGS } from "@/lib/spatial/machine";
import { distance } from "@/lib/spatial/types";
import { HandFrame } from "@/lib/spatial/types";
import {
  availableChannels, askNativeCapability, deviceFeedback, momentFor,
} from "@/lib/spatial/feedback";
import { HandPreview } from "./HandPreview";
import {
  DEFAULT_PREFERENCES, SLIDER_RANGE, SpatialPreferences, readPreferences,
  writePreferences,
} from "@/lib/spatial/preferences";

/**
 * A live reading of the hand, for a page that has to explain a non-response.
 *
 * The one number that separates "the tracking is not seeing me" from "the
 * tracking sees me and disagrees about what a pinch is". From the outside those
 * two are identical — camera on, nothing moving — and they have completely
 * different fixes: light and distance for the first, calibration for the second.
 */
export type HandMeasurement = {
  /** Wrist to index knuckle: the hand's own ruler, in normalised units. */
  span: number;
  /** Thumb tip to index tip, right now. */
  pinch: number;
  /** What that has to fall below to close, and rise above to open again. */
  pinchOn: number;
  pinchOff: number;
  confidence: number;
};

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

export function SpatialControl({ controllerRef, alsoControls, label, onTelemetry,
                                 onFrameRate, onTracker, onMeasurement, onLatency,
                                 onInferenceLatency, onActiveTarget, intentOf,
                                 reachOf,
                                 onFrame }: {
  controllerRef: React.RefObject<VisualizationController | null>;
  /**
   * Further figures on the page that the hand may address (§189).
   *
   * Optional, and `controllerRef` remains the first of them, so a page with one
   * chart is unchanged. A page with two had no way to say so at all: the second
   * chart was simply dead to the hand, and a researcher waving at it concludes
   * the tracking is broken rather than that nothing was wired.
   */
  alsoControls?: Array<React.RefObject<VisualizationController | null>>;
  /** What this controls, so the button is not an unlabelled camera request. */
  label: string;
  /**
   * Optional diagnostics, for a page whose purpose is to test the tracking
   * rather than to use it. Counts only — never imagery, never a trace of how
   * somebody moved.
   */
  onTelemetry?: (telemetry: SpatialTelemetry) => void;
  onFrameRate?: (framesPerSecond: number) => void;
  /**
   * The tracker's own counters, polled by a diagnostics page.
   *
   * A function rather than a stream: these are read when somebody is looking at
   * them, and pushing them per frame would cost a render for numbers nobody has
   * on screen.
   */
  onTracker?: (read: () => TrackerDiagnostics | null) => void;
  /**
   * How long a frame waits, as a distribution (§149).
   *
   * A reader rather than a stream, for the same reason as `onTracker`: this is
   * read when somebody is looking at it, and pushing a percentile calculation
   * per frame would cost more than the thing it measures.
   */
  onLatency?: (read: () => LatencySummary | null) => void;
  /** How long inference alone blocks the main thread. Read, not streamed. */
  onInferenceLatency?: (read: () => LatencySummary | null) => void;
  /**
   * Which figure the hand is currently addressing (§189).
   *
   * A reader rather than a stream: this is asked at the moment a stroke lands,
   * not thirty times a second, and pushing it per frame would re-render the page
   * to report the same chart. Returns null when the hand is over nothing, which
   * the caller must treat as "no figure" rather than as "the usual one".
   */
  onActiveTarget?: (read: () => VisualizationController | null) => void;
  /**
   * What a pinch would do right now, so the cursor can say (§95).
   *
   * A function rather than a value, read once per frame, because the answer
   * depends on the tool the host has in hand and only the host knows that.
   */
  intentOf?: () => CursorIntent;
  /** How far the tool in hand reaches, so its size can be seen (§177). */
  reachOf?: () => number | null;
  /**
   * What the pinch actually measures, against what it has to beat.
   *
   * The one number that separates "the tracking is not seeing me" from "the
   * tracking sees me and disagrees about what a pinch is". Without it those two
   * look identical from the outside, and they have completely different fixes.
   *
   * Throttled to a few times a second: it is read by eye.
   */
  onMeasurement?: (m: HandMeasurement) => void;
  /**
   * Every tracked frame, for a subsystem that needs the hand rather than the
   * gestures — Air Ink is the one that does.
   *
   * Opening a second tracker for it would mean two inferences per frame off one
   * camera, and worse, two slightly different readings of the same hand: the pen
   * would land a few pixels from where the pointer said it was, on the same
   * screen, with nothing to explain the gap.
   */
  onFrame?: (frame: HandFrame) => void;
}) {
  const [preferences, setPreferences] =
    useState<SpatialPreferences>(DEFAULT_PREFERENCES);
  const [explaining, setExplaining] = useState(false);
  const [state, setState] = useState<SpatialState>("IDLE");
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [running, setRunning] = useState(false);
  /**
   * Whether the first client render has happened.
   *
   * Without this the component is a hydration mismatch by construction: the
   * support check below reads `navigator`, which does not exist on the server,
   * so the server renders nothing and the browser renders a button — and React
   * throws "server rendered HTML didn't match" on every page carrying this
   * control. Rendering nothing until mounted makes both passes agree, and the
   * offer appears a frame later.
   *
   * Found in a browser. Nothing in the suite could have caught it: happy-dom
   * has a `navigator`, so the two renders agree in tests and disagree in
   * production.
   */
  const [mounted, setMounted] = useState(false);
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
  const lastMeasuredRef = useRef(0);

  /**
   * The frame observer, read through a ref.
   *
   * The session captures its observer object once, when the camera starts.
   * Passing `onFrame` straight in would freeze whichever closure existed at that
   * moment, so a host that re-rendered with new state would keep receiving
   * frames into a stale one — the observer would keep working and quietly act on
   * values from before the camera was switched on.
   */
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  /**
   * The figure the hand is addressing, and whether it is being held (§189).
   *
   * Refs rather than state: this is recomputed on every frame, and re-rendering
   * the page thirty times a second to record which chart is under a hand would
   * cost more than everything it is deciding between.
   */
  const activeRef = useRef<VisualizationController | null>(null);
  const engagedRef = useRef(false);
  const cursorRef = useRef<HandCursorHandle | null>(null);
  /**
   * The four-step introduction (§97), driven by the hand rather than by a Next
   * button — so finishing it is proof that gestures work here, and being stuck
   * on one step is a precise report rather than "it doesn't work".
   */
  const onboardingRef = useRef<Onboarding | null>(null);
  const [teaching, setTeaching] =
    useState<Exclude<OnboardingStep, "done"> | null>(null);
  const [teachingProgress, setTeachingProgress] = useState(0);
  const teachingRef = useRef<OnboardingStep | null>(null);
  /** Narrowing helper: "done" is not a step with anything to say. */
  const asGuided = (step: OnboardingStep) =>
    (step === "done" ? null : step);
  const progressRef = useRef(0);

  const [channels, setChannels] = useState(() => availableChannels());
  /** Set briefly on a gesture moment, so the panel can show it landed. */
  const [pulse, setPulse] = useState(false);

  // Read on mount rather than during render: `localStorage` is not available on
  // the server, and reading it in the component body would make the first client
  // render disagree with the markup Next sent.
  useEffect(() => {
    setMounted(true);
    const stored = readPreferences();
    setPreferences(stored);
    deviceFeedback.configure(stored.feedback);

    // Ask the machine what it can actually do. Until it answers, the native
    // channel is off — nothing is promised before it is known.
    let live = true;
    void askNativeCapability().then((native) => {
      if (!live) return;
      setChannels((current) => ({ ...current, native }));
      deviceFeedback.useNative(native.available);
    });
    // The shared feedback is deliberately *not* closed here. It belongs to the
    // machine rather than to this component, and other things on the page — a
    // chart's detents — go on using it after this panel unmounts.
    return () => { live = false; };
  }, []);

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
    onTracker?.(() => trackerRef.current?.diagnostics() ?? null);
    onLatency?.(() => sessionRef.current?.latencySummary() ?? null);
    onInferenceLatency?.(() => sessionRef.current?.inferenceSummary() ?? null);
    onActiveTarget?.(() => activeRef.current);

    const session = new SpatialSession(
      tracker,
      // Whichever figure the hand is on, decided a moment ago in `onFrame`.
      // Falls back to the first, so a page with one chart behaves as before and
      // a hand that is over nothing does not lose a gesture already in flight.
      () => activeRef.current ?? controllerRef.current,
      {
        onState: setState,
        onFailure: (reported) => { setFailure(reported); stop(); },
        onEvents: (events) => {
          // The visual channel is the only one always present, so it fires for
          // every marked moment regardless of what hardware exists.
          for (const event of events) {
            const moment = momentFor(event);
            if (!moment) continue;
            deviceFeedback.emit(moment);
            setPulse(true);
            window.setTimeout(() => setPulse(false), 140);
          }
        },
        onTelemetry,
        onFrameRate,
        onFrame: (frame) => {
          frameRef.current = frame;
          // Before anything else, and outside the throttles below: ink is drawn
          // per frame, and a subsystem whose job is hiding latency cannot be fed
          // at a quarter of the rate the tracker runs at.
          onFrameRef.current?.(frame);

          /*
           * Choose which figure this frame is addressed to, before the session
           * asks for it.
           *
           * Ordering is what makes this work without touching the session at
           * all: `SpatialSession` calls its `controller()` resolver *after*
           * publishing the frame to this observer, so deciding here is decided
           * in time. The resolver below simply returns what was chosen.
           */
          const chartHand = frame.hands[0];
          if (chartHand) {
            const settings = { ...DEFAULT_SETTINGS, ...preferences.settings };
            const { pinchOn, pinchOff } = scaleThresholds(chartHand, settings);
            const pinch = distance(chartHand.thumbTip, chartHand.indexTip);
            // The same hysteresis the gesture machine uses, so the lock is held
            // for exactly as long as the machine considers the hand closed.
            engagedRef.current = engagedRef.current
              ? pinch < pinchOff
              : pinch < pinchOn;

            const candidates = [controllerRef, ...(alsoControls ?? [])]
              .map((ref) => ref.current)
              .filter((c): c is VisualizationController => c !== null);
            const pointer = pointerFor(
              { x: chartHand.indexTip.x, y: chartHand.indexTip.y },
              { width: window.innerWidth, height: window.innerHeight });
            activeRef.current = chooseTarget(candidates, pointer, {
              engaged: engagedRef.current,
              heldTarget: activeRef.current,
            }).target;
          } else {
            // No hand, no lock. Leaving it engaged would hold a chart hostage
            // after the researcher walked away.
            engagedRef.current = false;
          }

          /*
           * The cursor, every frame, and never through React (§94, §142).
           *
           * Computed here because this is the only place that has the hand, the
           * settings the machine is using, and whether a figure is under it —
           * and a cursor computed from any subset of those would disagree with
           * the machine about what is happening, which is worse than no cursor.
           */
          const guide = onboardingRef.current;
          if (guide && !guide.finished()) {
            const state = guide.step_(frame);
            // Published on change only: progress moves at tracker rate and a
            // setState per frame would re-render the page to move a bar.
            if (state.justCompleted || state.step !== teachingRef.current) {
              teachingRef.current = state.step;
              setTeaching(asGuided(state.step));
              if (state.justCompleted) deviceFeedback.emit("select");
              if (state.step === "done") {
                update({ onboarded: true });
              }
            }
            if (Math.round(state.progress * 3) !== progressRef.current) {
              progressRef.current = Math.round(state.progress * 3);
              setTeachingProgress(state.progress);
            }
          }

          cursorRef.current?.show(cursorFrom({
            hand: chartHand ?? null,
            settings: { ...DEFAULT_SETTINGS, ...preferences.settings },
            engaged: engagedRef.current,
            overTarget: activeRef.current !== null,
            intent: intentOf?.() ?? "grab",
            addressing: activeRef.current?.bounds() ?? null,
            reach: reachOf?.() ?? null,
            project: (point) => ({
              x: (1 - point.x) * window.innerWidth,
              y: point.y * window.innerHeight,
            }),
          }));

          // A reading of the hand, a few times a second. Deliberately computed
          // from the same frame the machine just judged, so what is displayed is
          // what was decided on rather than a second sample taken nearby.
          const hand = frame.hands[0];
          if (onMeasurement && hand
              && frame.timestamp - lastMeasuredRef.current > 250) {
            lastMeasuredRef.current = frame.timestamp;
            const settings = { ...DEFAULT_SETTINGS, ...preferences.settings };
            const { pinchOn, pinchOff } = scaleThresholds(hand, settings);
            onMeasurement({
              span: handScale(hand),
              pinch: distance(hand.thumbTip, hand.indexTip),
              pinchOn, pinchOff,
              confidence: hand.confidence,
            });
          }

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

    // Play explicitly rather than relying on the `autoPlay` attribute.
    //
    // The attribute fires when the element gets a source during parsing; this
    // element gets its stream later, from JavaScript, and whether that
    // autoplays has varied by browser. A video that never starts produces a
    // `videoWidth` of 0 for ever, and the panel would report no hand in the
    // picture while the camera light was on — indistinguishable from tracking
    // that cannot see you.
    try {
      await video.play();
    } catch {
      // Muted playback is allowed without a gesture, and this is inside a click
      // anyway, so a rejection here is unexpected rather than routine — but it
      // must not take down a session that is otherwise working.
    }
    sessionRef.current = session;
    // Only for somebody who has not done it. §97 is a first session, not a
    // thing that greets you every time you switch the camera on.
    onboardingRef.current = preferences.onboarded
      ? null : new Onboarding({ ...DEFAULT_SETTINGS, ...preferences.settings });
    teachingRef.current = null;
    setTeaching(preferences.onboarded ? null : "point");
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
  }, [controllerRef, alsoControls, preferences.deviceId, preferences.settings, stop,
      onTelemetry, onFrameRate, onTracker, onMeasurement, onLatency,
      onInferenceLatency, onActiveTarget, intentOf, reachOf]);

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
    calibrationRef.current = null;
    setCalibrating(false);
    // §19 — the video was there to answer "does the tracker see my hand", and
    // that question has just been answered. The research visualization is what
    // the researcher came for, so the preview gets out of the way on its own
    // rather than waiting to be dismissed. The toggle below brings it back.
    setShowPreview(false);
  }

  function update(next: Partial<SpatialPreferences>) {
    const merged = { ...preferences, ...next };
    setPreferences(merged);
    writePreferences(merged);
    // Applied to the running session too, so a sensitivity change is felt on
    // the next movement rather than after switching the feature off and on.
    // A settings panel whose effect is deferred teaches people that it does not
    // work, and they stop touching it.
    if (next.settings) sessionRef.current?.configure(next.settings);
    if (next.feedback) deviceFeedback.configure(next.feedback);
  }

  function setSensitivity(key: "rotationSensitivity" | "zoomSensitivity",
                          value: number) {
    update({ settings: { ...preferences.settings, [key]: value } });
  }

  // Nothing at all until the client has rendered once — see `mounted`.
  if (!mounted) return null;

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
        * Off-screen rather than `display: none`, and the difference is the whole
        * feature working.
        *
        * A display:none video is not rendered, and browsers are entitled to
        * stop decoding frames for one — `videoWidth` stays 0, so the tracker's
        * guard skips every frame and hand tracking silently never starts, with
        * the camera light on and the panel reporting that no hand is in the
        * picture. It would look exactly like bad tracking.
        *
        * One pixel, clipped, off the edge of the viewport: laid out and decoded,
        * invisible to the reader. `muted` and `playsInline` because a camera
        * stream carries no audio and must not go fullscreen on iOS.
        */}
      <video ref={videoRef} autoPlay muted playsInline aria-hidden
             /*
              * Inside the viewport, and that is the whole point.
              *
              * This has now been wrong twice in two different ways, both with
              * the same symptom: camera light on, no hand ever detected, no
              * error anywhere. First as `display: none`, which browsers may not
              * decode at all. Then at `left: -9999`, which is laid out but
              * entirely off-screen — and a browser is entitled to stop
              * compositing a video nobody can see, which leaves MediaPipe
              * sampling a stale or blank texture every frame.
              *
              * The tracker reads this element as a texture source, so it has to
              * be a thing the compositor is actually keeping current. One pixel
              * at the origin, transparent and not clickable: on screen by every
              * definition the browser uses, invisible by every definition the
              * researcher does.
              */
             style={{ position: "fixed", top: 0, left: 0, width: 2, height: 2,
                      opacity: 0.01, pointerEvents: "none", zIndex: -1 }} />
      <HandCursor ref={cursorRef} active={running} />

      {/*
        * The introduction (§97), and it is never a gate.
        *
        * Rendered beside everything rather than over it: the scene responds to
        * the hand throughout, so a researcher who would rather just start can,
        * and one who is stuck on a step can skip that step alone rather than the
        * whole sequence — being held at the one thing your hand or your camera
        * is bad at is exactly what would make somebody give up on the feature.
        */}
      {teaching && (
        <div className="spatial-teaching">
          <p className="spatial-teaching-step">
            <strong>{GUIDANCE[teaching].instruction}</strong>{" "}
            <span>— {GUIDANCE[teaching].because}.</span>
          </p>
          <div className="spatial-teaching-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(teachingProgress * 100)}%` }} />
          </div>
          <div className="spatial-teaching-actions">
            <button type="button" onClick={() => {
              onboardingRef.current?.skipStep();
              const next = onboardingRef.current?.current() ?? "done";
              teachingRef.current = next;
              setTeaching(asGuided(next));
              if (next === "done") update({ onboarded: true });
            }}>Skip this step</button>
            <button type="button" onClick={() => {
              onboardingRef.current?.skipAll();
              setTeaching(null);
              update({ onboarded: true });
            }}>Skip the introduction</button>
          </div>
        </div>
      )}

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

          <p className={pulse ? "spatial-state spatial-pulse" : "spatial-state"}
             role="status" aria-live="polite">
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

          {/*
            * §29's Interaction group, and §31's recovery: one action that
            * returns a view from anywhere, reachable without a hand — a
            * researcher whose tracking has gone wrong is precisely the one who
            * cannot gesture their way home.
            */}
          <div className="spatial-row">
            <button type="button" className="spatial-quiet"
                    onClick={() => controllerRef.current?.resetView()}>
              Reset the view
            </button>
          </div>

          <details className="spatial-advanced">
            <summary>Sensitivity</summary>
            <label className="spatial-slider">
              Rotation
              <input type="range"
                     min={SLIDER_RANGE.rotationSensitivity.min}
                     max={SLIDER_RANGE.rotationSensitivity.max}
                     step={SLIDER_RANGE.rotationSensitivity.step}
                     value={preferences.settings.rotationSensitivity}
                     onChange={(event) => setSensitivity(
                       "rotationSensitivity", Number(event.target.value))} />
              <span>{preferences.settings.rotationSensitivity.toFixed(1)}</span>
            </label>
            <label className="spatial-slider">
              Zoom
              <input type="range"
                     min={SLIDER_RANGE.zoomSensitivity.min}
                     max={SLIDER_RANGE.zoomSensitivity.max}
                     step={SLIDER_RANGE.zoomSensitivity.step}
                     value={preferences.settings.zoomSensitivity}
                     onChange={(event) => setSensitivity(
                       "zoomSensitivity", Number(event.target.value))} />
              <span>{preferences.settings.zoomSensitivity.toFixed(1)}</span>
            </label>
          </details>

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

          {/*
            * A switch only for a channel that exists. Offering "vibration" on a
            * laptop that cannot vibrate is a control that does nothing, and a
            * control that does nothing teaches people the panel is decorative.
            */}
          <div className="spatial-row spatial-toggles">
            {(channels.vibration || channels.native.available) && (
              <label>
                <input type="checkbox" checked={preferences.feedback.vibrate}
                       onChange={(event) => update({
                         feedback: { ...preferences.feedback,
                                     vibrate: event.target.checked } })} />
                Touch feedback
              </label>
            )}
            {channels.sound && (
              <label>
                <input type="checkbox" checked={preferences.feedback.sound}
                       onChange={(event) => update({
                         feedback: { ...preferences.feedback,
                                     sound: event.target.checked } })} />
                Sound
              </label>
            )}
          </div>

          {channels.native.available && channels.native.feltWhere && (
            /* The limit stated where the switch is, not in a help page. A hand
               in the air has no actuator near it, and a researcher who expected
               to feel a mid-air pinch would reasonably conclude it was broken. */
            <p className="spatial-note">
              Taps are produced in {channels.native.feltWhere}.
            </p>
          )}

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
