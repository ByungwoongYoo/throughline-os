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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpatialControl } from "@/components/spatial/SpatialControl";
import { VisualizationController } from "@/lib/spatial/commands";

let getUserMedia: ReturnType<typeof vi.fn>;
let tracks: Array<{ stop: ReturnType<typeof vi.fn>; kind: string }>;

beforeEach(() => {
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
