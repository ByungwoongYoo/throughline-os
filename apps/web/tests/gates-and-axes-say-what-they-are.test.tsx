/**
 * Two things a plot has to say out loud: what a region contains, and what an
 * axis is drawn on.
 *
 * **The region.** A dragged-out region reporting a percentage is the most
 * quotable number on the screen, and the two ways it misleads are the
 * denominator and the noun. The denominator is what is *drawn*, which on a
 * sampled figure is not the dataset. The noun is nothing: it is a region
 * somebody dragged, not a cluster, a population or a group in any sense the
 * data has licensed — the rule `selection.py` states for the same reason.
 *
 * **The axis.** A log axis read as linear is wrong by orders of magnitude at
 * one end and nearly right at the other, which is the most convincing kind of
 * wrong. The renderer prints what the analysis recorded and never infers it —
 * and prints nothing for a linear axis, because a bracket that appears
 * everywhere is a bracket nobody reads.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Cartesian } from "@/components/charts/Cartesian";

/*
 * Eighty, and not a hundred — deliberately. Written with a hundred points, a
 * mutation replacing the denominator with the literal 100 passed every test
 * here, because `count / data.length` and `count / 100` are the same number
 * on a fixture of that size. A test whose fixture makes two rules agree
 * cannot tell them apart.
 */
const DATA = Array.from({ length: 80 }, (_, i) => ({
  id: `p${i}`, x: i, y: i % 7,
}));

function brushAcross(container: HTMLElement, from: number, to: number) {
  const surface = container.querySelector("rect.chart-brush-surface")!;
  fireEvent.mouseDown(surface, { clientX: from });
  fireEvent.mouseMove(surface, { clientX: to });
  fireEvent.mouseUp(surface);
}

describe("what a region says about itself", () => {
  it("prints its share on the region, not only underneath", () => {
    /**
     * A reader comparing two regions is looking at the plot. A number they
     * have to look away to find is one they will estimate from the picture.
     */
    const { container } = render(
      <Cartesian data={DATA} mark="point" xLabel="x" yLabel="y" />);

    brushAcross(container, 40, 200);

    const label = container.querySelector(".chart-brush-label");
    expect(label?.textContent).toMatch(/%/);
  });

  it("says the share is of what is drawn", () => {
    const { container } = render(
      <Cartesian data={DATA} mark="point" xLabel="x" yLabel="y" />);

    brushAcross(container, 40, 200);

    expect(container.querySelector(".chart-brush-label")!.textContent)
      .toMatch(/of drawn/);
    expect(screen.getByRole("status").textContent).toMatch(/drawn/);
  });

  it("calls it a region and never a group or a cluster", () => {
    /**
     * Points somebody dragged a box around are not a population. The moment
     * the interface calls them one, a gesture has become a result.
     */
    const { container } = render(
      <Cartesian data={DATA} mark="point" xLabel="x" yLabel="y" />);

    brushAcross(container, 40, 200);

    const said = screen.getByRole("status").textContent ?? "";
    expect(said).toMatch(/region/);
    for (const word of ["cluster", "population", "group of"]) {
      expect(said.toLowerCase()).not.toContain(word);
    }
  });

  it("counts and reports the same number", () => {
    // The share and the count must be two views of one arithmetic, or one of
    // them is decoration.
    const { container } = render(
      <Cartesian data={DATA} mark="point" xLabel="x" yLabel="y" />);

    // A partial region, so the count is neither zero nor everything and the
    // denominator actually has to be the right one.
    brushAcross(container, 0, 200);

    const said = screen.getByRole("status").textContent ?? "";
    const count = Number(/^([\d,]+) of/.exec(said)?.[1]?.replace(/,/g, ""));
    const share = Number(/\(([\d.]+)%\)/.exec(said)?.[1]);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(DATA.length);
    expect(share).toBeCloseTo((count / DATA.length) * 100, 1);
  });

  it("shows nothing before anybody has dragged one", () => {
    const { container } = render(
      <Cartesian data={DATA} mark="point" xLabel="x" yLabel="y" />);

    expect(container.querySelector(".chart-brush-label")).toBeNull();
  });
});

describe("what an axis says it is drawn on", () => {
  it("states a transform the analysis recorded", () => {
    const { container } = render(
      <Cartesian data={DATA} mark="point" xLabel="CD4" yLabel="CD8"
                 xTransform="asinh c=150" yTransform="log" />);
    const titles = [...container.querySelectorAll("text.chart-axis-label")]
      .map((t) => t.textContent);
    expect(titles).toContain("CD4 [asinh c=150]");
    expect(titles).toContain("CD8 [log]");
  });

  it("keeps the unit as well as the transform", () => {
    const { container } = render(
      <Cartesian data={DATA} mark="point" xLabel="Dose" yLabel="y"
                 xUnit="mg" xTransform="log" />);

    const titles = [...container.querySelectorAll("text.chart-axis-label")]
      .map((t) => t.textContent);
    expect(titles).toContain("Dose (mg) [log]");
  });

  it("says nothing when nothing was recorded", () => {
    /**
     * An axis reading "[linear]" everywhere trains a reader to skip the
     * brackets, and the brackets exist for the one case that matters.
     */
    const { container } = render(
      <Cartesian data={DATA} mark="point" xLabel="CD4" yLabel="CD8" />);

    const titles = [...container.querySelectorAll("text.chart-axis-label")]
      .map((t) => t.textContent);
    expect(titles).toContain("CD4");
    expect(titles.join(" ")).not.toContain("[");
  });
});
