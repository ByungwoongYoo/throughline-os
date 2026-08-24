/**
 * Reading a mark as a shape (§181), and refusing to when it is not one (§174).
 *
 * The failure worth guarding is not "it fails to recognise a circle". It is
 * "it recognises everything": a recogniser that always returns its best guess
 * turns a deliberately irregular boundary into an ellipse, and the researcher
 * gets back a tidier version of something they did not draw.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_CONFIDENCE, cornersOf, describeShape, recognise,
} from "@/lib/ink/shapes";
import { StrokePoint } from "@/lib/ink/stroke";
import { InkRecorder } from "@/lib/ink/recorder";
import { Hand, HandFrame } from "@/lib/spatial/types";

function hand(at: { x: number; y: number }, pinch: number): Hand {
  const span = 0.1;
  return {
    handedness: "right", confidence: 0.95,
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

function points(raw: Array<{ x: number; y: number }>): StrokePoint[] {
  return raw.map((p, i) => ({ ...p, timestamp: 1000 + i * 33, confidence: 0.9 }));
}

/** A hand-drawn version: the ideal shape with a little wobble on it. */
function wobble(raw: Array<{ x: number; y: number }>, amount: number) {
  return points(raw.map((p, i) => ({
    x: p.x + Math.sin(i * 2.399) * amount,
    y: p.y + Math.cos(i * 3.117) * amount,
  })));
}

const circle = (cx: number, cy: number, r: number, n = 32) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r };
  });

const straight = (n = 20) =>
  Array.from({ length: n }, (_, i) => ({ x: 100 + i * 15, y: 200 }));

describe("a mark that is a shape", () => {
  it("reads a drawn circle as a circle", () => {
    const shape = recognise(wobble(circle(300, 300, 120), 4));
    expect(shape?.kind).toBe("circle");
    expect(shape!.confidence).toBeGreaterThan(MIN_CONFIDENCE);
  });

  it("reads a drawn line as a line", () => {
    const shape = recognise(wobble(straight(), 3));
    expect(shape?.kind).toBe("line");
  });

  it("reads a stretched loop as an ellipse, not a circle", () => {
    const stretched = circle(300, 300, 100).map((p) => ({ x: p.x, y: 300 + (p.y - 300) * 0.4 }));
    const shape = recognise(wobble(stretched, 3));
    expect(shape?.kind).toBe("ellipse");
  });

  it("reads a drawn box as a rectangle", () => {
    const box = [
      ...Array.from({ length: 10 }, (_, i) => ({ x: 100 + i * 20, y: 100 })),
      ...Array.from({ length: 8 }, (_, i) => ({ x: 280, y: 100 + i * 15 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 280 - i * 20, y: 205 })),
      ...Array.from({ length: 8 }, (_, i) => ({ x: 100, y: 205 - i * 15 })),
    ];
    expect(recognise(wobble(box, 2))?.kind).toBe("rectangle");
  });

  it("keeps a rotated rectangle rotated", () => {
    /**
     * Axis-aligned to the *drawing*, not to the screen. A researcher sketching
     * a region on a rotated figure draws a rotated rectangle, and snapping it
     * upright would move the annotation off what it was drawn around.
     */
    const box = [
      ...Array.from({ length: 10 }, (_, i) => ({ x: i * 20, y: 0 })),
      ...Array.from({ length: 8 }, (_, i) => ({ x: 180, y: i * 12 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 180 - i * 20, y: 84 })),
      ...Array.from({ length: 8 }, (_, i) => ({ x: 0, y: 84 - i * 12 })),
    ];
    const turned = box.map(({ x, y }) => ({
      x: 300 + x * Math.cos(0.6) - y * Math.sin(0.6),
      y: 300 + x * Math.sin(0.6) + y * Math.cos(0.6),
    }));
    const shape = recognise(wobble(turned, 2));

    expect(shape?.kind).toBe("rectangle");
    // The corners are not axis-aligned, so it was not snapped upright.
    const xs = shape!.points.map((p) => p.x);
    expect(new Set(xs.map((x) => Math.round(x))).size).toBeGreaterThan(2);
  });

  it("returns a clean version, not the points that were drawn", () => {
    const drawn = wobble(circle(300, 300, 120), 6);
    const shape = recognise(drawn)!;
    /*
     * Measured from the fit's own centre, and with the closing point dropped.
     *
     * Two fixture mistakes, both of which blamed the fit for the test. The
     * first measured from the centre the fixture was built around, but the fit
     * is centred on the drawn points, which a wobble shifts. The second
     * averaged all the returned points — and a closed path repeats its first
     * point at the end, so that duplicate pulls the centroid off by r/n and
     * doubles into the spread.
     */
    const ring = shape.points.slice(0, -1);
    const centre = ring.reduce(
      (a, p) => ({ x: a.x + p.x / ring.length, y: a.y + p.y / ring.length }),
      { x: 0, y: 0 });
    const radii = ring.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y));

    // Every point the same distance out: the wobble is gone from the offer.
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1);
  });
});

