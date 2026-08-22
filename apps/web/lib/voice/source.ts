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
