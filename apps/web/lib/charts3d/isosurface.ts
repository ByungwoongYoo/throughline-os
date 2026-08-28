/**
 * The shell where a field crosses a value (§9 isosurface).
 *
 * Eleven named visualizations are this one primitive: a sphere, an ellipsoid,
 * a torus, a hyperboloid, the zero level of an implicit function, a constraint
 * surface, a molecular orbital, a tumour boundary, and — the one that is a
 * genuine research object rather than a shape — a decision boundary, which in
 * three inputs is a shell and not a height field.
 *
 * **Marching tetrahedra, not marching cubes, and that is the whole design.**
 * Marching cubes is the famous algorithm and it has a famous defect: several
 * of its 256 corner configurations are *ambiguous* — the same corner signs
 * admit two different surfaces, and the standard table picks one per case
 * without reference to the neighbour that shares the face. Where the two
 * choices disagree the surface has a hole in it. A hole in a decision boundary
 * or a tumour margin is not a cosmetic artefact: it is a gap in the thing being
 * measured, and it looks exactly like a gap in the data.
 *
 * Splitting each cube into six tetrahedra removes the ambiguity by
 * construction. A tetrahedron has four corners and sixteen configurations, none
 * of which admits two surfaces, so neighbouring cells always agree along the
 * face they share and the result is watertight. The cost is roughly twice the
 * triangles for the same grid, which is a fair price for a surface that is not
 * sometimes wrong in a way nobody can see.
 *
 * **The crossing is interpolated, never taken at the midpoint.** Where a cell
 * edge runs from 0.9 to 1.1 and the level is 1.0, the surface passes halfway;
 * where it runs from 0.9 to 9.9 it passes a tenth of the way along. Snapping to
 * the midpoint gives a blocky shell whose facets are artefacts of the sampling
 * grid, and a reader measuring a diameter off it measures the grid.
 */

import { Grid, valueAt } from "./voxels";

export type Vec3 = { x: number; y: number; z: number };

/** One triangle of the shell, in the unit cube -1..1. */
export type Triangle = {
  a: Vec3; b: Vec3; c: Vec3;
  /** Unit normal, oriented so it points *up* the field's gradient. */
  n: Vec3;
};

export type Surface = {
  triangles: Triangle[];
  /** The level actually extracted. */
  level: number;
  /** The measured range of the grid, so a caller can say whether the level is in it. */
  range: { min: number; max: number };
  /** Cells skipped because a corner held no measurement. */
  incomplete: number;
  /** The per-axis stride used, for the caption. */
  stride: number;
};

export type SurfaceSettings = {
  /**
   * The most cells to march.
   *
   * Each cell becomes six tetrahedra and up to twelve triangles, so this is a
   * budget on the *output* as much as on the work. A 128³ grid is two million
   * cells and would produce a mesh no screen can show and no frame can sort.
   */
  maxCells: number;
};

export const DEFAULT_SURFACE: SurfaceSettings = { maxCells: 60000 };

/*
 * Six tetrahedra filling the cube, all sharing the main diagonal 0–7.
 *
 * Corners are indexed by bit: x = c & 1, y = (c >> 1) & 1, z = (c >> 2) & 1, so
 * corner 0 is the near-low corner and 7 is the far-high one. Sharing one
 * diagonal is what makes the decomposition consistent between neighbouring
 * cubes — an arbitrary split would put different diagonals on a shared face and
 * reintroduce exactly the cracks this algorithm was chosen to avoid.
 */
const TETRAHEDRA: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 7, 1, 3], [0, 7, 3, 2], [0, 7, 2, 6],
  [0, 7, 6, 4], [0, 7, 4, 5], [0, 7, 5, 1],
];

/** The four corner offsets, from the bit encoding above. */
function cornerOffset(c: number): [number, number, number] {
  return [c & 1, (c >> 1) & 1, (c >> 2) & 1];
}

/**
 * Extract the shell where the field crosses `level`.
 *
 * Positions land in the unit cube -1..1, matching `unitScale` and therefore
 * every other spatial chart here.
 */
