/**
 * The surface that asks for a camera, and the order it does things in.
 *
 * Almost every assertion here is about *sequence* rather than appearance. A
 * research tool that springs a permission prompt has spent trust it cannot earn
 * back, so the explanation has to come first, the camera has to start only on a
 * deliberate press, and nothing may request it on mount. Those are testable, and
 * they are the ones that would be quietly broken by an ordinary refactor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpatialControl } from "@/components/spatial/SpatialControl";
import { VisualizationController } from "@/lib/spatial/commands";
import { DEFAULT_PREFERENCES } from "@/lib/spatial/preferences";

/**
 * The tracker is stubbed, deliberately and completely.
 *
 * Real hand tracking needs a WASM runtime, a GPU delegate, a 7.5MB model and a
 * person with a hand — none of which exist in happy-dom. More importantly, none
 * of them are what this file is about: every assertion here is about the order
 * the component does things in, and inference is downstream of all of it.
 * `spatial-mediapipe.test.ts` covers the part of the tracker that can be
 * checked without a camera, which is the landmark mapping.
 */
let deliverFrame: ((frame: unknown) => void) | null = null;

vi.mock("@/lib/spatial/mediapipe", () => ({
  MediaPipeHandTracker: class {
    async load() {}
    start(_source: unknown, onFrame: (frame: unknown) => void) {
      // Captured rather than ignored: this is the callback the session hands a
      // real tracker, so a test that calls it drives the whole chain — session,
      // machine, calibration — exactly as landmarks from a camera would.
      deliverFrame = onFrame;
    }
    stop() { deliverFrame = null; }
    close() {}
    status() { return "running" as const; }
  },
}));

let getUserMedia: ReturnType<typeof vi.fn>;
let tracks: Array<{ stop: ReturnType<typeof vi.fn>; kind: string }>;

beforeEach(() => {
  clock = 0;
  window.localStorage.clear();
  tracks = [{ stop: vi.fn(), kind: "video" }];
  // A real `MediaStream`, not a shaped object: happy-dom type-checks the
  // assignment to `video.srcObject` exactly as a browser does, so a plain object
  // would be rejected and the test would exercise the failure path while
  // claiming to test the happy one. Its instances carry no tracks here, so the
  // spies are attached directly.
  getUserMedia = vi.fn(async () => {
    const stream = new MediaStream();
    stream.getTracks = () => tracks as unknown as MediaStreamTrack[];
    return stream;
  });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => [
        { kind: "videoinput", deviceId: "cam-1", label: "FaceTime HD" },
      ]),
    },
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  const controllerRef = createRef<VisualizationController | null>();
  render(<SpatialControl controllerRef={controllerRef} label="this scatter" />);
  return controllerRef;
}

/** Get past the opt-in, which is off by default. */
async function optIn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /try hand gestures/i }));
}

describe("nothing happens until it is asked for", () => {
  it("requests no camera on mount", () => {
    /** The single most important assertion in this file. */
    mount();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("offers the feature without turning it on", async () => {
    const user = userEvent.setup();
    mount();

    await optIn(user);

    // Opted in, and still no camera: enabled means offered, not running.
    expect(screen.getByRole("button", { name: /set up hand gestures/i }))
      .toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("explains before it asks", async () => {
    /**
     * §4. The browser's prompt must never be the first the researcher hears of
     * it — the explanation is a step, not a tooltip, and the camera is not
     * requested while it is on screen.
     */
    const user = userEvent.setup();
    mount();
    await optIn(user);

    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));

    expect(screen.getByText(/your camera stays on this machine/i)).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("says the things a researcher would want to know first", async () => {
    const user = userEvent.setup();
    mount();
    await optIn(user);
    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));

    const panel = screen.getByRole("group", { name: /before turning on the camera/i });

    expect(panel.textContent).toMatch(/never uploaded/i);
    expect(panel.textContent).toMatch(/never recorded/i);
    // Rule 5, said out loud rather than left to be discovered when it fails.
    expect(panel.textContent).toMatch(/mouse still does everything/i);
  });

  it("takes no for an answer", async () => {
    const user = userEvent.setup();
    mount();
    await optIn(user);
    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));

    await user.click(screen.getByRole("button", { name: /not now/i }));

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByText(/your camera stays on this machine/i)).toBeNull();
  });

  it("asks only after the researcher presses the button that says so", async () => {
    const user = userEvent.setup();
    mount();
    await optIn(user);
    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));

    await user.click(screen.getByRole("button", { name: /turn on the camera/i }));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    // ...and never for a microphone.
    expect(getUserMedia.mock.calls[0][0].audio).toBe(false);
  });
});

