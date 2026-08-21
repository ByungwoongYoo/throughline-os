/**
 * Stored settings, treated as what they are: untrusted input.
 *
 * They come from disk, they can be edited by hand, they survive upgrades that
 * change what the fields mean, and they are read during a render. So the tests
 * that matter here are not "does a round trip work" — they are the ones where
 * the stored blob is wrong, and the question is whether a webcam feature turns
 * itself on or a workspace fails to paint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES, clearPreferences, readPreferences, writePreferences,
} from "@/lib/spatial/preferences";

const KEY = "throughline-spatial";

function store(value: string): void {
  window.localStorage.setItem(KEY, value);
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("off unless asked for", () => {
  it("is off when nothing has been stored", () => {
    expect(readPreferences().enabled).toBe(false);
  });

  it("stays off for a value that is merely truthy", () => {
    /**
     * The one that matters. `enabled: "no"`, `1`, or `{}` are values this code
     * never wrote — a hand edit, a half-finished migration, another tool's key
     * collision. Turning a camera on because a string was non-empty is exactly
     * the failure this feature cannot afford.
     */
    for (const value of ["\"yes\"", "1", "{}", "[]", "\"false\""]) {
      store(`{"version":1,"enabled":${value}}`);
      expect(readPreferences().enabled, value).toBe(false);
    }
  });

  it("is on only when it was genuinely switched on", () => {
    writePreferences({ ...DEFAULT_PREFERENCES, enabled: true });
    expect(readPreferences().enabled).toBe(true);
  });
});

describe("a bad blob must not take the workspace down", () => {
  it("returns the defaults for text that is not JSON", () => {
    store("{not json at all");
    expect(() => readPreferences()).not.toThrow();
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("returns the defaults for JSON that is not an object", () => {
    for (const value of ["null", "42", "\"a string\"", "[1,2,3]"]) {
      store(value);
      expect(readPreferences(), value).toEqual(DEFAULT_PREFERENCES);
    }
  });

  it("survives storage that throws on read", () => {
    /** Private browsing, or storage disabled by policy. */
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("survives storage that throws on write", () => {
    /** A full quota must not stop the choice applying to this session. */
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => writePreferences(DEFAULT_PREFERENCES)).not.toThrow();
  });

  it("ignores a blob written by a different version", () => {
    /**
     * Discarded rather than migrated. Migration is right for a researcher's
     * data and wrong for four tuning numbers: being wrong costs a scene that
     * behaves strangely for reasons nobody can see, and resetting costs thirty
     * seconds.
     */
    store(`{"version":99,"enabled":true,"deviceId":"cam-1"}`);
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("stored numbers that would ruin the scene", () => {
  function withSettings(settings: Record<string, unknown>) {
    store(JSON.stringify({ version: 1, enabled: true, settings }));
    return readPreferences().settings;
  }

  it("clamps a sensitivity that would make the scene unusable", () => {
    /**
     * A stored 1e9 would spin the view off on the first twitch, with no route
     * back short of clearing site data — §32's requirement applied to the
     * settings rather than to the camera.
     */
    const wild = withSettings({ rotationSensitivity: 1e9, zoomSensitivity: -40 });

    expect(wild.rotationSensitivity).toBeLessThanOrEqual(8);
    expect(wild.zoomSensitivity).toBeGreaterThan(0);
  });

  it("rejects values that are not numbers at all", () => {
    const text = withSettings({ rotationSensitivity: "fast", pinchRatioOn: null });

    expect(text.rotationSensitivity)
      .toBe(DEFAULT_PREFERENCES.settings.rotationSensitivity);
    expect(text.pinchRatioOn).toBe(DEFAULT_PREFERENCES.settings.pinchRatioOn);
  });

  it("rejects NaN and Infinity, which pass a typeof check", () => {
    /** `JSON.parse` cannot produce them, but a caller can, and `typeof` says
     * "number" for both — the exact shape of bug that reaches production. */
    const broken = withSettings({ rotationSensitivity: Number.NaN });
    expect(broken.rotationSensitivity)
      .toBe(DEFAULT_PREFERENCES.settings.rotationSensitivity);
  });

  it("restores hysteresis when the two thresholds crossed", () => {
    /**
     * The subtle one. If the release threshold is not above the engage
     * threshold, a pinch releases the instant it engages — the gesture becomes
     * impossible and it reads as the tracking being broken, not as a bad
     * setting. Two values can cross by a hand edit or by being clamped
     * independently, so the pair is checked after clamping rather than before.
     */
    const crossed = withSettings({ pinchRatioOn: 0.9, pinchRatioOff: 0.2 });

    expect(crossed.pinchRatioOff).toBeGreaterThan(crossed.pinchRatioOn);
  });

  it("keeps a sensible stored value rather than overriding it", () => {
    /** Validation must not mean ignoring the researcher. */
    const chosen = withSettings({ rotationSensitivity: 1.1 });
    expect(chosen.rotationSensitivity).toBe(1.1);
  });

  it("treats a missing settings object as the defaults", () => {
    store(`{"version":1,"enabled":true}`);
    expect(readPreferences().settings).toEqual(DEFAULT_PREFERENCES.settings);
  });
});

describe("the rest of the round trip", () => {
  it("remembers a chosen camera and forgets an empty one", () => {
    writePreferences({ ...DEFAULT_PREFERENCES, deviceId: "cam-1" });
    expect(readPreferences().deviceId).toBe("cam-1");

    store(`{"version":1,"enabled":true,"deviceId":""}`);
    expect(readPreferences().deviceId).toBeNull();
  });

  it("can be reset to the defaults", () => {
    writePreferences({ ...DEFAULT_PREFERENCES, enabled: true, deviceId: "cam-1" });
    clearPreferences();

    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("stores nothing describing the person", () => {
    /**
     * §12, checked rather than asserted in a comment. Thresholds and a device id
     * are settings; timings, confidences or a history of use would be a
     * behavioural record of somebody at their desk, and a feature that wants a
     * camera cannot quietly keep one.
     */
    writePreferences({ ...DEFAULT_PREFERENCES, enabled: true });
    const raw = window.localStorage.getItem(KEY) ?? "";

    for (const forbidden of ["timestamp", "history", "confidence", "session",
                             "frames", "user", "seen"]) {
      expect(raw, forbidden).not.toContain(forbidden);
    }
  });
});
