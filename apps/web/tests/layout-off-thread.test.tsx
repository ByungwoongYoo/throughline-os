/**
 * A graph big enough to freeze the page is laid out somewhere else.
 *
 * `DEFAULT_LAYOUT` claimed for a long time that its pass count ran "inside a
 * frame budget", and that "a layout that took a second would be computed on a
 * background thread". The first half was measured and found false; this is the
 * second half. After Barnes-Hut the cost is 161ms at five hundred nodes, 1.4s
 * at two thousand and 6s at five thousand — and half of a frozen interface is
 * still a frozen interface.
 *
 * The tests below are about the *decision*, not the worker: which graphs go
 * across, which stay, and what happens where there is no worker to go to. That
 * last case is not hypothetical — it is this test environment, and a server
 * render.
 */

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { WORKER_ABOVE, useLayout } from "@/lib/charts3d/useLayout";
import type { Graph } from "@/lib/charts3d/network";

const graphOf = (n: number): Graph => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `N${i}` })),
  edges: Array.from({ length: Math.max(0, n - 1) },
    (_, i) => ({ source: `n${i}`, target: `n${i + 1}` })),
});

describe("which graphs are laid out where", () => {
  it("lays a small graph out immediately, with no settling state", () => {
    /** The round trip costs more than the work at this size, and a reader
     *  should not watch a twenty-node graph "settle". */
    const { result } = renderHook(() => useLayout(graphOf(20)));
    expect(result.current.kind).toBe("ready");
  });

  it("keeps a layered graph on this thread whatever its size", () => {
    /**
     * A layered layout is one pass over the nodes rather than a relaxation, so
     * there is nothing worth moving — and it is exact, which a reader
     * comparing an architecture against their notes depends on.
     */
    const big = graphOf(WORKER_ABOVE * 3);
    const { result } = renderHook(
      () => useLayout(big, (id) => Number(id.slice(1)) % 4));
    expect(result.current.kind).toBe("ready");
  });

  it("still draws a large graph where there is no worker to use", () => {
    /**
     * Load-bearing rather than defensive: this environment has no `Worker`,
     * and neither does a server render. A hook that assumed one would leave
     * both drawing nothing at all — the failure being *silent* is what makes
     * it worth a test rather than a comment.
     */
    expect(typeof Worker).toBe("undefined");
    const { result } = renderHook(() => useLayout(graphOf(WORKER_ABOVE + 50)));
    expect(result.current.kind).toBe("ready");
    if (result.current.kind !== "ready") return;
    expect(result.current.layout.nodes).toHaveLength(WORKER_ABOVE + 50);
  });

  it("has a threshold taken from a measurement, not a round number", () => {
    /** 161ms at 500 nodes is where a freeze stops being a stutter. A guard
     *  against someone raising this to "1000" because it looks tidier. */
    expect(WORKER_ABOVE).toBeGreaterThan(100);
    expect(WORKER_ABOVE).toBeLessThan(800);
  });

  it("gives every edge the node objects the layout returned", () => {
    /**
     * Structured clone copies each referenced node separately, so an edge
     * crossing back from a worker would point at a *twin* of the node in
     * `nodes` rather than at the node itself. Nothing compares them by
     * identity today; this is so that nothing has to remember not to.
     */
    const { result } = renderHook(() => useLayout(graphOf(30)));
    if (result.current.kind !== "ready") throw new Error("expected a layout");
    const { nodes, edges } = result.current.layout;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of edges) {
      expect(edge.from).toBe(byId.get(edge.from.id));
      expect(edge.to).toBe(byId.get(edge.to.id));
    }
  });
});
