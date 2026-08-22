/**
 * Whether the system can tell intention from movement.
 *
 * §37 sets reliability targets — 95% recognition of intentional gestures,
 * false actions "extremely rare" — and those are the sort of numbers that
 * usually get asserted after a good demo. They can be measured here instead,
 * because the machine is pure: synthetic landmark streams exercise every
 * threshold with no camera, no lighting and no human.
 *
 * The tests are weighted deliberately towards *not acting*. A missed gesture
 * costs a repeat; a false one costs the researcher's confidence in the result
 * they were looking at, and there is no undo for that.
 */

import { describe, expect, it } from "vitest";
import { SpatialInteractionMachine } from "@/lib/spatial/machine";
import { Hand, HandFrame } from "@/lib/spatial/types";

/** A hand with everything at a known place, so each test moves one thing. */
function hand(options: Partial<Hand> & { pinch?: number; at?: { x: number; y: number } } = {}): Hand {
  const at = options.at ?? { x: 0.5, y: 0.5 };
  const pinch = options.pinch ?? 0.2;   // wide open unless asked otherwise
  return {
    handedness: "right",
    confidence: 0.95,
    wrist: { x: at.x, y: at.y + 0.15 },
    thumbTip: { x: at.x - pinch / 2, y: at.y },
    indexTip: { x: at.x + pinch / 2, y: at.y },
    // Curled by default: closer to the wrist than the index tip, so a resting
    // hand is not read as pointing.
    middleTip: { x: at.x, y: at.y + 0.12 },
    ringTip: { x: at.x, y: at.y + 0.13 },
    pinkyTip: { x: at.x, y: at.y + 0.14 },
    // Wrist to index base is 0.10 — deliberately `REFERENCE_SPAN`, the hand size
    // the absolute defaults were written against. Thresholds are now scaled to
    // the hand in frame, so a fixture of any other size would make the numbers
    // quoted throughout this file (`pinchOn (0.035)`) untrue of the hand being
    // tested, and the hysteresis tests would be describing a band that is not
    // where they say it is. The scaling itself is tested in `spatial-calibration`.
    indexBase: { x: at.x, y: at.y + 0.05 },
    palmCenter: { x: at.x, y: at.y },
    ...options,
  };
}

function pointingHand(at = { x: 0.5, y: 0.5 }): Hand {
  return hand({
    at,
    // Index extended well beyond the curled fingers.
    indexTip: { x: at.x, y: at.y - 0.25 },
    middleTip: { x: at.x, y: at.y + 0.12 },
    ringTip: { x: at.x, y: at.y + 0.13 },
    pinkyTip: { x: at.x, y: at.y + 0.14 },
    thumbTip: { x: at.x - 0.12, y: at.y },
  });
}

function frames(machine: SpatialInteractionMachine, hands: Hand[][], startAt = 0) {
  const results = hands.map((set, index) =>
    machine.step({ timestamp: startAt + index * 33, hands: set } as HandFrame));
  return {
    results,
    commands: results.flatMap((r) => r.commands),
    events: results.flatMap((r) => r.events),
    last: results[results.length - 1],
  };
}

/** A pinched hand, held closed. */
const grabbing = (at: { x: number; y: number }) => hand({ at, pinch: 0.02 });

describe("a hand that is merely visible", () => {
  it("does not move the visualization", () => {
    /**
     * The rule the entire feature rests on (§17, Rule 2). A professor
     * explaining a result waves their hand across the whole frame; if that
     * turns the graph, the feature is hostile at exactly the moment it was
     * supposed to help.
     */
    const machine = new SpatialInteractionMachine();
    const wave = [0.2, 0.4, 0.6, 0.8, 0.6, 0.4].map((x) => [hand({ at: { x, y: 0.5 } })]);

    const { commands } = frames(machine, wave);

    expect(commands.filter((c) => c.kind === "rotate")).toEqual([]);
    expect(commands.filter((c) => c.kind === "zoom")).toEqual([]);
  });

  it("reaches READY but goes no further on its own", () => {
    const machine = new SpatialInteractionMachine();
    const { last } = frames(machine, [[hand()], [hand()]]);
    expect(last.state).toBe("READY");
  });
});

