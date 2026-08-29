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
  | { shape: "series"; bars: Array<{ row: number; column: number; value: number }> };

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
 * The generator for each data shape, or null where none should exist.
 *
 * `geometry` is null on purpose: vertices and faces come from a researcher's
 * file, and a generated stand-in would make the catalogue claim a capability
 * that only arrives with the file.
 */
export const GENERATORS: Record<DataShape, (() => Generated) | null> = {
  xyz: () => points(false),
  xyzv: () => points(true),
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
export function exampleFor(entry: Visualization): Generated | null {
  const make = GENERATORS[entry.needs];
  if (!make || !RENDERED.has(entry.primitive)) return null;
  return make();
}