describe("once it is running", () => {
  async function turnOn(user: ReturnType<typeof userEvent.setup>) {
    await optIn(user);
    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /turn on the camera/i }));
    await waitFor(() => screen.getByRole("button", { name: /turn off the camera/i }));
  }

  it("offers a way out that is always visible", async () => {
    /**
     * §10. A researcher who wants the camera off must never have to hunt for
     * the control, and it must not be behind the state that is misbehaving.
     */
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    expect(screen.getByRole("button", { name: /turn off the camera/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /pause/i })).toBeTruthy();
  });

  it("releases the camera when switched off", async () => {
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    await user.click(screen.getByRole("button", { name: /turn off the camera/i }));

    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it("releases the camera when the component goes away", async () => {
    /**
     * Navigation, a re-render, a closing tab. A component that unmounts with a
     * stream open leaves the indicator light on and nothing on screen to
     * explain it — the worst version of this feature's failure mode, because
     * there is no longer any control to switch off.
     */
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    cleanup();

    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it("describes what it is doing in words rather than a state name", async () => {
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    const status = screen.getByRole("status");

    expect(status.textContent).not.toMatch(/READY|IDLE|GRABBED/);
    expect(status.textContent).toMatch(/pinch|ready|hand/i);
  });
});

describe("when the camera says no", () => {
  it("explains a refusal instead of failing silently", async () => {
    getUserMedia.mockRejectedValue(
      Object.assign(new Error("no"), { name: "NotAllowedError" }));
    const user = userEvent.setup();
    mount();
    await optIn(user);
    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));

    await user.click(screen.getByRole("button", { name: /turn on the camera/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/declined/i);
    // And says the rest of the chart is unaffected, because it is.
    expect(alert.textContent).toMatch(/works without it/i);
  });

  it("offers nothing at all in a browser that cannot do this", async () => {
    /** Better than a control that fails when pressed. */
    vi.stubGlobal("navigator", {});
    const { container } = render(
      <SpatialControl controllerRef={createRef()} label="this scatter" />);

    expect(container.textContent).toBe("");
  });
});

describe("the choice is remembered, the camera is not", () => {
  it("remembers that the feature was switched on", async () => {
    const user = userEvent.setup();
    mount();
    await optIn(user);
    cleanup();

    mount();

    await waitFor(() => expect(
      screen.getByRole("button", { name: /set up hand gestures/i })).toBeTruthy());
  });

  it("does not resume the camera on a later visit", async () => {
    /**
     * The distinction the whole preferences file exists for. Remembering that
     * someone once enabled a webcam feature must never mean starting a webcam
     * for them — starting is an explicit act, every session.
     */
    const user = userEvent.setup();
    mount();
    await optIn(user);
    cleanup();
    getUserMedia.mockClear();

    mount();

    await waitFor(() => screen.getByRole("button", { name: /set up hand gestures/i }));
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("can be turned off again", async () => {
    const user = userEvent.setup();
    mount();
    await optIn(user);

    await user.click(screen.getByRole("button", { name: /turn this off/i }));

    expect(screen.getByRole("button", { name: /try hand gestures/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Calibration (§18) and the camera preview (§19)
// ---------------------------------------------------------------------------

/**
 * Deliver frames of a held pose, as the tracker would.
 *
 * `pinchRatio` is the thumb-to-index distance as a fraction of the hand's own
 * span, which is the unit calibration measures in — so "open" and "pinched" are
 * one parameter apart rather than a rewritten fixture.
 */
let clock = 0;

function feed(pinchRatio: number, count: number, span = 0.12) {
  const pinch = span * pinchRatio;
  for (let i = 0; i < count; i += 1) {
    // The clock only ever goes forward, across calls as well as within them.
    // The session's rate governor compares each frame against the last one it
    // processed, so a helper that restarted at zero for the second pose had
    // every one of its frames rejected as arriving too soon — the progress bar
    // sat at zero and the pose looked unmeasurable. The same mistake the
    // session itself guards against on restart.
    clock += 40;
    act(() => {
      deliverFrame?.({
        timestamp: clock,
        hands: [{
          handedness: "right", confidence: 0.95,
          wrist: { x: 0.5, y: 0.5 + span * 2 },
          indexBase: { x: 0.5, y: 0.5 + span },
          thumbTip: { x: 0.5 - pinch / 2, y: 0.5 },
          indexTip: { x: 0.5 + pinch / 2, y: 0.5 },
          middleTip: { x: 0.5, y: 0.5 + span * 1.7 },
          ringTip: { x: 0.5, y: 0.5 + span * 1.8 },
          pinkyTip: { x: 0.5, y: 0.5 + span * 1.9 },
          palmCenter: { x: 0.5, y: 0.5 },
        }],
      });
    });
  }
}

describe("calibration", () => {
  async function turnOn(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /try hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /turn on the camera/i }));
    await waitFor(() => screen.getByRole("button", { name: /turn off the camera/i }));
  }

  it("is offered but never required", async () => {
    /**
     * §18, and the reason the span-relative thresholds came first: the defaults
     * already work for most hands at most distances, so calibration is for the
     * people they do not work for — not a gate everybody walks through before
     * using the feature once.
     */
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    // Running, tracking, and no calibration in sight.
    expect(screen.getByRole("button", { name: /calibrate/i })).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("asks for one pose at a time, in words that say what to do", async () => {
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    await user.click(screen.getByRole("button", { name: /calibrate/i }));

    expect(screen.getByRole("status").textContent).toMatch(/hold your hand open/i);
    // Cannot advance before the pose has actually been measured.
    expect(screen.getByRole("button", { name: /^next$/i }).hasAttribute("disabled"))
      .toBe(true);
  });

  it("can be abandoned without disturbing anything", async () => {
    /** A researcher who opened it by accident must be able to leave. */
    const user = userEvent.setup();
    mount();
    await turnOn(user);
    await user.click(screen.getByRole("button", { name: /calibrate/i }));

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: /turn off the camera/i })).toBeTruthy();
  });
});

describe("calibration, driven to a conclusion", () => {
  async function turnOn(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /try hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /turn on the camera/i }));
    await waitFor(() => screen.getByRole("button", { name: /turn off the camera/i }));
    await user.click(screen.getByRole("button", { name: /calibrate/i }));
  }

  it("measures a pose and then lets the researcher move on", async () => {
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    feed(2.0, 14);   // open hand, held

    const next = screen.getByRole("button", { name: /^next$/i });
    await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false));
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow")))
      .toBe(100);
  });

  it("finishes, and the thresholds it derived are the ones that persist", async () => {
    /**
     * The whole point of a calibration screen: something has to change because
     * of it. `CalibrationManager` existed for two commits computing thresholds
     * that nothing consumed, which is the failure this test exists to prevent
     * from recurring quietly.
     */
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    feed(2.0, 14);                                           // open
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    feed(0.2, 14);                                           // pinched
    await user.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());

    const stored = JSON.parse(
      window.localStorage.getItem("throughline-spatial") ?? "{}");
    // Between the two measured poses, and hysteresis preserved.
    expect(stored.settings.pinchRatioOn).toBeGreaterThan(0.2);
    expect(stored.settings.pinchRatioOn).toBeLessThan(2.0);
    expect(stored.settings.pinchRatioOff)
      .toBeGreaterThan(stored.settings.pinchRatioOn);
  });

  it("refuses two poses that did not separate, and says what to do", async () => {
    /**
     * The refusal is the useful outcome, not an error path to smooth over.
     * Thresholds derived from two attempts at the same pose would sit inside
     * the noise, and the researcher would leave the screen believing they were
     * set up — then blame the tracking for the rest of the session.
     */
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    feed(0.30, 14);
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    feed(0.29, 14);
    await user.click(screen.getByRole("button", { name: /finish/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/open your hand wide/i);
    // Nothing was persisted from a calibration that was refused.
    const stored = JSON.parse(
      window.localStorage.getItem("throughline-spatial") ?? "{}");
    expect(stored.settings?.pinchRatioOn)
      .toBe(DEFAULT_PREFERENCES.settings.pinchRatioOn);
  });

  it("starts over rather than stranding the researcher after a refusal", async () => {
    const user = userEvent.setup();
    mount();
    await turnOn(user);
    feed(0.30, 14);
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    feed(0.29, 14);
    await user.click(screen.getByRole("button", { name: /finish/i }));
    await screen.findByRole("alert");

    // Back at the first pose, with a fresh measurement, and it works.
    expect(screen.getByRole("status").textContent).toMatch(/hold your hand open/i);
    feed(2.0, 14);
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    feed(0.2, 14);
    await user.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
  });
});

describe("settings that take effect", () => {
  async function turnOn(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /try hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /turn on the camera/i }));
    await waitFor(() => screen.getByRole("button", { name: /turn off the camera/i }));
  }

  it("remembers a sensitivity the researcher chose", async () => {
    const user = userEvent.setup();
    mount();
    await turnOn(user);
    await user.click(screen.getByText(/sensitivity/i));

    const rotation = screen.getByLabelText(/rotation/i);
    fireEvent.change(rotation, { target: { value: "1.2" } });

    const stored = JSON.parse(
      window.localStorage.getItem("throughline-spatial") ?? "{}");
    expect(stored.settings.rotationSensitivity).toBeCloseTo(1.2, 6);
  });

  it("offers a range whose useful part is not a sliver", async () => {
    /**
     * The slider range is deliberately narrower than the range storage accepts.
     * `LIMITS` answers "what is not insane" and is wide so a hand-edited or
     * future value survives; a slider spanning all of it would put every usable
     * setting in the first fifth of the track, and the control would feel broken
     * while working perfectly.
     */
    const user = userEvent.setup();
    mount();
    await turnOn(user);
    await user.click(screen.getByText(/sensitivity/i));

    const rotation = screen.getByLabelText(/rotation/i) as HTMLInputElement;
    const min = Number(rotation.min);
    const max = Number(rotation.max);
    const chosen = DEFAULT_PREFERENCES.settings.rotationSensitivity;

    // The default sits inside the offered band rather than at an edge.
    expect(chosen).toBeGreaterThan(min);
    expect(chosen).toBeLessThan(max);
  });

  it("puts the view back without needing a hand", async () => {
    /**
     * §31's recovery. A researcher whose tracking has gone wrong is exactly the
     * one who cannot gesture their way home, so the way home cannot be a
     * gesture.
     */
    const user = userEvent.setup();
    const controllerRef = mount();
    const resetView = vi.fn();
    controllerRef.current = {
      rotate: vi.fn(), zoom: vi.fn(), pan: vi.fn(),
      hover: vi.fn(), select: vi.fn(), selectRegion: vi.fn(() => []),
      withinPolygon: vi.fn(() => []),
      focus: vi.fn(), deselect: vi.fn(),
      resetView,
      viewport: () => ({ width: 400, height: 400 }),
    };
    await turnOn(user);

    await user.click(screen.getByRole("button", { name: /reset the view/i }));

    expect(resetView).toHaveBeenCalled();
  });

  it("gets the camera out of the way once calibration has answered its question",
     async () => {
    /**
     * §19. The preview existed to answer "does the tracker see my hand". That
     * question has just been answered, and the research visualization is what
     * the researcher came for — so it stands down on its own rather than
     * waiting to be dismissed.
     */
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    const preview = screen.getByLabelText(/camera preview with detected hand/i);
    expect(preview).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /calibrate/i }));
    feed(2.0, 14);
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    feed(0.2, 14);
    await user.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => expect(
      screen.queryByLabelText(/camera preview with detected hand/i)).toBeNull());
    // ...and the researcher can bring it back.
    expect(screen.getByLabelText(/camera preview$/i)).toBeTruthy();
  });
});

