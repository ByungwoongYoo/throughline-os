/**
 * Making a gesture feel like it landed, without claiming hardware that is absent.
 *
 * The temptation here is a `vibrate()` call and a feature called "haptics". On a
 * laptop that is a no-op wearing a label: `navigator.vibrate` is Android-only,
 * Safari does not implement it, and Force Touch is reachable from native code
 * and not from a page. So most of these tests are about what the layer refuses
 * to promise.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FEEDBACK, Feedback, askNativeCapability, availableChannels, momentFor,
} from "@/lib/spatial/feedback";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("what this machine can do", () => {
  it("reports vibration only where the browser has it", () => {
    vi.stubGlobal("navigator", {});
    expect(availableChannels().vibration).toBe(false);

    vi.stubGlobal("navigator", { vibrate: () => true });
    expect(availableChannels().vibration).toBe(true);
  });

  it("promises no native actuator before the machine has answered", () => {
    /** A capability claimed before it is known is a claim, not a capability. */
    expect(availableChannels().native.available).toBe(false);
  });

  it("treats an API that cannot answer as a machine with no haptics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    expect(await askNativeCapability()).toEqual(
      { available: false, feltWhere: null });
  });

  it("carries where a tap can be felt, not only that one exists", async () => {
    /**
     * The field that stops the interface making a promise the hardware breaks.
     * The actuator is in the trackpad, so a hand held in the air feels nothing —
     * and a researcher who expected to feel a mid-air pinch would reasonably
     * conclude the feature was broken.
     */
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ available: true, felt_where: "the trackpad — …" }),
    })));

    const native = await askNativeCapability();

    expect(native.available).toBe(true);
    expect(native.feltWhere).toContain("trackpad");
  });
});

describe("marking a moment", () => {
  it("never throws when there is nothing to mark it with", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", {});

    expect(() => new Feedback().emit("grabStart")).not.toThrow();
  });

  it("survives a browser that throws from vibrate", () => {
    /** Some engines throw when the page has never been interacted with. */
    vi.stubGlobal("navigator", {
      vibrate: () => { throw new Error("not allowed"); },
    });

    expect(() => new Feedback().emit("select")).not.toThrow();
  });

  it("says nothing when touch feedback is switched off", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });

    new Feedback({ vibrate: false }).emit("grabStart");

    expect(vibrate).not.toHaveBeenCalled();
  });

  it("keeps every pattern short", () => {
    /**
     * A research tool is used for hours. Anything long enough to be described as
     * a buzz is intolerable by the fourth time, and the point is to mark a
     * boundary rather than announce one.
     */
    const durations: number[] = [];
    vi.stubGlobal("navigator", {
      vibrate: (pattern: number[]) => { durations.push(...pattern); },
    });

    const feedback = new Feedback();
    for (const moment of
         ["grabStart", "grabEnd", "select", "zoomStart", "trackingLost"] as const) {
      feedback.emit(moment);
    }

    expect(Math.max(...durations)).toBeLessThanOrEqual(30);
  });

  it("asks the machine for a real tap only once it knows there is one", () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    const feedback = new Feedback();
    feedback.emit("grabStart");
    expect(fetchMock).not.toHaveBeenCalled();

    feedback.useNative(true);
    feedback.emit("grabStart");
    expect(fetchMock).toHaveBeenCalledWith("/api/haptics/tap",
                                           expect.objectContaining({ method: "POST" }));
  });

  it("sends the tap as JSON, which is what stops another page firing it", () => {
    /**
     * A request carrying `application/json` is not a "simple" request, so a
     * browser must preflight it and no cross-origin preflight is permitted.
     * Without that, any page in any tab could POST to this port and buzz
     * somebody's trackpad.
     */
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    const feedback = new Feedback();
    feedback.useNative(true);
    feedback.emit("select");

    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((request.headers as Record<string, string>)["Content-Type"])
      .toBe("application/json");
  });

  it("does not wait for the tap", async () => {
    /**
     * Awaiting a round trip — even a local one — on the frame a gesture engages
     * would put the confirmation behind the thing it confirms, and a tap that
     * arrives late feels like a tap for something else.
     */
    let settle: (() => void) | null = null;
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => {
      settle = () => resolve({ ok: true, json: async () => ({}) });
    })));

    const feedback = new Feedback();
    feedback.useNative(true);

    // Returns while the request is still outstanding.
    expect(() => feedback.emit("grabStart")).not.toThrow();
    expect(settle).not.toBeNull();
  });
});

describe("which moments are marked at all", () => {
  it("marks the boundaries and ignores the rest", () => {
    /**
     * Marking every event would make the feedback continuous, and continuous
     * feedback is indistinguishable from none.
     */
    expect(momentFor("gesture_grab_started")).toBe("grabStart");
    expect(momentFor("gesture_selection_completed")).toBe("select");
    expect(momentFor("tracking_lost")).toBe("trackingLost");

    expect(momentFor("tracking_recovered")).toBeNull();
    expect(momentFor("gesture_cancelled")).toBeNull();
    expect(momentFor("something_new")).toBeNull();
  });
});

describe("defaults", () => {
  it("leaves sound off", () => {
    /**
     * A research tool that clicks in a shared office is one somebody mutes on
     * the first afternoon — and then they have no feedback at all.
     */
    expect(DEFAULT_FEEDBACK.sound).toBe(false);
    expect(DEFAULT_FEEDBACK.vibrate).toBe(true);
  });
});