describe("a mark that is not a shape", () => {
  it("refuses a scribble rather than naming the least-bad fit", () => {
    /**
     * The failure this whole module is written around. A recogniser that always
     * answers turns every mark into whichever shape it resembles least badly.
     */
    const scribble = points(Array.from({ length: 40 }, (_, i) => ({
      x: 200 + Math.sin(i * 1.7) * 90 + Math.cos(i * 0.6) * 40,
      y: 200 + Math.cos(i * 2.3) * 70 + Math.sin(i * 1.1) * 50,
    })));
    expect(recognise(scribble)).toBeNull();
  });

  it("leaves a deliberately irregular boundary alone", () => {
    /**
     * §174, as the case it exists for. A researcher who drew an irregular
     * boundary around a cluster meant that boundary, and a system that offers a
     * tidy ellipse has misread what they said.
     */
    const lumpy = circle(300, 300, 120).map((p, i) => {
      const k = 1 + (i % 7 === 0 ? 0.35 : 0);      // deliberate lobes
      return { x: 300 + (p.x - 300) * k, y: 300 + (p.y - 300) * k };
    });
    expect(recognise(points(lumpy))).toBeNull();
  });

  it("says nothing about a mark too short to have a shape", () => {
    expect(recognise(points([{ x: 0, y: 0 }, { x: 10, y: 10 }]))).toBeNull();
  });

  it("says nothing about a mark with no extent at all", () => {
    const still = points(Array.from({ length: 20 }, () => ({ x: 50, y: 50 })));
    expect(recognise(still)).toBeNull();
  });
});

describe("what the researcher is asked", () => {
  it("offers rather than applies, and says the original is kept", () => {
    // §197: an interpretation that changes what somebody drew is a question.
    const shape = recognise(wobble(circle(300, 300, 120), 4));
    const sentence = describeShape(shape);

    expect(sentence).toMatch(/tidy it\?/i);
    expect(sentence).toMatch(/what you drew is kept/i);
  });

  it("says plainly when there is nothing to offer", () => {
    expect(describeShape(null)).toMatch(/stay as drawn/i);
  });
});

describe("the threshold is doing work", () => {
  it("would accept the irregular boundary if it were lowered", () => {
    /**
     * Stated so the constant is shown to matter rather than assumed to. A
     * threshold that nothing ever fails is not a threshold.
     */
    const lumpy = circle(300, 300, 120).map((p, i) => {
      const k = 1 + (i % 7 === 0 ? 0.35 : 0);
      return { x: 300 + (p.x - 300) * k, y: 300 + (p.y - 300) * k };
    });
    expect(recognise(points(lumpy))).toBeNull();
    expect(recognise(points(lumpy), 0.1)).not.toBeNull();
  });
});

