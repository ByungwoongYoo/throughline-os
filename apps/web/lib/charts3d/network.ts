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
};

/*
 * Enough passes to untangle a few hundred nodes and few enough to run inside a
 * frame budget. A layout that took a second would be computed on a background
 * thread; at this size it is cheaper to do it directly than to marshal the
 * graph across a worker boundary twice.
 */
export const DEFAULT_LAYOUT: LayoutSettings = {
  iterations: 120,
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

  for (let pass = 0; pass < settings.iterations; pass += 1) {
    // Repulsion: every pair, which is quadratic and fine at this scale. A
    // graph large enough for that to hurt needs a spatial index, and building
    // one before anything renders would be optimising a picture nobody has
    // seen.
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dz = nodes[i].z - nodes[j].z;
        /*
         * Floored, and deliberately defensive rather than load-bearing.
         *
         * Two nodes can only sit at exactly the same position if they share an
         * id, and the Map above makes that impossible — so a mutation removing
         * this floor survives every test, twice checked. It stays because the
         * cost of being wrong is total: one division by zero sends a pair to
         * infinity, normalisation then divides by that span, and the entire
         * graph renders as a single dot with nothing reported.
         */
        const d2 = Math.max(dx * dx + dy * dy + dz * dz, 1e-4);
        const push = settings.repulsion / d2;
        const d = Math.sqrt(d2);
        velocity[i].x += (dx / d) * push;
        velocity[i].y += (dy / d) * push;
        velocity[i].z += (dz / d) * push;
        velocity[j].x -= (dx / d) * push;
        velocity[j].y -= (dy / d) * push;
        velocity[j].z -= (dz / d) * push;
      }
    }

    const index = new Map(nodes.map((n, i) => [n.id, i]));
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
