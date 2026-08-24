/**
 * What the researcher chose, remembered across sessions.
 *
 * Three rules shape this file, and each one rules out an easier implementation.
 *
 * **Off unless asked for.** Spatial interaction is experimental and it wants a
 * camera. Anything that defaults it on — including a corrupt stored value that
 * happens to parse as truthy — has effectively enabled a webcam feature on
 * someone's behalf. The default is `false` and every path that cannot produce a
 * confident answer returns the default rather than a guess.
 *
 * **Enabled is not running.** This records that the feature may be *offered*.
 * It never causes a camera to start: §4 puts the explanation before the request,
 * and a permission prompt on page load is the fastest way to make a research
 * tool feel untrustworthy. Starting is always an explicit act, every session.
 *
 * **Stored settings are untrusted input.** They come from disk, they can be
 * edited by hand, and they survive upgrades that change what the fields mean. A
 * stored `rotationSensitivity` of 1e9 would make the scene unusable with no way
 * back short of clearing site data — so every value is validated and clamped on
 * the way in, not on the way out.
 *
 * Nothing here records anything about the person: no timings, no confidences, no
 * history of use. Thresholds and a device id are settings; a log of when someone
 * gestured at their desk is a behavioural trace, and this feature cannot ask to
 * be trusted with a camera while quietly keeping one.
 */

import { DEFAULT_SETTINGS, SpatialSettings } from "./machine";
import { DEFAULT_FEEDBACK, FeedbackSettings } from "./feedback";

const STORAGE_KEY = "throughline-spatial";

/**
 * Bumped when the meaning of a stored field changes.
 *
 * A stored blob from an older shape is discarded rather than migrated. Migration
 * is the right answer for a researcher's data and the wrong one for four tuning
 * numbers: the cost of being wrong is a scene that responds strangely for
 * reasons nobody can see, and the cost of resetting is thirty seconds of
 * re-calibration.
 */
const VERSION = 1;

export type SpatialPreferences = {
  /** Whether the feature is offered at all. Never whether it is running. */
  enabled: boolean;
  /** Which camera, when the machine has more than one. */
  deviceId: string | null;
  /**
   * Whether the four-step introduction has been completed (§97).
   *
   * Remembered so it is not repeated, and stored rather than derived: "has this
   * person done it" is a fact about them, and inferring it from whether any
   * gesture has ever succeeded would show it again to somebody who learnt on a
   * different machine and skip it for somebody who once brushed a chart.
   */
  onboarded: boolean;
  /**
   * Whether a gesture is confirmed by touch or sound as well as by sight.
   *
   * Vibration defaults on and costs nothing where there is no hardware — most
   * laptops, where the call is simply ignored. Sound defaults **off**: a
   * research tool that clicks in a shared office is one somebody mutes on the
   * first afternoon, and then they have no feedback at all.
   */
  feedback: FeedbackSettings;
  /** The tuning the researcher (or calibration) arrived at. */
  settings: Pick<SpatialSettings,
    "adaptiveThresholds" | "pinchRatioOn" | "pinchRatioOff"
    | "rotationSensitivity" | "zoomSensitivity">;
};

export const DEFAULT_PREFERENCES: SpatialPreferences = {
  enabled: false,
  deviceId: null,
  onboarded: false,
  feedback: DEFAULT_FEEDBACK,
  settings: {
    adaptiveThresholds: DEFAULT_SETTINGS.adaptiveThresholds,
    pinchRatioOn: DEFAULT_SETTINGS.pinchRatioOn,
    pinchRatioOff: DEFAULT_SETTINGS.pinchRatioOff,
    rotationSensitivity: DEFAULT_SETTINGS.rotationSensitivity,
    zoomSensitivity: DEFAULT_SETTINGS.zoomSensitivity,
  },
};

/**
 * Ranges a stored value must fall inside to be believed.
 *
 * Wide enough that a researcher who genuinely wants a very slow rotation gets
 * it, narrow enough that no stored number can produce a scene that cannot be
 * recovered from — §32's requirement, applied to the settings rather than to the
 * camera.
 */
const LIMITS = {
  pinchRatioOn: { min: 0.05, max: 1.2 },
  pinchRatioOff: { min: 0.08, max: 1.8 },
  rotationSensitivity: { min: 0.2, max: 8 },
  zoomSensitivity: { min: 0.1, max: 5 },
} as const;