export function extractSurface(grid: Grid, level: number,
                               settings: SurfaceSettings = DEFAULT_SURFACE): Surface {
  const total = grid.nx * grid.ny * grid.nz;
  const empty: Surface = {
    triangles: [], level, range: { min: 0, max: 0 }, incomplete: 0, stride: 1,
  };
  if (total <= 0 || grid.values.length < total) return empty;

  let min = Infinity, max = -Infinity, measured = 0;
  for (let n = 0; n < total; n += 1) {
    const v = grid.values[n];
    if (!Number.isFinite(v)) continue;
    measured += 1;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (measured === 0) return empty;

  const cells = Math.max(1, (grid.nx - 1) * (grid.ny - 1) * (grid.nz - 1));
  const stride = Math.max(1, Math.ceil(Math.cbrt(cells / settings.maxCells)));

  // Positions normalise against the grid's full extent, not the strided one, so
  // a coarser march puts the surface in the same place rather than a scaled one.
  const place = (i: number, extent: number) =>
    extent > 0 ? (i / extent) * 2 - 1 : 0;

  const triangles: Triangle[] = [];
  let incomplete = 0;

  for (let k = 0; k + stride < grid.nz; k += stride) {
    for (let j = 0; j + stride < grid.ny; j += stride) {
      for (let i = 0; i + stride < grid.nx; i += stride) {
        // The eight corners of this cell, read once.
        const value: number[] = [];
        const point: Vec3[] = [];
        let usable = true;
        for (let c = 0; c < 8; c += 1) {
          const [dx, dy, dz] = cornerOffset(c);
          const ci = i + dx * stride, cj = j + dy * stride, ck = k + dz * stride;
          const v = valueAt(grid, ci, cj, ck);
          if (!Number.isFinite(v)) { usable = false; break; }
          value.push(v);
          point.push({
            x: place(ci, grid.nx - 1),
            y: place(cj, grid.ny - 1),
            z: place(ck, grid.nz - 1),
          });
        }
        /*
         * A cell touching an unmeasured voxel is skipped whole, and counted.
         * Treating the gap as "below the level" would close the shell across
         * it — inventing a boundary exactly where the data ran out, which is
         * the one place a reader most needs to see that it did.
         */
        if (!usable) { incomplete += 1; continue; }

        for (const tet of TETRAHEDRA) {
          marchTetrahedron(tet, value, point, level, triangles);
        }
      }
    }
  }

  return { triangles, level, range: { min, max }, incomplete, stride };
}

/**
 * One tetrahedron, contributing nothing, one triangle, or two.
 *
 * Sixteen configurations, none ambiguous — which is the entire reason this is a
 * tetrahedron rather than a cube.
 */
function marchTetrahedron(tet: readonly [number, number, number, number],
                          value: number[], point: Vec3[], level: number,
                          out: Triangle[]): void {
  const [p0, p1, p2, p3] = tet;
  // `>=` rather than `>`, so a corner sitting exactly on the level counts as
  // inside. The choice is arbitrary but it must be the *same* choice in every
  // cell: mixing them puts two neighbours on opposite sides of a shared corner
  // and tears the surface there.
  const above = (c: number) => (value[c] >= level ? 1 : 0);
  const mask = above(p0) | (above(p1) << 1) | (above(p2) << 2) | (above(p3) << 3);

  /**
   * Where the level crosses the edge between two corners.
   *
   * **The pair is put in a canonical order first.** Two tetrahedra sharing a
   * face reach the same edge from opposite ends, and `(level - va) / (vb - va)`
   * and `(level - vb) / (va - vb)` are the same number in algebra and not
   * always the same float. Computing both from the lower index makes the
   * shared vertex bitwise identical, so the mesh welds exactly instead of
   * leaving seams a few ulps wide — which are invisible until something tries
   * to compute a volume or weld the vertices, and are then a leak.
   */
  const cross = (from: number, to: number): Vec3 => {
    const [a, b] = from <= to ? [from, to] : [to, from];
    const va = value[a], vb = value[b];
    const span = vb - va;
    /*
     * Interpolated, not halved. An edge from 0.9 to 9.9 crossing at 1.0 is cut
     * a tenth of the way along, not in the middle; snapping to the midpoint
     * builds a shell out of the sampling grid rather than out of the field.
     *
     * A flat edge cannot be crossed at a defined place, and the midpoint is
     * the only answer that does not favour one end — but it is only reachable
     * when both corners equal the level exactly.
     */
    const t = Math.abs(span) > 1e-12 ? (level - va) / span : 0.5;
    const u = Math.max(0, Math.min(1, t));
    return {
      x: point[a].x + (point[b].x - point[a].x) * u,
      y: point[a].y + (point[b].y - point[a].y) * u,
      z: point[a].z + (point[b].z - point[a].z) * u,
    };
  };

  const push = (a: Vec3, b: Vec3, c: Vec3) => {
    const t = oriented(a, b, c, value, point, level);
    if (t) out.push(t);
  };

  switch (mask) {
    case 0b0000: case 0b1111: return;

    // One corner inside: a single triangle cutting off that corner.
    case 0b0001: push(cross(p0, p1), cross(p0, p2), cross(p0, p3)); return;
    case 0b0010: push(cross(p1, p0), cross(p1, p3), cross(p1, p2)); return;
    case 0b0100: push(cross(p2, p0), cross(p2, p1), cross(p2, p3)); return;
    case 0b1000: push(cross(p3, p0), cross(p3, p2), cross(p3, p1)); return;

    // Three inside: the complement, same cut with the other side kept.
    case 0b1110: push(cross(p0, p1), cross(p0, p3), cross(p0, p2)); return;
    case 0b1101: push(cross(p1, p0), cross(p1, p2), cross(p1, p3)); return;
    case 0b1011: push(cross(p2, p0), cross(p2, p3), cross(p2, p1)); return;
    case 0b0111: push(cross(p3, p0), cross(p3, p1), cross(p3, p2)); return;

    // Two inside: a quadrilateral, split into two triangles. The split must use
    // the same diagonal for both halves or the quad is not planar-consistent.
    case 0b0011: {
      const a = cross(p0, p2), b = cross(p0, p3);
      const c = cross(p1, p3), d = cross(p1, p2);
      push(a, b, c); push(a, c, d); return;
    }
    case 0b0101: {
      const a = cross(p0, p1), b = cross(p0, p3);
      const c = cross(p2, p3), d = cross(p2, p1);
      push(a, b, c); push(a, c, d); return;
    }
    case 0b1001: {
      const a = cross(p0, p1), b = cross(p0, p2);
      const c = cross(p3, p2), d = cross(p3, p1);
      push(a, b, c); push(a, c, d); return;
    }
    case 0b0110: {
      const a = cross(p1, p0), b = cross(p1, p3);
      const c = cross(p2, p3), d = cross(p2, p0);
      push(a, b, c); push(a, c, d); return;
    }
    case 0b1010: {
      const a = cross(p1, p0), b = cross(p1, p2);
      const c = cross(p3, p2), d = cross(p3, p0);
      push(a, b, c); push(a, c, d); return;
    }
    case 0b1100: {
      const a = cross(p2, p0), b = cross(p2, p1);
      const c = cross(p3, p1), d = cross(p3, p0);
      push(a, b, c); push(a, c, d); return;
    }
  }
}

/**
 * A triangle with its winding fixed against the field, not against the case.
 *
 * The sixteen cases could each carry a hand-worked vertex order, and a single
 * transposition among them would flip one triangle in one configuration —
 * invisible in a wireframe, and in a shaded surface a black facet in an
 * otherwise lit shell, which reads as a hole. Deciding the orientation from the
 * field itself makes every triangle agree by construction: the normal is
 * required to point up the gradient, so it faces away from the enclosed volume
 * for a field that is larger inside.
 *
 * Degenerate triangles — two coincident crossings, which happen whenever the
 * level passes exactly through a corner — have no normal and are dropped
 * rather than emitted with a NaN one.
 */
function oriented(a: Vec3, b: Vec3, c: Vec3, value: number[], point: Vec3[],
                  level: number): Triangle | null {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (!(length > 1e-12)) return null;
  nx /= length; ny /= length; nz /= length;

  /*
   * Which way is "up the field"? Take the corner furthest from the level and
   * ask which side of the triangle it is on: a corner above the level must sit
   * behind the normal, one below must sit in front.
   */
  let pick = 0;
  let furthest = -Infinity;
  for (let i = 0; i < value.length; i += 1) {
    const d = Math.abs(value[i] - level);
    if (d > furthest) { furthest = d; pick = i; }
  }
  const toCorner = {
    x: point[pick].x - a.x, y: point[pick].y - a.y, z: point[pick].z - a.z };
  const facing = nx * toCorner.x + ny * toCorner.y + nz * toCorner.z;
  const shouldFacePositive = value[pick] > level;

  if ((facing > 0) !== shouldFacePositive) {
    return { a, b: c, c: b, n: { x: -nx, y: -ny, z: -nz } };
  }
  return { a, b, c, n: { x: nx, y: ny, z: nz } };
}

/**
 * What the surface says about itself.
 *
 * A level outside the data has no shell, and an empty canvas is
 * indistinguishable from a failure to load — so it is stated rather than shown.
 */
export function describeSurface(surface: Surface): string {
  const { range, level } = surface;
  const outside = level < range.min || level > range.max;

  if (surface.triangles.length === 0) {
    if (outside) {
      return `Nothing at ${format(level)}: the data runs from `
           + `${format(range.min)} to ${format(range.max)}, so this level is `
           + "outside it entirely.";
    }
    return `Nothing crosses ${format(level)}.`;
  }

  let text = `${surface.triangles.length.toLocaleString()} triangles at `
           + `${format(level)}, from a field of ${format(range.min)} to `
           + `${format(range.max)}.`;
  if (surface.stride > 1) {
    text += ` Marched every ${surface.stride} voxels; a fold thinner than that`
          + " is smoothed away.";
  }
  if (surface.incomplete > 0) {
    text += ` ${surface.incomplete.toLocaleString()} cells touch a voxel with`
          + " no measurement and are left open rather than closed across the"
          + " gap.";
  }
  return text;
}

function format(value: number): string {
  if (!Number.isFinite(value)) return "?";
  if (value === 0) return "0";
  const m = Math.abs(value);
  if (m >= 10000 || m < 0.01) return value.toExponential(1);
  return Number(value.toFixed(2)).toString();
}
