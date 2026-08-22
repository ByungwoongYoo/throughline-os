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
  it("reaches no server at all", async () => {
    /**
     * The property that makes it usable on somebody else's laptop. A page that
     * called the API would need a session, and needing a session is how a
     * five-minute check becomes a thing nobody does.
     */
    render(<GestureCheck />);

    expect(fetchMock).not.toHaveBeenCalled();
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