describe("pinch as a clutch", () => {
  it("rotates only while the pinch is held", () => {
    const machine = new SpatialInteractionMachine();
    const { commands } = frames(machine, [
      [hand({ at: { x: 0.5, y: 0.5 } })],           // open
      [grabbing({ x: 0.5, y: 0.5 })],               // pinch: origin
      [grabbing({ x: 0.6, y: 0.5 })],               // move while pinched
      [grabbing({ x: 0.7, y: 0.5 })],
    ]);

    expect(commands.filter((c) => c.kind === "rotate").length).toBeGreaterThan(0);
  });

  it("stops the instant the pinch is released", () => {
    /** Release is mouse-up. Movement after it is a hand going back to rest. */
    const machine = new SpatialInteractionMachine();
    frames(machine, [
      [hand()], [grabbing({ x: 0.5, y: 0.5 })], [grabbing({ x: 0.6, y: 0.5 })],
    ]);

    const after = frames(machine, [
      [hand({ at: { x: 0.7, y: 0.5 } })],           // released, still moving
      [hand({ at: { x: 0.9, y: 0.5 } })],
    ], 1000);

    expect(after.commands.filter((c) => c.kind === "rotate")).toEqual([]);
    expect(after.last.state).toBe("READY");
  });

  it("does not oscillate at the pinch threshold", () => {
    /**
     * §16. With one threshold, a hand resting near the boundary flickers in and
     * out several times a second — which the researcher sees as the graph
     * convulsing while they hold still.
     */
    const machine = new SpatialInteractionMachine();
    // Between pinchOn (0.035) and pinchOff (0.05): inside the hysteresis band.
    const hovering = [0.04, 0.042, 0.038, 0.045, 0.04]
      .map((pinch) => [hand({ pinch })]);

    const { events } = frames(machine, [[hand({ pinch: 0.2 })], ...hovering]);

    // Never closed, because it never crossed pinchOn.
    expect(events.filter((e) => e === "gesture_grab_started")).toEqual([]);
  });

  it("keeps the grab while the hand drifts back through the band", () => {
    const machine = new SpatialInteractionMachine();
    const { events, last } = frames(machine, [
      [hand({ pinch: 0.2 })],
      [hand({ at: { x: 0.5, y: 0.5 }, pinch: 0.02 })],   // closed
      [hand({ at: { x: 0.5, y: 0.5 }, pinch: 0.045 })],  // drifted into the band
    ]);

    expect(events.filter((e) => e === "gesture_grab_completed")).toEqual([]);
    expect(last.state).toBe("GRABBED");
  });
});

describe("holding still", () => {
  it("emits nothing for tremor-sized movement", () => {
    /**
     * §15, and the answer to §51's "does the graph remain stable when the
     * user's hand is stable". Scaling small movement down is not enough — it
     * still drifts, and drift is what ends trust.
     */
    const machine = new SpatialInteractionMachine();
    const tremor = [0.5, 0.5008, 0.4994, 0.5006, 0.4998]
      .map((x) => [grabbing({ x, y: 0.5 })]);

    const { commands } = frames(machine, [[hand()], ...tremor]);

    expect(commands.filter((c) => c.kind === "rotate")).toEqual([]);
  });
});

