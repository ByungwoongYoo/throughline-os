/**
 * Where a graph's layout is computed, and on which thread.
 *
 * Small graphs stay synchronous. That is not a concession: the whole apparatus
 * of a worker — a second bundle, a message round trip, a state machine with a
 * pending case — costs more than laying out twenty-seven nodes, and it would
 * put an intermediate "laying out" flash in front of a picture that is
 * otherwise instant.
 *
 * Large graphs go across. Measured on this machine after Barnes-Hut: 161ms at
 * five hundred nodes, 300ms at eight hundred, 1.4s at two thousand, 6s at five
 * thousand. Anything past a frame is a page that has stopped answering, and
 * past a second it reads as a crash.
 *
 * **The synchronous path is also the fallback**, and it is load-bearing in two
 * ordinary places: the test environment has no `Worker`, and neither does a
 * server render. A hook that assumed one would leave both drawing nothing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Graph, type Layout, layoutGraph, layoutLayered,
} from "./network";
import type { LayoutRequest, LayoutResponse } from "./layout.worker";

/**
 * Node count above which the layout is handed to a worker.
 *
 * Chosen from the measurement rather than rounded: four hundred nodes is
 * roughly a tenth of a second, which is where a freeze stops being a stutter
 * and starts being a page that ignores you.
 */
export const WORKER_ABOVE = 400;

export type LayoutState =
  | { kind: "ready"; layout: Layout }
  /** Still settling on a worker; `nodes` says how many, so the wait is named. */
  | { kind: "working"; nodes: number };

/**
 * Whether this environment can run one at all.
 *
 * Asked inside the effect and never during render. A first version asked it
 * while rendering, so the server said no and the browser said yes for the same
 * graph — the server sent a laid-out chart and the client expected a settling
 * one, and React reported a hydration failure on the console of a page that
 * otherwise looked fine. What goes across is decided by the data alone; what
 * it is computed *on* is decided after mounting.
 */
function workersExist(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

/**
 * Re-link edges to the node objects that came back.
 *
 * Structured clone copies each referenced node separately, so an edge would
 * otherwise point at a twin of the node in `nodes` rather than at the node
 * itself. Nothing here compares them by identity today, and this exists so
 * that nothing has to remember not to.
 */
function relink(graph: Graph, nodes: Layout["nodes"],
                dangling: Layout["dangling"]): Layout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: Layout["edges"] = [];
  for (const edge of graph.edges) {
    const from = byId.get(edge.source);
    const to = byId.get(edge.target);
    if (from && to) edges.push({ ...edge, from, to });
  }
  return { nodes, edges, dangling };
}

/**
 * A cheap content signature, so an equal graph is not treated as a new one.
 *
 * The effect cannot key on the object: `CatalogueChart` builds its example
 * inside render, so every pass hands over a fresh `graph` that describes
 * exactly the same thing. Keyed on identity, the effect re-ran, set state,
 * re-rendered, and made another one — an infinite loop in the browser, not
 * merely a slow test. The previous `useMemo` survived that only because a memo
 * recomputes where an effect re-fires.
 *
 * A rolling hash over the ids and the endpoints, not a stringify: at five
 * thousand nodes a JSON copy is a megabyte on every render, which is the cost
 * this whole file exists to remove. A collision would show a layout belonging
 * to a graph with the same node count, edge count and id hash — vanishingly
 * unlikely, and stale rather than wrong.
 */
function signatureOf(graph: Graph): string {
  let hash = 2166136261;
  const mix = (text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  };
  for (const node of graph.nodes) mix(node.id);
  for (const edge of graph.edges) { mix(edge.source); mix(edge.target); }
  return `${graph.nodes.length}:${graph.edges.length}:${hash >>> 0}`;
}

export function useLayout(graph: Graph,
                          depthOf?: (nodeId: string) => number): LayoutState {
  /*
   * A layered layout is never sent across. It is a fixed arrangement rather
   * than a relaxation — one pass over the nodes — so it costs nothing worth
   * moving, and it is exact, which a reader comparing an architecture to their
   * notes depends on.
   */
  const offThread = !depthOf && graph.nodes.length > WORKER_ABOVE;

  const signature = useMemo(() => signatureOf(graph), [graph]);

  /*
   * Keyed on content, because the caller rebuilds an equal graph on every
   * render — depending on the object itself would relax the layout again on
   * every render for a graph that did not change.
   *
   * The suppression has to be the single line immediately above the dependency
   * array, which is where `exhaustive-deps` reports. It used to be a two-line
   * comment, so `disable-next-line` covered the comment's own second line and
   * nothing else: ESLint printed both the missing-dependency warning and an
   * "unused eslint-disable directive" for the comment meant to silence it.
   */
  const immediate = useMemo(
    () => (offThread
      ? null
      : depthOf
        ? layoutLayered(graph, (n) => depthOf(n.id))
        : layoutGraph(graph)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, depthOf, offThread]);

  const [fromWorker, setFromWorker] = useState<Layout | null>(null);
  const requestRef = useRef(0);
  /* The effect keys on the signature, so it needs the current object without
     re-firing when only the reference changed. */
  const graphRef = useRef(graph);
  graphRef.current = graph;

  useEffect(() => {
    if (!offThread) { setFromWorker(null); return; }
    const id = ++requestRef.current;
    setFromWorker(null);

    /*
     * No worker here — a test environment, or an older browser. The layout
     * still has to happen, and blocking is better than a chart that never
     * arrives; it is the cost the worker exists to avoid, paid only where
     * there is no worker to avoid it with.
     */
    const current = graphRef.current;
    if (!workersExist()) { setFromWorker(layoutGraph(current)); return; }

    const worker = new Worker(new URL("./layout.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
      const reply = event.data;
      // A stale reply is dropped rather than drawn: the graph it describes is
      // not the graph on screen any more.
      if (reply.id !== requestRef.current) return;
      if (reply.ok) setFromWorker(relink(current, reply.nodes, reply.dangling));
      else setFromWorker(layoutGraph(current));   // it still has to draw
    };
    /*
     * A worker that fails to start is a chart that never appears, so the work
     * falls back to this thread. It will block — that is the cost the worker
     * existed to avoid — but a slow picture beats no picture and no reason.
     */
    worker.onerror = () => setFromWorker(layoutGraph(current));
    worker.postMessage({ id, graph: current } satisfies LayoutRequest);

    return () => worker.terminate();
  }, [signature, offThread]);

  if (immediate) return { kind: "ready", layout: immediate };
  if (fromWorker) return { kind: "ready", layout: fromWorker };
  return { kind: "working", nodes: graph.nodes.length };
}
