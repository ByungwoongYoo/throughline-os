/**
 * Data for every catalogue entry, so "drawable" can be checked rather than
 * claimed.
 *
 * `status: "built"` was a hand-written assertion with nothing behind it. The
 * catalogue page turned it into a headline — "199 of 238 catalogued
 * visualizations can be drawn today" — by counting `built` *and*
 * `configuration` together, and `configuration` means, in the registry's own
 * words, "the primitive exists; this is a configuration of it not yet
 * exposed". So the most prominent number on the page counted 141 things a
 * researcher could not reach, and nothing in the codebase could contradict it,
 * because nothing connected an entry to a renderer.
 *
 * Drawability is derived here instead. An entry is drawable when two things
 * are true and both are facts about code rather than opinions about it:
 *
 *   1. a renderer exists for its `primitive`, and
 *   2. a generator exists for the `needs` shape it consumes.
 *
 * That leaves `geometry` — vertices and faces from a file — undrawable by
 * construction, which is correct: it needs a researcher's file, and no
 * generator should pretend otherwise.
 *
 * **The generators are shapes, not data.** They exist so a catalogue entry can
 * be *seen* and its renderer exercised; they are never a substitute for a
 * researcher's own numbers, and every chart drawn from one says so.
 */

import type { DataShape, Primitive, Visualization } from "./registry";

export type Generated =
  | { shape: "xyz" | "xyzv"; points: Array<{ id: string; label: string; x: number; y: number; z: number; value?: number }> }
  | { shape: "grid"; grid: { x: number[]; y: number[]; z: Array<Array<number | null>> } }
  | { shape: "field"; samples: Array<{ x: number; y: number; z: number; u: number; v: number; w: number }> }
  | { shape: "voxels"; grid: { nx: number; ny: number; nz: number; values: Float32Array; units?: string } }
  | { shape: "graph"; graph: { nodes: Array<{ id: string; label: string; group?: string }>; edges: Array<{ source: string; target: string; weight?: number }> } }
  | { shape: "series"; bars: Array<{ row: number; column: number; value: number }> }
  | { shape: "paths"; paths: Array<{ id: string; label: string; group?: string;
      points: Array<{ x: number; y: number; z: number; t?: number }> }> };

/** A deterministic pseudo-random source, so a demo is the same every time. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function points(withValue: boolean): Generated {
  const rand = noise(7);
  return {
    shape: withValue ? "xyzv" : "xyz",
    points: Array.from({ length: 160 }, (_, i) => {
      const t = i / 160 * Math.PI * 2;
      const r = 1 + rand() * 0.35;
      return {
        id: `p${i}`, label: `Sample ${i + 1}`,
        x: Math.cos(t * 3) * r, y: Math.sin(t * 2) * r, z: Math.cos(t) * r,
        ...(withValue ? { value: r } : {}),
      };
    }),
  };
}

/** A height field z = f(x, y) over a fixed lattice. */
function heightField(f: (x: number, y: number) => number, span = 3): Generated {
  const n = 28;
  const axis = Array.from({ length: n }, (_, i) => -span + i * (2 * span / (n - 1)));
  return {
    shape: "grid",
    grid: { x: axis, y: axis, z: axis.map((y) => axis.map((x) => f(x, y))) },
  };
}

/** A scalar sampled through a box, for an isosurface to cut. */
function scalarField(f: (x: number, y: number, z: number) => number,
                     span = 2): Generated {
  const n = 28;
  const at = (i: number) => -span + i * (2 * span / (n - 1));
  const values = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        values[i + n * (j + n * k)] = f(at(i), at(j), at(k));
      }
    }
  }
  return { shape: "voxels", grid: { nx: n, ny: n, nz: n, values, units: "" } };
}

function grid(): Generated {
  const xs = Array.from({ length: 28 }, (_, i) => -3 + i * (6 / 27));
  const ys = Array.from({ length: 28 }, (_, i) => -3 + i * (6 / 27));
  return {
    shape: "grid",
    grid: {
      x: xs, y: ys,
      // A saddle: the one height field where reading a 2D contour and reading
      // the surface give genuinely different impressions.
      z: ys.map((y) => xs.map((x) => x * x - y * y)),
    },
  };
}

function field(): Generated {
  const samples: Array<{ x: number; y: number; z: number; u: number; v: number; w: number }> = [];
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      for (let k = -2; k <= 2; k++) {
        // A vortex about z, which is the field whose streamlines and arrows
        // disagree most usefully.
        samples.push({ x: i, y: j, z: k, u: -j, v: i, w: 0.35 * k });
      }
    }
  }
  return { shape: "field", samples };
}

