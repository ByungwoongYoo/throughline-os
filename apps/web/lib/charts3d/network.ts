/**
 * Placing a graph in space (§9 networks, §16 native).
 *
 * Thirty-five named visualizations in the catalogue are this one primitive: a
 * citation network, a protein interaction network, a dependency graph, a causal
 * space, and — the ones nobody else can build — the provenance tree, the
 * evidence galaxy and the hypothesis space, which draw this system's own
 * semantic layer rather than somebody's file format.
 *
 * **Layout is separated from drawing, and that is the whole design.** Where a
 * node sits is a property of the graph; how it appears is a property of the
 * camera. Keeping them apart means a layout can be computed once, tested
 * without a canvas, reused when the view rotates, and — for a provenance tree,
 * where depth *is* the derivation — replaced entirely by a deterministic
 * arrangement without touching the renderer.
 *
 * **The layout is deterministic.** A force-directed graph seeded by a random
 * number generator produces a different picture every time it is opened, which
 * for a researcher comparing a network to the one in their notes is worse than
 * an ugly layout: nothing is where they left it. The seed is derived from node
 * identity, so the same graph always lands the same way.
 */

import { buildOctree, repulsionOn } from "./octree";

/** A node as the caller knows it. Positions are computed, never supplied. */
export type GraphNode = {
  id: string;
  label?: string;
  /** Groups colour and, in a layered layout, depth. */
  group?: string;
  /** Relative importance. Drives size, and nothing else. */
  weight?: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  /** Pulls harder when higher. Absent means an ordinary edge. */
  strength?: number;
  /** What the edge means: "cites", "derived from", "supports". */
  kind?: string;
};

export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** A node with somewhere to be. The unit cube -1..1, as `unitScale` means it. */
export type Placed = GraphNode & { x: number; y: number; z: number };

export type Layout = {
  nodes: Placed[];
  /** Edges whose endpoints both exist, so the renderer never looks one up. */
  edges: Array<GraphEdge & { from: Placed; to: Placed }>;
  /** Edges naming a node that is not in the graph. Reported, never drawn. */
  dangling: GraphEdge[];
};

/**
 * A small deterministic generator.
 *
 * Seeded from node identity rather than a clock: a graph that arranges itself
 * differently on every open is one a researcher cannot compare with what they
 * saw yesterday, and the first thing they conclude is that the data changed.
 */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type LayoutSettings = {
  /** How many times the whole graph is relaxed. */
  iterations: number;
  /** How hard connected nodes pull together. */
  attraction: number;
  /** How hard every pair pushes apart. */
  repulsion: number;
  /** How quickly movement decays, so the layout settles rather than orbits. */
  damping: number;
  /**
   * Barnes-Hut opening angle: how coarse a distant cluster may be.
   *
   * A cell is treated as one body when its width over its distance falls below
   * this. Zero means never, which is the exact all-pairs force and what the
   * tests compare against.
   */
  theta: number;
  /**
   * Node count at which the tree takes over from comparing every pair.
   *
   * Measured, not chosen. See `DEFAULT_LAYOUT`.
   */
  approximateAbove: number;
};

/*
 * What these numbers cost, measured rather than asserted.
 *
 * The note that stood here claimed the pass count was "few enough to run
 * inside a frame budget" for "a few hundred nodes", and added that "a layout
 * that took a second would be computed on a background thread". Neither was
 * measured, and both were wrong: at three hundred nodes the layout took 42ms
 * against a 16.7ms budget, and at two thousand it took 1.93 seconds on the
 * main thread with the interface frozen throughout.
 *
 * `approximateAbove` is the crossover between comparing every pair and walking
 * a Barnes-Hut tree, and it is measured on the real function rather than on a
 * microbenchmark — a first attempt compared a tree walk against a stripped
 * all-pairs loop that only accumulated a scalar, which the engine optimised
 * into something the layout never runs:
 *
 *     n=  100   pairs     4ms   tree    16ms   pairs 4.6x faster
 *     n=  500   pairs   113ms   tree   170ms   pairs 1.5x faster
 *     n=  800   pairs   414ms   tree   298ms   tree  1.4x faster
 *     n= 2000   pairs  1944ms   tree  1430ms   tree  1.4x faster
 *     n= 5000   pairs 12173ms   tree  6070ms   tree  2.0x faster
 *
 * **This does not make a large graph interactive, and it should not be read as
 * if it did.** It halves the cost of one that was already far past a frame,
 * and it is the part that had to come first — a worker running a quadratic
 * layout over five thousand nodes still takes twelve seconds. What remains is
 * getting it off the main thread, which is the thing the old note said should
 * happen and the reason the false claim mattered: it described a limit nobody
 * had checked, so nobody went looking.
 *
 * `theta` is the standard 0.5 — a resolution limit on a force that is a layout
 * heuristic and not a measurement, so no number a reader is shown depends on
 * it.
 */
