/**
 * The chart catalogue can be used, not only read.
 *
 * Fourteen primitives rendered against illustrative data, and not one of them
 * offered to draw *this project's* data. So a researcher who saw the picture
 * they wanted had to work out for themselves that "Matrices" is the thing the
 * figure builder calls *How it all relates* — which is the catalogue being
 * documentation with charts in it rather than part of the product.
 *
 * The owner put it plainly: "if they click on that graph, they can change what
 * graph they need."
 *
 * Two rules hold this together. A primitive with somewhere to send you gets a
 * button and a sentence naming the destination, because a button alone is a
 * control with no destination and a sentence alone is a promise with no
 * control. **A primitive with nowhere to send you gets no button** and says so
 * — a door that leads nowhere reads as a broken feature rather than an absent
 * one, which is the rule the Record's own door follows.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Gallery } from "@/components/gallery";
import { PRIMITIVES } from "@/lib/primitives";

/**
 * happy-dom has no `Worker`, and the gallery's node-link primitive starts one
 * for its force layout. Stubbed rather than the primitive excluded — P6 is one
 * of the eight that carries a door, so leaving it out would leave the thing
 * under test unchecked. `gallery-keys` does the same for the same reason.
 */
class SilentWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}

beforeEach(() => {
  (globalThis as { Worker?: unknown }).Worker = SilentWorker;
  // The map primitive fetches world topology; there is no network here and the
  // component already handles the failure by not drawing a map.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
});

describe("every primitive says where it goes, or that it goes nowhere", () => {
  it("draws this project's data with the lens that matches the primitive", async () => {
    const onDraw = vi.fn();
    render(<Gallery onDraw={onDraw} onGo={() => {}} />);

    // P1 is Cartesian marks, which the builder calls "One relationship".
    const doors = await screen.findAllByRole("button",
      { name: /Draw my data this way/ });
    await userEvent.click(doors[0]);
    expect(onDraw).toHaveBeenCalledWith("one");
  });

  it("names the destination beside the button", async () => {
    render(<Gallery onDraw={() => {}} onGo={() => {}} />);
    // The lens is named in words, so pressing is not a guess.
    expect(await screen.findByText(/One relationship/)).toBeTruthy();
    expect(screen.getByText(/How it all relates/)).toBeTruthy();
  });

  it("leaves for the section that draws a primitive on real objects", async () => {
    const onGo = vi.fn();
    render(<Gallery onDraw={() => {}} onGo={onGo} />);

    // P6 is node-link graphs, which this project draws as the research graph.
    const doors = await screen.findAllByRole("button",
      { name: /Show this project/ });
    await userEvent.click(doors[0]);
    expect(onGo).toHaveBeenCalledWith({ section: "graph" });
  });

  it("says so rather than offering a door that leads nowhere", async () => {
    render(<Gallery onDraw={() => {}} onGo={() => {}} />);
    // Six of the fourteen have no route into a project figure today.
    const said = await screen.findAllByText(/nowhere to send you/);
    expect(said.length).toBeGreaterThan(0);
  });

  it("offers nothing at all when nobody is listening", async () => {
    // Rendered without handlers — on a marketing page, say — the catalogue is
    // still a catalogue. A button wired to nothing would be the dead end again.
    render(<Gallery />);
    await screen.findByText(/Cartesian marks/);
    expect(screen.queryByRole("button", { name: /Draw my data this way/ }))
      .toBeNull();
  });

  it("has a route for every primitive it claims one for", () => {
    // The map is keyed by P-number, and a typo there would silently drop a
    // door rather than fail: the section would simply render the "nowhere"
    // sentence. So the codes are checked against the registry itself.
    const codes = new Set(PRIMITIVES.map((p) => p.code));
    for (const code of ["P1", "P2", "P4", "P5", "P6", "P9", "P11", "P12"]) {
      expect(codes.has(code), code).toBe(true);
    }
  });
});