function voxels(): Generated {
  const n = 24;
  const values = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(i - n / 2, j - n / 2, k - n / 2);
        values[i + n * (j + n * k)] = 100 * Math.exp(-(d * d) / 40);
      }
    }
  }
  return { shape: "voxels", grid: { nx: n, ny: n, nz: n, values, units: "arbitrary" } };
}

function graph(): Generated {
  const groups = ["one", "two", "three"];
  const nodes = Array.from({ length: 27 }, (_, i) => ({
    id: `n${i}`, label: `Node ${i + 1}`, group: groups[i % 3],
  }));
  const rand = noise(11);
  const edges: Array<{ source: string; target: string; weight?: number }> = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ source: nodes[i].id, target: nodes[Math.floor(rand() * i)].id, weight: 1 });
  }
  return { shape: "graph", graph: { nodes, edges } };
}

/**
 * Paths, for the renderer that draws lines.
 *
 * A curve is not a cloud. Handing the points generator to `Lines3D` would draw
 * a scatter joined in the order it happened to be generated, which is the
 * picture "3D line" and "Parametric curve" are least well described by.
 */
function curves(): Generated {
  return {
    shape: "paths",
    paths: [0, 1, 2].map((k) => ({
      id: `curve-${k}`,
      label: `Curve ${k + 1}`,
      group: ["one", "two", "three"][k],
      // A trefoil-ish knot: closed, self-crossing, and unmistakably a curve.
      points: Array.from({ length: 120 }, (_, i) => {
        const u = (i / 119) * Math.PI * 2;
        const r = 1 + 0.28 * Math.cos(3 * u + k);
        return {
          x: r * Math.cos(2 * u), y: r * Math.sin(2 * u),
          z: 0.55 * Math.sin(3 * u + k), t: i,
        };
      }),
    })),
  };
}

/** Streamlines through the same vortex the arrow field samples. */
function streams(): Generated {
  return {
    shape: "paths",
    paths: Array.from({ length: 12 }, (_, k) => {
      const angle = (k / 12) * Math.PI * 2;
      let x = 1.6 * Math.cos(angle), y = 1.6 * Math.sin(angle), z = -1.6;
      const points = [];
      for (let step = 0; step < 60; step++) {
        points.push({ x, y, z, t: step });
        const u = -y, v = x, w = 0.5;
        const length = Math.hypot(u, v, w) || 1;
        x += (u / length) * 0.16; y += (v / length) * 0.16; z += (w / length) * 0.09;
      }
      return { id: `stream-${k}`, label: `Streamline ${k + 1}`, points };
    }),
  };
}

function series(): Generated {
  return {
    shape: "series",
    bars: Array.from({ length: 5 }, (_, r) =>
      Array.from({ length: 5 }, (_, c) => ({
        row: r, column: c,
        value: 20 + 30 * Math.exp(-((r - 2) ** 2 + (c - 2) ** 2) / 4),
      }))).flat(),
  };
}

/**
 * The shape a named entry actually is.
 *
 * Keying only on the data shape was wrong, and wrong in the way this codebase
 * cares about most: every isosurface drew the same gaussian ball, so "Torus",
 * "Sphere" and "Hyperboloid" produced pixel-identical pictures, and every
 * height field drew the same saddle, so "Paraboloid" and "Plane" did too. A
 * chart that draws something other than its own name is not a rough
 * approximation of the right chart — it is a confident picture of the wrong
 * one, and a reader has no way to tell.
 *
 * So an entry whose name *is* a geometry gets that geometry. Names that
 * describe a use rather than a shape — "Loss landscape", "Optimization
 * landscape" — get a surface chosen to suit the use, because there the name
 * does not pin the geometry and any honest example of the right kind will do.
 */
/**
 * A graph with layers, for the entries whose name is an architecture.
 *
 * A neural network is not a random graph and does not look like one: every
 * edge runs forward from one layer to the next, and that is the whole of what
 * a reader is looking for when they open "Transformer architecture". Drawn as
 * a uniform blob of 27 nodes it is the same error as a globe drawn flat — the
 * name denotes a definite structure and the picture does not have it.
 */