export const DEFAULT_LAYOUT: LayoutSettings = {
  iterations: 120,
  theta: 0.5,
  approximateAbove: 800,
  attraction: 0.02,
  repulsion: 0.0009,
  damping: 0.85,
};

/**
 * Arrange a graph in three dimensions.
 *
 * Force-directed, because for most of the thirty-five the meaningful structure
 * is *adjacency* rather than any measured coordinate — which cluster a protein
 * belongs to, what cites what. Where real coordinates exist the caller should
 * place the nodes itself; this is for graphs that have none.
 */
export function layoutGraph(graph: Graph,
                            settings: LayoutSettings = DEFAULT_LAYOUT): Layout {
  const known = new Map<string, Placed>();

  for (const node of graph.nodes) {
    // Skipped rather than recomputed. The Map already guarantees one entry per
    // id — and because the seed is the id, a duplicate would land in exactly
    // the same place anyway — so this saves the work rather than changing the
    // result. Mutation testing removed it and nothing failed, which is how the
    // distinction was noticed.
    if (known.has(node.id)) continue;
    const random = seeded(node.id);
    // Started on a sphere rather than uniformly through the cube. A cloud of
    // points started at random depths collapses into a disc under repulsion,
    // because the shortest escape from the middle is outward in two dimensions.
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const r = 0.4 + random() * 0.1;
    known.set(node.id, {
      ...node,
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
    });
  }

  const nodes = [...known.values()];
  const dangling: GraphEdge[] = [];
  const edges: Layout["edges"] = [];
  for (const edge of graph.edges) {
    const from = known.get(edge.source);
    const to = known.get(edge.target);
    // An edge to a node that is not here is reported rather than drawn to the
    // origin, which is what a missing lookup silently produces — a spray of
    // lines converging on the centre that reads as a hub.
    if (!from || !to || from === to) { dangling.push(edge); continue; }
    edges.push({ ...edge, from, to });
  }

  const velocity = nodes.map(() => ({ x: 0, y: 0, z: 0 }));

  /*
   * Both reused across passes rather than rebuilt. The tree is refilled in
   * place and `push` is written into, because the alternative — a fresh tree
   * and a fresh vector per node per pass — cost more than the quadratic loop
   * this replaced, at every graph size a person is likely to open.
   */
  let tree: ReturnType<typeof buildOctree> = null;
  const push = { x: 0, y: 0, z: 0 };

  /*
   * Hoisted out of the pass loop, where it was rebuilt on every one of the 120
   * iterations. The graph does not change while it settles, so that was 120
   * allocations of an n-entry Map to produce the same answer each time.
   */
  const index = new Map(nodes.map((n, i) => [n.id, i]));

  for (let pass = 0; pass < settings.iterations; pass += 1) {
    /*
     * Repulsion through a Barnes-Hut tree rather than over every pair.
     *
     * The all-pairs version was honest about itself — "quadratic and fine at
     * this scale... a graph large enough for that to hurt needs a spatial
     * index" — and it was measured at 121ms for 500 nodes and 1.93 seconds for
     * 2000, synchronously, with the interface frozen throughout. `DEFAULT_LAYOUT`
     * meanwhile claimed the pass count ran "inside a frame budget" for "a few
     * hundred nodes", which was already 2.5x over at three hundred.
     *
     * A distance cutoff would have been simpler and wrong: repulsion is what
     * holds two separated clusters apart, so discarding the long-range term
     * collapses the layout. See `octree.ts`.
     */
    if (nodes.length >= settings.approximateAbove) {
      tree = buildOctree(nodes, tree);
      for (let i = 0; i < nodes.length; i += 1) {
        repulsionOn(tree, nodes[i], settings.repulsion, settings.theta, push);
        velocity[i].x += push.x;
        velocity[i].y += push.y;
        velocity[i].z += push.z;
      }
    } else {
      /*
       * Every pair, for the graphs where that is genuinely the faster answer.
       *
       * Kept rather than replaced, because measuring showed the tree is not a
       * free win: it walks branches and misses cache, while this is a flat
       * loop over adjacent memory doing nothing but arithmetic, and it uses
       * each pair twice. Below the crossover the tree is several times slower.
       *
       * The floor is defensive rather than load-bearing — two nodes can only
       * coincide if they share an id, which the Map above prevents — but one
       * division by zero sends a pair to infinity, and normalisation then
       * divides by that span and renders the whole graph as a single dot.
       */
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dz = nodes[i].z - nodes[j].z;
          const d2 = Math.max(dx * dx + dy * dy + dz * dz, 1e-4);
          const strength = settings.repulsion / d2;
          const d = Math.sqrt(d2);
          velocity[i].x += (dx / d) * strength;
          velocity[i].y += (dy / d) * strength;
          velocity[i].z += (dz / d) * strength;
          velocity[j].x -= (dx / d) * strength;
          velocity[j].y -= (dy / d) * strength;
          velocity[j].z -= (dz / d) * strength;
        }
      }
    }

    for (const edge of edges) {
      const i = index.get(edge.from.id)!;
      const j = index.get(edge.to.id)!;
      const pull = settings.attraction * (edge.strength ?? 1);
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dz = nodes[j].z - nodes[i].z;
      velocity[i].x += dx * pull; velocity[j].x -= dx * pull;
      velocity[i].y += dy * pull; velocity[j].y -= dy * pull;
      velocity[i].z += dz * pull; velocity[j].z -= dz * pull;
    }

    for (let i = 0; i < nodes.length; i += 1) {
      nodes[i].x += velocity[i].x;
      nodes[i].y += velocity[i].y;
      nodes[i].z += velocity[i].z;
      velocity[i].x *= settings.damping;
      velocity[i].y *= settings.damping;
      velocity[i].z *= settings.damping;
    }
  }

  return { nodes: normalise(nodes), edges, dangling };
}

