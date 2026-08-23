/**
 * Where the words come from, and what it costs to get them.
 *
 * This file exists mostly to make one fact impossible to miss, because it is the
 * kind of fact a product quietly loses during a demo.
 *
 * **The browser's built-in speech recognition is not local.** `SpeechRecognition`
 * in Chrome streams microphone audio to Google's servers and returns text. It is
 * one line of code, it works well, and using it here would break the first claim
 * this project makes about itself — that nothing leaves the machine unless the
 * researcher connects an external service. A researcher thinking aloud about
 * unpublished data, an embargoed finding or a participant's details would be
 * uploading all of it to a third party, and nothing in the interface would
 * suggest that had happened. Hand tracking was built the hard way, with a
 * vendored model and no CDN, for exactly this reason; speech does not get an
 * exception because it is harder.
 *
 * So recognition sits behind an interface with three implementations, and the
 * one that leaves the machine has to say so in the interface before it will run.
 *
 * A second reason for the seam, which matters for building: **none of the
 * subsystem's difficulty is in recognition.** The hard part is binding "these"
 * to the gesture that was in progress when the word was said — that lives in
 * `timeline.ts`, is entirely testable without a microphone, and would be
 * untestable if it were tangled up with an audio API.
 */

export type SpeechPrivacy =
  /** Audio never leaves this machine. */
  | "local"
  /** Audio is sent to a third party, and the interface must say which. */
  | "remote";

export type SpeechSourceInfo = {
  /** Named in the interface, so a researcher knows what is listening. */
  label: string;
  privacy: SpeechPrivacy;
  /** For `remote`, who receives the audio. Required — see `describeSource`. */
  recipient?: string;
};

/** A word as it arrives, on the same monotonic clock the gesture stream uses. */
export type SpeechEvent = {
  text: string;
  at: number;
  /** Interim results are revised; final ones are not. */
  final: boolean;
};

export interface SpeechSource {
  info(): SpeechSourceInfo;
  /** Begin listening. Rejects if the microphone is refused or unavailable. */
  start(onEvent: (event: SpeechEvent) => void): Promise<void>;
  stop(): void;
  listening(): boolean;
}

/**
 * What must be shown before a source is used.
 *
 * Returns the sentence the interface is obliged to display. A remote source with
 * no named recipient is refused outright rather than described vaguely: "audio
 * may be processed externally" is the kind of phrasing that exists to avoid
 * being understood.
 */
export function describeSource(info: SpeechSourceInfo): string {
  if (info.privacy === "local") {
    return `${info.label}. Audio is processed on this machine and never sent `
         + "anywhere.";
  }
  if (!info.recipient) {
    throw new Error(
      "a remote speech source must name who receives the audio");
  }
  return `${info.label}. **Your microphone audio is sent to ${info.recipient}.** `
       + "Anything you say while this is on — including unpublished results and "
       + "anything about participants — leaves this machine.";
}

/**
 * A source that produces nothing, and is honest about why.
 *
 * The default. Speech is off until a researcher chooses a recogniser, rather
 * than the browser's cloud one being switched on because it was the easiest to
 * reach.
 */
export class NoSpeechSource implements SpeechSource {
  info(): SpeechSourceInfo {
    return { label: "No speech recognition configured", privacy: "local" };
  }

  async start(): Promise<void> {
    throw new Error(
      "No speech recogniser is configured. The browser's built-in recognition "
      + "sends audio to Google, so it is not enabled by default; a local model "
      + "can be installed instead.");
  }

  stop(): void {}
  listening(): boolean { return false; }
}

/**
 * A source driven by the caller, for tests and for the keyboard path.
 *
 * Not a mock bolted on for testing: it is also how speech-plus-gesture stays
 * reachable without a microphone at all, which §79 and Rule 5 require — a
 * capability that only exists by voice would lock out anybody who cannot use
 * one, and would make the feature untestable in CI at the same time.
 */
export class ScriptedSpeechSource implements SpeechSource {
  private listener: ((event: SpeechEvent) => void) | null = null;

  info(): SpeechSourceInfo {
    return { label: "Typed input", privacy: "local" };
  }

  async start(onEvent: (event: SpeechEvent) => void): Promise<void> {
    this.listener = onEvent;
  }

  stop(): void {
    this.listener = null;
  }

  listening(): boolean {
    return this.listener !== null;
  }

  /** Deliver a word, as though it had been spoken at `at`. */
  say(text: string, at: number, final = true): void {
    this.listener?.({ text, at, final });
  }

  /** Deliver a sentence, spreading the words over a duration. */
  utter(sentence: string, startAt: number, durationMs: number): void {
    const words = sentence.split(/\s+/).filter(Boolean);
    const step = words.length > 1 ? durationMs / (words.length - 1) : 0;
    words.forEach((word, i) => this.say(word, startAt + i * step, true));
  }
}

/**
 * When a *typed* sentence should be considered to have been said.
 *
 * The typed path is not a stand-in for speech — it is the path that works today
 * — so getting its timing wrong is getting the feature wrong. And it was wrong
 * twice, in opposite directions.
 *
 * **Dating it from submission was wrong.** Draw a loop, take ten seconds to
 * type, and every word landed ten seconds after the gesture, outside the
 * backward window: somebody referring to the circle they had just drawn was told
 * nothing was indicated.
 *
 * **Spreading it across the typing interval was also wrong**, and a test caught
 * it. Typing "why are these different" over five seconds put *these* four and a
 * third seconds after the gesture — still outside. The deeper problem is that
 * the spread models something that cannot happen: speech words are spread out
 * because a person gestures *while* speaking, and **a person cannot gesture
 * while typing**, because both hands are busy. A typed sentence refers to
 * whatever was true when they turned to the keyboard, and every word of it
 * refers to the same moment.
 *
 * So a typed sentence is a short utterance dated from the first keystroke. The
 * words keep an order, since the resolver reads each at its own timestamp, but
 * they are close enough together to belong to one gesture — which is the only
 * arrangement typing can actually mean.
 *
 * The two-gesture sentence — "compare this with this", one word per cluster — is
 * genuinely unavailable by keyboard for the same reason, and is a thing speech
 * will be able to do that typing cannot.
 */
export function typedTiming(firstKeystrokeAt: number, submittedAt: number,
                            spreadMs = 700): { startAt: number; durationMs: number } {
  const composed = submittedAt - firstKeystrokeAt;
  // Pasted, submitted without typing, or a clock that appears to run backwards:
  // it belongs to this moment. A negative duration would spread the words
  // backwards and bind them to whatever was there first.
  if (!Number.isFinite(composed) || composed <= 0) {
    return { startAt: submittedAt, durationMs: 0 };
  }
  return { startAt: firstKeystrokeAt, durationMs: Math.min(composed, spreadMs) };
}
