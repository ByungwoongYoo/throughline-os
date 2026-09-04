/**
 * Density colouring, and the three ways it could mislead.
 *
 * A scatter of twenty thousand observations in one colour is a blob: every
 * point is present, nothing is hidden, and the reader still cannot see where
 * the mass is. Colouring each point by how many share its cell is the largest
 * legibility gain available here — and it introduces a channel that can lie in
 * ways a plain scatter cannot:
 *
 * - the scale is local, so the same colour in two panels is two counts;
 * - colour cannot carry a category and a count at once;
 * - the ramp must order by lightness, or apparent structure in the picture is
 *   an artefact of the palette rather than a feature of the data.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Cartesian } from "@/components/charts/Cartesian";
import { BINS, densityNote, densityOf } from "@/lib/charts/density";
import { luma, sequential, sequentialChannels } from "@/lib/charts/sequential";

/** A dense core at the origin and a thin skirt around it. */
function coreAndSkirt() {
  const points = [];
  for (let i = 0; i < 400; i += 1) {
    points.push({ x: 0.5 + (i % 5) * 0.001, y: 0.5 + (i % 3) * 0.001 });
  }
  for (let i = 0; i < 40; i += 1) {
    points.push({ x: i / 40, y: 1 - i / 40 });
  }
  return points;
}

describe("where the mass is", () => {
  it("gives the crowded points a higher level than the lonely ones", () => {
    const points = coreAndSkirt();

    const { levels } = densityOf(points);

    expect(levels[0]).toBeGreaterThan(levels[levels.length - 1]);
  });

  it("ranks rather than scales, so a long tail is not one flat colour", () => {
    /**
     * Point density is heavy-tailed. On a linear ramp the core saturates and
     * the rest is a single dark blue — the blob again, in colour.
     */
    const points = coreAndSkirt();

    const { levels } = densityOf(points);
    const tail = new Set(levels.slice(400).map((l) => l.toFixed(3)));

    expect(tail.size).toBeGreaterThan(1);
  });

  it("gives equally busy cells the same colour", () => {
    // Ties share a rank, so a reader comparing two cells compares counts.
    const points = [
      { x: 0, y: 0 }, { x: 0, y: 0 },
      { x: 1, y: 1 }, { x: 1, y: 1 },
    ];

    const { levels } = densityOf(points);

    expect(levels[0]).toBe(levels[2]);
  });

  it("ranks among the distinct counts, not among the cells", () => {
    /**
     * Ranking among cells makes a cell's colour depend on how many *other*
     * cells share each count, so adding sparse cells shifts the colour of a
     * busy cell that did not change. Three counts here — 1, 2 and 5 — with two
     * cells holding 2, so the two rules give different answers: one half among
     * distinct values, two thirds among cells.
     */
    const at = (x: number, y: number, n: number) =>
      Array.from({ length: n }, () => ({ x, y }));
    const points = [
      ...at(0.0, 0.0, 1),
      ...at(0.5, 0.5, 2),
      ...at(0.9, 0.1, 2),
      ...at(1.0, 1.0, 5),
    ];

    const { levels } = densityOf(points);

    expect(levels[1]).toBeCloseTo(0.5, 6);
  });

  it("survives a dimension with no extent", () => {
    const flat = [{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }];

    expect(() => densityOf(flat)).not.toThrow();
    expect(densityOf(flat).levels).toHaveLength(3);
  });

  it("ignores a point with a missing coordinate rather than binning it at zero",
     () => {
    const points = [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 1, y: 1 }];

    const { levels, occupied } = densityOf(points);

    expect(levels[1]).toBe(0);
    expect(occupied).toBe(2);
  });

  it("says nothing about an empty plot", () => {
    expect(densityOf([]).levels).toEqual([]);
    expect(densityNote(densityOf([]), 0)).toBe("");
  });
});

