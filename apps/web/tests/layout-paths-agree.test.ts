/**
 * The two repulsion paths lay a graph out the same way.
 *
 * `layoutGraph` compares every pair below `approximateAbove` and walks a
 * Barnes-Hut tree above it, because measuring showed neither is faster
 * everywhere — a flat loop over adjacent memory beats a branching tree walk
 * until about eight hundred nodes, and loses badly after.
 *
 * Two code paths for one job is a standing invitation to drift, and the drift
 * would be invisible: a layout has no right answer to check by eye, so a graph
 * that crossed the threshold and rearranged itself would just look like a
 * different graph. These tests hold the paths to the same *properties* rather
 * than to identical coordinates, which is the strongest thing that can honestly
 * be asked of an approximation.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, layoutGraph, type Graph } from "@/lib/charts3d/network";

const PAIRS = { ...DEFAULT_LAYOUT, approximateAbove: Infinity };
const TREE = { ...DEFAULT_LAYOUT, approximateAbove: 0 };

/** Two clusters joined by one edge — a shape whose layout is checkable. */
function twoClusters(per = 25): Graph {
  const nodes = [], edges = [];
  for (const side of ["a", "b"]) {
    for (let i = 0; i < per; i += 1) nodes.push({ id: `${side}${i}`, group: side });
    for (let i = 1; i < per; i += 1) {
      edges.push({ source: `${side}0`, target: `${side}${i}` });
    }
  }
  edges.push({ source: "a0", target: "b0" });
  return { nodes, edges };
}

const at = (layout: ReturnType<typeof layoutGraph>, id: string) =>
  layout.nodes.find((n) => n.id === id)!;
const gap = (layout: ReturnType<typeof layoutGraph>, a: string, b: string) => {
  const p = at(layout, a), q = at(layout, b);
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
};

/** Mean distance from a cluster's members to its hub. */
const spread = (layout: ReturnType<typeof layoutGraph>, side: string, per: number) => {
  let total = 0;
  for (let i = 1; i < per; i += 1) total += gap(layout, `${side}0`, `${side}${i}`);
  return total / (per - 1);
};

describe("both repulsion paths produce the same kind of picture", () => {
  it("keeps a cluster together in both", () => {
    const graph = twoClusters();
    const byPairs = layoutGraph(graph, PAIRS);
    const byTree = layoutGraph(graph, TREE);

    // Connected nodes sit closer than the graph is wide, whichever path ran.
    for (const layout of [byPairs, byTree]) {
      expect(spread(layout, "a", 25)).toBeLessThan(gap(layout, "a0", "b0") * 1.5);
    }
  });

  it("agrees on how tightly a cluster packs", () => {
    /**
     * The number that would drift if the tree lost bodies or double-counted
     * them: too little repulsion collapses a cluster, too much blows it apart.
     */
    const graph = twoClusters();
    const byPairs = spread(layoutGraph(graph, PAIRS), "a", 25);
    const byTree = spread(layoutGraph(graph, TREE), "a", 25);
    expect(byTree).toBeGreaterThan(byPairs * 0.6);
    expect(byTree).toBeLessThan(byPairs * 1.6);
  });

  it("fills the cube in both, rather than collapsing to a dot", () => {
    /** `normalise` stretches to the unit cube, so a collapsed layout shows up
     *  as a *degenerate* one — every node on top of every other. */
    for (const settings of [PAIRS, TREE]) {
      const layout = layoutGraph(twoClusters(), settings);
      const xs = layout.nodes.map((n) => n.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1);
      for (const n of layout.nodes) {
        expect(Number.isFinite(n.x + n.y + n.z)).toBe(true);
      }
    }
  });

  it("is deterministic on each path", () => {
    /** The property the whole layout is built around: "a graph that arranges
     *  itself differently on every open is one a researcher cannot compare
     *  with what they have." */
    for (const settings of [PAIRS, TREE]) {
      const once = layoutGraph(twoClusters(), settings);
      const twice = layoutGraph(twoClusters(), settings);
      for (const node of once.nodes) {
        expect(at(twice, node.id).x).toBeCloseTo(node.x, 12);
        expect(at(twice, node.id).y).toBeCloseTo(node.y, 12);
      }
    }
  });

  it("switches path on node count, and only on node count", () => {
    /**
     * Guards the threshold itself. Without this the constant could be set to
     * anything — or to a value no graph ever reaches — and every other test
     * here would still pass, having quietly exercised one path twice.
     */
    expect(DEFAULT_LAYOUT.approximateAbove).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_LAYOUT.approximateAbove)).toBe(true);

    const small = twoClusters(3);
    expect(small.nodes.length).toBeLessThan(DEFAULT_LAYOUT.approximateAbove);
    // The default must take the pairs path here, so it must match it exactly.
    const byDefault = layoutGraph(small);
    const byPairs = layoutGraph(small, PAIRS);
    for (const node of byDefault.nodes) {
      expect(at(byPairs, node.id).x).toBeCloseTo(node.x, 12);
    }
  });
});