describe("tracking failures", () => {
  it("survives a single dropped frame mid-gesture", () => {
    /** One blink is normal. Ending the rotation on it would be unusable. */
    const machine = new SpatialInteractionMachine();
    const { last } = frames(machine, [
      [hand()],
      [grabbing({ x: 0.5, y: 0.5 })],
      [],                                    // dropped
      [grabbing({ x: 0.55, y: 0.5 })],
    ]);

    expect(last.state).toBe("GRABBED");
  });

  it("releases everything when tracking is really lost", () => {
    /**
     * §32. A hand leaving the frame must not become a spin — nothing is
     * extrapolated across a gap.
     */
    const machine = new SpatialInteractionMachine();
    const { events, last } = frames(machine, [
      [hand()],
      [grabbing({ x: 0.5, y: 0.5 })],
      [], [], [], [],                        // past the grace window
    ]);

    expect(events).toContain("tracking_lost");
    expect(events).toContain("gesture_cancelled");
    expect(last.state).toBe("TRACKING_LOST");
  });

  it("does not resume mid-gesture when the hand comes back far away", () => {
    /**
     * Returning to a grabbed state would apply the distance the hand travelled
     * while invisible as one rotation.
     *
     * Note this passes on the spike guard alone — 0.5 to 0.9 is further than a
     * hand can move between frames — so it does *not* prove the gesture was
     * released. The test below is the one that proves that.
     */
    const machine = new SpatialInteractionMachine();
    frames(machine, [[hand()], [grabbing({ x: 0.5, y: 0.5 })], [], [], [], []]);

    const back = frames(machine, [[grabbing({ x: 0.9, y: 0.9 })]], 5000);

    expect(back.commands.filter((c) => c.kind === "rotate")).toEqual([]);
  });

  it("releases the pinch on loss, not merely the position", () => {
    /**
     * The property §32 actually asks for, isolated.
     *
     * This exists because removing `releaseEverything()` from the loss path
     * failed nothing: every test that should have caught it returned the hand
     * *far* from where it vanished, so the spike guard rejected the movement
     * and the outcome looked correct while the gesture was still live
     * underneath. Two independent defences, and no test could tell which one
     * was doing the work.
     *
     * So the hand comes back a plausible distance away — beyond the dead zone,
     * well inside the spike threshold. Nothing but a genuine release can stop a
     * rotation here, and the state must be a fresh grab rather than a resumed
     * one.
     */
    const machine = new SpatialInteractionMachine();
    frames(machine, [[hand()], [grabbing({ x: 0.5, y: 0.5 })], [], [], [], []]);

    const back = frames(machine, [
      [grabbing({ x: 0.52, y: 0.5 })],
      [grabbing({ x: 0.54, y: 0.5 })],
    ], 5000);

    expect(back.results[0].commands.filter((c) => c.kind === "rotate")).toEqual([]);
    expect(back.results[0].events).toContain("gesture_grab_started");
  });

  it("ignores hands the tracker is not confident about", () => {
    /** §31 — reliability over responsiveness. */
    const machine = new SpatialInteractionMachine();
    const unsure = [hand({ at: { x: 0.5, y: 0.5 }, pinch: 0.02, confidence: 0.3 })];

    const { commands, last } = frames(machine, [unsure, unsure]);

    expect(commands).toEqual([]);
    expect(last.state).not.toBe("GRABBED");
  });

  it("discards a tracking spike rather than rotating by it", () => {
    /**
     * A landmark teleporting across the frame is the tracker changing its mind
     * — often to a different person (§31). Passed through it is an enormous
     * rotation from a hand that never moved.
     *
     * Asserted as *no command at all* on the spike frame, not as a small one.
     * The first version allowed anything under 0.5 and passed with spike
     * rejection deleted, because the One Euro filter damps a single jump on its
     * own — two mechanisms, and a bound loose enough that either could satisfy
     * it. Only the guard can make the frame silent.
     */
    const machine = new SpatialInteractionMachine();
    const { results } = frames(machine, [
      [hand()],
      [grabbing({ x: 0.5, y: 0.5 })],
      [grabbing({ x: 0.52, y: 0.5 })],
      [grabbing({ x: 0.98, y: 0.05 })],      // impossible in 33ms
    ]);

    const spikeFrame = results[3];
    expect(spikeFrame.commands.filter((c) => c.kind === "rotate")).toEqual([]);
  });
});

