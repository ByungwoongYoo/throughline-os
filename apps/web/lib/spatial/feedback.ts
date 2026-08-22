/**
 * Making a gesture feel like it landed.
 *
 * Direct manipulation feels physical for a small number of reasons, and haptics
 * is only one of them. The others matter more and are available everywhere:
 * latency, one-to-one tracking without overshoot, and an unambiguous moment when
 * the grab takes hold. A pinch that closes 120ms before the scene responds feels
 * broken however it buzzes.
 *
 * **The honest position on web haptics, stated plainly because it decides the
 * design.** There is no vibration on a laptop. `navigator.vibrate` is
 * implemented on Android and on no desktop browser; Safari does not implement it
 * at all; Apple's Force Touch haptics are reachable from native code and not
 * from a page. So on the machine most researchers will use this on, a vibration
 * call is a no-op that looks like a feature. Shipping one and calling the
 * feature "haptic" would be the kind of claim this codebase spends its time
 * removing from other people's work.
 *
 * What this does instead is treat feedback as *semantic* — a gesture began, a
 * gesture ended, something was selected — and route it to whichever channels
 * genuinely exist here:
 *
 *   - **vibration**, where the hardware and the browser both have it (an Android
 *     tablet driving a lecture display is a real case, §47);
 *   - **sound**, a very short click, off unless asked for, because a research
 *     tool that clicks in a shared office is one somebody switches off for good;
 *   - **visual**, always, because it is the only channel that is always there.
 *
 * And it reports what it found, so the interface can say "this machine has no
 * vibration hardware" rather than offering a switch that does nothing.
 */

/** The moments worth marking. Deliberately few — §9's argument, applied here. */
export type FeedbackMoment =
  | "grabStart"
  | "grabEnd"
  | "select"
  | "zoomStart"
  | "trackingLost";

export type FeedbackChannels = {
  vibration: boolean;
  sound: boolean;
  visual: boolean;
  /**
   * A real actuator, reached through this machine's own API.
   *
   * The browser cannot fire one; the local process is native code and can. What
   * it drives is the trackpad, so it is felt by a hand resting there and not by
   * a hand held in the air — which is why this carries a description rather than
   * only a flag.
   */
  native: { available: boolean; feltWhere: string | null };
};

/**
 * Vibration patterns, in milliseconds.
 *
 * All of them short. A research tool is used for hours, and anything long enough
 * to be described as a buzz becomes intolerable by the fourth time — the point
 * is to mark a boundary, not to announce one. `grabStart` is the crispest
 * because it is the moment that has to feel like a click.
 */
const PATTERN: Record<FeedbackMoment, number[]> = {
  grabStart: [12],
  grabEnd: [8],
  select: [10, 30, 10],
  zoomStart: [12],
  // Longer, and the only one that is: losing tracking mid-gesture is the one
  // moment the researcher needs to notice without looking at a status line.
  trackingLost: [25],
};

/** Where the click sits. Low and brief reads as a mechanism rather than a beep. */
const CLICK = { frequency: 180, seconds: 0.02, gain: 0.06 };

export type FeedbackSettings = {
  vibrate: boolean;
  sound: boolean;
};

/**
 * Which Apple pattern marks which moment.
 *
 * `alignment` is the sharp one — it exists for a dragged object snapping to a
 * guide, which is exactly the feel wanted when a selection lands. `generic` is
 * softer and marks a boundary being crossed.
 */
const NATIVE_PATTERN: Record<FeedbackMoment, string> = {
  grabStart: "alignment",
  grabEnd: "generic",
  select: "alignment",
  zoomStart: "generic",
  trackingLost: "level",
};

export const DEFAULT_FEEDBACK: FeedbackSettings = {
  // On where it exists: a gesture that lands with a tap is the entire point, and
  // on hardware with no vibration this costs nothing because nothing happens.
  vibrate: true,
  // Off. A tool that clicks in a shared office gets muted permanently on the
  // first afternoon, and then the researcher has no feedback at all.
  sound: false,
};

/**
 * What this machine can actually do.
 *
 * Called before anything is offered, so a switch is never shown for a channel
 * that does not exist. `navigator.vibrate` being present is not the same as it
 * doing anything — several desktop browsers expose the function and ignore the
 * call — but presence is the only signal available, and the interface says as
 * much rather than promising.
 */
export function availableChannels(): FeedbackChannels {
  const hasVibration =
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  const hasAudio =
    typeof window !== "undefined"
    && (typeof window.AudioContext === "function"
        || typeof (window as { webkitAudioContext?: unknown }).webkitAudioContext
           === "function");

  return {
    vibration: hasVibration, sound: hasAudio, visual: true,
    // Filled in by `askNativeCapability`, which needs a round trip. Reported as
    // unavailable until it answers, so nothing is promised before it is known.
    native: { available: false, feltWhere: null },
  };
}