describe("the shapes a researcher actually draws", () => {
  it("reads a triangle as a three-sided shape", () => {
    const triangle = [
      ...Array.from({ length: 14 }, (_, i) => ({ x: 100 + i * 14, y: 300 })),
      ...Array.from({ length: 14 }, (_, i) => ({ x: 296 - i * 7, y: 300 - i * 12 })),
      ...Array.from({ length: 14 }, (_, i) => ({ x: 198 - i * 7, y: 132 + i * 12 })),
    ];
    const shape = recognise(wobble(triangle, 2));
    expect(shape?.kind).toBe("polygon");
    expect(shape!.description).toContain("3-sided");
  });

  it("keeps the shape of the region rather than regularising it", () => {
    /**
     * A researcher sketching a region draws the shape of the region. Snapping it
     * to a regular polygon would move the annotation off what it surrounds,
     * which is §174's concern in a different costume.
     */
    /*
     * A five-sided region with sides of obviously different lengths.
     *
     * Deliberately not a wonky quadrilateral: four near-right corners is a
     * rectangle, `asRectangle` claims it, and the test would then be measuring
     * that preference rather than the thing it is about.
     */
    const wonky = [
      ...Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 20, y: 300 })),
      ...Array.from({ length: 8 }, (_, i) => ({ x: 340 + i * 6, y: 300 - i * 18 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 388 - i * 14, y: 156 - i * 9 })),
      ...Array.from({ length: 6 }, (_, i) => ({ x: 248 - i * 22, y: 66 + i * 5 })),
      ...Array.from({ length: 12 }, (_, i) => ({ x: 116 - i * 2, y: 96 + i * 17 })),
    ];
    const shape = recognise(wobble(wonky, 2));
    expect(shape?.kind).toBe("polygon");

    // The corners are where the mark turned, not on a regular figure.
    const sides = shape!.points.slice(0, -1).map((p, i, all) => {
      const next = all[(i + 1) % all.length];
      return Math.hypot(next.x - p.x, next.y - p.y);
    });
    expect(Math.max(...sides) / Math.min(...sides)).toBeGreaterThan(1.2);
  });

  it("reads an arrow as an arrow", () => {
    const arrow = [
      ...Array.from({ length: 24 }, (_, i) => ({ x: 100 + i * 12, y: 200 })),
      // A barb turned back from the tip.
      ...Array.from({ length: 7 }, (_, i) => ({ x: 376 - i * 8, y: 200 - i * 6 })),
    ];
    expect(recognise(wobble(arrow, 1.5))?.kind).toBe("arrow");
  });

  it("does not call a line with a stopping flick an arrow", () => {
    /**
     * A hand that stops moving leaves a small hook. Offering an arrow every time
     * somebody drew a line would be the recognise-everything failure again, in
     * the one shape where it changes what the annotation means.
     */
    const flicked = [
      ...Array.from({ length: 26 }, (_, i) => ({ x: 100 + i * 12, y: 200 })),
      ...Array.from({ length: 3 }, (_, i) => ({ x: 410 - i * 2, y: 200 - i * 2 })),
    ];
    expect(recognise(wobble(flicked, 1))?.kind).not.toBe("arrow");
  });

  it("reads a bracket as a bracket", () => {
    const bracket = [
      ...Array.from({ length: 8 }, (_, i) => ({ x: 200 - i * 10, y: 100 })),
      ...Array.from({ length: 16 }, (_, i) => ({ x: 130, y: 100 + i * 12 })),
      ...Array.from({ length: 8 }, (_, i) => ({ x: 130 + i * 10, y: 292 })),
    ];
    expect(recognise(wobble(bracket, 1.5))?.kind).toBe("bracket");
  });

  it("does not call a zigzag a bracket", () => {
    // Both ends must leave the spine on the same side. Without that test, any
    // mark that changed direction twice would be offered as a bracket.
    const zigzag = [
      ...Array.from({ length: 8 }, (_, i) => ({ x: 200 - i * 10, y: 100 })),
      ...Array.from({ length: 16 }, (_, i) => ({ x: 130, y: 100 + i * 12 })),
      ...Array.from({ length: 8 }, (_, i) => ({ x: 130 - i * 10, y: 292 })),
    ];
    expect(recognise(wobble(zigzag, 1.5))?.kind).not.toBe("bracket");
  });

  it("draws an arrow with two barbs, which is what people mean by one", () => {
    const arrow = [
      ...Array.from({ length: 24 }, (_, i) => ({ x: 100 + i * 12, y: 200 })),
      ...Array.from({ length: 7 }, (_, i) => ({ x: 376 - i * 8, y: 200 - i * 6 })),
    ];
    const shape = recognise(wobble(arrow, 1.5))!;
    // Shaft, tip, barb, back to tip, other barb.
    expect(shape.points).toHaveLength(5);
  });
});

