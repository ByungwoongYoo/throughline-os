/**
 * The flat-image panel (§ a comparison that is not a volume).
 *
 * The behaviour worth pinning is the *shared window*. Two images of one
 * specimen at different exposures look like two specimens, and the eye is
 * completely unreliable about it — so a panel that quietly kept its own
 * contrast would make every comparison on this screen dishonest while looking
 * perfectly reasonable.
 */

import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { RasterPanel } from "@/components/imaging/RasterPanel";
import { Raster } from "@/lib/imaging/raster";
import type { VisualizationController } from "@/lib/spatial/commands";

/** A small greyscale ramp, so a window has something to act on. */
function ramp(width = 4, height = 4, from = 10, to = 200): Raster {
  const values = new Float32Array(width * height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < values.length; i++) {
    const v = from + ((to - from) * i) / (values.length - 1);
    values[i] = v;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, values, min: from, max: to, colour: false, rgba };
}

function mount(over: Partial<React.ComponentProps<typeof RasterPanel>> = {}) {
  const controllerRef = createRef<VisualizationController | null>();
  const onViewChange = vi.fn();
  const view = render(
    <RasterPanel raster={ramp()} width={200} height={200} name="Section"
                 controllerRef={controllerRef} onViewChange={onViewChange}
                 {...over} />,
  );
  return { view, controllerRef, onViewChange };
}

describe("what the panel opens at", () => {
  it("frames the window on the values actually present", () => {
    /*
     * Not on the container's nominal range. A fluorescence channel using the
     * bottom tenth of sixteen bits would otherwise be drawn black, and a black
     * panel reads as "nothing there" rather than as "wrong window".
     */
    mount();
    const level = screen.getByLabelText("Window level") as HTMLInputElement;
    expect(Number(level.value)).toBeCloseTo(105, 5); // midpoint of 10..200
    const width = screen.getByLabelText("Window width") as HTMLInputElement;
    expect(Number(width.value)).toBeCloseTo(190, 5);
  });

  it("says what it is showing, including the window", () => {
    mount();
    const caption = document.querySelector(".chart-caption");
    expect(caption?.textContent).toContain("4 × 4");
    expect(caption?.textContent).toContain("greyscale");
    expect(caption?.textContent).toContain("window");
  });

  it("offers the same two controls the volume panel does", () => {
    // A researcher holding a micrograph beside a scan should not have to learn
    // that one calls it brightness and the other level.
    mount();
    expect(screen.getByLabelText("Window level")).toBeTruthy();
    expect(screen.getByLabelText("Window width")).toBeTruthy();
  });

  it("offers no orbit recording, because there is no turn to record", () => {
    mount();
    expect(screen.queryByRole("button", { name: /orbit video/i })).toBeNull();
    // The still exports are still there — the feature is absent, not broken.
    expect(screen.getByRole("button", { name: "PNG" })).toBeTruthy();
  });
});

describe("the shared view", () => {
  it("takes a window pushed from another panel", () => {
    const { controllerRef } = mount();
    act(() => { controllerRef.current?.restoreViewState({ level: 50, window: 20 }); });
    const level = screen.getByLabelText("Window level") as HTMLInputElement;
    expect(Number(level.value)).toBe(50);
    expect(Number((screen.getByLabelText("Window width") as HTMLInputElement)
      .value)).toBe(20);
  });

  it("leaves its own framing alone when the snapshot carries no framing", () => {
    /*
     * A view pushed from a volume has a window and no pan. Adopting a missing
     * pan as zero would jump every flat panel back to centre whenever the
     * window moved anywhere on the page.
     */
    const { controllerRef } = mount();
    act(() => { controllerRef.current?.pan(30, 40); });
    act(() => { controllerRef.current?.restoreViewState({ level: 60, window: 30 }); });
    const after = controllerRef.current?.viewState();
    expect(after?.panX).toBe(30);
    expect(after?.panY).toBe(40);
    expect(after?.level).toBe(60);
  });

  it("reports the window outward so the rest of the case can follow", () => {
    const { controllerRef, onViewChange } = mount();
    onViewChange.mockClear();
    act(() => { controllerRef.current?.zoom(2); });
    expect(onViewChange).toHaveBeenCalled();
    const last = onViewChange.mock.calls.at(-1)?.[0];
    expect(last.zoom).toBeCloseTo(2, 5);
    expect(last.level).toBeCloseTo(105, 5);
  });

  it("returns to where it started", () => {
    const { controllerRef } = mount();
    act(() => { controllerRef.current?.zoom(4); });
    act(() => { controllerRef.current?.pan(50, 50); });
    act(() => { controllerRef.current?.resetView(); });
    const view = controllerRef.current?.viewState();
    expect(view?.zoom).toBe(1);
    expect(view?.panX).toBe(0);
    expect(view?.panY).toBe(0);
  });
});

describe("what the panel will not claim", () => {
  it("answers a region with nothing, rather than with a count of pixels", () => {
    /*
     * A raster has no discrete observations. Returning every pixel inside the
     * polygon would answer a question about data with a measure of screen area
     * — a confident number meaning nothing, which is the failure this whole
     * screen is arranged against.
     */
    const { controllerRef } = mount();
    expect(controllerRef.current?.withinPolygon([
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 },
    ])).toEqual([]);
  });

  it("does not pretend a flat image can be orbited", () => {
    // Ignored rather than quietly remapped onto panning: a hand rotating a
    // flat image and watching it slide would be told a gesture works when it
    // does not.
    const { controllerRef } = mount();
    const before = controllerRef.current?.viewState();
    act(() => { controllerRef.current?.rotate(45, 45); });
    expect(controllerRef.current?.viewState()).toEqual(before);
  });

  it("reports the value under a point, and nothing outside the image", () => {
    const { controllerRef } = mount();
    expect(controllerRef.current?.select({ x: 100, y: 100 })?.datum)
      .toMatchObject({ x: 2, y: 2 });
    expect(controllerRef.current?.select({ x: -500, y: -500 })).toBeNull();
  });
});
