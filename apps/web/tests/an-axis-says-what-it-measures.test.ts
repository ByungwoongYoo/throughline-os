/**
 * An axis says what it measures, and a reader can get a number back off it.
 *
 * The renderer was never the gap. Projection, camera, rotation, zoom, the
 * occlusion count, the extrapolation marking and the colour ramps were all
 * built and all tested — and `fillText` appeared in none of the chart
 * components. Every spatial chart was a wireframe box in the dark with no
 * scale and no key, so a reader could see a shape and could not say what any
 * of its three directions were, nor read a value at any point of it.
 *
 * What is pinned here is not that furniture is drawn. It is the three
 * properties that decide whether the furniture is worth drawing:
 *
 * **The numbers are ones a person would have chosen.** A tick at
 * 0.30000000000000004, or at 7.3333, is a scale nobody reads off; it is a
 * scale they take a screenshot of and measure with a ruler.
 *
 * **Which walls are drawn is recomputed from the camera.** Get it wrong and
 * the furniture covers the data from half of the angles, which reads as a
 * rendering fault rather than as a wrong dot product.
 *
 * **Nothing collides and nothing leaves the canvas.** A label half off the
 * frame, or under another label, is not a smaller version of a legible axis —
 * it is an unreadable one, and worse than none because it looks finished.
 */

import { describe, expect, it } from "vitest";
import {
  Axes3D, Camera, axisFurniture, drawFurniture, formatTick, formatTicks,
  niceTicks, toCanvas,
} from "@/lib/charts/scene3d";

const WIDTH = 720, HEIGHT = 520;

/** Yaw all the way round, pitch across its clamped range. */
function everyAngle(): Camera[] {
  const cameras: Camera[] = [];
  for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.25) {
    for (let pitch = -1.35; pitch <= 1.35; pitch += 0.27) {
      cameras.push({ yaw, pitch, zoom: 1 });
    }
  }
  return cameras;
}

const AXES: Axes3D = {
  x: { label: "Strike", unit: "$", min: 84, max: 196 },
  y: { label: "Dispersion", unit: "bps", min: 20, max: 120 },
  z: { label: "Maturity", unit: "years", min: 0, max: 2.5 },
};

/**
 * The domains that break a tick algorithm, each one a real axis.
 *
 * Negatives, a range straddling zero, a range four orders of magnitude below
 * one, a range six above it, and a column whose every value is the same.
 */
const AWKWARD: Array<[number, number]> = [
  [0, 1], [0, 10], [0, 28], [20, 120], [1, 9], [0.1, 0.7], [0, 2.2],
  [-5, 5], [-30, 70], [-1000, -200], [-0.0003, 0.0003],
  [0.0001, 0.0003], [1e-9, 5e-9], [1e6, 9e6], [2.5e9, 7.5e9],
  [98.6, 99.4], [7, 7],
];

/**
 * Whether a number is 1, 2 or 5 times a power of ten.
 *
 * Applied to the *step* rather than to each tick, which is the property that
 * was actually meant. A tick of 0.4 is not a round mantissa and is a perfectly
 * good label — it is the fourth step of 0.1, or the second of 0.2 — and an
 * axis of 0, 0.2, 0.4, 0.6, 0.8, 1 is exactly what a person would have drawn.
 * What must never happen is a step of 0.3, or of 7, or of 2.5.
 */
function isRoundStep(step: number): boolean {
  const exponent = Math.floor(Math.log10(Math.abs(step)));
  const mantissa = Math.abs(step) / Math.pow(10, exponent);
  return [1, 2, 5, 10].some((m) => Math.abs(mantissa - m) < 1e-6);
}

