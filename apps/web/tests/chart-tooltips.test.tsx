/**
 * Two charts whose hover reported nothing.
 *
 * `SetRegions` mounted a tooltip with `const hit = null` above it and
 * `rows={[]}` inside it, so hovering a combination dimmed the others and said
 * nothing — on a chart whose entire content is how many items fall in each
 * combination. The highlight worked, which is what made it look finished, and
 * the unused `readable` import was the evidence of what had been intended.
 *
 * `Ribbon` reported `id: cohort_a`, which a reader can already see on the axis,
 * and which that file's own rule calls a raw name a label should never be.
 *
 * Neither chart had a test of any kind.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetRegions } from "@/components/charts/SetRegions";
import { Ribbon, flowThrough } from "@/components/charts/Ribbon";

const SETS = [
  { id: "trial", label: "Randomised trials" },
  { id: "cohort", label: "Cohort studies" },
];

const MEMBERS = [
  { id: "p1", label: "Karim 2019", sets: ["trial"] },
  { id: "p2", label: "Osei 2020", sets: ["trial", "cohort"] },
  { id: "p3", label: "Lund 2021", sets: ["trial", "cohort"] },
];

/**
 * Hover a mark the way the chart's own helper expects.
 *
 * `markProps` listens for mouse events, not pointer events, and the tooltip
 * renders nothing until a pointer position has been tracked — so entering
 * without moving shows nothing, which is correct and is why both are sent.
 */
function hover(mark: Element) {
  fireEvent.mouseEnter(mark, { clientX: 40, clientY: 40 });
  fireEvent.mouseMove(mark, { clientX: 40, clientY: 40 });
}

describe("an intersection reports how many items are in it", () => {
  it("names the combination and its count", () => {
    const { container } = render(
      <SetRegions sets={SETS} members={MEMBERS} itemLabel="papers" />);

    const rows = container.querySelectorAll(".upset-row");
    expect(rows.length).toBeGreaterThan(0);
    hover(rows[0]);

    const tip = screen.getByRole("status");
    // The largest combination first: two papers are in both sets.
    expect(tip.textContent).toContain("Randomised trials and Cohort studies");
    expect(tip.textContent).toContain("papers");
    expect(tip.textContent).toContain("2");
  });

  it("says an empty combination has none in common, not '0'", () => {
    /*
     * Combinations that do not occur are enumerated on purpose, because "no
     * item is in both of these" is a finding. A bare 0 beside a count reads as
     * a missing value rather than as that finding.
     */
    const apart = [
      { id: "p1", label: "Karim 2019", sets: ["trial"] },
      { id: "p2", label: "Osei 2020", sets: ["cohort"] },
    ];
    const { container } = render(
      <SetRegions sets={SETS} members={apart} itemLabel="papers" />);

    const rows = [...container.querySelectorAll(".upset-row")];
    // The empty pairwise row is the one covering both sets.
    const both = rows[rows.length - 1];
    hover(both);
    expect(screen.getByRole("status").textContent).toContain("none in common");
  });

  it("shows nothing while nothing is hovered", () => {
    render(<SetRegions sets={SETS} members={MEMBERS} itemLabel="papers" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a flow node reports its throughput, not its identifier", () => {
  const NODES = [
    { id: "screened", label: "Screened" },
    { id: "eligible", label: "Eligible" },
    { id: "enrolled", label: "Enrolled" },
  ];
  const LINKS = [
    { source: "screened", target: "eligible", value: 80 },
    { source: "eligible", target: "enrolled", value: 55 },
  ];

  it("counts what passes through rather than doubling a middle node", () => {
    /*
     * The larger of what arrives and what leaves. Summing them would make a
     * node in the middle report twice its own throughput, so comparing it with
     * an endpoint would compare two different quantities.
     */
    expect(flowThrough(LINKS, "screened")).toBe(80);
    expect(flowThrough(LINKS, "eligible")).toBe(80);
    expect(flowThrough(LINKS, "enrolled")).toBe(55);
    expect(flowThrough(LINKS, "absent")).toBe(0);
  });

  it("puts the throughput in the tooltip instead of the id", () => {
    const { container } = render(<Ribbon nodes={NODES} links={LINKS} unitLabel="participants" />);
    const marks = container.querySelectorAll(".ribbon-node");
    expect(marks.length).toBeGreaterThan(0);
    hover(marks[0]);

    const tip = screen.getByRole("status");
    expect(tip.textContent).toContain("total flow");
    expect(tip.textContent).not.toContain("screened");
  });
});
