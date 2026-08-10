/**
 * Force layout, off the main thread (Part E1).
 *
 * Bundled from node_modules rather than fetched from a CDN. This product is
 * local-first: a researcher on a plane, or on an institutional network that
 * blocks external scripts, must still get a graph. The first version imported
 * d3-force from jsdelivr and failed with `r.timer is not a function` because
 * the standalone build expects d3-timer as a peer — bundling fixes both the
 * missing dependency and the network assumption.
 *
 * Positions go back as a transferable Float32Array. Posting JSON would
 * serialise and copy every tick, which at this size costs more than the
 * simulation itself.
 *
 * The tuning below is not d3's default, and the differences are deliberate:
 *
 * - `velocityDecay 0.35` rather than 0.4 — nodes carry momentum slightly
 *   longer and settle like objects rather than snapping. This is most of why
 *   the graph feels fluid rather than stiff.
 * - Link distance is a function of similarity, so proximity on screen means
 *   something. Where distance is arbitrary, a layout is decoration.
 * - Charge scales with importance, so a well-connected node clears space and
 *   reads as significant without needing a label.
 * - Insertion reheats alpha to 0.3, never 1.0. Adding one paper is a local
 *   reorganisation; reheating fully throws the whole graph, and is the single
 *   most common reason force graphs feel chaotic.
 */

import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
} from "d3-force";

// Without this, TypeScript types `self` as Window and rejects the transfer-list
// form of postMessage — which is the whole reason this runs in a worker.
declare const self: DedicatedWorkerGlobalScope;
export {};

type Node = {
  id: string;
  importance: number;
  x?: number; y?: number;
  fx?: number | null; fy?: number | null;
};
type Link = { source: string | Node; target: string | Node; similarity: number };

let simulation: ReturnType<typeof forceSimulation<Node>> | null = null;
let nodes: Node[] = [];
let links: Link[] = [];

/** Sub-linear, or one heavily connected node dominates the whole field. */
const importanceScale = (d: Node) => 1 + Math.log1p(d.importance || 0) * 0.6;
const nodeRadius = (d: Node) => 5 + Math.sqrt(d.importance || 0) * 1.6;

function build(alpha: number) {
  simulation = forceSimulation<Node>(nodes)
    .force("charge", forceManyBody<Node>()
      .strength((d) => -180 * importanceScale(d))
      .theta(0.85)
      // Beyond this, repulsion is negligible and the Barnes-Hut traversal is
      // wasted work on every tick.
      .distanceMax(600))
    .force("link", forceLink<Node, Link>(links)
      .id((d) => d.id)
      .distance((d) => 40 + 120 * (1 - (d.similarity ?? 0.5)))
      .strength((d) => 0.15 + 0.55 * (d.similarity ?? 0.5)))
    .force("collide", forceCollide<Node>()
      .radius((d) => nodeRadius(d) + 4).strength(0.8).iterations(2))
    // A weak pull to centre stops disconnected components drifting away
    // forever without visibly compressing the layout.
    .force("x", forceX<Node>(0).strength(0.02))
    .force("y", forceY<Node>(0).strength(0.02))
    .alpha(alpha)
    .alphaMin(0.001)
    .alphaDecay(0.0228)
    .velocityDecay(0.35)
    .on("tick", post);
}

/** [x, y, radius] per node, in the order the main thread already holds. */
function post() {
  if (!simulation) return;
  const buffer = new Float32Array(nodes.length * 3);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    buffer[i * 3] = node.x ?? 0;
    buffer[i * 3 + 1] = node.y ?? 0;
    buffer[i * 3 + 2] = nodeRadius(node);
  }
  self.postMessage({ type: "tick", positions: buffer, alpha: simulation.alpha() },
                   [buffer.buffer]);
}

self.onmessage = (event: MessageEvent) => {
  const message = event.data;

  if (message.type === "init") {
    nodes = message.nodes.map((n: Node) => ({ ...n }));
    links = message.links.map((l: Link) => ({ ...l }));
    build(1);
    return;
  }

  if (message.type === "add") {
    // New nodes spawn at the centroid of their neighbours, never at (0,0):
    // spawning at the origin fires them across the viewport on the first tick,
    // which reads as the graph breaking rather than growing.
    const existing = new Map(nodes.map((n) => [n.id, n]));
    for (const node of message.nodes as Node[]) {
      if (existing.has(node.id)) continue;
      const neighbours = (message.links as Link[])
        .filter((l) => l.source === node.id || l.target === node.id)
        .map((l) => existing.get((l.source === node.id ? l.target : l.source) as string))
        .filter((n): n is Node => Boolean(n));
      const seed = neighbours.length
        ? { x: neighbours.reduce((s, n) => s + (n.x ?? 0), 0) / neighbours.length,
            y: neighbours.reduce((s, n) => s + (n.y ?? 0), 0) / neighbours.length }
        : { x: 0, y: 0 };
      nodes.push({ ...node, x: seed.x + (Math.random() - 0.5) * 20,
                            y: seed.y + (Math.random() - 0.5) * 20 });
    }
    const known = new Set(links.map((l) => `${String(l.source)} ${String(l.target)}`));
    for (const link of message.links as Link[]) {
      if (!known.has(`${String(link.source)} ${String(link.target)}`)) links.push({ ...link });
    }
    build(0.3);
    return;
  }

  if (message.type === "drag") {
    const node = nodes[message.index];
    if (!node || !simulation) return;
    node.fx = message.x;
    node.fy = message.y;
    // Keep it warm while dragging so neighbours respond.
    simulation.alphaTarget(0.3).restart();
    return;
  }

  if (message.type === "release") {
    const node = nodes[message.index];
    if (node) { node.fx = null; node.fy = null; }
    // Ramp to zero rather than stopping dead, so the graph relaxes after a drag
    // instead of freezing mid-motion.
    simulation?.alphaTarget(0);
    return;
  }

  if (message.type === "stop") simulation?.stop();
};