describe("sensitivity, measured at the chart", () => {
  /**
   * The assertion that makes the slider more than a stored number.
   *
   * Persistence is easy to test and proves nothing a researcher cares about:
   * what matters is that moving the control changes how far the scene turns for
   * the same hand movement. So this drives an identical pinch-and-drag through
   * the whole chain at two settings and compares what the chart was actually
   * told.
   */
  function rotationFor(sensitivity: number) {
    return async () => {
      const user = userEvent.setup();
      const controllerRef = mount();
      let turned = 0;
      controllerRef.current = {
        rotate: (dx: number) => { turned += Math.abs(dx); },
        zoom: vi.fn(), pan: vi.fn(), hover: vi.fn(), select: vi.fn(),
        selectRegion: vi.fn(() => []), withinPolygon: vi.fn(() => []),
        focus: vi.fn(), deselect: vi.fn(), resetView: vi.fn(),
        viewport: () => ({ width: 400, height: 400 }),
      };

      await user.click(screen.getByRole("button", { name: /try hand gestures/i }));
      await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));
      await user.click(screen.getByRole("button", { name: /turn on the camera/i }));
      await waitFor(() =>
        screen.getByRole("button", { name: /turn off the camera/i }));

      await user.click(screen.getByText(/sensitivity/i));
      fireEvent.change(screen.getByLabelText(/rotation/i),
                       { target: { value: String(sensitivity) } });

      // Pinch, then travel the same distance across the frame.
      feed(0.2, 1);      // open
      feed(0.15, 2);     // closed — the clutch engages
      for (let i = 0; i < 8; i += 1) drift(0.15, 0.01 * (i + 1));

      return turned;
    };
  }

  /** One frame of a held pinch, displaced horizontally. */
  function drift(pinchRatio: number, dx: number, span = 0.12) {
    const pinch = span * pinchRatio;
    clock += 40;
    act(() => {
      deliverFrame?.({
        timestamp: clock,
        hands: [{
          handedness: "right", confidence: 0.95,
          wrist: { x: 0.5 + dx, y: 0.5 + span * 2 },
          indexBase: { x: 0.5 + dx, y: 0.5 + span },
          thumbTip: { x: 0.5 + dx - pinch / 2, y: 0.5 },
          indexTip: { x: 0.5 + dx + pinch / 2, y: 0.5 },
          middleTip: { x: 0.5 + dx, y: 0.5 + span * 1.7 },
          ringTip: { x: 0.5 + dx, y: 0.5 + span * 1.8 },
          pinkyTip: { x: 0.5 + dx, y: 0.5 + span * 1.9 },
          palmCenter: { x: 0.5 + dx, y: 0.5 },
        }],
      });
    });
  }

  it("turns the scene further at a higher setting, for the same hand movement",
     async () => {
    const gentle = await rotationFor(0.8)();
    cleanup();
    window.localStorage.clear();
    const brisk = await rotationFor(3.5)();

    expect(gentle).toBeGreaterThan(0);
    expect(brisk).toBeGreaterThan(gentle * 2);
  });
});

