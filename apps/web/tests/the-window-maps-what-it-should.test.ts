/**
 * The window, as arithmetic (§ the maths a judgement rests on, untested).
 *
 * A window and a level decide what a researcher sees in a micrograph: applied
 * wrongly, a faint structure disappears or a flat field looks like signal. This
 * calculation lived inside the panel's frame loop, where it had no test — and
 * where it also ran on every dirty frame, including every frame of a drag,
 * although nothing in it depends on where the image sits. On a 2048-square
 * image that is four million iterations and two allocations per frame.
 *
 * Pulling it out fixed both: it is computed when the pixels or the window
 * change, and it can be checked.
 */

import { describe, expect, it } from "vitest";
import { Raster, windowedBytes } from "@/lib/imaging/raster";

/** A greyscale ramp with one value per pixel. */
function grey(values: number[], over: Partial<Raster> = {}): Raster {
  const data = Float32Array.from(values);
  const rgba = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = values[i];
    rgba[i * 4 + 3] = 255;
  }
  return {
    width: values.length, height: 1, values: data,
    min: Math.min(...values), max: Math.max(...values),
    colour: false, rgba, ...over,
  };
}

const reds = (bytes: Uint8ClampedArray) =>
  Array.from({ length: bytes.length / 4 }, (_, i) => bytes[i * 4]);

describe("a greyscale window", () => {
  it("puts the centre of the window at mid grey", () => {
    // Level 100, width 200: the value 100 sits exactly halfway.
    expect(reds(windowedBytes(grey([100]), 100, 200))[0]).toBe(128);
  });

  it("puts the bottom of the window at black and the top at white", () => {
    const bytes = reds(windowedBytes(grey([0, 200]), 100, 200));
    expect(bytes[0]).toBe(0);
    expect(bytes[1]).toBe(255);
  });

  it("clamps outside the window rather than wrapping", () => {
    /*
     * The failure this prevents is not cosmetic: a value that wrapped would
     * render a bright structure as dark, and a reader would take it for
     * absence.
     */
    const bytes = reds(windowedBytes(grey([-500, 900]), 100, 200));
    expect(bytes[0]).toBe(0);
    expect(bytes[1]).toBe(255);
  });

  it("narrowing the window raises the contrast", () => {
    const wide = reds(windowedBytes(grey([90, 110]), 100, 200));
    const tight = reds(windowedBytes(grey([90, 110]), 100, 20));
    expect(tight[1] - tight[0]).toBeGreaterThan(wide[1] - wide[0]);
  });

  it("never leaves a pixel transparent", () => {
    // An alpha of zero reads as "nothing measured here", which is a different
    // statement from "measured, and low".
    const bytes = windowedBytes(grey([0, 128, 255]), 128, 256);
    for (let i = 3; i < bytes.length; i += 4) expect(bytes[i]).toBe(255);
  });
});

describe("a window on values deeper than the display", () => {
  /*
   * A sixteen-bit TIFF keeps its own units — the caption and the sliders speak
   * in them — while `rgba` is eight bits per channel. Applying a window of
   * 47000 directly to a byte renders everything black at every setting, which
   * is what happened before `rgbaFrom` recorded the mapping between the two.
   */
  function deepColour(): Raster {
    const values = Float32Array.from([0, 23500, 47000]);
    const rgba = new Uint8ClampedArray(3 * 4);
    // The same three values, already scaled to bytes by the decoder.
    [0, 128, 255].forEach((v, i) => {
      rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    });
    return { width: 3, height: 1, values, min: 0, max: 47000, colour: true,
             rgba, rgbaFrom: { min: 0, max: 47000 } };
  }

  it("does not render a sixteen-bit image black at its own full window", () => {
    const bytes = reds(windowedBytes(deepColour(), 23500, 47000));
    expect(bytes[0]).toBe(0);
    expect(bytes[2]).toBe(255);
    expect(bytes[1]).toBeGreaterThan(100);
  });

  it("still narrows when the window narrows", () => {
    const bytes = reds(windowedBytes(deepColour(), 23500, 4700));
    expect(bytes[0]).toBe(0);
    expect(bytes[2]).toBe(255);
  });
});

describe("colour is stretched, not tinted", () => {
  it("moves every channel by the same rule", () => {
    /*
     * Brightness moves; hue does not. A per-channel window would recolour a
     * stain, which is a claim about the specimen.
     *
     * Asserted as *the same rule*, not as identity: a window of width 256
     * centred on 128 covers [0, 256], so 240 correctly maps to 239 and not to
     * 240. The first version of this test expected identity and was wrong
     * about the arithmetic, not about the code.
     */
    const channels = [10, 120, 240];
    const rgba = new Uint8ClampedArray([...channels, 255]);
    const colour: Raster = {
      width: 1, height: 1, values: Float32Array.from([100]),
      min: 0, max: 255, colour: true, rgba,
    };
    const out = windowedBytes(colour, 128, 256);

    // The greyscale path applies the same map to a single value, so each
    // channel must land where that value would.
    for (let c = 0; c < 3; c++) {
      const alone = reds(windowedBytes(grey([channels[c]]), 128, 256))[0];
      expect(out[c], `channel ${c}`).toBe(alone);
    }
  });

  it("keeps the channels in the order they came in", () => {
    // A stretch that reordered or mixed channels would change the hue while
    // claiming only to change brightness.
    const rgba = new Uint8ClampedArray([10, 120, 240, 255]);
    const colour: Raster = {
      width: 1, height: 1, values: Float32Array.from([100]),
      min: 0, max: 255, colour: true, rgba,
    };
    const out = windowedBytes(colour, 128, 256);
    expect(out[0]).toBeLessThan(out[1]);
    expect(out[1]).toBeLessThan(out[2]);
  });
});
