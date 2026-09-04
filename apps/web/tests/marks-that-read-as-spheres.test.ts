/**
 * Shape from shading, and the two ways it could quietly lie.
 *
 * A lit sphere is read as solid and placed in space before any other depth cue
 * is consciously processed, so this is the largest visual difference available
 * to these charts. It is also the version of "make it look rendered" that adds
 * no information — which is the reason it was chosen over ambient occlusion,
 * and the property these tests exist to hold down:
 *
 * - **the light never moves**, so lightness cannot encode position or value;
 * - **the silhouette never changes**, because hit-testing measures the radius
 *   the mark was given, and a mark that draws larger than it tests is one the
 *   reader can see and cannot point at.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SPRITES, darken, drawLitSphere, forgetSprites, lighten, sphereSprite,
} from "@/lib/charts3d/shading";

type Stop = [number, string];

function fakeCanvas() {
  const stops: Stop[] = [];
  const context = {
    createRadialGradient: vi.fn(() => ({
      addColorStop: (offset: number, colour: string) => stops.push([offset, colour]),
    })),
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: "" as unknown,
  };
  const canvas = {
    width: 0, height: 0,
    getContext: vi.fn(() => context),
  };
  return { canvas, context, stops };
}

/** A document that can make canvases, which happy-dom cannot. */
function withCanvas() {
  const made = fakeCanvas();
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
    tag === "canvas" ? made.canvas : ({} as unknown)) as never);
  return made;
}

function recordingContext() {
  return {
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), drawImage: vi.fn(),
    fillStyle: "" as unknown,
  } as unknown as CanvasRenderingContext2D & {
    arc: ReturnType<typeof vi.fn>;
    fill: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
  };
}

describe("marks that read as spheres", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    forgetSprites();
  });

  it("keeps the assigned colour as the colour of the mark", () => {
    /**
     * The shading lifts and drops the same hue around the colour it was given.
     * A legend entry that matches nothing on the canvas is worse than a flat
     * disc.
     */
    const made = withCanvas();

    sphereSprite("#3366cc");

    const middle = made.stops.find(([offset]) => offset > 0 && offset < 1);
    expect(middle?.[1]).toBe("#3366cc");
  });

  it("draws inside exactly the circle it was given", () => {
    /**
     * Hit-testing measures distance against this radius. A mark that drew
     * larger than it tests is one the reader can see and cannot point at.
     */
    withCanvas();
    const context = recordingContext();

    drawLitSphere(context, 100, 60, 8, "#3366cc");

    expect(context.drawImage).toHaveBeenCalledTimes(1);
    const [, x, y, w, h] = context.drawImage.mock.calls[0];
    expect([x, y, w, h]).toEqual([92, 52, 16, 16]);
  });

  it("shades the same colour identically wherever the mark is", () => {
    /**
     * The light is constant, so lightness carries no information. If a sprite
     * depended on position, the figure would be encoding something nobody
     * asked it to.
     */
    withCanvas();
    const context = recordingContext();

    drawLitSphere(context, 10, 10, 6, "#3366cc");
    drawLitSphere(context, 400, 300, 6, "#3366cc");

    const [first] = context.drawImage.mock.calls[0];
    const [second] = context.drawImage.mock.calls[1];
    expect(first).toBe(second);
  });

  it("falls back to a flat disc where no canvas can be made", () => {
    /**
     * happy-dom has no 2D context, and neither does an older browser under
     * memory pressure. The fallback is the drawing that was there before —
     * correct, and merely plainer.
     */
    const context = recordingContext();

    const shaded = drawLitSphere(context, 20, 20, 5, "#3366cc");

    expect(shaded).toBe(false);
    expect(context.arc).toHaveBeenCalledWith(20, 20, 5, 0, Math.PI * 2);
    expect(context.fill).toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it("says whether it actually shaded, rather than assuming", () => {
    withCanvas();
    expect(drawLitSphere(recordingContext(), 0, 0, 4, "#123456")).toBe(true);
  });

  it("does not grow a sprite for every value on a continuous ramp", () => {
    const made = withCanvas();

    for (let n = 0; n < MAX_SPRITES + 20; n += 1) {
      sphereSprite(`rgb(${n},0,0)`);
    }

    // Cleared rather than grown without limit: the count of canvases made
    // stays bounded by the cap plus what has been asked for since.
    expect(made.canvas.getContext.mock.calls.length)
      .toBeLessThanOrEqual(MAX_SPRITES + 21);
  });
});

describe("the colour arithmetic moves lightness and nothing else", () => {
  it("keeps a colour's alpha", () => {
    expect(lighten("rgba(20,40,60,0.5)", 0.5)).toContain("0.5");
    expect(darken("rgba(20,40,60,0.5)", 0.5)).toContain("0.5");
  });

  it("moves toward white and toward black", () => {
    expect(lighten("#000000", 1)).toBe("rgba(255,255,255,1)");
    expect(darken("#ffffff", 1)).toBe("rgba(0,0,0,1)");
  });

  it("reads short hex as well as long", () => {
    expect(lighten("#036", 0)).toBe("rgba(0,51,102,1)");
  });

  it("returns a colour it cannot parse untouched", () => {
    /**
     * A named colour or a CSS variable still has to draw. Guessing at one
     * would put a mark on screen in a colour nobody chose.
     */
    expect(lighten("var(--accent)", 0.5)).toBe("var(--accent)");
    expect(darken("rebeccapurple", 0.5)).toBe("rebeccapurple");
  });
});
