/**
 * Translating MediaPipe's 21 points into this product's idea of a hand.
 *
 * Every line of that translation is an index into an array, which is to say
 * every line is an opportunity to be off by one in a way that produces
 * plausible-looking nonsense rather than an error. A thumb read from the ring
 * finger's slot still yields a number, a pinch distance, and a scene that
 * rotates — just never when the researcher meant it. Nothing downstream can
 * catch that, because everything downstream is working on the coordinates it
 * was given.
 *
 * So this file pins the mapping against fixtures whose points are deliberately
 * distinguishable, and asserts the properties the gesture logic silently
 * assumes.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { toHandFrame } from "@/lib/spatial/mediapipe";
import { handScale } from "@/lib/spatial/calibration";
import { distance } from "@/lib/spatial/types";

/**
 * A hand whose every landmark is at a different, identifiable position.
 *
 * Index `i` sits at x = i/100, so a mis-indexed landmark is not merely wrong,
 * it names the index it was actually read from — which turns a failure into a
 * diagnosis.
 */
function identifiableHand(): Array<{ x: number; y: number; z: number }> {
  return Array.from({ length: 21 }, (_, i) => ({ x: i / 100, y: 0.5, z: 0 }));
}

function result(landmarks: Array<Array<{ x: number; y: number; z: number }>>,
                handedness: string[] = []) {
  return {
    landmarks,
    worldLandmarks: [],
    handednesses: handedness.map((name) => [
      { categoryName: name, score: 0.94, index: 0, displayName: name },
    ]),
    handedness: [],
  } as never;
}

describe("which point is which", () => {
  it("reads each landmark from the slot MediaPipe puts it in", () => {
    /**
     * The indices are MediaPipe's published topology: 0 wrist, 4 thumb tip,
     * 5 index knuckle, 8 index tip, 12 middle tip, 16 ring tip, 20 pinky tip.
     * Asserted rather than trusted, because a silent off-by-one here is
     * invisible everywhere else.
     */
    const [hand] = toHandFrame(result([identifiableHand()], ["Right"]), 0).hands;

    expect(hand.wrist.x).toBeCloseTo(0.00, 6);
    expect(hand.thumbTip.x).toBeCloseTo(0.04, 6);
    expect(hand.indexBase.x).toBeCloseTo(0.05, 6);
    expect(hand.indexTip.x).toBeCloseTo(0.08, 6);
    expect(hand.middleTip.x).toBeCloseTo(0.12, 6);
    expect(hand.ringTip.x).toBeCloseTo(0.16, 6);
    expect(hand.pinkyTip.x).toBeCloseTo(0.20, 6);
  });

  it("places the palm at the wrist and knuckles, not at a fingertip", () => {
    /**
     * The palm centre is the position the whole rotation gesture is measured
     * from, so what it is made of matters more than it looks.
     *
     * Fingertips move as the hand opens and closes — taking the position from
     * one would make the scene drift every time the researcher pinched, which
     * reads as sloppy tracking rather than as a definition. The wrist alone is
     * stable but sits at the edge of the hand, so rotating the wrist swings it
     * further than the hand actually travelled. The knuckle centroid is the
     * part of a hand that behaves most like a rigid body.
     */
    const [hand] = toHandFrame(result([identifiableHand()]), 0).hands;

    // Mean of indices 0, 5, 9, 13, 17 → (0 + 5 + 9 + 13 + 17) / 5 / 100.
    expect(hand.palmCenter.x).toBeCloseTo(0.088, 6);
  });

  it("keeps the palm still while the fingers move", () => {
    /**
     * The property the choice above exists for, asserted directly: closing the
     * hand must not move the point the rotation is measured from.
     */
    const open = identifiableHand();
    const pinched = identifiableHand();
    // Bring thumb and index tips together; knuckles and wrist unchanged.
    pinched[4] = { x: 0.30, y: 0.30, z: 0 };
    pinched[8] = { x: 0.31, y: 0.30, z: 0 };

    const before = toHandFrame(result([open]), 0).hands[0].palmCenter;
    const after = toHandFrame(result([pinched]), 0).hands[0].palmCenter;

    expect(distance(before, after)).toBeCloseTo(0, 6);
  });

  it("produces a hand whose own ruler is measurable", () => {
    /**
     * `handScale` — wrist to index knuckle — is what makes the pinch thresholds
     * work at any distance from the camera. If either landmark were mapped
     * wrongly the ruler would be a different bone, or zero, and every threshold
     * derived from it would be silently off.
     */
    const [hand] = toHandFrame(result([identifiableHand()]), 0).hands;

    expect(handScale(hand)).toBeGreaterThan(0);
    expect(handScale(hand)).toBeCloseTo(0.05, 6);
  });
});