describe("finding where a mark turns", () => {
  it("finds no corner along a line somebody drew straight", () => {
    /**
     * Measured over a window rather than between adjacent points. Consecutive
     * samples from a hand are a couple of pixels apart and their angle is almost
     * entirely tremor, so a per-point turn finds a corner every few samples.
     */
    expect(cornersOf(wobble(straight(30), 2))).toEqual([]);
  });

  it("finds one corner where a mark turns once", () => {
    const bent = [
      ...Array.from({ length: 14 }, (_, i) => ({ x: 100 + i * 14, y: 200 })),
      ...Array.from({ length: 14 }, (_, i) => ({ x: 296, y: 200 + i * 14 })),
    ];
    expect(cornersOf(wobble(bent, 1.5))).toHaveLength(1);
  });

  it("finds no corner anywhere on a smooth closed loop", () => {
    /**
     * A circle has no corners, and that is the property that shows the cyclic
     * walk is genuine rather than incidental.
     *
     * Counting corners on a square cannot tell the two apart: clamping the
     * indices at the ends fabricates a turn at the final point — comparing a
     * real heading against a zero-length step — so a square comes back with
     * four either way, one of them an artefact. On a smooth loop the artefact
     * has nothing to hide behind, and clamping invents a corner where the mark
     * plainly has none.
     */
    const loop = Array.from({ length: 48 }, (_, i) => {
      const t = (i / 48) * Math.PI * 2;
      return { x: 300 + Math.cos(t) * 120, y: 300 + Math.sin(t) * 120 };
    });
    expect(cornersOf(loop)).toEqual([]);
  });

  it("finds the corner sitting on the seam of a closed mark", () => {
    /**
     * The case that made a triangle read as a circle. A closed mark ends where
     * it began, and the corner at that join has no neighbours on one side — so
     * a walk that stops `window` points from each end never sees it. Every
     * closed polygon has a corner at its seam roughly a third of the time, so
     * this was not an edge case.
     *
     * Pinned as its own property because the triangle happens to pass without
     * it: clamping the indices instead of wrapping fabricates a turn at index 0,
     * which is the right answer for the wrong reason.
     */
    const side = (from: { x: number; y: number }, to: { x: number; y: number }) =>
      Array.from({ length: 10 }, (_, i) => ({
        x: from.x + ((to.x - from.x) * i) / 10,
        y: from.y + ((to.y - from.y) * i) / 10,
      }));

    // A square whose stroke *starts at a corner*, so one corner is on the seam.
    const atCorner = [
      ...side({ x: 100, y: 100 }, { x: 300, y: 100 }),
      ...side({ x: 300, y: 100 }, { x: 300, y: 300 }),
      ...side({ x: 300, y: 300 }, { x: 100, y: 300 }),
      ...side({ x: 100, y: 300 }, { x: 100, y: 100 }),
    ];
    expect(cornersOf(wobble(atCorner, 1))).toHaveLength(4);

    // And the same square drawn from the middle of an edge, where every corner
    // is safely inside the walk. Both must agree.
    const midEdge = [
      ...side({ x: 200, y: 100 }, { x: 300, y: 100 }),
      ...side({ x: 300, y: 100 }, { x: 300, y: 300 }),
      ...side({ x: 300, y: 300 }, { x: 100, y: 300 }),
      ...side({ x: 100, y: 300 }, { x: 100, y: 100 }),
      ...side({ x: 100, y: 100 }, { x: 200, y: 100 }),
    ];
    expect(cornersOf(wobble(midEdge, 1))).toHaveLength(4);
  });

  it("treats a rounded corner as one corner, not a run of them", () => {
    // A real corner is rounded by the hand and by smoothing, and shows up as a
    // run of turning rather than a spike.
    const rounded = [
      ...Array.from({ length: 14 }, (_, i) => ({ x: 100 + i * 14, y: 200 })),
      ...Array.from({ length: 6 }, (_, i) => {
        const t = (i / 6) * (Math.PI / 2);
        return { x: 296 + Math.sin(t) * 20, y: 200 + 20 - Math.cos(t) * 20 };
      }),
      ...Array.from({ length: 14 }, (_, i) => ({ x: 316, y: 220 + i * 14 })),
    ];
    expect(cornersOf(wobble(rounded, 1))).toHaveLength(1);
  });
});