function layered(widths: number[], group = "layer"): Generated {
  const nodes: Array<{ id: string; label: string; group?: string }> = [];
  const edges: Array<{ source: string; target: string; weight?: number }> = [];
  widths.forEach((width, depth) => {
    for (let i = 0; i < width; i += 1) {
      nodes.push({ id: `l${depth}n${i}`, label: `Layer ${depth + 1}, unit ${i + 1}`,
                   group: `${group} ${depth + 1}` });
    }
  });
  for (let depth = 0; depth < widths.length - 1; depth += 1) {
    for (let i = 0; i < widths[depth]; i += 1) {
      for (let j = 0; j < widths[depth + 1]; j += 1) {
        edges.push({ source: `l${depth}n${i}`, target: `l${depth + 1}n${j}` });
      }
    }
  }
  return { shape: "graph", graph: { nodes, edges } };
}

/**
 * A rooted tree, for a hierarchy or a provenance chain.
 *
 * The property that makes it a tree — one parent each, no cycles, n − 1 edges
 * — is the thing a reader is checking when they look at a derivation.
 */
function tree(depth: number, branching: number): Generated {
  const nodes = [{ id: "root", label: "Root", group: "level 1" }];
  const edges: Array<{ source: string; target: string }> = [];
  let frontier = ["root"];
  for (let level = 1; level <= depth; level += 1) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (let b = 0; b < branching; b += 1) {
        const id = `${parent}.${b}`;
        nodes.push({ id, label: id, group: `level ${level + 1}` });
        edges.push({ source: parent, target: id });
        next.push(id);
      }
    }
    frontier = next;
  }
  return { shape: "graph", graph: { nodes, edges } };
}

/**
 * A few hubs and a long tail, which is what an interaction network is.
 *
 * Preferential attachment, seeded deterministically. A protein interaction
 * network drawn with uniform degree hides the only structural fact anybody
 * opens it for: that a handful of proteins carry most of the interactions.
 */
function scaleFree(count: number): Generated {
  const nodes = [{ id: "n0", label: "Node 1", group: "hub" }];
  const edges: Array<{ source: string; target: string }> = [];
  const draw = noise(29);
  const degrees = [1];
  for (let i = 1; i < count; i += 1) {
    const id = `n${i}`;
    const total = degrees.reduce((a, b) => a + b, 0);
    let target = 0;
    let threshold = draw() * total;
    while (threshold > degrees[target] && target < degrees.length - 1) {
      threshold -= degrees[target];
      target += 1;
    }
    edges.push({ source: id, target: `n${target}` });
    degrees[target] += 1;
    degrees.push(1);
    nodes.push({ id, label: `Node ${i + 1}`,
                 group: degrees[target] > 4 ? "hub" : "leaf" });
  }
  return { shape: "graph", graph: { nodes, edges } };
}

/**
 * Named structures, where the name is a structure.
 *
 * The counterpart of `SHAPES`: 35 entries resolved to the `network` primitive
 * and every one of them drew the same 27-node blob, so an architecture, a
 * hierarchy and an interaction network were one picture with three labels.
 */
export const GRAPHS: Record<string, () => Generated> = {
  "Neural network graph": () => layered([4, 6, 6, 3]),
  "Transformer architecture": () => layered([5, 5, 5, 5], "block"),
  "Model architecture graph": () => layered([3, 5, 4, 2]),
  "Hierarchical network": () => tree(3, 3),
  "Provenance tree": () => tree(3, 2),
  "Protein interaction network": () => scaleFree(34),
  "Gene interaction network": () => scaleFree(30),
  "Biological interaction network": () => scaleFree(32),
};

/**
 * Which named graphs have a depth a reader should see, and how to read it.
 *
 * Giving an architecture layered *data* is only half of it: `layoutGraph` is
 * force-directed, so it relaxes those layers into the same blob every other
 * network gets, and the structure survives in the numbers while vanishing from
 * the picture. `Network3D` already takes a `depthOf` and already calls
 * `layoutLayered` when it gets one — the catalogue simply never passed it,
 * which is the built-and-unreachable shape this page exists to catch.
 *
 * The depth is read from the node id rather than stored beside it, so a
 * generator cannot produce ids of one shape and a depth function of another.
 */
const LAYERED_ENTRIES = new Set([
  "Neural network graph", "Transformer architecture", "Model architecture graph",
  "Hierarchical network", "Provenance tree",
]);

export function depthReaderFor(name: string):
    ((nodeId: string) => number) | undefined {
  if (!LAYERED_ENTRIES.has(name)) return undefined;
  return (nodeId) => {
    const architecture = /^l(\d+)n/.exec(nodeId);
    if (architecture) return Number(architecture[1]);
    // A tree: "root", "root.0", "root.0.1" — depth is how far down it sits.
    return nodeId === "root" ? 0 : nodeId.split(".").length - 1;
  };
}