describe("what it refuses to report", () => {
  it("drops a hand that does not have all its landmarks", () => {
    /**
     * A truncated array would index `undefined` into every distance
     * calculation downstream and yield NaN rotations rather than an error —
     * the scene would stop responding with nothing in the console.
     */
    const partial = identifiableHand().slice(0, 10);

    expect(toHandFrame(result([partial]), 0).hands).toHaveLength(0);
  });

  it("reports no hands rather than an empty one when none are visible", () => {
    expect(toHandFrame(result([]), 0).hands).toEqual([]);
  });

  it("carries the timestamp it was given", () => {
    /** The machine's filters and the session's governor both work in time. */
    expect(toHandFrame(result([identifiableHand()]), 1234).timestamp).toBe(1234);
  });
});

describe("handedness", () => {
  it("reports the researcher's hand, not the camera's", () => {
    /**
     * MediaPipe labels handedness from the *camera's* point of view, so an
     * unmirrored front-facing camera calls the researcher's right hand "Left".
     * Nothing branches on this yet, which is exactly why it is worth pinning:
     * the first feature that does would otherwise inherit a silent inversion.
     */
    const [hand] = toHandFrame(result([identifiableHand()], ["Left"]), 0).hands;
    expect(hand.handedness).toBe("right");

    const [other] = toHandFrame(result([identifiableHand()], ["Right"]), 0).hands;
    expect(other.handedness).toBe("left");
  });

  it("passes the tracker's confidence through for the gate to use", () => {
    /** §31 — below a confidence threshold, nothing is acted on. */
    const [hand] = toHandFrame(result([identifiableHand()], ["Right"]), 0).hands;
    expect(hand.confidence).toBeCloseTo(0.94, 6);
  });

  it("assumes confidence when the tracker reports none", () => {
    /**
     * Defaulting to 0 would make a hand with no handedness block silently
     * un-actable — the feature would appear to do nothing, forever, with the
     * camera on.
     */
    const [hand] = toHandFrame(result([identifiableHand()]), 0).hands;
    expect(hand.confidence).toBe(1);
  });

  it("reads two hands independently", () => {
    /** §6 — two-handed zoom needs both, and needs them not confused. */
    const left = identifiableHand();
    const right = identifiableHand().map((p) => ({ ...p, x: p.x + 0.5 }));

    const { hands } = toHandFrame(result([left, right], ["Left", "Right"]), 0);

    expect(hands).toHaveLength(2);
    expect(hands[0].wrist.x).toBeCloseTo(0, 6);
    expect(hands[1].wrist.x).toBeCloseTo(0.5, 6);
  });
});

describe("the promise that nothing is fetched while you work", () => {
  /**
   * §12 is a product requirement, so it gets a test rather than a comment.
   *
   * MediaPipe's own documented example passes a jsdelivr URL to
   * `FilesetResolver`, and that snippet is the first result for every question
   * anyone will ask while maintaining this file. Pasting it back would restore
   * a silent network request at the exact moment a researcher enables a feature
   * whose entire claim is that nothing leaves their machine — and nothing else
   * in the suite would notice, because it would still work.
   */
  const source = readFileSync("lib/spatial/mediapipe.ts", "utf8");

  it("loads the runtime and the model from this application only", () => {
    const remote = source.match(/["'`]https?:\/\/[^"'`]+/g) ?? [];

    expect(remote, "remote URLs in the tracker").toEqual([]);
    expect(source).toContain('"/mediapipe/wasm"');
    expect(source).toContain('"/mediapipe/hand_landmarker.task"');
  });

  it("names the fix when the model has not been vendored", () => {
    /**
     * The likely case is a fresh clone where the install step was skipped, and
     * the raw failure for that is a 404 on a `.task` file — which tells a
     * researcher nothing, and reads like the feature is broken rather than
     * un-installed.
     */
    expect(source).toContain("vendor:hand-model");
  });

  it("is excluded from the repository rather than committed", () => {
    /**
     * 7.5MB of model and 21MB of WASM in every clone's history, forever, for
     * bytes reproducible from a pinned hash and a pinned package version.
     */
    expect(readFileSync(".gitignore", "utf8")).toContain("/public/mediapipe/");
  });

  it("pins the model it was built against", () => {
    /** A model file is executable behaviour; a substituted one is a silent
     * behaviour change arriving over a network. */
    const script = readFileSync("scripts/vendor-hand-model.mjs", "utf8");

    expect(script).toMatch(/MODEL_SHA256\s*=\s*\n?\s*"[0-9a-f]{64}"/);
    expect(script).toContain("Refusing to install it");
  });
});
