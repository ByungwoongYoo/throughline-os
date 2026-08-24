/**
 * The thresholds, and the hands they were never written for.
 *
 * `pinchOn: 0.035` is a distance in normalised image coordinates, which means it
 * silently assumes a hand size and a camera distance. The tests below are the
 * two people that assumption fails: someone sitting back from a large display,
 * whose merely resting hand is already inside the threshold so the machine reads
 * a grab they never made; and someone leaning close to a laptop, whose pinch never
 * gets small enough so the feature simply does not respond. Both are indexed on
 * the same number being wrong, both look to the researcher like bad tracking,
 * and neither would ever be reported as a threshold problem.
 */

import { describe, expect, it } from "vitest";
import {
  CalibrationManager, handScale, scaleThresholds,
} from "@/lib/spatial/calibration";
import { DEFAULT_SETTINGS, SpatialInteractionMachine } from "@/lib/spatial/machine";
import { Hand } from "@/lib/spatial/types";

/**
 * A hand at an arbitrary size. `span` is wrist-to-index-base — the ruler — and
 * `pinch` is the thumb-to-index distance as a fraction of it, so "the same
 * gesture at a different distance" is one parameter change rather than a
 * rewritten fixture.
 */
function handAt(span: number, pinchRatio: number,
                at = { x: 0.5, y: 0.5 }): Hand {
  const pinch = span * pinchRatio;
  return {
    handedness: "right", confidence: 0.95,
    // The ruler is wrist-to-index-base, so those two are exactly `span` apart.
    // The first version of this fixture placed them at 3x and 1x, making every
    // measured ratio half what the test said it was — and two assertions passed
    // anyway, because halving both poses preserves their separation.
    wrist: { x: at.x, y: at.y + span * 2 },
    indexBase: { x: at.x, y: at.y + span },
    thumbTip: { x: at.x - pinch / 2, y: at.y },
    indexTip: { x: at.x + pinch / 2, y: at.y },
    middleTip: { x: at.x, y: at.y + span * 1.7 },
    ringTip: { x: at.x, y: at.y + span * 1.8 },
    pinkyTip: { x: at.x, y: at.y + span * 1.9 },
    palmCenter: { x: at.x, y: at.y },
  };
}

describe("the hand's own ruler", () => {
  it("measures a bone length, not a pose", () => {
    /**
     * The whole approach rests on this. If the ruler changed as the hand opened
     * and closed, it would be measuring the thing being measured, and the ratio
     * would be constant no matter what the fingers did.
     */
    const open = handScale(handAt(0.1, 2.5));
    const pinched = handScale(handAt(0.1, 0.2));

    expect(open).toBeCloseTo(pinched, 6);
  });

  it("shrinks as the hand moves away, which is what makes it a scale", () => {
    expect(handScale(handAt(0.05, 1))).toBeCloseTo(0.05, 6);
    expect(handScale(handAt(0.2, 1))).toBeCloseTo(0.2, 6);
  });
});