describe("what the reader is told about the colour", () => {
  it("says the scale is local to this plot", () => {
    const note = densityNote(densityOf(coreAndSkirt()), 440);

    expect(note).toMatch(/scaled within this plot/);
    expect(note).toMatch(/cannot be compared between plots/);
  });

  it("says when it is showing fewer points than exist", () => {
    /**
     * A reader looking at 20,000 marks from 100,000 rows is looking at a real
     * distribution, and is owed the fact that it is a sample of one.
     */
    const note = densityNote(densityOf(coreAndSkirt()), 20000, 100000);

    expect(note).toMatch(/20,000 drawn of 100,000/);
  });

  it("does not claim a sample when everything is drawn", () => {
    const note = densityNote(densityOf(coreAndSkirt()), 440, 440);

    expect(note).not.toMatch(/drawn of/);
    expect(note).toMatch(/440 points/);
  });

  it("names the grid and the busiest cell", () => {
    const density = densityOf(coreAndSkirt());
    const note = densityNote(density, 440);

    expect(note).toContain(`${BINS}×${BINS}`);
    expect(note).toContain(String(density.peak));
  });
});

describe("the ramp orders by lightness", () => {
  it("never gets darker as the value rises", () => {
    /**
     * The property that makes it survive greyscale, a bad projector, and any
     * of the common colour deficiencies. A ramp that only orders by hue does
     * not, and a ramp with a bright band in the middle puts apparent structure
     * where the numbers are smooth — which is why the rainbow is wrong here.
     */
    let previous = -1;
    for (let i = 0; i <= 100; i += 1) {
      const here = luma(sequentialChannels(i / 100));
      expect(here).toBeGreaterThanOrEqual(previous - 0.5);
      previous = here;
    }
  });

  it("spans a wide lightness range, so the ends are far apart", () => {
    const low = luma(sequentialChannels(0));
    const high = luma(sequentialChannels(1));

    expect(high - low).toBeGreaterThan(120);
  });

  it("clamps rather than producing a colour outside the ramp", () => {
    expect(sequential(-5)).toBe(sequential(0));
    expect(sequential(5)).toBe(sequential(1));
    expect(sequential(NaN)).toBe(sequential(0));
  });
});

describe("the scatter itself", () => {
  /*
   * A dense clump and a sparse arm. Written first as an even grid, which put
   * exactly one point in every cell — so every point had the same density and
   * one colour was the *right* answer. A fixture with no structure cannot
   * show that structure is being drawn.
   */
  const DATA = [
    ...Array.from({ length: 50 }, (_, i) => ({
      id: `core${i}`, x: 0.5 + (i % 4) * 0.002, y: 0.5 + (i % 3) * 0.002,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `arm${i}`, x: i / 10, y: 1 - i / 10,
    })),
  ];

  it("colours by density when asked", () => {
    const { container } = render(
      <Cartesian data={DATA} mark="point" xLabel="x" yLabel="y"
                 densityColour />);

    const fills = new Set([...container.querySelectorAll("circle")]
      .map((c) => (c as SVGElement).style.fill));
    expect(fills.size).toBeGreaterThan(1);
    expect(screen.getByText(/scaled within this plot/)).toBeTruthy();
  });

  it("does not colour by density unless asked", () => {
    const { container } = render(
      <Cartesian data={DATA} mark="point" xLabel="x" yLabel="y" />);

    expect(container.querySelector(".chart-density-note")).toBeNull();
  });

  it("refuses density when the points already carry a group", () => {
    /**
     * Colour cannot say what a point is and how crowded it is at once. A
     * chart that tried would encode two things on one channel, and neither
     * would be readable.
     */
    const grouped = DATA.map((d, i) => ({ ...d, group: i % 2 ? "a" : "b" }));

    const { container } = render(
      <Cartesian data={grouped} mark="point" xLabel="x" yLabel="y"
                 densityColour />);

    expect(container.querySelector(".chart-density-note")).toBeNull();
  });
});
