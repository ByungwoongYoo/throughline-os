/**
 * Reading a mark in the 3D scatter.
 *
 * The chart could hit-test, highlight, select and be driven from the keyboard.
 * What it could not do was *say what it had hit*: hovering a point lit it up
 * and named nothing, so it was the one primitive of the thirteen a reader
 * could touch and not interrogate.
 *
 * This is the chart where that matters most, and the component's own docstring
 * says why: a projected position on a flat screen is ambiguous without motion.
 * On a scatter a reader can at least infer identity from where a dot sits; here
 * they cannot, so highlighting a dot and naming nothing asks them to guess.
 *
 * happy-dom paints nothing and lays nothing out, so these drive the same seam
 * the existing controller tests use — the centre of the canvas, where the
 * bounding cube's midpoint projects whatever the camera is doing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Volume, volumeRows } from "@/components/charts/Volume";

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const CLOUD = [
  { id: "a", label: "Sample A", x: 0, y: 0, z: 0, value: 1 },
  { id: "b", label: "Sample B", x: 10, y: 10, z: 10, value: 9 },
  { id: "c", label: "Sample C", x: -10, y: -10, z: -10, value: 4 },
];

/**
 * The readout element, or null.
 *
 * Asked for by its own node rather than by text: the chart renders a data
 * table listing every mark, so "is 'Sample A' on the page" is true before a
 * pointer has touched anything. What is under test is what the *readout* says.
 */
function tip(): HTMLElement | null {
  return document.querySelector(".chart-tip");
}

function draw(props: Record<string, unknown> = {}) {
  render(<Volume points={CLOUD} xLabel="Component 1" yLabel="Component 2"
                 zLabel="Component 3" valueLabel="Resistance"
                 width={400} height={400} {...props} />);
  return document.querySelector("canvas")!;
}

// ---------------------------------------------------------------------------
// Which numbers a reader is shown
// ---------------------------------------------------------------------------

describe("what the readout says", () => {
  it("gives all three coordinates under the project's own names", () => {
    expect(volumeRows(CLOUD[1],
                      { x: "Component 1", y: "Component 2", z: "Component 3" }))
      .toEqual([
        { label: "Component 1", value: "10" },
        { label: "Component 2", value: "10" },
        { label: "Component 3", value: "10" },
      ]);
  });

  it("includes the value when the chart encodes one", () => {
    const rows = volumeRows(CLOUD[1], {
      x: "x", y: "y", z: "z", value: "Resistance" });
    expect(rows.at(-1)).toEqual({ label: "Resistance", value: "9" });
  });

  it("invents no value row on a chart with no value channel", () => {
    /*
     * Colour is the value channel here and it is optional. A "Value —" row
     * would name a variable the reader does not have.
     */
    const rows = volumeRows({ id: "a", label: "A", x: 1, y: 2, z: 3 },
                            { x: "x", y: "y", z: "z" });
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.label === "Value")).toBe(false);
  });

  it("shows a coordinate of zero as a number, not as a dash", () => {
    // Zero is a position. A dash would read as "not recorded".
    const rows = volumeRows(CLOUD[0], { x: "x", y: "y", z: "z" });
    expect(rows.map((r) => r.value)).toEqual(["0", "0", "0"]);
  });
});

// ---------------------------------------------------------------------------
// Reaching it with a pointer
// ---------------------------------------------------------------------------

describe("hovering a mark", () => {
  it("names the mark under the pointer", async () => {
    const canvas = draw();
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 200 });

    await waitFor(() => expect(tip()).not.toBeNull());
    expect(tip()!.textContent).toContain("Sample A");
  });

  it("shows its coordinates beside its name", async () => {
    const canvas = draw();
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 200 });

    await waitFor(() => expect(tip()).not.toBeNull());
    const text = tip()!.textContent!;
    expect(text).toContain("Component 1");
    expect(text).toContain("Component 3");
    expect(text).toContain("Resistance");
  });

  it("says nothing while the pointer is over empty space", () => {
    // A readout pinned to a cursor that is not over anything describes
    // whatever it last touched, which is worse than describing nothing.
    const canvas = draw();
    fireEvent.pointerMove(canvas, { clientX: 5, clientY: 395 });

    expect(tip()).toBeNull();
  });

  it("stops naming a mark once the pointer leaves it", async () => {
    const canvas = draw();
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 200 });
    await waitFor(() => expect(tip()).not.toBeNull());

    fireEvent.pointerMove(canvas, { clientX: 5, clientY: 395 });
    await waitFor(() => expect(tip()).toBeNull());
  });

  it("clears when the pointer leaves the chart entirely", async () => {
    const canvas = draw();
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 200 });
    await waitFor(() => expect(tip()).not.toBeNull());

    fireEvent.pointerLeave(canvas);
    await waitFor(() => expect(tip()).toBeNull());
  });

  it("does not describe a mark while the camera is being dragged", async () => {
    /*
     * A drag is a camera move, not a reading. Naming whatever passes under a
     * rotating scene would be a readout that changes for a reason the reader
     * did not intend.
     */
    const canvas = draw();
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 200 });

    expect(tip()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reaching it without one
// ---------------------------------------------------------------------------

describe("aiming and pressing", () => {
  it("names the mark a keyboard selection landed on", async () => {
    /*
     * Rule 5 and §30: the keyboard reaches everything the pointer does. A
     * readout the pointer gets and the keyboard does not would reintroduce
     * the original failure for exactly the readers who cannot use a mouse.
     */
    const canvas = draw();
    fireEvent.focus(canvas);
    fireEvent.keyDown(canvas, { key: "Enter" });

    await waitFor(() => expect(tip()).not.toBeNull());
    expect(tip()!.textContent).toContain("Sample A");
  });

  it("clears the readout on Escape, with the selection", async () => {
    const canvas = draw();
    fireEvent.focus(canvas);
    fireEvent.keyDown(canvas, { key: "Enter" });
    await waitFor(() => expect(tip()).not.toBeNull());

    fireEvent.keyDown(canvas, { key: "Escape" });
    await waitFor(() => expect(tip()).toBeNull());
  });
});
