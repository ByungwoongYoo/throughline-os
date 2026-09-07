/**
 * A colour scale that can be read, and one that is not drawn twice.
 *
 * A ramp with no key is the most confident kind of wrong picture: it varies
 * smoothly, so it looks quantitative, and a reader takes greener for more and
 * has no way to find out how much more. `Surface` has carried a legend for its
 * fourth variable for a while; nothing else did, and even that one was ends
 * only — a bar with the lowest and highest numbers at its two corners and
 * nothing to interpolate against between them.
 *
 * The other half of the argument is when *not* to draw one. A surface shaded
 * by its own height has three dimensions of data in it, and the z axis is
 * already the key; a second key beside it invites a reader to treat one
 * quantity as two. `Surface` builds a legend only when `colourBy` supplies a
 * genuine fourth variable, and this component is documented to be mounted on
 * the same condition.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Colourbar } from "@/components/charts/Colourbar";
import { sequential } from "@/lib/charts/sequential";

describe("a colourbar says what its colour measures", () => {
  it("names the variable and its unit", () => {
    render(<Colourbar ramp={sequential} min={20} max={120}
                      label="Dispersion" unit="bps" />);
    expect(screen.getByText("Dispersion (bps)")).toBeTruthy();
  });

  it("drops the parentheses when there is no unit to put in them", () => {
    // "Residual ()" is the shape this goes wrong in, and it looks like a bug
    // in the data rather than in the legend.
    render(<Colourbar ramp={sequential} min={0} max={1} label="Residual" />);
    expect(screen.getByText("Residual")).toBeTruthy();
    expect(screen.queryByText(/Residual \(/)).toBeNull();
  });

  it("labels the scale between its ends, not only at them", () => {
    /**
     * The bar this replaces had two numbers, one at each corner. A reader with
     * a patch of colour in the middle of that has to guess whether the ramp is
     * linear, and viridis is not linear in hue.
     */
    render(<Colourbar ramp={sequential} min={20} max={120}
                      label="Dispersion" unit="bps" />);
    for (const text of ["20", "40", "60", "80", "100", "120"]) {
      expect(screen.getByText(text), `tick ${text}`).toBeTruthy();
    }
  });

  it("writes its ticks the way the axes do", () => {
    // The same formatter as the 3D axes, so a figure does not carry two
    // conventions for the same number.
    render(<Colourbar ramp={sequential} min={1e6} max={9e6}
                      label="Notional" unit="$" />);
    expect(screen.getByText("2×10⁶")).toBeTruthy();
    expect(screen.getByText("8×10⁶")).toBeTruthy();
  });

  it("names both ends of the range where a screen reader will find it", () => {
    /**
     * The gradient is the part of this with no text in it, so it is the part
     * that needs describing. Read aloud, "Dispersion (bps), colour scale from
     * 20 to 120" is the whole of what the picture says.
     */
    render(<Colourbar ramp={sequential} min={20} max={120}
                      label="Dispersion" unit="bps" />);
    const bar = screen.getByRole("img");
    const said = bar.getAttribute("aria-label") ?? "";
    expect(said).toContain("Dispersion (bps)");
    expect(said).toContain("20");
    expect(said).toContain("120");
  });

  it("leaves the tick numbers as text a reader can select and search", () => {
    /**
     * `role="img"` hides everything inside it from a screen reader, so putting
     * it on the whole legend would trade six readable labels for one sentence.
     * It sits on the bar; the numbers stay ordinary markup.
     */
    render(<Colourbar ramp={sequential} min={20} max={120}
                      label="Dispersion" unit="bps" />);
    expect(screen.getByRole("img").textContent).toBe("");
    expect(screen.getByText("60").tagName).toBe("SPAN");
  });

  it("puts the larger value higher up the bar", () => {
    // Every axis on the page reads upwards, and a reader assumes this one does
    // too rather than checking.
    render(<Colourbar ramp={sequential} min={0} max={100} label="Depth" />);
    const low = screen.getByText("20").getAttribute("style") ?? "";
    const high = screen.getByText("80").getAttribute("style") ?? "";
    expect(low).toContain("bottom: 20%");
    expect(high).toContain("bottom: 80%");
  });

  it("samples the chart's own ramp rather than keeping a second copy", () => {
    /**
     * A legend drawn from its own gradient is a second implementation of the
     * scale, and the one nobody edits becomes the one that is wrong. The
     * function the chart paints with is the function the key is drawn from.
     */
    const asked: number[] = [];
    const ramp = (t: number) => { asked.push(t); return "rgb(0,0,0)"; };
    render(<Colourbar ramp={ramp} min={0} max={1} label="Level" />);
    expect(asked.length).toBeGreaterThan(8);
    expect(Math.min(...asked)).toBe(0);
    expect(Math.max(...asked)).toBe(1);
  });

  it("shows one swatch for a variable that is the same everywhere", () => {
    /**
     * A fourth variable that turned out constant. The chart paints one colour,
     * so a key with a gradient on it would offer a scale the picture does not
     * contain — and a reader who compares two patches of the same colour
     * against a graded bar will find a difference that is not there.
     */
    render(<Colourbar ramp={sequential} min={4} max={4} label="Cohort" />);
    const mark = screen.getByText("4").getAttribute("style") ?? "";
    expect(mark).toContain("bottom: 50%");
    expect(mark).not.toContain("NaN");
    const bar = (screen.getByRole("img").getAttribute("style") ?? "")
      .replace(/\s+/g, "");
    expect(bar).not.toContain("gradient");
    expect(bar).toContain(sequential(0.5).replace(/\s+/g, ""));
    expect(screen.getByRole("img").getAttribute("aria-label"))
      .toContain("single value 4");
  });
});