/**
 * Fit the arrangement into the unit cube.
 *
 * Per-axis, matching what every other spatial chart here does, so a network and
 * a scatter occupy the same space and the camera means the same thing in both.
 * A graph that settled into a thin sheet is stretched to fill the cube rather
 * than left as a line seen edge-on — the shape of a layout is not a measurement.
 */
function normalise(nodes: Placed[]): Placed[] {
  if (nodes.length === 0) return nodes;
  for (const axis of ["x", "y", "z"] as const) {
    let min = Infinity, max = -Infinity;
    for (const node of nodes) {
      min = Math.min(min, node[axis]);
      max = Math.max(max, node[axis]);
    }
    const span = max - min;
    for (const node of nodes) {
      // A degenerate axis becomes the centre rather than NaN. One node, or a
      // perfectly flat graph, would otherwise render nowhere at all.
      node[axis] = span > 1e-9 ? (((node[axis] - min) / span) * 2) - 1 : 0;
    }
  }
  return nodes;
}

/**
 * A layered arrangement, for graphs whose depth carries meaning.
 *
 * The provenance tree is the reason this exists: a result derives from runs
 * which derive from datasets, and that ordering *is* the information. A
 * force-directed layout would place those layers by how many edges each node
 * happens to have, which is the wrong picture told confidently.
 */
export function layoutLayered(graph: Graph,
                              depthOf: (node: GraphNode) => number): Layout {
  const known = new Map<string, Placed>();
  const byDepth = new Map<number, GraphNode[]>();

  for (const node of graph.nodes) {
    if (known.has(node.id)) continue;
    const depth = depthOf(node);
    const row = byDepth.get(depth) ?? [];
    row.push(node);
    byDepth.set(depth, row);
    known.set(node.id, { ...node, x: 0, y: 0, z: 0 });
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  depths.forEach((depth, layer) => {
    const row = byDepth.get(depth)!;
    // Spread across the layer, and staggered in z so a wide layer does not
    // become a line of overlapping discs when seen from the front.
    row.forEach((node, i) => {
      const placed = known.get(node.id)!;
      placed.y = depths.length > 1
        ? ((layer / (depths.length - 1)) * 2) - 1 : 0;
      placed.x = row.length > 1 ? ((i / (row.length - 1)) * 2) - 1 : 0;
      placed.z = row.length > 1 ? ((i % 3) - 1) * 0.24 : 0;
    });
  });

  const nodes = [...known.values()];
  const dangling: GraphEdge[] = [];
  const edges: Layout["edges"] = [];
  for (const edge of graph.edges) {
    const from = known.get(edge.source);
    const to = known.get(edge.target);
    if (!from || !to || from === to) { dangling.push(edge); continue; }
    edges.push({ ...edge, from, to });
  }
  return { nodes, edges, dangling };
}

/** Everything one node connects to, for "show me what this touches". */
export function neighboursOf(layout: Layout, nodeId: string): Placed[] {
  const found = new Map<string, Placed>();
  for (const edge of layout.edges) {
    if (edge.from.id === nodeId) found.set(edge.to.id, edge.to);
    if (edge.to.id === nodeId) found.set(edge.from.id, edge.from);
  }
  return [...found.values()];
}

/**
 * What a layout says about itself, including what it could not draw.
 *
 * Dangling edges are reported rather than silently dropped: an edge naming a
 * node that is not in the graph usually means the query that built it missed
 * something, and a researcher reading a citation network needs to know the
 * picture is incomplete rather than sparse.
 */
export function describeLayout(layout: Layout): string {
  const nodes = layout.nodes.length;
  const edges = layout.edges.length;
  if (nodes === 0) return "Nothing to draw.";

  let text = `${nodes} ${nodes === 1 ? "node" : "nodes"}, `
           + `${edges} ${edges === 1 ? "edge" : "edges"}.`;
  if (layout.dangling.length > 0) {
    text += ` ${layout.dangling.length} connection`
          + `${layout.dangling.length === 1 ? "" : "s"} could not be drawn `
          + "because the other end is not in this graph.";
  }
  return text;
}
