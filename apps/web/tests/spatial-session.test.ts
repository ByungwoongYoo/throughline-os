/**
 * The camera, and the promises made about it.
 *
 * The architecture in §12 is the easy half — frames never leave the browser
 * because nothing in this path has a network call to send them with. The hard
 * half is the two mundane failures that destroy trust faster than any policy
 * document repairs it: a camera that stays on after the researcher switched the
 * feature off, and a scene that moves after the light goes out.
 *
 * Both are tested here against a mocked `getUserMedia` and a scripted tracker,
 * so the whole chain — permission, tracking, intent, chart — runs with no
 * hardware. What cannot be tested here is whether a real hand in real lighting
 * produces good landmarks, which is why no tracker implementation is claimed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraManager } from "@/lib/spatial/camera";
import { SpatialSession } from "@/lib/spatial/session";
import { ScriptedHandTracker } from "@/lib/spatial/tracker";
import { VisualizationController } from "@/lib/spatial/commands";
import { Hand, HandFrame } from "@/lib/spatial/types";

/** Tracks whether anything actually released the hardware. */
function fakeStream() {
  const tracks = [
    { stop: vi.fn(), kind: "video" },
    { stop: vi.fn(), kind: "video" },   // two, because a stream may carry more
  ];
  return {
    stream: { getTracks: () => tracks } as unknown as MediaStream,
    tracks,
  };
}

function grantCamera(stream: MediaStream) {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => [
        { kind: "videoinput", deviceId: "cam-1", label: "FaceTime HD" },
        { kind: "audioinput", deviceId: "mic-1", label: "Microphone" },
      ]),
    },
  });
}

