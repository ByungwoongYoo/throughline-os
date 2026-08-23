/**
 * What a wheel over a chart means (§10).
 *
 * Small, but it decides whether a page of charts can be read at all: a chart
 * that zooms on a plain wheel traps a reader scrolling past it, and a page
 * with three stacked charts becomes one the pointer can never leave.
 */

import { describe, expect, it } from "vitest";
import { isZoomWheel, wheelZoomFactor } from "@/lib/charts/wheel";

describe("a plain wheel belongs to the page", () => {
  it("does not zoom without a modifier", () => {
    // Found on the page rather than here: scrolling the gallery zoomed the
    // citation network apart and the page never moved.
    expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("zooms with ctrl, which is also what a trackpad pinch sends", () => {
    expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
  });

  it("zooms with the command key", () => {
    expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
  });
});

describe("the same gesture reaches the same zoom", () => {
  it("is exponential, so many small steps equal one large one", () => {
    /*
     * A trackpad sends many small deltas and a mouse wheel a few large ones.
     * Linear zoom would put the same physical gesture in a different place
     * depending on the hardware.
     */
    const once = wheelZoomFactor(90);
    const thrice = wheelZoomFactor(30) * wheelZoomFactor(30) * wheelZoomFactor(30);
    expect(thrice).toBeCloseTo(once, 12);
  });

  it("returns exactly where it began after out and back", () => {
    expect(wheelZoomFactor(120) * wheelZoomFactor(-120)).toBeCloseTo(1, 12);
  });

  it("zooms in one direction and out in the other", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
  });
});
