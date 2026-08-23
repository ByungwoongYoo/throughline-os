/**
 * Reading a mark as a shape (§181), and refusing to when it is not one (§174).
 *
 * The failure worth guarding is not "it fails to recognise a circle". It is
 * "it recognises everything": a recogniser that always returns its best guess
 * turns a deliberately irregular boundary into an ellipse, and the researcher
 * gets back a tidier version of something they did not draw.
 */

import { describe, expect, it } from "vitest";
import { MIN_CONFIDENCE, describeShape, recognise } from "@/lib/ink/shapes";
import { StrokePoint } from "@/lib/ink/stroke";

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