describe("accepting an offer, and being able to take it back", () => {
  /**
   * §181 offers; §197 makes it a question; §174 requires that saying yes still
   * keeps what the hand did. All three meet here.
   */
  function drawnCircle() {
    const recorder = new InkRecorder({ now: () => 5000 });
    recorder.setViewport({ width: 720, height: 520 });
    recorder.arm();
    let clock = 1000;
    /*
     * A circle *on screen*, which is not a circle in camera space.
     *
     * The canvas is 720x520, so a normalised offset maps to (dx*720, dy*520) —
     * and the first version of this fixture drew an equal-radius loop in
     * normalised units, which lands as a visibly squashed ellipse. The
     * recogniser correctly said "ellipse" and the test blamed it. Compensating
     * for the aspect ratio is what makes "circle" the right expectation.
     */
    const radius = 90;
    const loop = Array.from({ length: 30 }, (_, i) => {
      const t = (i / 29) * Math.PI * 2;
      return { x: 0.5 + (Math.cos(t) * radius) / 720,
               y: 0.5 + (Math.sin(t) * radius) / 520 };
    });
    const steps = [{ at: loop[0], pinch: 0.2 },
                   ...loop.map((at) => ({ at, pinch: 0.02 })),
                   { at: loop[0], pinch: 0.2 }];
    for (const step of steps) {
      recorder.step({ timestamp: clock,
                      hands: [hand(step.at, step.pinch)] } as HandFrame);
      clock += 33;
    }
    return recorder;
  }

  it("reads a finished stroke, after it is finished", () => {
    const recorder = drawnCircle();
    const stroke = recorder.strokes()[0];
    expect(recorder.shapeOf(stroke.id)).not.toBeNull();
  });

  it("does not touch the record when the offer is accepted", () => {
    /**
     * The whole of §174, and the reason a tidy is safe to offer at all. The
     * drawn copy changes; what the hand did does not.
     */
    const recorder = drawnCircle();
    const stroke = recorder.strokes()[0];
    const drawn = stroke.originalPoints;

    recorder.tidy(stroke.id, recorder.shapeOf(stroke.id)!);

    const after = recorder.strokes()[0];
    expect(after.originalPoints).toBe(drawn);
    expect(after.points).not.toBe(drawn);
  });

  it("records that the shape was accepted rather than drawn", () => {
    // So a figure can distinguish a circle somebody drew from one they agreed to.
    const recorder = drawnCircle();
    const stroke = recorder.strokes()[0];
    recorder.tidy(stroke.id, recorder.shapeOf(stroke.id)!);

    expect(recorder.strokes()[0].interpretation?.kind).toBe("circle");
  });

  it("can be taken back, giving the original stroke object", () => {
    const recorder = drawnCircle();
    const stroke = recorder.strokes()[0];
    recorder.tidy(stroke.id, recorder.shapeOf(stroke.id)!);

    expect(recorder.describeUndo()).toBe("Undo tidying into circle");
    expect(recorder.undo()).toBe(true);
    expect(recorder.strokes()[0]).toBe(stroke);
  });

  it("keeps the mark where it was in the drawing order", () => {
    // A tidied mark that jumped on top would paint over things drawn after it.
    const recorder = drawnCircle();
    const first = recorder.strokes()[0].id;
    // A second mark, drawn later.
    let clock = 9000;
    for (const step of [{ x: 0.8, y: 0.8, p: 0.2 }, { x: 0.8, y: 0.8, p: 0.02 },
                        { x: 0.82, y: 0.8, p: 0.02 }, { x: 0.84, y: 0.8, p: 0.02 },
                        { x: 0.84, y: 0.8, p: 0.2 }]) {
      recorder.step({ timestamp: clock,
                      hands: [hand({ x: step.x, y: step.y }, step.p)] } as HandFrame);
      clock += 33;
    }

    recorder.tidy(first, recorder.shapeOf(first)!);
    expect(recorder.strokes()[0].interpretation?.kind).toBe("circle");
    expect(recorder.strokes()).toHaveLength(2);
  });

  it("refuses to tidy a stroke that is not there", () => {
    const recorder = drawnCircle();
    const shape = recorder.shapeOf(recorder.strokes()[0].id)!;
    expect(recorder.tidy("nonexistent", shape)).toBe(false);
  });
});
