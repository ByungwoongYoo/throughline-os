/**
 * The chart on screen belongs to the family the reader is looking at.
 *
 * Filtering the catalogue to "Volume" left a Plane drawn above the list — a
 * Mathematical entry, sitting over thirteen volume entries that did not
 * include it, with nothing saying the two were unrelated. The reader is
 * looking at one thing and reading about others.
 *
 * Found by reading the rendered page rather than by the suite, which is now
 * the sixth time. The state was two `useState` calls that never consulted each
 * other, and nothing in a component test had ever changed the filter after
 * choosing a chart.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CatalogueBrowser } from "@/components/charts3d/CatalogueBrowser";
import { CATALOGUE } from "@/lib/charts3d/registry";

/** The family select, which is the only combobox this component renders. */
const familySelect = () => screen.getByRole("combobox");

const chooseChart = (name: string) => {
  const button = screen.getAllByRole("button")
    .find((b) => (b.textContent ?? "").startsWith(name));
  if (!button) throw new Error(`no catalogue button for ${name}`);
  fireEvent.click(button);
};

/** Whether a chart is currently drawn, by its figure caption. */
const drawnChart = () =>
  document.querySelector(".c3d-chosen figcaption")?.textContent ?? "";

describe("the filter and the drawn chart agree", () => {
  it("clears a chart that the chosen family does not contain", () => {
    render(<CatalogueBrowser />);
    chooseChart("Plane");
    expect(drawnChart()).toContain("Plane");

    const plane = CATALOGUE.find((v) => v.name === "Plane")!;
    expect(plane.family).not.toBe("Volume");

    fireEvent.change(familySelect(), { target: { value: "Volume" } });
    expect(drawnChart()).toBe("");
  });

  it("keeps a chart when the reader narrows to its own family", () => {
    /**
     * The reason this is not "always clear on change". Narrowing to the family
     * the current chart belongs to is a reader looking more closely at what
     * they already chose, and blanking it there would punish the gesture.
     */
    render(<CatalogueBrowser />);
    const plane = CATALOGUE.find((v) => v.name === "Plane")!;
    chooseChart("Plane");
    expect(drawnChart()).toContain("Plane");

    fireEvent.change(familySelect(), { target: { value: plane.family } });
    expect(drawnChart()).toContain("Plane");
  });

  it("keeps a chart when the reader goes back to All", () => {
    render(<CatalogueBrowser />);
    chooseChart("Plane");
    fireEvent.change(familySelect(), { target: { value: "All" } });
    expect(drawnChart()).toContain("Plane");
  });
});