/**
 * What a slider offers, which is narrower than what storage accepts.
 *
 * Two different questions, deliberately answered separately. `LIMITS` is "what
 * is not insane" — wide, because a stored value from a future version or a
 * deliberate hand-edit should survive rather than be silently rewritten. This is
 * "what is worth offering", and it is tight around the defaults: a slider
 * spanning 0.2 to 8 would put every usable setting in the first fifth of the
 * track, so the control would feel broken while working perfectly.
 */
export const SLIDER_RANGE = {
  rotationSensitivity: { min: 0.6, max: 4, step: 0.1 },
  zoomSensitivity: { min: 0.3, max: 2.5, step: 0.1 },
} as const;

function clamp(value: unknown, limits: { min: number; max: number },
               fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, limits.min), limits.max);
}

/**
 * Read the stored preferences, or the defaults.
 *
 * Never throws. This is called during render, and a workspace that fails to
 * paint because a settings blob was malformed would be a far worse outcome than
 * an experimental feature reverting to its defaults.
 */
export function readPreferences(): SpatialPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage disabled. The defaults are a fine answer and
    // are what would have happened anyway.
    return DEFAULT_PREFERENCES;
  }
  if (!raw) return DEFAULT_PREFERENCES;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFERENCES;

  const stored = parsed as Record<string, unknown>;
  if (stored.version !== VERSION) return DEFAULT_PREFERENCES;

  const settings = (typeof stored.settings === "object" && stored.settings !== null
    ? stored.settings : {}) as Record<string, unknown>;

  const fallback = DEFAULT_PREFERENCES.settings;
  const preferences: SpatialPreferences = {
    // Strictly `true`, never truthiness: a stored `"yes"`, `1` or `{}` is a
    // value this code did not write, and enabling a camera feature on the
    // strength of one is exactly the thing not to do.
    enabled: stored.enabled === true,
    deviceId: typeof stored.deviceId === "string" && stored.deviceId
      ? stored.deviceId : null,
    // Strictly `true`, and defaulting to *not* done: a preferences blob written
    // before this existed must show the introduction rather than silently skip
    // it for somebody who has never seen it.
    onboarded: stored.onboarded === true,
    feedback: {
      // Strictly boolean, like `enabled`. A stored value this code did not write
      // should fall back to the default rather than be coerced.
      vibrate: typeof (stored.feedback as FeedbackSettings)?.vibrate === "boolean"
        ? (stored.feedback as FeedbackSettings).vibrate
        : DEFAULT_FEEDBACK.vibrate,
      sound: typeof (stored.feedback as FeedbackSettings)?.sound === "boolean"
        ? (stored.feedback as FeedbackSettings).sound
        : DEFAULT_FEEDBACK.sound,
    },
    settings: {
      adaptiveThresholds: settings.adaptiveThresholds === undefined
        ? fallback.adaptiveThresholds
        : settings.adaptiveThresholds === true,
      pinchRatioOn: clamp(settings.pinchRatioOn, LIMITS.pinchRatioOn,
                          fallback.pinchRatioOn),
      pinchRatioOff: clamp(settings.pinchRatioOff, LIMITS.pinchRatioOff,
                           fallback.pinchRatioOff),
      rotationSensitivity: clamp(settings.rotationSensitivity,
                                 LIMITS.rotationSensitivity,
                                 fallback.rotationSensitivity),
      zoomSensitivity: clamp(settings.zoomSensitivity, LIMITS.zoomSensitivity,
                             fallback.zoomSensitivity),
    },
  };

  // Hysteresis has to survive whatever was stored. Two values that crossed —
  // by a hand edit, or by clamping them independently — would make a pinch
  // release the instant it engaged, which reads as the tracking being broken.
  if (preferences.settings.pinchRatioOff <= preferences.settings.pinchRatioOn) {
    preferences.settings.pinchRatioOn = fallback.pinchRatioOn;
    preferences.settings.pinchRatioOff = fallback.pinchRatioOff;
  }

  return preferences;
}

/** Persist. Silent on failure — the choice still applies to this session. */
export function writePreferences(preferences: SpatialPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY,
      JSON.stringify({ version: VERSION, ...preferences }));
  } catch {
    // Storage full or unavailable. Losing persistence is a smaller failure than
    // refusing to apply what the researcher just chose.
  }
}

/** Forget everything, for a researcher who wants the defaults back. */
export function clearPreferences(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do, and nothing worth interrupting anyone about.
  }
}