describe("the video the tracker reads", () => {
  /**
   * This has been wrong twice, in two different ways, with identical symptoms:
   * camera light on, no hand ever detected, and no error anywhere. First as
   * `display: none`, which a browser need not decode. Then at `left: -9999`,
   * which is laid out but entirely off-screen — and a browser may stop
   * compositing a video nobody can see, leaving MediaPipe to sample a stale
   * texture every frame.
   *
   * happy-dom lays nothing out, so it cannot catch either by rendering. What it
   * can do is hold the element to the rules that keep it a live texture source.
   */
  async function turnOn(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /try hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /turn on the camera/i }));
    await waitFor(() => screen.getByRole("button", { name: /turn off the camera/i }));
  }

  it("is never display:none, and never parked off-screen", async () => {
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.style.display).not.toBe("none");

    for (const edge of [video.style.left, video.style.top]) {
      // A negative offset is how an element is hidden by being moved away, and
      // it is the thing that broke this.
      expect(edge.startsWith("-")).toBe(false);
    }
  });

  it("stays out of the researcher's way without being removed from the page",
     async () => {
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    const video = document.querySelector("video") as HTMLVideoElement;

    expect(video.style.pointerEvents).toBe("none");
    expect(Number(video.style.opacity)).toBeLessThan(0.1);
    expect(video.getAttribute("aria-hidden")).toBe("true");
  });

  it("is muted and inline, because a camera stream has no audio to play", async () => {
    const user = userEvent.setup();
    mount();
    await turnOn(user);

    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video.hasAttribute("muted") || video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
  });
});

