/**
 * The refusals, and the claims that must never quietly disappear.
 *
 * These primitives are worth testing for one reason: each of them can produce a
 * picture that looks correct and is wrong, and in every case the wrong picture
 * is the one a library produces by default. A treemap that renders a −40 at the
 * size of a +40 does not throw. A Sankey whose stages do not balance does not
 * throw. A UMAP plot with numbered axes does not throw.
 *
 * So the assertions here are mostly about what is *said*, not what is drawn.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Hierarchy, TreeNode } from "@/components/charts/Hierarchy";
import { Ribbon, FlowNode, FlowLink } from "@/components/charts/Ribbon";
import { SetRegions } from "@/components/charts/SetRegions";
import { Projection, Projected } from "@/components/charts/Projection";
import { Radial, Spoke } from "@/components/charts/Radial";
import { PRIMITIVES } from "@/lib/primitives";

const positive: TreeNode = {
  id: "r", label: "Root",
  children: [
    { id: "a", label: "Alpha", value: 60 },
    { id: "b", label: "Beta", value: 40 },
  ],
};

describe("P7 hierarchies", () => {
  it("refuses a negative value rather than drawing its absolute value", () => {
    const withNegative: TreeNode = {
      id: "r", label: "Root",
      children: [
        { id: "a", label: "Alpha", value: 60 },
        { id: "b", label: "Beta", value: -40 },
      ],
    };
    render(<Hierarchy root={withNegative} valueLabel="cases" />);

    expect(screen.getByText(/cannot be drawn as areas/i)).toBeInTheDocument();
    // The offending value is named, because "render failed" is not actionable.
    expect(screen.getByText(/Beta is -40/)).toBeInTheDocument();
    expect(document.querySelectorAll(".tree-tile").length).toBe(0);
  });

  it("names a leaf with no value rather than treating it as zero", () => {
    const missing: TreeNode = {
      id: "r", label: "Root",
      children: [
        { id: "a", label: "Alpha", value: 60 },
        { id: "b", label: "Beta" },
      ],
    };
    render(<Hierarchy root={missing} valueLabel="cases" />);
    expect(screen.getByText(/Beta has no value/)).toBeInTheDocument();
  });

  it("prints each value rather than leaving areas to be compared by eye", () => {
    render(<Hierarchy root={positive} valueLabel="passages" width={600}
                      height={400} />);
    expect(document.querySelectorAll(".tree-tile").length).toBeGreaterThan(0);
    expect(screen.getByText(/Areas are reliable for large differences/i))
      .toBeInTheDocument();
  });
});

describe("P9 ribbon flows", () => {
  const nodes: FlowNode[] = [
    { id: "in", label: "Screened" },
    { id: "mid", label: "Enrolled" },
    { id: "out", label: "Analysed" },
  ];

  it("reports a stage that does not balance instead of absorbing it", () => {
    // 100 in, 80 out — twenty participants are unaccounted for.
    const links: FlowLink[] = [
      { source: "in", target: "mid", value: 100 },
      { source: "mid", target: "out", value: 80 },
    ];
    render(<Ribbon nodes={nodes} links={links} unitLabel="participants" />);

    expect(screen.getByText(/do not balance/i)).toBeInTheDocument();
    expect(screen.getByText(/Enrolled received 100 and emits 80/))
      .toBeInTheDocument();
  });

  it("reports the same gap as measured attrition when that is what it is", () => {
    const links: FlowLink[] = [
      { source: "in", target: "mid", value: 100 },
      { source: "mid", target: "out", value: 80 },
    ];
    render(<Ribbon nodes={nodes} links={links} unitLabel="participants"
                   attritionIsExpected />);

    expect(screen.getByText(/20 unaccounted/)).toBeInTheDocument();
    expect(screen.queryByText(/do not balance/i)).not.toBeInTheDocument();
  });

  it("says nothing about balance when every stage balances", () => {
    const links: FlowLink[] = [
      { source: "in", target: "mid", value: 100 },
      { source: "mid", target: "out", value: 100 },
    ];
    render(<Ribbon nodes={nodes} links={links} unitLabel="participants" />);
    expect(screen.getByText(/Every stage balances/i)).toBeInTheDocument();
  });

  it("refuses a cycle rather than dropping an edge to make it a DAG", () => {
    const cyclic: FlowLink[] = [
      { source: "in", target: "mid", value: 100 },
      { source: "mid", target: "out", value: 60 },
      { source: "out", target: "mid", value: 60 },
    ];
    render(<Ribbon nodes={nodes} links={cyclic} unitLabel="manuscripts" />);

    expect(screen.getByText(/contain a cycle/i)).toBeInTheDocument();
    // Dropping an edge would change the totals, so nothing is drawn.
    expect(document.querySelectorAll(".ribbon-link").length).toBe(0);
  });

  it("tolerates the rounding error of flows built from percentages", () => {
    const rounded: FlowLink[] = [
      { source: "in", target: "mid", value: 0.1 + 0.2 },
      { source: "mid", target: "out", value: 0.3 },
    ];
    render(<Ribbon nodes={nodes} links={rounded} unitLabel="share" />);
    expect(screen.getByText(/Every stage balances/i)).toBeInTheDocument();
  });
});

describe("P10 set regions", () => {
  const sets = [
    { id: "x", label: "Reports MIC" },
    { id: "y", label: "Reports outcome" },
    { id: "z", label: "Shares raw data" },
  ];

  it("shows a combination with no members instead of omitting the row", () => {
    // Nothing is in both "Reports MIC" and "Shares raw data".
    const members = [
      { id: "1", label: "A", sets: ["x"] },
      { id: "2", label: "B", sets: ["x", "y"] },
      { id: "3", label: "C", sets: ["z"] },
    ];
    render(<SetRegions sets={sets} members={members} itemLabel="papers" />);

    expect(screen.getByText(/have no papers at all|has no papers at all/i))
      .toBeInTheDocument();
    expect(screen.getByText(/Reports MIC \+ Shares raw data/)).toBeInTheDocument();
  });

  it("states that rows are exclusive, so they sum rather than overlap", () => {
    const members = [{ id: "1", label: "A", sets: ["x", "y"] }];
    render(<SetRegions sets={sets} members={members} itemLabel="papers" />);
    expect(screen.getByText(/belongs to those sets and no others/i))
      .toBeInTheDocument();
  });
});

describe("P11 embedding projections", () => {
  const points: Projected[] = [
    { id: "a", label: "One", x: 0, y: 0, neighbours: [{ id: "b", distance: 0.1 }] },
    { id: "b", label: "Two", x: 1, y: 1 },
    { id: "c", label: "Three", x: 4, y: 4 },
  ];

  it("says distance between clusters is meaningless for UMAP", () => {
    render(<Projection points={points} method="umap"
                       parameters={{ n_neighbors: 15 }} />);
    expect(screen.getByText(/carries no meaning here/i)).toBeInTheDocument();
  });

  it("does not say that for PCA, which preserves global distance", () => {
    render(<Projection points={points} method="pca" parameters={{}}
                       varianceExplained={[0.41, 0.22]} />);
    expect(screen.queryByText(/carries no meaning here/i)).not.toBeInTheDocument();
    // …but it does bound the claim by how much variance was kept.
    expect(screen.getByText(/63% of variance/)).toBeInTheDocument();
  });

  it("prints the parameters that produced the layout", () => {
    render(<Projection points={points} method="tsne"
                       parameters={{ perplexity: 30, seed: 42 }} />);
    expect(screen.getByText(/perplexity 30, seed 42/)).toBeInTheDocument();
  });

  it("draws no numbered axis, because the axes have no units", () => {
    render(<Projection points={points} method="umap" parameters={{}} />);
    expect(document.querySelectorAll(".chart-tick").length).toBe(0);
    expect(screen.getByText(/axes have no units/i)).toBeInTheDocument();
  });
});

describe("P8 radial", () => {
  const spokes: Spoke[] = [
    { id: "a", label: "A", value: 10 },
    { id: "b", label: "B", value: 20 },
    { id: "c", label: "C", value: 30 },
  ];

  it("draws bars instead of a ring when the data does not wrap", () => {
    render(<Radial spokes={spokes} valueLabel="papers" cycleLabel="journal"
                   cyclical={false} />);
    expect(document.querySelectorAll(".radial-bar").length).toBe(0);
    expect(screen.getByText(/does not wrap/i)).toBeInTheDocument();
  });

  it("encodes radius as the square root so equal areas mean equal values", () => {
    render(<Radial spokes={spokes} valueLabel="doses" cycleLabel="hour of day" />);
    expect(document.querySelectorAll(".radial-bar").length).toBe(3);
    expect(screen.getByText(/square root of the value/i)).toBeInTheDocument();
  });
});

describe("the primitive registry", () => {
  it("gives every primitive a distinct code and id", () => {
    expect(new Set(PRIMITIVES.map((p) => p.code)).size).toBe(PRIMITIVES.length);
    expect(new Set(PRIMITIVES.map((p) => p.id)).size).toBe(PRIMITIVES.length);
  });

  it("keeps the marketing count derived rather than written down", () => {
    // The landing page renders these numbers. If a primitive regresses, the
    // claim on the marketing page has to move with it — which is the point of
    // deriving it rather than typing a sentence.
    const rendering = PRIMITIVES.filter((p) => p.status === "renders").length;
    expect(rendering).toBeGreaterThan(0);
    expect(rendering).toBeLessThanOrEqual(PRIMITIVES.length);
  });

  it("states what each shipped primitive guards against", () => {
    for (const p of PRIMITIVES.filter((x) => x.status === "renders")) {
      expect(p.guards, `${p.code} has no stated guard`).toBeTruthy();
    }
  });
});