/**
 * Ask this machine's own API what it can do.
 *
 * Separate from the synchronous check because it is a network call, local but
 * still asynchronous. Failure is silence: a machine that cannot answer is a
 * machine with no haptics, which is the common case and not an error.
 */
export async function askNativeCapability():
    Promise<{ available: boolean; feltWhere: string | null }> {
  try {
    const response = await fetch("/api/haptics");
    if (!response.ok) return { available: false, feltWhere: null };
    const body = await response.json();
    return {
      available: body?.available === true,
      feltWhere: typeof body?.felt_where === "string" ? body.felt_where : null,
    };
  } catch {
    return { available: false, feltWhere: null };
  }
}

export class Feedback {
  private context: AudioContext | null = null;
  private settings: FeedbackSettings;
  private native = false;

  constructor(settings: Partial<FeedbackSettings> = {}) {
    this.settings = { ...DEFAULT_FEEDBACK, ...settings };
  }

  configure(settings: Partial<FeedbackSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Mark a moment.
   *
   * Never throws, and never awaits. This is called from the frame path at the
   * instant a gesture changes state, and an exception or a delay here would
   * damage the very thing it exists to improve — a feedback layer that stalls
   * the interaction it is confirming is worse than no feedback.
   */
  emit(moment: FeedbackMoment): void {
    if (this.settings.vibrate) {
      this.vibrate(moment);
      this.nativeTap(moment);
    }
    if (this.settings.sound) this.click(moment);
  }

  /**
   * Ask the local process for a real tap.
   *
   * Fire and forget, deliberately. Awaiting a round trip — even a local one — on
   * the frame where a gesture engages would put the confirmation behind the
   * thing it confirms, and a tap that arrives late feels like a tap for
   * something else. The response is not read: whether it fired is not worth a
   * branch on the interaction path.
   */
  private nativeTap(moment: FeedbackMoment): void {
    if (!this.native) return;
    try {
      void fetch("/api/haptics/tap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: NATIVE_PATTERN[moment] }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Offline, blocked, or no API. Nothing to do and nothing to say.
    }
  }

  /** Turn the native channel on once the machine has said it has one. */
  useNative(available: boolean): void {
    this.native = available;
  }

  private vibrate(moment: FeedbackMoment): void {
    try {
      navigator?.vibrate?.(PATTERN[moment]);
    } catch {
      // Some engines throw when the page is not visible or has never been
      // interacted with. There is nothing to do about it and nothing worth
      // telling anyone.
    }
  }

  private click(moment: FeedbackMoment): void {
    try {
      const context = this.audio();
      if (!context) return;

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      // A slightly higher click for a completed selection, so the two most
      // common moments are distinguishable without being looked at.
      oscillator.frequency.value =
        moment === "select" ? CLICK.frequency * 1.6 : CLICK.frequency;

      // Ramped, not switched. A square-edged gain change is a pop, which reads
      // as a fault in the audio rather than as a confirmation.
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(CLICK.gain, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + CLICK.seconds);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + CLICK.seconds + 0.01);
    } catch {
      // Audio is a courtesy. It must never take an interaction down with it.
    }
  }

  /**
   * One context, created on first use.
   *
   * Browsers refuse to start an AudioContext before a user gesture, and every
   * path into this has been through a button press. Created lazily so a
   * researcher who never enables sound never pays for an audio graph.
   */
  private audio(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof window === "undefined") return null;
    const Constructor = window.AudioContext
      ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return null;
    try {
      this.context = new Constructor();
      return this.context;
    } catch {
      return null;
    }
  }

  /** Release the audio graph. */
  close(): void {
    try {
      void this.context?.close();
    } catch {
      // Already closed, or never opened.
    }
    this.context = null;
  }
}

/**
 * Which moments a machine event corresponds to.
 *
 * A separate mapping rather than emitting from inside the state machine: the
 * machine's job is deciding what the researcher meant, and a decision layer that
 * also makes noises is one that cannot be tested without silencing it.
 */
export function momentFor(event: string): FeedbackMoment | null {
  switch (event) {
    case "gesture_grab_started":
      return "grabStart";
    case "gesture_grab_completed":
      return "grabEnd";
    case "gesture_selection_completed":
      return "select";
    case "gesture_zoom_started":
      return "zoomStart";
    case "tracking_lost":
      return "trackingLost";
    default:
      // Everything else is a state change nobody needs to feel. Marking every
      // event would make the feedback continuous, and continuous feedback is
      // indistinguishable from none.
      return null;
  }
}