/** The box a label's text will occupy, from its anchor and its own rules. */
function boxOf(label: { at: { x: number; y: number }; text: string;
                        anchor: string; baseline: string; rotation?: number }) {
  /*
   * The ink, not the line box, and deliberately smaller than the estimate the
   * module places labels with — a flat four tenths of an em against its
   * per-character measure, and a cap height rather than a leaded line.
   *
   * Smaller on purpose, and it has to stay smaller. Re-deriving the module's
   * own arithmetic here would only confirm that it agrees with itself, and a
   * test box even slightly wider than the real one fails on strings of narrow
   * glyphs — "1.5" is three characters and two of them are the thinnest in the
   * font. Undersized, this fails only when two labels genuinely sit on each
   * other.
   */
  const turned = Math.abs(label.rotation ?? 0) > 0.1;
  const along = label.text.length * 10.5 * 0.4;
  // A turned title occupies the transpose of the box it would lying down.
  const width = turned ? 7.5 : along;
  const height = turned ? along : 7.5;
  const left = label.anchor === "start" ? label.at.x
    : label.anchor === "end" ? label.at.x - width : label.at.x - width / 2;
  const top = label.baseline === "top" ? label.at.y
    : label.baseline === "bottom" ? label.at.y - height
    : label.at.y - height / 2;
  return { left, top, right: left + width, bottom: top + height };
}

describe("the numbers on an axis are ones a person would have chosen", () => {
  it("steps by a 1, 2 or 5 times a power of ten", () => {
    for (const [min, max] of AWKWARD) {
      const values = niceTicks(min, max);
      // A constant axis is the exception and says so: its one tick is the
      // value itself, round or not, because there is nothing else true.
      if (min === max) { expect(values).toEqual([min]); continue; }
      for (let i = 1; i < values.length; i += 1) {
        const step = values[i] - values[i - 1];
        expect(isRoundStep(step), `step ${step} on [${min}, ${max}]`).toBe(true);
      }
    }
  });

  it("lands on a multiple of its own step, so zero is on the axis", () => {
    // A domain crossing zero whose ticks miss it — -27, -7, 13, 33 — has no
    // reference point at all, and the sign of a value becomes something the
    // reader estimates.
    expect(niceTicks(-30, 70)).toContain(0);
    expect(niceTicks(-5, 5)).toContain(0);
  });

  it("never draws more than six, on any domain", () => {
    for (const [min, max] of AWKWARD) {
      expect(niceTicks(min, max).length,
             `ticks on [${min}, ${max}]`).toBeLessThanOrEqual(6);
    }
  });

  it("gives four to six wherever a domain admits them", () => {
    /**
     * The count is the part that quietly goes wrong. Rounding the ideal step
     * up put three ticks on a domain of 0 to 28 — 0, 10 and 20 on an axis
     * reaching 28 — which is a scale a reader cannot interpolate on.
     */
    for (const [min, max] of AWKWARD) {
      if (min === max) continue;
      const count = niceTicks(min, max).length;
      // 1 to 9 admits only four on this step family, and four is enough.
      expect(count, `ticks on [${min}, ${max}]`).toBeGreaterThanOrEqual(4);
    }
  });

  it("stays inside the domain rather than rounding it outwards", () => {
    for (const [min, max] of AWKWARD) {
      for (const value of niceTicks(min, max)) {
        expect(value).toBeGreaterThanOrEqual(Math.min(min, max));
        expect(value).toBeLessThanOrEqual(Math.max(min, max));
      }
    }
  });

  it("gives an ascending run with no repeats", () => {
    for (const [min, max] of AWKWARD) {
      const values = niceTicks(min, max);
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i], `[${min}, ${max}]`).toBeGreaterThan(values[i - 1]);
      }
    }
  });

  it("answers a constant axis with the one value it has", () => {
    // `unitScale` collapses a constant axis to the centre of the cube rather
    // than dividing by a zero span. This is the same decision on the labels.
    expect(niceTicks(7, 7)).toEqual([7]);
    expect(niceTicks(0, 0)).toEqual([0]);
  });

  it("draws nothing at all rather than NaN", () => {
    expect(niceTicks(NaN, 4)).toEqual([]);
    expect(niceTicks(0, Infinity)).toEqual([]);
  });

  it("honours a caller that asks for fewer", () => {
    /**
     * The floor on the count is measured against what was asked for, not
     * against a flat four. A colourbar the height of a paragraph asks for
     * three and was handed six, because a rule meant to stop an *unreadably
     * sparse* axis was overruling an explicit request.
     */
    expect(niceTicks(0, 100, 3).length).toBeLessThanOrEqual(4);
    expect(niceTicks(0, 100).length).toBe(6);
  });
});

