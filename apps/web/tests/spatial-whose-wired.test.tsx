/**
 * Whose hand the gesture layer follows (§32), in the component that follows it.
 *
 * `lib/spatial/whose.ts` was written, documented and tested, and imported by
 * nothing but its own test file. `SpatialControl` went on taking
 * `frame.hands[0]` unconditionally, so the defect the module describes in its
 * own header — mid-drag, the tracked hand silently becomes a stranger's — was
 * live the whole time the fix sat in the repository.
 *
 * That is the shape of failure this file guards. `whose.test.ts` covers the
 * choosing and passed throughout; nothing covered the wiring, so the module
 * looked finished and did nothing. These assertions are all about the seam.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { SpatialControl } from "@/components/spatial/SpatialControl";
import { VisualizationController } from "@/lib/spatial/commands";

let deliverFrame: ((frame: unknown) => void) | null = null;

/* The tracker is stubbed exactly as `spatial-control.test.tsx` stubs it: the
   real one needs a WASM runtime, a GPU delegate and a person with a hand, and
   none of that is what this file is about. Capturing `onFrame` drives the whole
   chain — session, machine, this component — as landmarks from a camera would. */
vi.mock("@/lib/spatial/mediapipe", () => ({
  MediaPipeHandTracker: class {
    async load() {}
    start(_source: unknown, onFrame: (frame: unknown) => void) {
      deliverFrame = onFrame;
    }
    stop() { deliverFrame = null; }
    close() {}
    status() { return "running" as const; }
  },
}));

const span = 0.12;

/**
 * One hand, at a given place.
 *
 * `pinchRatio` is thumb-to-index as a fraction of the hand's own span, which is
 * the unit the thresholds are in — so open and pinched are one parameter apart.
 * A zoom needs *both* hands pinched: two visible hands are not an engagement,
 * which is the distinction §17 turns on and the first version of this file
 * missed, leaving the test unable to reach the state it claimed to test.
 */
function hand(x: number, y: number, handedness: "left" | "right",
              pinchRatio = 1) {
  const pinch = span * pinchRatio;
  return {
    handedness, confidence: 0.95,
    wrist: { x, y: y + span * 2 },
    indexBase: { x, y: y + span },
    thumbTip: { x: x - pinch / 2, y },
    indexTip: { x: x + pinch / 2, y },
    middleTip: { x, y: y + span * 1.7 },
    ringTip: { x, y: y + span * 1.8 },
    pinkyTip: { x, y: y + span * 1.9 },
    palmCenter: { x, y },
  };
}

let clock = 0;
function feedHands(hands: unknown[], count = 3) {
  for (let i = 0; i < count; i += 1) {
    // Forward only, across calls as well as within them: the session's rate
    // governor rejects a frame that arrives before the last one it processed.
    clock += 40;
    act(() => { deliverFrame?.({ timestamp: clock, hands }); });
  }
}

beforeEach(() => {
  clock = 0;
  window.localStorage.clear();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const stream = new MediaStream();
        const tracks = [{ stop: vi.fn(), kind: "video" }];
        stream.getTracks = () => tracks as unknown as MediaStreamTrack[];
        return stream;
      }),
      enumerateDevices: vi.fn(async () => [
        { kind: "videoinput", deviceId: "cam-1", label: "FaceTime HD" },
      ]),
    },
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  return render(
    <SpatialControl controllerRef={createRef<VisualizationController | null>()}
                    label="this scatter" />).container;
}

/*
 * The panel already carries a `role="status"` for the machine's own state, so
 * this asks for the one that says whose hand is being followed rather than for
 * "a status" — a query that matched either would pass while reporting the wrong
 * element, which is the failure this whole file exists to catch elsewhere.
 */
const whose = (container: HTMLElement) =>
  container.querySelector(".spatial-whose");

/** Past the opt-in, the explanation, and the permission prompt. */
async function turnOn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /try hand gestures/i }));
  await user.click(screen.getByRole("button", { name: /set up hand gestures/i }));
  await user.click(screen.getByRole("button", { name: /turn on the camera/i }));
  await waitFor(() => screen.getByRole("button", { name: /turn off the camera/i }));
}

describe("two hands in frame", () => {
  it("holds, and says why, rather than following whichever came first", async () => {
    /*
     * The whole point. `hands[0]` would silently take the first, and MediaPipe
     * promises no ordering between frames — so a colleague leaning over the
     * desk could take a drag mid-gesture and the object would follow them.
     */
    const user = userEvent.setup();
    const container = mount();
    await turnOn(user);

    feedHands([hand(0.3, 0.5, "right"), hand(0.7, 0.5, "left")]);

    await waitFor(() => expect(whose(container)).not.toBeNull());
    // The wording has to read as patience rather than as a fault: nothing is
    // broken, the frame simply cannot say which hand is the researcher's.
    expect(whose(container)?.textContent).toMatch(/hand/i);
  });

  it("says nothing at all while one hand is in frame", async () => {
    const user = userEvent.setup();
    const container = mount();
    await turnOn(user);

    feedHands([hand(0.5, 0.5, "right")]);
    expect(whose(container)).toBeNull();
  });

  it("keeps following the hand it was already following", async () => {
    /*
     * Continuity before handedness. The tracked hand barely moves and a second
     * appears far away: the first is still the researcher's, and the panel
     * should carry on without a word.
     */
    const user = userEvent.setup();
    const container = mount();
    await turnOn(user);

    feedHands([hand(0.3, 0.5, "right")]);
    feedHands([hand(0.31, 0.5, "right"), hand(0.85, 0.2, "left")]);

    expect(whose(container)).toBeNull();
  });

  it("stops holding once the second hand leaves", async () => {
    // A hold that outlived its cause would be a feature that looks broken.
    const user = userEvent.setup();
    const container = mount();
    await turnOn(user);

    feedHands([hand(0.3, 0.5, "right"), hand(0.7, 0.5, "left")]);
    await waitFor(() => expect(whose(container)).not.toBeNull());

    feedHands([hand(0.3, 0.5, "right")]);
    await waitFor(() => expect(whose(container)).toBeNull());
  });
});

/*
 * The two-handed case is tested in `whose.test.ts` against `followFrame`, not
 * here. It cannot be reached through this component: happy-dom gives a
 * `<video>` a `videoWidth` of 0, so the machine never leaves "tracking lost"
 * and never reports a zoom. A version of that test did live here, fed open
 * hands, never entered the two-handed path, and passed with the guard removed —
 * which is worse than no test, because it reported the guard as covered.
 */