describe("frames reach a subsystem that asks for them", () => {
  /**
   * Air Ink needs the hand, not the gestures, and it needs it at tracker rate.
   *
   * The alternative — a second tracker on the same camera — would mean two
   * inferences per frame and, worse, two slightly different readings of one
   * hand: the pen would land a few pixels from where the pointer said it was, on
   * the same screen, with nothing to explain the gap.
   */
  async function turnOn(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /try hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));
    await user.click(screen.getByRole("button", { name: /turn on the camera/i }));
    await waitFor(() => screen.getByRole("button", { name: /turn off the camera/i }));
  }

  it("hands every processed frame to onFrame", async () => {
    const user = userEvent.setup();
    const seen: Array<{ timestamp: number }> = [];
    const controllerRef = createRef<VisualizationController | null>();
    render(<SpatialControl controllerRef={controllerRef} label="this scatter"
                           onFrame={(frame) => seen.push(frame)} />);

    await turnOn(user);
    feed(0.2, 5);

    expect(seen.length).toBe(5);
    expect(seen[0].timestamp).toBeLessThan(seen[4].timestamp);
  });

  it("delivers frames at the tracker's rate, not a throttled one", async () => {
    /**
     * The measurement readout is deliberately throttled to a few times a second
     * because it is read by eye. Ink is not read by eye — it is drawn — and
     * feeding it at that rate would produce a line made of six points a second,
     * which no amount of smoothing recovers.
     */
    const user = userEvent.setup();
    let frames = 0;
    let measurements = 0;
    const controllerRef = createRef<VisualizationController | null>();
    render(<SpatialControl controllerRef={controllerRef} label="this scatter"
                           onFrame={() => { frames += 1; }}
                           onMeasurement={() => { measurements += 1; }} />);

    await turnOn(user);
    feed(0.2, 12);

    expect(frames).toBe(12);
    expect(measurements).toBeLessThan(frames);
  });

  it("calls the latest onFrame, not the one the camera started with", async () => {
    /**
     * The session captures its observer once, when the camera starts. Reading
     * the prop directly there would freeze whichever closure existed at that
     * moment — so a host that re-rendered would keep feeding frames into a stale
     * one, and the ink would go on recording into a recorder nothing was
     * reading. Silent, and permanent until the camera is restarted.
     */
    const user = userEvent.setup();
    const first: number[] = [];
    const second: number[] = [];
    const controllerRef = createRef<VisualizationController | null>();
    const { rerender } = render(
      <SpatialControl controllerRef={controllerRef} label="this scatter"
                      onFrame={() => first.push(1)} />);

    await turnOn(user);
    feed(0.2, 2);

    rerender(<SpatialControl controllerRef={controllerRef} label="this scatter"
                             onFrame={() => second.push(1)} />);
    feed(0.2, 3);

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(3);
  });

  it("asks for no camera when nothing wants frames", () => {
    // Passing the callback must not itself turn anything on.
    const controllerRef = createRef<VisualizationController | null>();
    render(<SpatialControl controllerRef={controllerRef} label="this scatter"
                           onFrame={() => {}} />);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