describe("two-handed zoom", () => {
  const twoPinched = (span: number) => [
    hand({ at: { x: 0.5 - span / 2, y: 0.5 }, pinch: 0.02 }),
    { ...hand({ at: { x: 0.5 + span / 2, y: 0.5 }, pinch: 0.02 }),
      handedness: "left" as const },
  ];

  it("zooms on relative change, not absolute separation", () => {
    /**
     * §6. Absolute would mean the scene's zoom depended on how far apart the
     * researcher happened to start, which differs every session.
     */
    const machine = new SpatialInteractionMachine();
    const { commands } = frames(machine, [
      twoPinched(0.3), twoPinched(0.4), twoPinched(0.5),
    ]);

    const zooms = commands.filter((c) => c.kind === "zoom");
    expect(zooms.length).toBeGreaterThan(0);
    expect((zooms[0] as { factor: number }).factor).toBeGreaterThan(1);
  });

  it("does not zoom merely because two hands are visible", () => {
    /** Two hands in frame is a person talking. Both pinched is a request. */
    const machine = new SpatialInteractionMachine();
    const open = (span: number) => [
      hand({ at: { x: 0.5 - span / 2, y: 0.5 } }),
      { ...hand({ at: { x: 0.5 + span / 2, y: 0.5 } }), handedness: "left" as const },
    ];

    const { commands } = frames(machine, [open(0.3), open(0.5), open(0.7)]);

    expect(commands.filter((c) => c.kind === "zoom")).toEqual([]);
  });

  it("cannot zoom the scene out of existence", () => {
    /** §32 — safe limits on every transformation. */
    const machine = new SpatialInteractionMachine({ maxScale: 2 });
    const widening = Array.from({ length: 40 },
      (_, i) => twoPinched(0.1 + i * 0.02));

    const { commands } = frames(machine, widening);

    const total = commands
      .filter((c) => c.kind === "zoom")
      .reduce((product, c) => product * (c as { factor: number }).factor, 1);
    expect(total).toBeLessThanOrEqual(2.0001);
  });
});

describe("pointing and selection", () => {
  it("does not hover on a hand passing through a pointing shape", () => {
    /** §17 — sustained intent, not an instantaneous pose. */
    const machine = new SpatialInteractionMachine({ pointingHoldFrames: 3 });
    const { commands } = frames(machine, [[hand()], [pointingHand()]]);

    expect(commands.filter((c) => c.kind === "hover")).toEqual([]);
  });

  it("hovers once pointing is sustained", () => {
    const machine = new SpatialInteractionMachine({ pointingHoldFrames: 3 });
    const { commands, last } = frames(machine, [
      [hand()], [pointingHand()], [pointingHand()], [pointingHand()],
    ]);

    expect(commands.filter((c) => c.kind === "hover").length).toBeGreaterThan(0);
    expect(last.state).toBe("POINTING");
  });

  it("turns a pinch while pointing into a selection, not a grab", () => {
    /** §8. The two gestures share a pinch; what precedes it decides meaning. */
    const machine = new SpatialInteractionMachine({ pointingHoldFrames: 2 });
    const { commands, events } = frames(machine, [
      [hand()], [pointingHand()], [pointingHand()],
      [{ ...pointingHand(), thumbTip: { x: 0.5, y: 0.26 } }],   // pinched
    ]);

    expect(commands.some((c) => c.kind === "select")).toBe(true);
    expect(events).toContain("gesture_selection_completed");
    expect(events).not.toContain("gesture_grab_started");
  });
});

describe("staying out of the way", () => {
  it("emits nothing at all while paused", () => {
    /** Rule 5 — conventional controls must always be reachable. */
    const machine = new SpatialInteractionMachine();
    machine.pause();

    const { commands, last } = frames(machine, [
      [grabbing({ x: 0.5, y: 0.5 })], [grabbing({ x: 0.9, y: 0.5 })],
    ]);

    expect(commands).toEqual([]);
    expect(last.state).toBe("PAUSED");
  });

  it("comes back cleanly after a pause", () => {
    const machine = new SpatialInteractionMachine();
    machine.pause();
    machine.resume();

    const { last } = frames(machine, [[hand()], [hand()]]);
    expect(last.state).toBe("READY");
  });
});