function refuseCamera(name: string) {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => { throw Object.assign(new Error("no"), { name }); }),
      enumerateDevices: vi.fn(async () => []),
    },
  });
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("releasing the camera", () => {
  it("stops every track, not just the first", () => {
    /**
     * A survivor keeps the indicator light on. Nothing said afterwards repairs
     * a researcher watching that light stay lit after they switched the feature
     * off.
     */
    const { stream, tracks } = fakeStream();
    grantCamera(stream);
    const camera = new CameraManager();

    return camera.start().then(() => {
      camera.stop();
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(tracks[1].stop).toHaveBeenCalled();
      expect(camera.active()).toBe(false);
    });
  });

  it("survives a track that refuses to stop", () => {
    /**
     * Some engines throw on a track the browser already ended. The point of the
     * method is that the camera ends up off, so one uncooperative track must
     * not prevent the rest from stopping.
     */
    const tracks = [
      { stop: vi.fn(() => { throw new Error("already ended"); }), kind: "video" },
      { stop: vi.fn(), kind: "video" },
    ];
    grantCamera({ getTracks: () => tracks } as unknown as MediaStream);
    const camera = new CameraManager();

    return camera.start().then(() => {
      expect(() => camera.stop()).not.toThrow();
      expect(tracks[1].stop).toHaveBeenCalled();
    });
  });

  it("is safe to stop when nothing is running", () => {
    /** Teardown runs from unmount, from failure, and from the user's control. */
    expect(() => new CameraManager().stop()).not.toThrow();
  });

  it("does not open a second stream when started twice", async () => {
    /** The second would leak the first, and the first holds the light. */
    const { stream } = fakeStream();
    grantCamera(stream);
    const camera = new CameraManager();

    await camera.start();
    await camera.start();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("never asks for audio", async () => {
    /** A research tool requesting a microphone to read a hand is indefensible. */
    const { stream } = fakeStream();
    grantCamera(stream);

    await new CameraManager().start();

    const request = (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(request.audio).toBe(false);
  });
});

describe("a refusal is an answer", () => {
  it("explains a denied permission instead of failing", async () => {
    const camera = new CameraManager();
    refuseCamera("NotAllowedError");

    const result = await camera.start();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("denied");
    // Says what still works, because the feature is optional and the
    // visualization is not.
    expect(result.failure.message).toMatch(/works without it|everything else/i);
  });

  it("tells a laptop with no camera something it can act on", async () => {
    refuseCamera("NotFoundError");
    const result = await new CameraManager().start();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("no-device");
  });

  it("distinguishes a camera another application is holding", async () => {
    /** "Close the other program" is actionable; "unknown error" is not. */
    refuseCamera("NotReadableError");
    const result = await new CameraManager().start();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("in-use");
  });

  it("reports a browser that cannot do this at all", async () => {
    vi.stubGlobal("navigator", {});
    const result = await new CameraManager().start();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("unsupported");
  });

  it("lists only cameras", async () => {
    const { stream } = fakeStream();
    grantCamera(stream);

    const devices = await new CameraManager().devices();

    expect(devices).toHaveLength(1);
    expect(devices[0].label).toBe("FaceTime HD");
  });
});

// ---------------------------------------------------------------------------
// The whole chain, with no hardware
// ---------------------------------------------------------------------------

function hand(at: { x: number; y: number }, pinch: number): Hand {
  return {
    handedness: "right", confidence: 0.95,
    wrist: { x: at.x, y: at.y + 0.15 },
    thumbTip: { x: at.x - pinch / 2, y: at.y },
    indexTip: { x: at.x + pinch / 2, y: at.y },
    middleTip: { x: at.x, y: at.y + 0.12 },
    ringTip: { x: at.x, y: at.y + 0.13 },
    pinkyTip: { x: at.x, y: at.y + 0.14 },
    // 0.10 from the wrist: a reference-size hand, so the absolute defaults and
    // the span-scaled thresholds agree and this test is about the session rather
    // than about threshold scaling.
    indexBase: { x: at.x, y: at.y + 0.05 },
    palmCenter: { x: at.x, y: at.y },
  };
}

/** Open, then pinch and drag: the canonical grab-and-rotate. */
const SCRIPT: HandFrame[] = [
  { timestamp: 0, hands: [hand({ x: 0.5, y: 0.5 }, 0.2)] },
  { timestamp: 33, hands: [hand({ x: 0.5, y: 0.5 }, 0.02)] },
  { timestamp: 66, hands: [hand({ x: 0.56, y: 0.5 }, 0.02)] },
  { timestamp: 99, hands: [hand({ x: 0.62, y: 0.5 }, 0.02)] },
];

function fakeController() {
  const calls: string[] = [];
  const controller: VisualizationController = {
    rotate: () => { calls.push("rotate"); },
    zoom: () => { calls.push("zoom"); },
    pan: () => { calls.push("pan"); },
    hover: () => { calls.push("hover"); return null; },
    select: () => { calls.push("select"); return null; },
    focus: () => { calls.push("focus"); },
    deselect: () => { calls.push("deselect"); },
    resetView: () => { calls.push("resetView"); },
    viewport: () => ({ width: 400, height: 400 }),
  };
  return { controller, calls };
}

describe("camera to chart, end to end", () => {
  beforeEach(() => {
    const { stream } = fakeStream();
    grantCamera(stream);
  });

  it("turns a scripted pinch-and-drag into rotation of the chart", async () => {
    /**
     * The whole point of the seam: this is the same path a real hand takes, and
     * it is asserted rather than demonstrated.
     */
    const tracker = new ScriptedHandTracker(SCRIPT);
    const { controller, calls } = fakeController();
    const session = new SpatialSession(tracker, () => controller);

    const failure = await session.start({} as HTMLVideoElement);
    expect(failure).toBeNull();

    // Drive the tracker by hand rather than by timer, so the test owns the clock.
    while (tracker.step((frame) => session["onFrame"](frame))) { /* replay */ }

    expect(calls).toContain("rotate");
  });

  it("counts gestures without recording anything about the person", async () => {
    /**
     * §36 — measure usefulness, never imagery. A tally answers "are gestures
     * being completed or abandoned"; a timestamped log of confidences would be
     * a behavioural trace of somebody at their desk, which this feature cannot
     * ask to be trusted with while quietly building.
     */
    const tracker = new ScriptedHandTracker(SCRIPT);
    const { controller } = fakeController();
    const session = new SpatialSession(tracker, () => controller);
    await session.start({} as HTMLVideoElement);

    while (tracker.step((frame) => session["onFrame"](frame))) { /* replay */ }

    const counts = session.counts();
    expect(counts.gesture_grab_started).toBe(1);
    expect(counts.frames).toBe(SCRIPT.length);
    // Nothing in the tally identifies anyone or anything they did.
    for (const value of Object.values(counts)) expect(typeof value).toBe("number");
  });

  it("acts on no frame that arrives after it is stopped", async () => {
    /**
     * Tracker callbacks are asynchronous, so one can be in flight when the
     * researcher switches off. A scene that moves after the camera light goes
     * out is the most alarming thing this feature could do.
     */
    const tracker = new ScriptedHandTracker(SCRIPT);
    const { controller, calls } = fakeController();
    const session = new SpatialSession(tracker, () => controller);
    await session.start({} as HTMLVideoElement);

    session.stop();
    calls.length = 0;
    for (const frame of SCRIPT) session["onFrame"](frame);

    expect(calls).toEqual([]);
  });

  it("releases the camera when it stops", async () => {
    const { stream, tracks } = fakeStream();
    grantCamera(stream);
    const session = new SpatialSession(new ScriptedHandTracker(SCRIPT),
                                       () => fakeController().controller);
    await session.start({} as HTMLVideoElement);

    session.stop();

    expect(tracks[0].stop).toHaveBeenCalled();
    expect(session.isRunning()).toBe(false);
  });

  it("releases the camera when the tracker fails to load", async () => {
    /**
     * The camera is already open by then. A failed start that leaves the light
     * on is indistinguishable from the feature running.
     */
    const { stream, tracks } = fakeStream();
    grantCamera(stream);
    const broken = new ScriptedHandTracker(SCRIPT);
    broken.load = async () => { throw new Error("model unavailable"); };
    const session = new SpatialSession(broken, () => fakeController().controller);

    const failure = await session.start({} as HTMLVideoElement);

    expect(failure).not.toBeNull();
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it("does not start the tracker at all when permission is refused", async () => {
    refuseCamera("NotAllowedError");
    const tracker = new ScriptedHandTracker(SCRIPT);
    const started = vi.spyOn(tracker, "start");
    const session = new SpatialSession(tracker, () => fakeController().controller);

    const failure = await session.start({} as HTMLVideoElement);

    expect(failure?.reason).toBe("denied");
    expect(started).not.toHaveBeenCalled();
    expect(session.isRunning()).toBe(false);
  });

  it("keeps the camera but stops acting when paused", async () => {
    /** §10 — the researcher's own pause, not a teardown. */
    const { stream, tracks } = fakeStream();
    grantCamera(stream);
    const tracker = new ScriptedHandTracker(SCRIPT);
    const { controller, calls } = fakeController();
    const session = new SpatialSession(tracker, () => controller);
    await session.start({} as HTMLVideoElement);

    session.pause();
    calls.length = 0;
    for (const frame of SCRIPT) session["onFrame"](frame);

    expect(calls).toEqual([]);
    expect(tracks[0].stop).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The cost of being switched on
// ---------------------------------------------------------------------------

/**
 * §13's requirement, restated as a cost: the vision work must never degrade the
 * rendering it exists to serve. The intent layer itself is not the risk — it
 * measures around 1–2µs per frame, flat across 50,000 frames, which is 0.005%
 * of a 33ms budget. The risk is everything wired *around* it at frame rate, and
 * that is what these assert.
 */
describe("what it costs to leave running", () => {
  beforeEach(() => {
    const { stream } = fakeStream();
    grantCamera(stream);
  });

  /** Frames at an arbitrary rate, holding one steady pose. */
  function steady(count: number, intervalMs: number): HandFrame[] {
    return Array.from({ length: count }, (_, i) => ({
      timestamp: i * intervalMs,
      hands: [hand({ x: 0.5 + i * 0.0002, y: 0.5 }, 0.02)],
    }));
  }

  it("tells the observer about a state only when it changes", async () => {
    /**
     * The cost that would be paid continuously for the whole time the feature is
     * on. An observer is a React setter in practice, and a hand held in a grab
     * reports GRABBED thirty times a second — publishing each one asks the
     * workspace to re-render at tracker rate to say nothing new.
     */
    const states: string[] = [];
    const tracker = new ScriptedHandTracker([]);
    const session = new SpatialSession(tracker, () => fakeController().controller,
                                       { onState: (s) => { states.push(s); } });
    await session.start({} as HTMLVideoElement);

    for (const frame of steady(60, 34)) session["onFrame"](frame);

    // READY, then GRABBED — and then silence for the remaining ~58 frames.
    expect(states).toEqual(["GRABBED"]);
  });

  it("does not process frames faster than the rate it was tuned for", async () => {
    /**
     * A tracker delivering at camera rate — 60 Hz is common — would drive the
     * machine and the chart at twice the rate the smoothing was tuned for, for
     * no extra fidelity. One Euro's cutoffs are in units of time, so this is not
     * only wasted work: it changes how much the filter smooths.
     */
    const session = new SpatialSession(new ScriptedHandTracker([]),
                                       () => fakeController().controller);
    await session.start({} as HTMLVideoElement);

    for (const frame of steady(60, 16.7)) session["onFrame"](frame);   // 60 Hz

    // Roughly half of them, not all sixty.
    expect(session.counts().frames).toBeLessThanOrEqual(31);
    expect(session.counts().frames).toBeGreaterThan(25);
  });

  it("does not throttle a tracker that is already at the target rate", async () => {
    /**
     * The trap the governor's threshold exists to avoid. A tracker nominally at
     * 30 Hz delivers frames ~33.3ms apart with jitter both ways; a floor set at
     * exactly 1000/30 would reject every frame arriving a millisecond early and
     * silently halve the rate of the stream it was sized for — presenting as the
     * gesture feeling coarse on some machines and fine on others.
     */
    const session = new SpatialSession(new ScriptedHandTracker([]),
                                       () => fakeController().controller);
    await session.start({} as HTMLVideoElement);

    const jittery = steady(40, 33.3).map((frame, i) => ({
      ...frame, timestamp: frame.timestamp + (i % 2 ? -0.8 : 0.8),
    }));
    for (const frame of jittery) session["onFrame"](frame);

    expect(session.counts().frames).toBe(40);
  });

  it("loses no movement to a dropped frame", async () => {
    /**
     * The property that makes the governor legitimate rather than a source of
     * missing motion, and the reason it is safe to drop rather than queue: every
     * command is a *delta* from the last processed position, so a skipped frame
     * does not lose movement, it makes the next delta larger.
     *
     * Asserted by comparing total rotation at 60 Hz (half the frames dropped)
     * against the same movement delivered at 30 Hz.
     */
    function totalRotation(intervalMs: number, count: number): number {
      let total = 0;
      const controller = { ...fakeController().controller,
        rotate: (dx: number) => { total += dx; } };
      const session = new SpatialSession(new ScriptedHandTracker([]),
                                         () => controller);
      session["running"] = true;
      // Same journey across the frame, sampled at two different rates.
      for (let i = 0; i < count; i += 1) {
        session["onFrame"]({ timestamp: i * intervalMs,
          hands: [hand({ x: 0.4 + (i / (count - 1)) * 0.2, y: 0.5 }, 0.02)] });
      }
      return total;
    }

    const fast = totalRotation(16.7, 61);   // 60 Hz, ~half dropped
    const slow = totalRotation(33.4, 31);   // 30 Hz, none dropped

    // Not identical — the smoothing filter sees different sample spacing — but
    // the same journey, not half of one.
    expect(fast).toBeGreaterThan(slow * 0.75);
    expect(fast).toBeLessThan(slow * 1.25);
  });

  it("does no work at all while the tab is in the background", async () => {
    /**
     * `rAF` stops on its own when the tab is hidden; a tracker driven by a timer
     * does not. Frames processed there produce commands that repaint nothing —
     * work whose only observable effect is battery.
     */
    const { controller, calls } = fakeController();
    const session = new SpatialSession(new ScriptedHandTracker([]), () => controller);
    await session.start({} as HTMLVideoElement);

    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    for (const frame of steady(30, 34)) session["onFrame"](frame);
    expect(calls).toEqual([]);
    expect(session.counts().frames).toBe(0);

    // ...and picks up again on return, rather than needing to be restarted.
    hidden.mockReturnValue(false);
    for (const frame of steady(30, 34)) session["onFrame"](frame);
    expect(session.counts().frames).toBeGreaterThan(0);
  });

  it("keeps the camera when the tab is hidden", async () => {
    /**
     * Deliberately not a teardown. Someone who switched to another window for
     * ten seconds did not ask to be logged out of the feature, and re-requesting
     * the stream on return is the worse surprise — some browsers re-prompt.
     */
    const { stream, tracks } = fakeStream();
    grantCamera(stream);
    const session = new SpatialSession(new ScriptedHandTracker([]),
                                       () => fakeController().controller);
    await session.start({} as HTMLVideoElement);

    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    session["onFrame"](steady(1, 34)[0]);

    expect(tracks[0].stop).not.toHaveBeenCalled();
    expect(session.isRunning()).toBe(true);
  });

  it("works again after a restart, whatever clock the new tracker uses", async () => {
    /**
     * The governor compares timestamps, and timestamps belong to the tracker —
     * a fresh one may start near zero, from a frame counter or a new video
     * element's time base. If the session remembered the previous run's clock,
     * every frame of the new one would look like it arrived *before* the last
     * frame it saw, and the governor would reject all of them until the new
     * clock climbed past the old one's final value. A session stopped after ten
     * minutes would appear to start and then do nothing for ten minutes, with
     * the camera light on throughout, and no error anywhere.
     */
    const session = new SpatialSession(new ScriptedHandTracker([]),
                                       () => fakeController().controller);
    await session.start({} as HTMLVideoElement);
    // A long first run, ending far from zero.
    for (const frame of steady(50, 34)) session["onFrame"](frame);
    const first = session.counts().frames;
    session.stop();

    await session.start({} as HTMLVideoElement);
    for (const frame of steady(10, 34)) session["onFrame"](frame);   // clock at 0 again

    expect(session.counts().frames).toBe(first + 10);
  });

  it("processes a long session in a fraction of one frame's budget", async () => {
    /**
     * A regression bound rather than a benchmark. The measured cost is ~1–2µs
     * per frame and does not grow with the number of frames seen; the bound is
     * set two orders of magnitude above that, so it cannot flake on a loaded
     * machine but would fail immediately if anything quadratic — a history
     * array, an unbounded accumulator — were added to the per-frame path.
     */
    const session = new SpatialSession(new ScriptedHandTracker([]),
                                       () => fakeController().controller);
    await session.start({} as HTMLVideoElement);
    const frames = steady(20_000, 34);

    const started = performance.now();
    for (const frame of frames) session["onFrame"](frame);
    const elapsed = performance.now() - started;

    expect(session.counts().frames).toBe(20_000);
    // 20,000 frames is 11 minutes of continuous gesturing at 30 Hz.
    expect(elapsed).toBeLessThan(2000);
  });
});
