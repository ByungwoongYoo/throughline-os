/**
 * The camera, and the promises made about it.
 *
 * §12 treats privacy as a product requirement rather than a disclosure, and the
 * hard part is not the architecture — frames never leave the browser because
 * nothing here has a network call to send them with — it is the two mundane
 * failures that destroy trust faster than any policy:
 *
 * **A camera that stays on.** If `stop()` misses a track the indicator light
 * stays lit after the researcher switched the feature off, and no explanation
 * afterwards repairs that. Every track is stopped, the reference is dropped,
 * and stopping twice is safe — because the teardown path runs from unmount,
 * from an error, and from the user's own control, sometimes all three.
 *
 * **A refusal with no way forward.** A denied permission is a decision, not a
 * fault: it returns a reason the interface can show, and the visualization
 * keeps working exactly as it did before. Nothing here throws into a render.
 *
 * Device labels are only readable after permission has been granted — browsers
 * hide them otherwise to stop sites fingerprinting hardware. So enumeration
 * happens *after* the stream opens, which is why the device list appears only
 * once the camera is already running.
 */

export type CameraFailure =
  | { reason: "denied"; message: string }
  | { reason: "no-device"; message: string }
  | { reason: "in-use"; message: string }
  | { reason: "unsupported"; message: string }
  | { reason: "unknown"; message: string };

export type CameraDevice = { deviceId: string; label: string };

export type CameraStartResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; failure: CameraFailure };

/**
 * Turns a `getUserMedia` rejection into something a researcher can act on.
 *
 * The browser's own messages are written for developers — "Requested device not
 * found" tells somebody with a closed laptop lid nothing about what to do.
 */
function describe(error: unknown): CameraFailure {
  const name = (error as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        reason: "denied",
        message: "Camera access was declined. Spatial interaction needs it to "
               + "see your hand; everything else in this visualization works "
               + "without it. You can allow the camera in your browser's site "
               + "settings and try again.",
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return {
        reason: "no-device",
        message: "No camera was found. If you are using an external webcam, "
               + "check it is connected — the visualization works without it.",
      };
    case "NotReadableError":
    case "AbortError":
      return {
        reason: "in-use",
        message: "The camera is being used by another application. Close the "
               + "other program and try again.",
      };
    default:
      return {
        reason: "unknown",
        message: "The camera could not be started. Spatial interaction is "
               + "unavailable; nothing else is affected.",
      };
  }
}

export class CameraManager {
  private stream: MediaStream | null = null;

  /** Whether this browser can do it at all, asked before anything is offered. */
  static supported(): boolean {
    return typeof navigator !== "undefined"
      && typeof navigator.mediaDevices?.getUserMedia === "function";
  }

  active(): boolean {
    return this.stream !== null;
  }

  /**
   * Ask for the camera. Never called on page load — only from an explicit act.
   *
   * A permission prompt the researcher did not ask for is the single fastest
   * way to make a research tool feel untrustworthy, and §4 puts the
   * explanation before the request for the same reason.
   */
  async start(deviceId?: string): Promise<CameraStartResult> {
    if (!CameraManager.supported()) {
      return { ok: false, failure: {
        reason: "unsupported",
        message: "This browser cannot provide camera access to a page. "
               + "Spatial interaction is unavailable here.",
      } };
    }

    // Starting twice would open a second stream and leak the first — and the
    // first is the one holding the indicator light.
    if (this.stream) return { ok: true, stream: this.stream };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Modest and explicit. Hand tracking needs landmarks, not detail, and a
        // 1080p request costs battery and decode time for no accuracy — §13
        // asks that vision work never degrade the rendering it exists to serve.
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
          : { width: 640, height: 480, facingMode: "user" },
        audio: false,   // never, under any setting
      });
      this.stream = stream;
      return { ok: true, stream };
    } catch (error) {
      return { ok: false, failure: describe(error) };
    }
  }

  /**
   * Release the camera completely.
   *
   * Every track, not just the first: a stream can carry more than one, and a
   * survivor keeps the light on. Safe to call when nothing is running, because
   * it is called from unmount, from failure paths and from the user's own
   * control, and guarding each caller separately is how one gets missed.
   */
  stop(): void {
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // A track already ended by the browser throws on some engines. The
        // point of this method is that the camera ends up off, and one
        // uncooperative track must not prevent the others from stopping.
      }
    }
    this.stream = null;
  }

  /**
   * The cameras available, once permission exists.
   *
   * Returns an empty list rather than throwing when enumeration is unavailable:
   * a missing device picker is a smaller problem than a settings panel that
   * cannot render.
   */
  async devices(): Promise<CameraDevice[]> {
    if (typeof navigator === "undefined"
        || typeof navigator.mediaDevices?.enumerateDevices !== "function") {
      return [];
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          // Before permission the label is empty by design. Numbering them
          // keeps the picker usable rather than showing a list of blanks.
          label: device.label || `Camera ${index + 1}`,
        }));
    } catch {
      return [];
    }
  }
}