export const SHAPES: Record<string, () => Generated> = {
  // Height fields, by their defining equation.
  "Saddle surface": () => heightField((x, y) => x * x - y * y),
  "Paraboloid": () => heightField((x, y) => x * x + y * y),
  "Plane": () => heightField((x, y) => 0.6 * x + 0.35 * y),
  "Regression plane": () => heightField((x, y) => 0.6 * x + 0.35 * y),
  "Function surface": () => heightField((x, y) => Math.sin(x) * Math.cos(y)),
  "Multivariable function plot": () =>
    heightField((x, y) => Math.sin(x) * Math.cos(y)),
  "Gaussian surface": () => heightField((x, y) => Math.exp(-(x * x + y * y) / 2)),
  "Kernel density surface": () =>
    heightField((x, y) => Math.exp(-((x - 1) ** 2 + y * y) / 1.2)
                        + 0.7 * Math.exp(-((x + 1.2) ** 2 + (y + 1) ** 2) / 0.8)),
  "3D probability distribution": () =>
    heightField((x, y) => Math.exp(-(x * x + y * y) / 2) / (2 * Math.PI)),
  "Multivariate distribution surface": () =>
    heightField((x, y) => Math.exp(-(x * x + 0.6 * x * y + y * y) / 2)),
  // A landscape wants several minima, or it says nothing about optimisation.
  "Optimization landscape": () =>
    heightField((x, y) => Math.sin(1.4 * x) * Math.cos(1.4 * y) + 0.12 * (x * x + y * y)),
  "Loss landscape": () =>
    heightField((x, y) => Math.sin(1.4 * x) * Math.cos(1.4 * y) + 0.12 * (x * x + y * y)),
  "Hessian": () => heightField((x, y) => x * x - y * y),
  "3D terrain map": () =>
    heightField((x, y) => Math.sin(x) * Math.cos(0.8 * y)
                        + 0.4 * Math.sin(2.3 * x + 1) * Math.cos(1.7 * y)),

  // Implicit surfaces, by the level set the isosurface cuts.
  "Sphere": () => scalarField((x, y, z) => 100 - 40 * Math.hypot(x, y, z)),
  "Ellipsoid": () =>
    scalarField((x, y, z) => 100 - 40 * Math.hypot(x / 1.6, y, z / 0.7)),
  "Torus": () => scalarField((x, y, z) => {
    // The distance to a circle of radius R in the z = 0 plane.
    const R = 1.1, ring = Math.hypot(Math.hypot(x, y) - R, z);
    return 100 - 90 * ring;
  }),
  "Hyperboloid": () =>
    scalarField((x, y, z) => 100 - 40 * Math.abs(x * x + y * y - z * z - 1)),
  "Implicit surface": () => scalarField((x, y, z) => 100 - 40 * Math.hypot(x, y, z)),
  "Constraint surface": () =>
    scalarField((x, y, z) => 100 - 40 * Math.abs(x + y + z)),
};

/**
 * The generator for each data shape, or null where none should exist.
 *
 * `geometry` is null on purpose: vertices and faces come from a researcher's
 * file, and a generated stand-in would make the catalogue claim a capability
 * that only arrives with the file.
 *
 * `places` is null for a different reason, and the difference is worth keeping.
 * The geometry is bundled and always available — what is missing is a *value
 * per country*, and inventing one would put a plausible pattern on a world map.
 * A fabricated scatter is obviously synthetic; a fabricated choropleth looks
 * exactly like an epidemiological finding, and the catalogue page's own caption
 * calls generated data "not a measurement" precisely so that no picture there
 * can be mistaken for one. A globe of invented country rates is the one example
 * in the set where that caption might not be believed.
 */
export const GENERATORS: Record<DataShape, (() => Generated) | null> = {
  xyz: () => points(false),
  xyzv: () => points(true),
  places: null,
  grid,
  field,
  voxels,
  graph,
  series,
  geometry: null,
};

/** Which primitives this codebase has a renderer for. */
export const RENDERED: ReadonlySet<Primitive> = new Set<Primitive>([
  "points", "surface", "lines", "bars", "glyphs", "isosurface", "volume",
  "network",
]);

/**
 * Whether this entry can actually be drawn, from code rather than from a
 * status somebody typed.
 */
export function isDrawable(entry: Visualization): boolean {
  return RENDERED.has(entry.primitive) && GENERATORS[entry.needs] !== null;
}