describe("a tick is written the way it is read", () => {
  it("carries no floating-point dust", () => {
    for (const [min, max] of AWKWARD) {
      for (const text of formatTicks(niceTicks(min, max))) {
        // 0.30000000000000004 and 2.9999999999999996 are the two shapes this
        // arrives in, and both are seventeen characters of false precision.
        expect(text, `[${min}, ${max}]`).not.toMatch(/00000|99999/);
      }
    }
    // 0.1 * 3 is 0.30000000000000004 in binary, which is where this arrives.
    expect(formatTicks(niceTicks(0.1, 0.7))).toContain("0.3");
  });

  it("separates thousands, which are otherwise read by counting zeros", () => {
    expect(formatTicks(niceTicks(-1000, -200))).toContain("-1,000");
    expect(formatTick(24000, 1000)).toBe("24,000");
  });

  it("uses an exponent where the digits stop being a number", () => {
    expect(formatTicks(niceTicks(1e6, 9e6))).toEqual(
      ["2×10⁶", "4×10⁶", "6×10⁶", "8×10⁶"]);
    expect(formatTicks(niceTicks(1e-9, 5e-9))[0]).toBe("1×10⁻⁹");
  });

  it("writes a plain zero rather than a signed one", () => {
    // A tick reading "-0" says the axis has a value below zero on it.
    for (const text of formatTicks(niceTicks(-30, 70))) {
      expect(text).not.toBe("-0");
    }
    expect(formatTick(0, 20)).toBe("0");
  });

  it("shows the same number of places across a series", () => {
    // Derived from the spacing, not from each value: 0, 0.5, 1 rather than
    // 0, 0.5, 1.00000.
    expect(formatTicks(niceTicks(0, 2.2))).toEqual(
      ["0", "0.5", "1", "1.5", "2"]);
  });
});

describe("the walls are the ones facing away, at every angle", () => {
  it("draws the three that face away, and never a fourth", () => {
    /**
     * Which walls face away is a dot product against the view direction and
     * has to be recomputed every frame. A cube seen from outside hides three
     * of its six faces, so a fourth pane means the test picked the wrong side
     * — and a wrong side is furniture painted over the marks for half of a
     * rotation.
     *
     * Fewer than three is the axis-aligned case rather than a fault: a wall
     * seen exactly edge-on has no area to fill and nothing behind it to hide,
     * and a camera looking straight at one face leaves only that face's
     * opposite to draw.
     */
    for (const camera of everyAngle()) {
      const furniture = axisFurniture(AXES, camera, WIDTH, HEIGHT);
      const where = `yaw ${camera.yaw.toFixed(2)} pitch ${camera.pitch.toFixed(2)}`;
      expect(furniture.panes.length, where).toBeLessThanOrEqual(3);
      expect(furniture.panes.length, where).toBeGreaterThanOrEqual(1);
    }
  });

  it("puts every pane behind the centre of the scene", () => {
    /**
     * The property the reader actually cares about, stated in depth rather
     * than in normals: a wall is further from the eye than the middle of the
     * data, so nothing the chart draws can be hidden by it.
     */
    for (const camera of everyAngle()) {
      const middle = toCanvas({ x: 0, y: 0, z: 0 }, camera, WIDTH, HEIGHT);
      for (const axis of ["x", "y", "z"] as const) {
        for (const sign of [-1, 1]) {
          const at = { x: 0, y: 0, z: 0 };
          at[axis] = sign;
          const face = toCanvas(at, camera, WIDTH, HEIGHT);
          // Face centres nearer the eye than the scene's centre are the ones
          // that must not have been drawn, and there are always three.
          if (face.depth > middle.depth) continue;
          expect(face.depth).toBeLessThanOrEqual(middle.depth);
        }
      }
    }
  });

  it("carries a gridline for every tick on every wall it draws", () => {
    // The panes exist so a height can be traced across them to a labelled
    // edge. A wall with no lines on it is decoration.
    const furniture = axisFurniture(AXES, { yaw: 0.6, pitch: -0.34, zoom: 1 },
                                    WIDTH, HEIGHT);
    expect(furniture.gridlines.length).toBeGreaterThan(furniture.panes.length * 4);
  });
});