describe("thresholds that mean the same thing at any distance", () => {
  it("agrees with the absolute defaults for a reference-size hand", () => {
    /**
     * Not a coincidence to be discovered later: the ratios are the absolute
     * defaults over the span they were written against. If the two disagreed
     * here, enabling the adaptive path would quietly redefine what a pinch is
     * for everybody rather than fixing it for the people it was wrong for.
     */
    const { pinchOn, pinchOff } = scaleThresholds(handAt(0.1, 1), DEFAULT_SETTINGS);

    expect(pinchOn).toBeCloseTo(DEFAULT_SETTINGS.pinchOn, 6);
    expect(pinchOff).toBeCloseTo(DEFAULT_SETTINGS.pinchOff, 6);
  });

  it("does not read a relaxed hand at a distance as a grab", () => {
    /**
     * The failure this exists for, stated as narrowly as it is true. A *wide
     * open* hand never falls under 0.035 at any plausible distance — I claimed
     * it did while writing this and the arithmetic says otherwise. What does
     * happen is the far commoner pose: a hand resting with the fingers loosely
     * curled, thumb near the index, at 0.8 of its own span. Small in frame that
     * is 0.032 — inside the fixed threshold — so the machine reports a grab
     * nobody made and the scene follows every idle movement. Rule 2 in one
     * number, and it is a resting hand rather than an open one.
     */
    const distant = handAt(0.04, 0.8);       // relaxed, and small in frame
    const fixed = new SpatialInteractionMachine({ adaptiveThresholds: false });
    const adaptive = new SpatialInteractionMachine();

    const withFixed = fixed.step({ timestamp: 0, hands: [distant] });
    const withAdaptive = adaptive.step({ timestamp: 0, hands: [distant] });

    expect(withFixed.events).toContain("gesture_grab_started");
    expect(withAdaptive.events).not.toContain("gesture_grab_started");
  });

  it("still registers a real pinch from someone leaning close", () => {
    /**
     * The mirror failure. A large hand in frame pinches to 0.045 — fingers
     * genuinely touching — and the fixed threshold refuses it, so the feature
     * does nothing at all with no explanation anywhere on screen.
     */
    const close = handAt(0.25, 0.18);        // pinched, but large in frame
    const fixed = new SpatialInteractionMachine({ adaptiveThresholds: false });
    const adaptive = new SpatialInteractionMachine();

    expect(fixed.step({ timestamp: 0, hands: [close] }).events)
      .not.toContain("gesture_grab_started");
    expect(adaptive.step({ timestamp: 0, hands: [close] }).events)
      .toContain("gesture_grab_started");
  });

  it("falls back to the absolute numbers when the span is implausible", () => {
    /**
     * A badly tracked frame reporting a 0.001 span would otherwise scale the
     * threshold to 0.00035, which no pinch can satisfy — the feature would go
     * dead for the rest of the session, which is the exact failure this file
     * exists to prevent, reintroduced by the fix for it.
     */
    const broken = scaleThresholds(handAt(0.001, 1), DEFAULT_SETTINGS);
    const huge = scaleThresholds(handAt(0.9, 1), DEFAULT_SETTINGS);

    expect(broken.pinchOn).toBe(DEFAULT_SETTINGS.pinchOn);
    expect(huge.pinchOn).toBe(DEFAULT_SETTINGS.pinchOn);
  });

  it("can be switched off, because a researcher may have tuned the numbers", () => {
    const off = scaleThresholds(handAt(0.25, 1),
                                { ...DEFAULT_SETTINGS, adaptiveThresholds: false });

    expect(off.pinchOn).toBe(DEFAULT_SETTINGS.pinchOn);
  });

  it("keeps hysteresis at every hand size", () => {
    /**
     * §16's guarantee has to survive the scaling. If the two thresholds
     * converged at some size, a hand hovering near the boundary would flicker in
     * and out several times a second at that distance and nowhere else — the
     * hardest kind of bug to report.
     */
    for (const span of [0.04, 0.08, 0.1, 0.16, 0.3, 0.55]) {
      const { pinchOn, pinchOff } = scaleThresholds(handAt(span, 1), DEFAULT_SETTINGS);
      expect(pinchOff, `span ${span}`).toBeGreaterThan(pinchOn);
    }
  });
});

// ---------------------------------------------------------------------------
// Explicit calibration
// ---------------------------------------------------------------------------

function feed(manager: CalibrationManager, ratio: number, count = 12,
              jitter = 0): void {
  for (let i = 0; i < count; i += 1) {
    const wobble = jitter * Math.sin(i);
    manager.sample(handAt(0.12, ratio + wobble));
  }
}

