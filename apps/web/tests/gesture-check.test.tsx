/**
 * The page whose job is to tell you whether the tracking works here.
 *
 * It exists because every reliability claim in the gesture layer rests on
 * synthetic landmark data, and the only way to learn whether the thresholds are
 * right is for a person to use them in their own room and their own light. That
 * makes two properties load-bearing: it must work without an account, and it
 * must reach no project data — otherwise testing on a colleague's laptop means
 * making them an account, and nobody does it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import GestureCheck from "@/app/gesture-check/page";

vi.mock("@/lib/spatial/mediapipe", () => ({
  MediaPipeHandTracker: class {
    async load() {}
    start() {}
    stop() {}
    close() {}
    status() { return "running" as const; }
  },
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // A browser that can provide a camera. happy-dom's navigator has no
  // `mediaDevices`, and the control correctly hides itself when there is none —
  // so without this the page under test is one that offers nothing, which is
  // not the page anybody will open.
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn(), enumerateDevices: vi.fn(async () => []) },
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("testing the tracking without an account", () => {
  it("reads no project data and needs no session", async () => {
    /**
     * The property that makes it usable on somebody else's laptop.
     *
     * This asserted "no server at all" until the page began asking the machine
     * what haptic hardware it has — which is a question about the hardware, not
     * about anybody's research, and needs no account to answer. The requirement
     * was always the narrower one: nothing here may touch a project or require
     * a session, because needing a session is how a five-minute check becomes a
     * thing nobody does.
     */
    render(<GestureCheck />);

    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toMatch(/\/projects\//);
      expect(String(url)).not.toMatch(/\/auth\//);
    }
  });

  it("works when the API is not running at all", async () => {
    /**
     * The check page has to be usable before the rest of the stack is. A
     * researcher debugging their camera should not first have to debug their
     * database.
     */
    fetchMock.mockRejectedValue(new Error("no API"));

    render(<GestureCheck />);

    expect(await screen.findByRole("button", { name: /try hand gestures/i }))
      .toBeTruthy();
  });

  it("draws a cloud with structure rather than noise", async () => {
    /**
     * Rotating a formless cloud tells you nothing about whether the rotation is
     * following your hand, because every orientation looks the same. Structure
     * is what makes lag and jitter legible.
     */
    render(<GestureCheck />);

    expect(await screen.findByText(/180 points/i)).toBeTruthy();
  });

  it("offers the gesture control", async () => {
    render(<GestureCheck />);

    expect(await screen.findByRole("button", { name: /try hand gestures/i }))
      .toBeTruthy();
  });
});

describe("numbers rather than adjectives", () => {
  it("shows the rate, the counts, and nothing about the person", async () => {
    /**
     * "It feels laggy" is not something a researcher should have to translate
     * into a bug report. What is on screen is a tally — never imagery, never a
     * trace of how somebody moved.
     */
    render(<GestureCheck />);

    expect(screen.getByText(/frames processed each second/i)).toBeTruthy();
    expect(screen.getByText(/grabs started \/ completed/i)).toBeTruthy();
    expect(screen.getByText(/tracking lost \/ recovered/i)).toBeTruthy();
    expect(screen.getByText(/counts only/i)).toBeTruthy();
  });

  it("says what a bad number would mean", async () => {
    /** A diagnostic nobody can interpret is decoration. */
    render(<GestureCheck />);

    expect(screen.getByText(/a healthy rate is around 30/i)).toBeTruthy();
    expect(screen.getByText(/more grabs started than completed/i)).toBeTruthy();
  });

  it("asks the questions that are actually unknown", async () => {
    /**
     * A page that asks "does it work?" gets "sort of". These are the specific
     * behaviours currently answered by synthetic data.
     */
    render(<GestureCheck />);

    expect(screen.getByText(/stay still when your hand is still/i)).toBeTruthy();
    expect(screen.getByText(/talk and gesture normally/i)).toBeTruthy();
    expect(screen.getByText(/register first time/i)).toBeTruthy();
  });

  it("says the mouse still does everything", async () => {
    /** Rule 5, on the page most likely to be read while a gesture is failing. */
    render(<GestureCheck />);

    expect(screen.getByText(/the mouse does everything the gestures do/i))
      .toBeTruthy();
  });
});

describe("explaining a non-response", () => {
  it("shows the tracker's counters only once it is running", async () => {
    /**
     * Before the camera is on there is nothing to report, and a panel of zeroes
     * would read as a broken tracker rather than an idle one.
     */
    render(<GestureCheck />);

    expect(screen.queryByText(/why nothing is happening/i)).toBeNull();
  });

  it("names the patterns rather than only printing numbers", async () => {
    /**
     * The four readings distinguish failures with completely different fixes:
     * no picture at all, a picture with no hand recognised, a model failing on
     * this machine, and a hand recognised whose pinch never crosses the
     * threshold. A page that printed the counters without saying what they mean
     * would leave the reader exactly as stuck.
     */
    const page = (await import("node:fs")).readFileSync(
      "app/gesture-check/page.tsx", "utf8");

    expect(page).toMatch(/stuck at 0/);
    expect(page).toMatch(/not recognising a hand/i);
    expect(page).toMatch(/GPU to CPU/i);
    expect(page).toMatch(/press <em>Calibrate<\/em>|Calibrate/);
  });
});

describe("saying what is wrong, rather than showing numbers that imply it", () => {
  /**
   * The counters were already on screen and a researcher still had to work out
   * what they meant, which is a diagnostic that has offloaded the diagnosis.
   * These check the sentence, because the sentence is the feature.
   */
  it("says what to press before the camera is on", async () => {
    render(<GestureCheck />);

    expect(await screen.findByText(/camera is not on yet/i)).toBeTruthy();
  });

  it("orders its checks so the innermost failure is the one reported", async () => {
    /**
     * Each check rules out a layer. Reported out of order, somebody would be
     * told to improve their lighting while the real problem was that no camera
     * frame had ever been read — and they would go and change the lighting.
     */
    const page = (await import("node:fs")).readFileSync(
      "app/gesture-check/page.tsx", "utf8");
    const body = page.slice(page.indexOf("function verdictFor"));

    const order = ["inferences === 0", "inferenceErrors", "handsSeen === 0",
                   "gesture_grab_started === 0"];
    let last = -1;
    for (const marker of order) {
      const at = body.indexOf(marker);
      expect(at, marker).toBeGreaterThan(last);
      last = at;
    }
  });

  it("names the threshold and the fix when a pinch is not closing", async () => {
    /**
     * The most likely real outcome, and the one where a number alone is
     * useless: "0.041" means nothing without "and it has to be under 0.035".
     */
    const page = (await import("node:fs")).readFileSync(
      "app/gesture-check/page.tsx", "utf8");

    expect(page).toMatch(/has to be under/);
    expect(page).toMatch(/Press Calibrate/);
  });

  it("says a closing pinch that does nothing is a bug, not a setting", async () => {
    /**
     * The one case the researcher must not be sent to Calibrate for — if the
     * pinch is closing and the scene is still, the threshold is right and
     * something downstream is broken.
     */
    const page = (await import("node:fs")).readFileSync(
      "app/gesture-check/page.tsx", "utf8");

    // Matched without the leading word: the sentence is split across source
    // lines by the formatter, and a regex spanning that break asserts the
    // layout of the file rather than the wording of the message.
    expect(page).toMatch(/is a bug rather than a threshold/);
  });
});