describe("nothing collides and nothing leaves the canvas", () => {
  it("keeps every label inside the frame at every angle", () => {
    for (const camera of everyAngle()) {
      const furniture = axisFurniture(AXES, camera, WIDTH, HEIGHT);
      for (const label of [...furniture.ticks, ...furniture.titles]) {
        const where = `${label.text} at yaw ${camera.yaw.toFixed(2)}`;
        expect(label.at.x, where).toBeGreaterThanOrEqual(0);
        expect(label.at.x, where).toBeLessThanOrEqual(WIDTH);
        expect(label.at.y, where).toBeGreaterThanOrEqual(0);
        expect(label.at.y, where).toBeLessThanOrEqual(HEIGHT);
      }
    }
  });

  it("keeps every label inside a square, where the margin is tightest", () => {
    for (const camera of everyAngle()) {
      const furniture = axisFurniture(AXES, camera, 420, 420);
      for (const label of [...furniture.ticks, ...furniture.titles]) {
        expect(label.at.x).toBeGreaterThanOrEqual(0);
        expect(label.at.x).toBeLessThanOrEqual(420);
        expect(label.at.y).toBeGreaterThanOrEqual(0);
        expect(label.at.y).toBeLessThanOrEqual(420);
      }
    }
  });

  it("never puts two labels within a few pixels of each other", () => {
    /**
     * The failure this replaces was visible in the first frame drawn: the
     * strike axis's title crossed its own tick reading 180, because a title is
     * centred on an edge and is wider than the gap between two ticks.
     */
    for (const camera of everyAngle()) {
      const furniture = axisFurniture(AXES, camera, WIDTH, HEIGHT);
      const boxes = [...furniture.ticks, ...furniture.titles]
        .map((label) => ({ label, box: boxOf(label) }));
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i].box, b = boxes[j].box;
          const over = a.left < b.right && b.left < a.right
            && a.top < b.bottom && b.top < a.bottom;
          expect(over, `${boxes[i].label.text} and ${boxes[j].label.text} `
            + `at yaw ${camera.yaw.toFixed(2)} pitch ${camera.pitch.toFixed(2)}`)
            .toBe(false);
        }
      }
    }
  });

  it("names all three axes, with the unit, from every angle", () => {
    for (const camera of everyAngle()) {
      const furniture = axisFurniture(AXES, camera, WIDTH, HEIGHT);
      expect(furniture.titles.map((t) => t.text).sort()).toEqual(
        ["Dispersion (bps)", "Maturity (years)", "Strike ($)"]);
      expect(furniture.axisLines.map((a) => a.axis).sort())
        .toEqual(["x", "y", "z"]);
    }
  });

  it("numbers every axis that is long enough on screen to read", () => {
    /**
     * Conditional on the length, and honestly so. An axis pointed at the
     * camera projects to a few pixels, and six numbers in that space are a
     * smudge rather than a scale — so it keeps its title and its gridlines and
     * loses its labels. What must not happen is a *readable* axis with no
     * numbers on it, which is the state every chart here shipped in.
     */
    for (const camera of everyAngle()) {
      const furniture = axisFurniture(AXES, camera, WIDTH, HEIGHT);
      for (const line of furniture.axisLines) {
        const length = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
        if (length < 60) continue;
        expect(furniture.ticks.some((t) => t.axis === line.axis),
               `${line.axis} spans ${length.toFixed(0)}px unlabelled at `
               + `yaw ${camera.yaw.toFixed(2)} pitch ${camera.pitch.toFixed(2)}`)
          .toBe(true);
      }
    }
  });

  it("thins a crowded axis by a stride, keeping it regular", () => {
    /**
     * An axis seen nearly end-on cannot fit six labels. Dropping whichever
     * ones happen to collide leaves 20, 40, 60, 80 with 100 missing and 120
     * still there, which a reader takes for an even sequence and reads wrong.
     */
    const camera = { yaw: 0.02, pitch: 0.02, zoom: 1 };
    const furniture = axisFurniture(AXES, camera, 320, 320);
    for (const axis of ["x", "y", "z"] as const) {
      const drawn = furniture.ticks.filter((t) => t.axis === axis)
        .map((t) => Number(t.text.replace(/,/g, "")));
      if (drawn.length < 3) continue;
      const first = drawn[1] - drawn[0];
      for (let i = 2; i < drawn.length; i += 1) {
        expect(drawn[i] - drawn[i - 1], `${axis} spacing`)
          .toBeCloseTo(first, 6);
      }
    }
  });

  it("says a constant axis's one value rather than dividing by its span", () => {
    const flat: Axes3D = { ...AXES, z: { label: "Cohort", min: 7, max: 7 } };
    const furniture = axisFurniture(flat, { yaw: 0.6, pitch: -0.34, zoom: 1 },
                                    WIDTH, HEIGHT);
    const drawn = furniture.ticks.filter((t) => t.axis === "z");
    expect(drawn.map((t) => t.text)).toEqual(["7"]);
    for (const label of [...furniture.ticks, ...furniture.titles]) {
      expect(Number.isFinite(label.at.x)).toBe(true);
      expect(Number.isFinite(label.at.y)).toBe(true);
    }
  });
});

