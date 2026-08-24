/**
 * Placing a graph in space (§9 networks, §16 native).
 *
 * Thirty-five named visualizations are this one primitive, so these tests are
 * about the properties all thirty-five depend on rather than about any picture:
 * that the same graph lands the same way every time, that a missing endpoint is
 * reported rather than drawn to the origin, and that a layout whose depth
 * carries meaning is not arranged by how many edges each node happens to have.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT, Graph, describeLayout, layoutGraph, layoutLayered,
  neighboursOf,
} from "@/lib/charts3d/network";

const chain = (n: number): Graph => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}` })),
  edges: Array.from({ length: n - 1 }, (_, i) => ({
    source: `n${i}`, target: `n${i + 1}` })),
});

describe("the same graph always lands the same way", () => {
  it("is deterministic across runs", () => {
    /*
     * A force-directed layout seeded from a clock produces a different picture
     * every open. For a researcher comparing a network with the one in their
     * notes that is worse than an ugly layout — nothing is where they left it,
     * and the first conclusion is that the data changed.
     */
    const a = layoutGraph(chain(12));
    const b = layoutGraph(chain(12));
    expect(a.nodes.map((n) => [n.id, n.x, n.y, n.z]))
      .toEqual(b.nodes.map((n) => [n.id, n.x, n.y, n.z]));
  });

  it("does not depend on the order the nodes arrived in", () => {
    // Two queries returning the same graph in different orders are the same
    // graph, and a layout that disagreed would look like a change.
    const forward = layoutGraph(chain(8));
    const backward = layoutGraph({
      nodes: [...chain(8).nodes].reverse(),
      edges: chain(8).edges,
    });
    const at = (l: typeof forward, id: string) =>
      l.nodes.find((n) => n.id === id)!;
    expect(at(backward, "n3").x).toBeCloseTo(at(forward, "n3").x, 6);
  });
});

describe("it fills the space it is given", () => {
  it("normalises into the unit cube", () => {
    // The same cube every other spatial chart here uses, so the camera means
    // the same thing in a network as in a scatter.
    for (const node of layoutGraph(chain(20)).nodes) {
      for (const axis of [node.x, node.y, node.z]) {
        expect(axis).toBeGreaterThanOrEqual(-1.0001);
        expect(axis).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it("does not collapse into a disc", () => {
    /*
     * Nodes started uniformly through the cube flatten under repulsion,
     * because the shortest escape from the middle is outward in two
     * dimensions. Starting them on a sphere is what keeps the third one.
     */
    const nodes = layoutGraph(chain(40)).nodes;
    const spread = (pick: (n: typeof nodes[0]) => number) => {
      const values = nodes.map(pick);
      return Math.max(...values) - Math.min(...values);
    };
    expect(spread((n) => n.z)).toBeGreaterThan(1);
  });

  it("puts a single node in the middle rather than nowhere", () => {
    // A degenerate axis divided by its own zero span is NaN, and a NaN
    // position renders nothing while reporting no error.
    const [only] = layoutGraph({ nodes: [{ id: "a" }], edges: [] }).nodes;
    expect(Number.isFinite(only.x)).toBe(true);
    expect(only).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it("survives nodes pulled onto the same position", () => {
    /*
     * Repulsion divides by the distance between two nodes. Unfloored, a pair
     * that attraction has dragged together divides by zero, flies to infinity,
     * and takes the normalisation of every other node with it — one collapsed
     * pair and the whole graph renders as a dot.
     *
     * Two freshly seeded nodes never coincide, so an earlier version of this
     * test never created the condition and a mutation removing the floor
     * survived it. Attraction here is strong enough to collapse them.
     */
    const layout = layoutGraph(
      { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        edges: [{ source: "a", target: "b" }, { source: "b", target: "c" }] },
      { iterations: 400, attraction: 0.9, repulsion: 1e-9, damping: 0.9 });

    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x + node.y + node.z)).toBe(true);
    }
  });

  it("keeps the graph spread through depth rather than pooled in the middle", () => {
    /*
     * The signature of sphere seeding that survives normalisation, and it took
     * measuring to find — two earlier attempts asserted the wrong thing.
     *
     * Sampling the polar angle uniformly rather than by `acos(2u-1)` biases the
     * cloud, and after repulsion and normalisation the result is a graph
     * *pooled* in the middle of the depth axis: standard deviation 0.114
     * against 0.156, with 93% of nodes in the middle third against 72%. The
     * range is identical either way, because normalisation stretches each axis
     * to fill the cube — which is why a test measuring range saw nothing and a
     * mutation seeding uniformly survived it twice.
     *
     * My first explanation for this was also wrong: I expected uniform phi to
     * cluster at the poles, and it does the opposite once the layout relaxes.
     * The number is measured rather than reasoned.
     */
    const many = {
      nodes: Array.from({ length: 120 }, (_, i) => ({ id: `n${i}` })),
      edges: [],
    };
    const zs = layoutGraph(many).nodes.map((n) => n.z);
    const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
    const sd = Math.sqrt(
      zs.reduce((a, z) => a + (z - mean) ** 2, 0) / zs.length);

    expect(sd).toBeGreaterThan(0.26);
  });

});

describe("edges that cannot be drawn", () => {
  it("reports an edge whose other end is missing", () => {
    /*
     * A missing lookup silently draws to the origin — a spray of lines
     * converging on the centre that reads as a hub nobody put there. Reported
     * instead, because it usually means the query that built the graph missed
     * something and the researcher is looking at an incomplete picture.
     */
    const layout = layoutGraph({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ source: "a", target: "b" }, { source: "a", target: "ghost" }],
    });
    expect(layout.edges).toHaveLength(1);
    expect(layout.dangling).toHaveLength(1);
  });

  it("says so in words", () => {
    const layout = layoutGraph({
      nodes: [{ id: "a" }],
      edges: [{ source: "a", target: "ghost" }],
    });
    expect(describeLayout(layout)).toContain("could not be drawn");
  });

  it("drops an edge from a node to itself", () => {
    // A self-edge has no direction to be drawn in and becomes a dot on the
    // node, which reads as a rendering artefact.
    const layout = layoutGraph({
      nodes: [{ id: "a" }], edges: [{ source: "a", target: "a" }] });
    expect(layout.edges).toHaveLength(0);
  });

  it("places a node with a duplicated id only once", () => {
    // Two nodes with one identity make every edge ambiguous, and the second
    // sits on top of the first looking like a fault.
    const layout = layoutGraph({
      nodes: [{ id: "a" }, { id: "a" }, { id: "b" }], edges: [] });
    expect(layout.nodes).toHaveLength(2);
  });
});

describe("a layout whose depth means something", () => {
  it("orders layers by the depth it is given, not by connectivity", () => {
    /*
     * The provenance tree is why this exists. A result derives from runs which
     * derive from datasets, and that ordering *is* the information — a
     * force-directed layout would place those layers by how many edges each
     * node happens to have, which is the wrong picture told confidently.
     */
    const graph: Graph = {
      nodes: [
        { id: "result", group: "2" },
        { id: "run", group: "1" },
        { id: "dataset", group: "0" },
      ],
      edges: [
        { source: "run", target: "result" },
        { source: "dataset", target: "run" },
      ],
    };
    const layout = layoutLayered(graph, (n) => Number(n.group));
    const at = (id: string) => layout.nodes.find((n) => n.id === id)!;

    expect(at("dataset").y).toBeLessThan(at("run").y);
    expect(at("run").y).toBeLessThan(at("result").y);
  });

  it("spreads a wide layer rather than stacking it", () => {
    const graph: Graph = {
      nodes: Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, group: "0" })),
      edges: [],
    };
    const xs = layoutLayered(graph, () => 0).nodes.map((n) => n.x);
    expect(new Set(xs).size).toBe(5);
  });

  it("staggers a wide layer in depth", () => {
    // Otherwise a layer seen from the front is a line of overlapping discs.
    const graph: Graph = {
      nodes: Array.from({ length: 6 }, (_, i) => ({ id: `d${i}` })),
      edges: [],
    };
    const zs = new Set(layoutLayered(graph, () => 0).nodes.map((n) => n.z));
    expect(zs.size).toBeGreaterThan(1);
  });

  it("puts a single layer in the middle", () => {
    const layout = layoutLayered({ nodes: [{ id: "a" }], edges: [] }, () => 0);
    expect(layout.nodes[0].y).toBe(0);
  });
});