/** The data an entry would be drawn from, or null when it cannot be. */
/**
 * The data a *renderer* needs, which is not always the shape the entry
 * declares.
 *
 * `needs` describes the data a chart consumes in the abstract; `primitive`
 * names the thing that draws it, and those two disagree more often than they
 * look like they should. Nineteen entries are `lines` over `xyz` — "3D line",
 * "3D stem", "Parametric curve", orbits, flight paths — and generating `xyz`
 * for them produced a point cloud, which the line renderer then joined in
 * whatever order it was generated. Two more are `surface` over `series`, one
 * is `bars` over `grid`, one is `surface` over `field`. Twenty-three entries
 * drawn by the wrong renderer, each of them a confident picture of something
 * else.
 *
 * So the generator follows the renderer. A curve gets a curve, a bar chart
 * gets bars, and a surface gets a height field, whatever the abstract shape of
 * the data behind the name.
 */
function forPrimitive(entry: Visualization): Generated | null {
  switch (entry.primitive) {
    case "lines":
      // Streamlines when the data is a field, an actual curve otherwise.
      return entry.needs === "field" ? streams() : curves();
    case "bars":
      // Bars over a grid is a 3D histogram: the grid is the binning, and the
      // bars are the counts.
      return series();
    case "surface":
      if (entry.needs === "geometry") return null;
      // A ribbon or an area chart is a surface over series, and a streamtube a
      // surface through a field. Both are height fields once drawn.
      return SHAPES[entry.name]?.() ?? grid();
    case "points":
      return points(entry.needs === "xyzv");
    case "glyphs":
      return field();
    case "isosurface":
    case "volume":
      return SHAPES[entry.name]?.() ?? voxels();
    case "network":
      return GRAPHS[entry.name]?.() ?? graph();
    default:
      return null;
  }
}

export function exampleFor(entry: Visualization): Generated | null {
  if (!RENDERED.has(entry.primitive)) return null;
  // `geometry` still has no generator: vertices and faces come from a file.
  if (entry.needs === "geometry") return null;
  return forPrimitive(entry);
}


/**
 * How many other entries draw the same picture as this one.
 *
 * 219 entries are drawable and they produce 21 distinct pictures. Much of that
 * is honest — "3D surface", "3D mesh" and "3D wireframe" *are* the same
 * numbers, and what separates them is how the quads are stroked. But this
 * codebase draws them identically, so a catalogue that listed 219 names and
 * showed 21 pictures would be making the same overstatement its headline used
 * to make: a count of things that exist, presented as a count of things you
 * can see.
 *
 * So each chart says what it shares. The number is derived, which means it
 * cannot drift as entries and renderers change, and it points at the work that
 * is actually left: the styling, not the geometry.
 */
export function sharesPictureWith(entry: Visualization,
                                  catalogue: readonly Visualization[]): Visualization[] {
  const mine = exampleFor(entry);
  if (!mine) return [];
  return catalogue.filter((other) => {
    if (other.name === entry.name) return false;
    // Same renderer and same generated data is the same picture, because
    // nothing between here and the canvas varies by name.
    return other.primitive === entry.primitive
        && other.needs === entry.needs
        && SHAPES[other.name] === SHAPES[entry.name]
        // A named structure is a different picture for the same reason a named
        // surface is: the name denotes the thing, not the renderer.
        && GRAPHS[other.name] === GRAPHS[entry.name]
        // Two entries drawn in different styles are two pictures, which is
        // the whole point of having styles at all.
        && STYLES[other.name] === STYLES[entry.name];
  });
}


/**
 * How a named entry is drawn, where the name is about the drawing.
 *
 * "3D surface", "3D mesh", "3D wireframe" and "3D contour" are the same
 * numbers; what separates them is how the cells are stroked, and this codebase
 * drew one picture for all of them. That was disclosed in the caption — "18
 * other entries draw this same picture" — which is better than hiding it and
 * worse than drawing the right one.
 *
 * Only the names that genuinely mean a style appear here. A surface whose name
 * describes a subject rather than a rendering keeps the default, because
 * inventing a distinction would be the same error in the other direction.
 */
export const STYLES: Record<string, "filled" | "wireframe" | "contour"> = {
  "3D wireframe": "wireframe",
  "3D mesh": "wireframe",
  "3D contour": "contour",
  "3D filled contour": "contour",
};

/** The style an entry is drawn in. */
export function styleFor(entry: Visualization): "filled" | "wireframe" | "contour" {
  return STYLES[entry.name] ?? "filled";
}
