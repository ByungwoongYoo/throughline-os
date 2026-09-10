/**
 * The cockpit reads one run five ways, and the keyboard has to get there.
 *
 * Two different claims live here and both would fail quietly.
 *
 * The first is the keyboard contract. A tablist that answers only a mouse is
 * the §30 defect this project has already fixed twice, and it looks perfect in
 * a screenshot. What makes it right is that only the SELECTED tab is in the
 * page's tab order — otherwise reaching the panel costs five presses — and that
 * the arrows move between them.
 *
 * The second is what a tab says before it is opened. The run this was built
 * against has nine assumption checks and one violation, and a badge reading "9"
 * would be true, useless, and would hide the only thing on that tab worth
 * knowing.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tabs } from "@/components/Tabs";
import { assumptionNote } from "@/components/views";

function check(name: string, outcome: string) {
  return { name, outcome, detail: "", statistic: null, p_value: null, severity: "" };
}

function threeTabs() {
  return [
    { id: "a", label: "Result", panel: () => <p>the estimate</p> },
    { id: "b", label: "Specification", panel: () => <p>what was asked for</p> },
    { id: "c", label: "Assumptions", note: "1 of 9 failed", panel: () => <p>the checks</p> },
  ];
}

describe("several readings of one object", () => {
  it("opens on the first reading and shows only that panel", () => {
    render(<Tabs label="Readings" tabs={threeTabs()} />);
    expect(screen.getByRole("tab", { name: /Result/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("the estimate")).toBeInTheDocument();
    expect(screen.queryByText("what was asked for")).not.toBeInTheDocument();
  });

  it("keeps only the selected tab in the page's tab order", async () => {
    const user = userEvent.setup();
    render(<Tabs label="Readings" tabs={threeTabs()} />);

    // The whole point: one stop for the strip, not one per tab.
    expect(screen.getByRole("tab", { name: /Result/ }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: /Specification/ }).tabIndex).toBe(-1);
    expect(screen.getByRole("tab", { name: /Assumptions/ }).tabIndex).toBe(-1);

    await user.click(screen.getByRole("tab", { name: /Specification/ }));
    expect(screen.getByRole("tab", { name: /Specification/ }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: /Result/ }).tabIndex).toBe(-1);
  });

  it("moves between readings with the arrows, and wraps", async () => {
    const user = userEvent.setup();
    render(<Tabs label="Readings" tabs={threeTabs()} />);

    await user.click(screen.getByRole("tab", { name: /Result/ }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("what was asked for")).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("the estimate")).toBeInTheDocument();

    // Left from the first lands on the last rather than doing nothing.
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("the checks")).toBeInTheDocument();

    await user.keyboard("{Home}");
    expect(screen.getByText("the estimate")).toBeInTheDocument();

    await user.keyboard("{End}");
    expect(screen.getByText("the checks")).toBeInTheDocument();
  });

  it("names the panel by its tab, so a screen reader says which reading it is", () => {
    render(<Tabs label="Readings" tabs={threeTabs()} />);
    const panel = screen.getByRole("tabpanel");
    const tab = screen.getByRole("tab", { name: /Result/ });
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    expect(tab.getAttribute("aria-controls")).toBe(panel.id);
  });
});

describe("what the Assumptions tab says before it is opened", () => {
  it("reports the failures, not the count, when anything failed", () => {
    // The case this exists for: eight passes and one violation. "9" is true
    // and hides the only thing worth knowing.
    const checks = [
      ...Array.from({ length: 8 }, (_, i) => check(`normality[group${i}]`, "passed")),
      check("normality[group8]", "violated"),
    ];
    expect(assumptionNote(checks)).toBe("1 of 9 failed");
  });

  it("reports a plain count when everything passed", () => {
    expect(assumptionNote([check("a", "passed"), check("b", "passed")])).toBe("2");
  });

  it("says none rather than zero when the method declared no assumptions", () => {
    // §09: an unavailable field is shown honestly. "0" reads as a failure to
    // check; "none" reads as nothing to check.
    expect(assumptionNote([])).toBe("none");
  });

  it("counts a failure however the runtime worded it", () => {
    expect(assumptionNote([check("a", "VIOLATED")])).toBe("1 of 1 failed");
    expect(assumptionNote([check("a", "failed")])).toBe("1 of 1 failed");
  });
});