describe("what a node touches", () => {
  it("finds neighbours in both directions", () => {
    // "Show me everything connected to this" does not care which way the edge
    // was written, and a citation network read one way only would answer half
    // the question.
    const layout = layoutGraph({
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "far" }],
      edges: [{ source: "a", target: "b" }, { source: "c", target: "a" }],
    });
    expect(neighboursOf(layout, "a").map((n) => n.id).sort())
      .toEqual(["b", "c"]);
  });

  it("counts a doubly-connected neighbour once", () => {
    const layout = layoutGraph({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ source: "a", target: "b" }, { source: "b", target: "a" }],
    });
    expect(neighboursOf(layout, "a")).toHaveLength(1);
  });

  it("finds nothing for an unconnected node", () => {
    const layout = layoutGraph({ nodes: [{ id: "lonely" }], edges: [] });
    expect(neighboursOf(layout, "lonely")).toEqual([]);
  });
});

describe("what it says about itself", () => {
  it("counts nodes and edges", () => {
    expect(describeLayout(layoutGraph(chain(3)))).toBe("3 nodes, 2 edges.");
  });

  it("counts one of each as one", () => {
    const layout = layoutGraph({
      nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b" }] });
    expect(describeLayout(layout)).toContain("2 nodes, 1 edge.");
  });

  it("says plainly when there is nothing", () => {
    expect(describeLayout(layoutGraph({ nodes: [], edges: [] })))
      .toBe("Nothing to draw.");
  });
});

describe("the settings are a decision, not a magic number", () => {
  it("relaxes enough times to untangle a graph", () => {
    expect(DEFAULT_LAYOUT.iterations).toBeGreaterThan(50);
  });

  it("damps below one, so the layout settles rather than orbits", () => {
    // At or above one the velocities never decay and the graph oscillates
    // forever — which looks like the layout failing rather than never
    // finishing.
    expect(DEFAULT_LAYOUT.damping).toBeLessThan(1);
    expect(DEFAULT_LAYOUT.damping).toBeGreaterThan(0);
  });
});