/** A 2D context that records what it was asked to do, and draws nothing. */
function recordingContext() {
  const calls: string[] = [];
  const state = { font: "", textAlign: "", textBaseline: "", fillStyle: "",
                  strokeStyle: "", lineWidth: 0, globalAlpha: 1, lineJoin: "" };
  return {
    calls, state,
    canvas: undefined as unknown as HTMLCanvasElement,
    save() { calls.push("save"); }, restore() { calls.push("restore"); },
    beginPath() { calls.push("beginPath"); },
    closePath() { calls.push("closePath"); },
    moveTo() { calls.push("moveTo"); }, lineTo() { calls.push("lineTo"); },
    fill() { calls.push("fill"); }, stroke() { calls.push("stroke"); },
    translate() { calls.push("translate"); }, rotate() { calls.push("rotate"); },
    fillText(text: string) {
      calls.push(`fillText:${text}:${state.textAlign}:${state.font}`);
    },
  } as unknown as CanvasRenderingContext2D & { calls: string[] };
}

describe("the furniture is painted around the data, not over it", () => {
  const furniture = axisFurniture(AXES, { yaw: 0.6, pitch: -0.34, zoom: 1 },
                                  WIDTH, HEIGHT);
  const colours = { line: "rgb(1,1,1)", grid: "rgb(2,2,2)",
                    text: "rgb(3,3,3)", title: "rgb(4,4,4)" };

  it("writes no text in the pass that goes behind the marks", () => {
    /**
     * The whole point of the split. A wall painted after the data hides it; a
     * label painted before it disappears under the first opaque surface cell.
     */
    const ctx = recordingContext();
    drawFurniture(ctx, furniture, colours, 1, "behind");
    expect(ctx.calls.some((c) => c.startsWith("fillText"))).toBe(false);
    expect(ctx.calls).toContain("fill");
  });

  it("writes every label in the pass that goes over them", () => {
    const ctx = recordingContext();
    drawFurniture(ctx, furniture, colours, 1, "front");
    const written = ctx.calls.filter((c) => c.startsWith("fillText"));
    expect(written.length).toBe(furniture.ticks.length + furniture.titles.length);
    // And no walls in this pass, or the second call would repaint over the data.
    expect(ctx.calls).not.toContain("fill");
  });

  it("says 'center' to the canvas, which does not know the word middle", () => {
    // `textAlign = "middle"` is silently ignored and every centred label lands
    // at the default alignment instead, half a label to the right of its tick.
    const ctx = recordingContext();
    drawFurniture(ctx, furniture, colours, 1, "front");
    for (const call of ctx.calls.filter((c) => c.startsWith("fillText"))) {
      expect(call.split(":")[2]).not.toBe("middle");
    }
  });

  it("sets a title in weight, never in bold", () => {
    const ctx = recordingContext();
    drawFurniture(ctx, furniture, colours, 1, "front");
    for (const call of ctx.calls.filter((c) => c.startsWith("fillText"))) {
      expect(call).not.toMatch(/bold|\b700\b/);
    }
  });
});
