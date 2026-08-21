/**
 * T011 — the charts respond to a pointer, and say what the numbers are.
 *
 * `recommend.py` declares `interaction: ["hover", "brush", "underlying_table"]`
 * on every scatter and hexbin. Before this, only the table existed: eight of
 * thirteen primitives had no interaction handlers at all, and the rest offered
 * a native SVG `<title>` — a browser tooltip that appears after about a second,
 * cannot be positioned, and shows nothing on touch.
 *
 * These assert the behaviour a reader gets, not that a handler is attached.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Cartesian } from "@/components/charts/Cartesian";
import { Interval } from "@/components/charts/Interval";
import { Matrix } from "@/components/charts/Matrix";
import { Binned } from "@/components/charts/Binned";
import { Density } from "@/components/charts/Density";

const POINTS = [
  { id: "a", x: 10, y: 1.5 },
  { id: "b", x: 20, y: 2.5 },
  { id: "c", x: 30, y: 3.5 },
];

function scatter(extra = {}) {
  return render(
    <Cartesian mark="point" xLabel="Antibiotic consumption" yLabel="Resistance"
               data={POINTS} {...extra} />);
}

describe("hovering a mark", () => {
  it("shows the values, not a browser tooltip", () => {
    const { container } = scatter();
    const marks = container.querySelectorAll("circle.chart-point");
    expect(marks).toHaveLength(3);

    // The old affordance must be gone: a native <title> is what this replaces.
    expect(container.querySelectorAll("circle.chart-point title")).toHaveLength(0);
    expect(document.querySelector(".chart-tip")).toBeNull();

    fireEvent.mouseEnter(marks[1], { clientX: 300, clientY: 200 });

    const tip = document.querySelector(".chart-tip");
    expect(tip, "no tooltip appeared on hover").not.toBeNull();
    // The axis labels name the values, so the tooltip is readable on its own.
    expect(within(tip as HTMLElement).getByText("Antibiotic consumption")).toBeInTheDocument();
    expect(within(tip as HTMLElement).getByText("20")).toBeInTheDocument();
    expect(within(tip as HTMLElement).getByText("2.5")).toBeInTheDocument();
  });

  it("lifts the hovered mark and recedes the others", () => {
    const { container } = scatter();
    const marks = container.querySelectorAll("circle.chart-point");

    for (const mark of marks) {
      expect((mark as SVGElement).style.opacity).toBe("1");
    }

    fireEvent.mouseEnter(marks[0], { clientX: 100, clientY: 100 });

    // Neighbourhood reaction, not global reaction: one lifts, the rest recede
    // rather than vanish — context has to survive the hover.
    expect((marks[0] as SVGElement).style.opacity).toBe("1");
    expect(Number((marks[1] as SVGElement).style.opacity)).toBeLessThan(1);
    expect(Number((marks[1] as SVGElement).style.opacity)).toBeGreaterThan(0);
    expect(marks[0].getAttribute("r")).not.toBe(marks[1].getAttribute("r"));
  });

  it("clears when the pointer leaves", () => {
    const { container } = scatter();
    const marks = container.querySelectorAll("circle.chart-point");
    fireEvent.mouseEnter(marks[0], { clientX: 100, clientY: 100 });
    expect(document.querySelector(".chart-tip")).not.toBeNull();
    fireEvent.mouseLeave(marks[0]);
    expect(document.querySelector(".chart-tip")).toBeNull();
  });

  it("shows the same tooltip on keyboard focus, positioned over the mark", () => {
    // A tooltip only a mouse can summon is not an affordance for everybody.
    const { container } = scatter();
    const marks = container.querySelectorAll("circle.chart-point");
    fireEvent.focus(marks[2]);
    expect(document.querySelector(".chart-tip")).not.toBeNull();
    fireEvent.blur(marks[2]);
    expect(document.querySelector(".chart-tip")).toBeNull();
  });
});

describe("the chart and its table share one highlight", () => {
  it("lights the row for the hovered mark", () => {
    const { container } = scatter();
    const marks = container.querySelectorAll("circle.chart-point");
    expect(container.querySelectorAll("tr.is-highlighted")).toHaveLength(0);

    fireEvent.mouseEnter(marks[1], { clientX: 1, clientY: 1 });

    const lit = container.querySelectorAll("tr.is-highlighted");
    expect(lit, "hovering a mark did not light its row").toHaveLength(1);
    expect(lit[0].textContent).toContain("20");
  });

  it("lights the mark for the hovered row", () => {
    const { container } = scatter();
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(3);

    fireEvent.mouseEnter(rows[0]);

    // The link runs both ways, which is what makes the table an index of the
    // figure rather than an appendix to it.
    const marks = container.querySelectorAll("circle.chart-point");
    expect((marks[0] as SVGElement).style.opacity).toBe("1");
    expect(Number((marks[1] as SVGElement).style.opacity)).toBeLessThan(1);
  });
});

describe("brushing a range", () => {
  it("reports what was selected, in the reader's units", () => {
    const { container } = scatter();
    const surface = container.querySelector("rect.chart-brush-surface");
    expect(surface, "no brush surface on a continuous scatter").not.toBeNull();

    fireEvent.mouseDown(surface!, { clientX: 0 });
    fireEvent.mouseMove(surface!, { clientX: 400 });
    fireEvent.mouseUp(surface!);

    const readout = container.querySelector(".chart-selection");
    expect(readout, "brushing produced no readout").not.toBeNull();
    // A count of selected points, not a pixel range.
    expect(readout!.textContent).toMatch(/\d+ of 3 selected/);
    expect(readout!.textContent).toContain("Antibiotic consumption");
  });

  it("can be cleared", () => {
    const { container } = scatter();
    const surface = container.querySelector("rect.chart-brush-surface")!;
    fireEvent.mouseDown(surface, { clientX: 0 });
    fireEvent.mouseMove(surface, { clientX: 400 });
    fireEvent.mouseUp(surface);
    expect(container.querySelector(".chart-selection")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(container.querySelector(".chart-selection")).toBeNull();
  });

  it("is absent on a categorical axis, where a range means nothing", () => {
    const { container } = render(
      <Cartesian mark="rect" xLabel="Country" yLabel="Resistance"
                 data={[{ id: "a", x: "IND", y: 1 }, { id: "b", x: "USA", y: 2 }]} />);
    expect(container.querySelector("rect.chart-brush-surface")).toBeNull();
  });
});

describe("the forest plot", () => {
  it("shows an estimate's interval and its correction verdict on hover", () => {
    const { container } = render(
      <Interval xLabel="correlation" estimates={[
        { id: "1", label: "consumption vs resistance", estimate: 0.85,
          lo: 0.7, hi: 0.94, significant: true, n: 120 },
        { id: "2", label: "GDP vs resistance", estimate: 0.02,
          lo: -0.2, hi: 0.24, significant: false },
      ]} />);

    const rows = container.querySelectorAll("g.chart-row");
    expect(rows).toHaveLength(2);
    fireEvent.mouseEnter(rows[0], { clientX: 10, clientY: 10 });

    const tip = document.querySelector(".chart-tip") as HTMLElement;
    expect(tip).not.toBeNull();
    expect(within(tip).getByText("consumption vs resistance")).toBeInTheDocument();
    expect(within(tip).getByText("0.7 to 0.94")).toBeInTheDocument();
    expect(within(tip).getByText("excludes the null")).toBeInTheDocument();
    expect(Number((rows[1] as SVGElement).style.opacity)).toBeLessThan(1);
  });
});


describe("the correlation matrix", () => {
  // Reached by real analyses through figures.tsx, not gallery-only — which I
  // had wrongly filed as already-interactive because it owned a little hover
  // state of its own. It had no tooltip, no emphasis and no link to its table.
  const CELLS = [
    { row: "consumption", column: "resistance", value: 0.88 },
    { row: "consumption", column: "gdp", value: 0.02 },
    { row: "resistance", column: "gdp", value: -0.04 },
  ];

  function matrix() {
    return render(
      <Matrix rows={["consumption", "resistance"]} columns={["resistance", "gdp"]}
              cells={CELLS} valueLabel="correlation" />);
  }

  it("shows the pair and its value on hover", () => {
    const { container } = matrix();
    const cells = container.querySelectorAll("rect.chart-cell");
    expect(cells.length).toBeGreaterThan(0);

    fireEvent.mouseEnter(cells[0], { clientX: 40, clientY: 40 });
    const tip = document.querySelector(".chart-tip") as HTMLElement;
    expect(tip, "no tooltip on a matrix cell").not.toBeNull();
    expect(within(tip).getByText("correlation")).toBeInTheDocument();
  });

  it("recedes the cells that are not hovered", () => {
    const { container } = matrix();
    const cells = container.querySelectorAll("rect.chart-cell");
    fireEvent.mouseEnter(cells[0], { clientX: 1, clientY: 1 });
    const others = [...cells].slice(1)
      .map((c) => Number((c as SVGElement).style.opacity));
    expect(others.some((o) => o < 1), "no cell receded").toBe(true);
  });

  it("lights the matching table row", () => {
    const { container } = matrix();
    const cells = container.querySelectorAll("rect.chart-cell");
    fireEvent.mouseEnter(cells[0], { clientX: 1, clientY: 1 });
    expect(container.querySelectorAll("tr.is-highlighted").length).toBe(1);
  });
});

describe("every wired primitive actually responds", () => {
  // The regression this catches, exactly: `Binned` and `Density` were shipped
  // with the hook declared and a <ChartTooltip> rendered, and no `markProps`
  // on any mark. Nothing could ever set `hovered`, so the tooltip was
  // unreachable — a declared affordance with nothing behind it, which is the
  // defect class this whole file exists to close.
  it("attaches markProps wherever it declares the hook", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "..", "components", "charts");

    const broken: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(join(dir, file), "utf8");
      // interaction.tsx defines the hook rather than consuming it.
      if (file === "interaction.tsx" || file === "ChartTable.tsx") continue;
      if (!src.includes("useChartHover()")) continue;
      if (!src.includes("markProps(")) broken.push(`${file}: hook but no markProps`);
      if (!src.includes(".emphasis(")) broken.push(`${file}: hook but no emphasis`);
    }
    expect(broken, broken.join("; ")).toEqual([]);
  });
});

describe("the binned figure", () => {
  it("names the cell and its count on hover", () => {
    const { container } = render(
      <Binned xLabel="consumption" yLabel="resistance" binCount={4} sampleSize={5000}
              cells={[{ x: 1, y: 2, count: 40 }, { x: 3, y: 4, count: 7 }]} />);
    const marks = container.querySelectorAll("polygon");
    expect(marks.length).toBeGreaterThan(0);
    fireEvent.mouseEnter(marks[0], { clientX: 5, clientY: 5 });
    const tip = document.querySelector(".chart-tip") as HTMLElement;
    expect(tip, "the binned tooltip never fired").not.toBeNull();
    expect(within(tip).getByText("observations")).toBeInTheDocument();
  });
});

describe("the density plot", () => {
  it("names the curve on hover", () => {
    const { container } = render(
      <Density xLabel="resistance" curves={[
        { id: "a", label: "Treated", x: [1, 2, 3], density: [0.1, 0.4, 0.2], n: 60 },
        { id: "b", label: "Control", x: [1, 2, 3], density: [0.2, 0.3, 0.1], n: 55 },
      ]} />);
    const groups = container.querySelectorAll("path.chart-density");
    expect(groups.length).toBe(2);
    fireEvent.mouseEnter(groups[0].parentElement!, { clientX: 5, clientY: 5 });
    const tip = document.querySelector(".chart-tip") as HTMLElement;
    expect(tip, "the density tooltip never fired").not.toBeNull();
    expect(within(tip).getByText("Treated")).toBeInTheDocument();
  });
});