describe("calibrating from two poses", () => {
  it("places the thresholds between what was actually measured", () => {
    const manager = new CalibrationManager();
    feed(manager, 2.0);              // open
    manager.advance();
    feed(manager, 0.2);              // pinched
    const result = manager.finish();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Strictly inside the measured range: at the open value an idle hand grabs,
    // at the pinched value the grab only registers once the fingers touch.
    expect(result.settings.pinchRatioOn).toBeGreaterThan(result.pinchSpan);
    expect(result.settings.pinchRatioOff).toBeLessThan(result.openSpan);
    expect(result.settings.pinchRatioOff)
      .toBeGreaterThan(result.settings.pinchRatioOn);
  });

  it("produces settings the machine accepts and acts on", () => {
    /**
     * A calibration screen that produces numbers nothing consumes is theatre.
     * The result is fed straight back and the same hand is then read correctly.
     */
    const manager = new CalibrationManager();
    feed(manager, 1.8);
    manager.advance();
    feed(manager, 0.25);
    const result = manager.finish();
    if (!result.ok) throw new Error("calibration should have succeeded");

    const machine = new SpatialInteractionMachine(result.settings);
    const events = machine.step({ timestamp: 0, hands: [handAt(0.12, 0.25)] }).events;

    expect(events).toContain("gesture_grab_started");
  });

  it("refuses when the two poses did not separate", () => {
    /**
     * The important refusal. Two attempts at the same pose, seen through noise,
     * would yield a threshold sitting inside the noise — the researcher would
     * leave the screen believing they were set up, and blame the tracking for
     * the rest of the session. Saying no here is the kinder answer.
     */
    const manager = new CalibrationManager();
    feed(manager, 0.30);
    manager.advance();
    feed(manager, 0.29);
    const result = manager.finish();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-separation");
    // And says what to do differently, rather than that something went wrong.
    expect(result.message).toMatch(/open your hand wide/i);
  });

  it("refuses when the hand was moving during a pose", () => {
    const manager = new CalibrationManager();
    feed(manager, 2.0, 12, 1.4);     // never held still
    manager.advance();
    feed(manager, 0.2);
    const result = manager.finish();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unstable");
  });

  it("refuses on too few samples rather than averaging three frames", () => {
    const manager = new CalibrationManager();
    feed(manager, 2.0, 3);
    manager.advance();
    feed(manager, 0.2, 3);
    const result = manager.finish();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("too-few-samples");
  });

  it("is not thrown off by one frame where the tracker lost a fingertip", () => {
    /**
     * The reason the samples are reduced with a median rather than a mean. One
     * lost fingertip produces an outlier large enough to move a mean past the
     * separation being measured — so a good calibration would be rejected, or a
     * bad one accepted, on the strength of a single bad frame.
     */
    const manager = new CalibrationManager();
    feed(manager, 2.0);
    manager.sample(handAt(0.12, 40));       // fingertip flew off
    manager.advance();
    feed(manager, 0.2);
    manager.sample(handAt(0.12, 60));
    const result = manager.finish();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.openSpan).toBeCloseTo(2.0, 1);
    expect(result.pinchSpan).toBeCloseTo(0.2, 1);
  });

  it("ignores frames with no measurable hand rather than recording zeroes", () => {
    const manager = new CalibrationManager();
    const collapsed = handAt(0.12, 1);
    collapsed.indexBase = { ...collapsed.wrist };    // span zero

    manager.sample(collapsed);

    expect(manager.progress()).toBe(0);
  });

  it("reports progress through the step it is on", () => {
    const manager = new CalibrationManager();
    expect(manager.current()).toBe("open");
    expect(manager.progress()).toBe(0);

    feed(manager, 2.0, 6);
    expect(manager.progress()).toBeCloseTo(0.5, 6);
    expect(manager.stepComplete()).toBe(false);

    feed(manager, 2.0, 6);
    expect(manager.stepComplete()).toBe(true);

    manager.advance();
    // The second step starts empty rather than inheriting the first's progress.
    expect(manager.current()).toBe("pinch");
    expect(manager.progress()).toBe(0);
  });

  it("can be started over after a refusal", () => {
    /** A researcher told to try again has to be able to. */
    const manager = new CalibrationManager();
    feed(manager, 0.3);
    manager.advance();
    feed(manager, 0.29);
    expect(manager.finish().ok).toBe(false);

    manager.reset();
    expect(manager.current()).toBe("open");
    feed(manager, 2.0);
    manager.advance();
    feed(manager, 0.2);

    expect(manager.finish().ok).toBe(true);
  });
});