describe("a second hand that is merely in shot", () => {
  /**
   * The failure that presents as the whole feature being broken.
   *
   * MediaPipe reports a second hand whenever any part of one is in frame:
   * resting on the desk, holding a pen, halfway out of shot. Every such frame
   * went down the two-handed path, and zoom requires *both* pinched — so a
   * single-handed pinch-and-rotate did nothing at all, silently. The researcher
   * pinches, nothing moves, and there is no way to tell that the reason is a
   * hand they were not using.
   *
   * §17's point is that visibility is not intent. That cuts both ways, and the
   * first version only applied it in one direction.
   */
  it("still rotates with one hand while the other rests in frame", () => {
    const machine = new SpatialInteractionMachine();
    const resting = hand({ at: { x: 0.15, y: 0.8 }, pinch: 0.2 });

    const { events, commands, last } = frames(machine, [
      [hand({ at: { x: 0.5, y: 0.5 }, pinch: 0.2 }), resting],
      [hand({ at: { x: 0.5, y: 0.5 }, pinch: 0.02 }), resting],
      // Two frames of movement, not one: the frame the pinch closes on is the
      // origin, so the first delta only exists on the frame after it.
      [hand({ at: { x: 0.56, y: 0.5 }, pinch: 0.02 }), resting],
      [hand({ at: { x: 0.62, y: 0.5 }, pinch: 0.02 }), resting],
    ]);

    expect(events).toContain("gesture_grab_started");
    expect(last.state).toBe("GRABBED");
    expect(commands.some((c) => c.kind === "rotate")).toBe(true);
  });

  it("prefers the pinched hand, whichever it is", () => {
    /** Nobody pinches by accident — that is the premise of the clutch, so a
     * pinched hand is the unambiguous answer to "which one is being used". */
    const machine = new SpatialInteractionMachine();

    const { events } = frames(machine, [
      // The *second* hand is the one doing the work.
      [hand({ at: { x: 0.2, y: 0.7 }, pinch: 0.2 }),
       hand({ at: { x: 0.6, y: 0.4 }, pinch: 0.2 })],
      [hand({ at: { x: 0.2, y: 0.7 }, pinch: 0.2 }),
       hand({ at: { x: 0.6, y: 0.4 }, pinch: 0.02 })],
    ]);

    expect(events).toContain("gesture_grab_started");
  });

  it("still zooms when both hands are genuinely pinched", () => {
    /** The fallthrough must not have cost the two-handed gesture. */
    const machine = new SpatialInteractionMachine();

    const { events } = frames(machine, [
      [hand({ at: { x: 0.35, y: 0.5 }, pinch: 0.02 }),
       hand({ at: { x: 0.65, y: 0.5 }, pinch: 0.02 })],
      [hand({ at: { x: 0.25, y: 0.5 }, pinch: 0.02 }),
       hand({ at: { x: 0.75, y: 0.5 }, pinch: 0.02 })],
    ]);

    expect(events).toContain("gesture_zoom_started");
  });

  it("does not act on two open hands", () => {
    /** Rule 2 still holds: a professor gesturing while talking has two hands in
     * frame constantly, and none of it may move the scene. */
    const machine = new SpatialInteractionMachine();

    const { last } = frames(machine, [
      [hand({ at: { x: 0.3, y: 0.5 }, pinch: 0.2 }),
       hand({ at: { x: 0.7, y: 0.5 }, pinch: 0.2 })],
      [hand({ at: { x: 0.4, y: 0.6 }, pinch: 0.2 }),
       hand({ at: { x: 0.8, y: 0.4 }, pinch: 0.2 })],
    ]);

    expect(last.commands.filter((c) => c.kind === "rotate")).toEqual([]);
  });
});
