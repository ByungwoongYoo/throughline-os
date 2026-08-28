/**
 * The shell where a field crosses a value (§9 isosurface).
 *
 * These tests lean on shapes whose answer is known in advance — a sphere, an
 * ellipsoid, a two-sheeted hyperboloid — because for an isosurface the analytic
 * form *is* an oracle: a sphere of radius r has every vertex at radius r, and
 * any deviation is the algorithm's rather than the data's.
 *
 * The watertightness test is the one that matters most. It is the property
 * marching tetrahedra was chosen to buy over marching cubes, and a hole in a
 * decision boundary or a tumour margin looks exactly like a gap in the data.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SURFACE, Surface, describeSurface, extractSurface,
} from "@/lib/charts3d/isosurface";
import { Grid, gridFromFunction } from "@/lib/charts3d/voxels";

/** |p| — a sphere of radius r is the level set at r. */
const sphere = (n = 24) =>
  gridFromFunction((x, y, z) => Math.sqrt(x * x + y * y + z * z), n,
                   { min: -1.5, max: 1.5 });

const all = (s: Surface) => s.triangles.flatMap((t) => [t.a, t.b, t.c]);

describe("a known shape comes out as that shape", () => {
  it("puts every vertex of a sphere on the sphere", () => {
    /*
     * The analytic oracle. Positions come back in the unit cube, so a radius
     * of 1.0 in a field sampled over ±1.5 lands at 1/1.5 of the way out.
     */
    const surface = extractSurface(sphere(28), 1.0);
    expect(surface.triangles.length).toBeGreaterThan(100);

    const expected = 1.0 / 1.5;
    for (const p of all(surface)) {
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      // Within one cell of the grid: the surface is piecewise linear between
      // samples, so this is the discretisation and not an error.
      expect(Math.abs(r - expected)).toBeLessThan(0.06);
    }
  });

  it("gives an ellipsoid different extents on different axes", () => {
    // A shape no height field can represent, and the reason `Sphere` is
    // catalogued as an isosurface rather than a surface.
    const grid = gridFromFunction(
      (x, y, z) => Math.sqrt(x * x + (y / 0.5) ** 2 + (z / 0.25) ** 2), 28,
      { min: -1.5, max: 1.5 });
    const points = all(extractSurface(grid, 1.0));
    const reach = (pick: (p: { x: number; y: number; z: number }) => number) =>
      Math.max(...points.map((p) => Math.abs(pick(p))));

    expect(reach((p) => p.x)).toBeGreaterThan(reach((p) => p.y) * 1.5);
    expect(reach((p) => p.y)).toBeGreaterThan(reach((p) => p.z) * 1.5);
  });

  it("finds both sheets of a two-sheeted hyperboloid", () => {
    /*
     * `-x² + y² + z² = -1` has two disconnected sheets, one at each end of x.
     * A height field cannot be double-valued, so this is precisely the case
     * that separates an isosurface from a surface — and a renderer that found
     * only one sheet would look entirely plausible.
     */
    const grid = gridFromFunction((x, y, z) => -(x * x) + y * y + z * z, 30,
                                  { min: -2, max: 2 });
    const xs = all(extractSurface(grid, -1)).map((p) => p.x);
    expect(xs.some((x) => x > 0.1)).toBe(true);
    expect(xs.some((x) => x < -0.1)).toBe(true);
    // And nothing in the middle, where the field never reaches the level.
    expect(xs.filter((x) => Math.abs(x) < 0.05)).toHaveLength(0);
  });
});

describe("the shell is closed", () => {
  it("shares every edge between exactly two triangles", () => {
    /*
     * The definition of watertight, and the whole reason for tetrahedra.
     * Marching cubes' ambiguous cases let two neighbours choose different
     * surfaces across the face they share, and the seam between them is a hole.
     *
     * Keys are exact rather than rounded: `cross` orders its corner pair
     * canonically, so a vertex reached from either side is bitwise identical.
     * If that ever stops being true this test fails, which is the point.
     */
    const surface = extractSurface(sphere(20), 1.0);
    const key = (p: { x: number; y: number; z: number }) =>
      `${p.x},${p.y},${p.z}`;
    const edges = new Map<string, number>();

    for (const t of surface.triangles) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as const) {
        // Undirected: sort the two ends so both traversals land on one key.
        const e = [key(u), key(v)].sort().join("|");
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    }

    const open = [...edges.entries()].filter(([, n]) => n !== 2);
    expect(open).toEqual([]);
  });

  it("leaves the shell open where a voxel was never measured", () => {
    /*
     * The one place it must NOT close. Treating a missing voxel as below the
     * level would seal the surface across the gap, inventing a boundary
     * exactly where the data ran out.
     */
    const n = 16;
    const grid = sphere(n);
    const values = Float64Array.from(grid.values);
    // Knock a hole through one octant's worth of samples.
    for (let k = 0; k < n; k += 1)
      for (let j = 0; j < n; j += 1)
        for (let i = 0; i < n / 2; i += 1) {
          if (j < n / 2 && k < n / 2) values[i + n * (j + n * k)] = NaN;
        }
    const holed: Grid = { ...grid, values };

    const surface = extractSurface(holed, 1.0);
    expect(surface.incomplete).toBeGreaterThan(0);
    expect(describeSurface(surface)).toContain("left open rather than closed");
  });

  it("marches nothing at all in a cell it could not read", () => {
    /*
     * Counting the cell is not enough — it has to be *skipped*. Without the
     * skip the march runs on a half-read cell whose missing corners read as
     * below the level, which either closes the shell across the gap or
     * dereferences a corner that was never loaded.
     *
     * The field decreases along x on purpose. With an increasing field the
     * low corner of every incomplete cell happens to sit below the level, the
     * configuration comes out empty, and the bug is invisible — which is
     * exactly how this survived the first mutation run.
     */
    const n = 3;
    const values = new Float64Array(n * n * n);
    for (let k = 0; k < n; k += 1)
      for (let j = 0; j < n; j += 1)
        for (let i = 0; i < n; i += 1) values[i + n * (j + n * k)] = (2 - i) * 10;
    values[2 + n * (1 + n * 1)] = NaN;

    const grid: Grid = { nx: n, ny: n, nz: n, values };
    let surface!: Surface;
    expect(() => { surface = extractSurface(grid, 5); }).not.toThrow();
    expect(surface.incomplete).toBeGreaterThan(0);
    for (const p of all(surface)) {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    }
  });

  it("does not emit a degenerate triangle", () => {
    // A level passing exactly through a corner produces two coincident
    // crossings; a triangle with no area has no normal, and a NaN normal
    // renders as a black facet that reads as a hole.
    const surfaces = [
      extractSurface(sphere(18), 1.0),
      /*
       * And the case that actually produces coincident crossings: a level
       * sitting exactly on corner values. Every edge from such a corner is cut
       * at the corner itself, so two of a triangle's three vertices land on the
       * same point. A sphere never lands on its samples that exactly, which is
       * why checking only the sphere left this unguarded.
       */
      (() => {
        const n = 3;
        const values = new Float64Array(n * n * n);
        for (let k = 0; k < n; k += 1)
          for (let j = 0; j < n; j += 1)
            for (let i = 0; i < n; i += 1) values[i + n * (j + n * k)] = i;
        return extractSurface({ nx: n, ny: n, nz: n, values }, 1);
      })(),
    ];

    for (const surface of surfaces) {
      expect(surface.triangles.length).toBeGreaterThan(0);
      for (const t of surface.triangles) {
        expect(Number.isFinite(t.n.x + t.n.y + t.n.z)).toBe(true);
        expect(Math.hypot(t.n.x, t.n.y, t.n.z)).toBeCloseTo(1, 6);
      }
    }
  });
});

describe("the normals agree with each other", () => {
  it("points every normal outward on a field that grows outward", () => {
    /*
     * Orientation is decided from the field rather than from a hand-worked
     * table per case, so a single transposition cannot flip one triangle in
     * one configuration. On |p| the field increases outward, so every normal
     * must point away from the centre.
     */
    const surface = extractSurface(sphere(22), 1.0);
    let agreeing = 0;
    for (const t of surface.triangles) {
      const cx = (t.a.x + t.b.x + t.c.x) / 3;
      const cy = (t.a.y + t.b.y + t.c.y) / 3;
      const cz = (t.a.z + t.b.z + t.c.z) / 3;
      if (t.n.x * cx + t.n.y * cy + t.n.z * cz > 0) agreeing += 1;
    }
    expect(agreeing).toBe(surface.triangles.length);
  });

  it("flips them all when the field grows inward instead", () => {
    // −|p| decreases outward, so "up the gradient" is inward. The rule is
    // about the field, not about the shape.
    const grid = gridFromFunction(
      (x, y, z) => -Math.sqrt(x * x + y * y + z * z), 20, { min: -1.5, max: 1.5 });
    const surface = extractSurface(grid, -1.0);
    expect(surface.triangles.length).toBeGreaterThan(50);
    for (const t of surface.triangles) {
      const cx = (t.a.x + t.b.x + t.c.x) / 3;
      const cy = (t.a.y + t.b.y + t.c.y) / 3;
      const cz = (t.a.z + t.b.z + t.c.z) / 3;
      expect(t.n.x * cx + t.n.y * cy + t.n.z * cz).toBeLessThan(0);
    }
  });
});

describe("the crossing is interpolated, not halved", () => {
  it("cuts an asymmetric edge off-centre", () => {
    /*
     * A field rising steeply on one side crosses the level near the low corner,
     * not between the corners. Snapping to the midpoint builds a shell out of
     * the sampling grid rather than out of the field, and a reader measuring a
     * diameter off it measures the grid.
     */
    const n = 3;
    const values = new Float64Array(n * n * n);
    for (let k = 0; k < n; k += 1)
      for (let j = 0; j < n; j += 1)
        for (let i = 0; i < n; i += 1) {
          // 0, 10, 20 along x: the level 1 sits a tenth of the way into the
          // first cell, nowhere near its midpoint.
          values[i + n * (j + n * k)] = i * 10;
        }
    const grid: Grid = { nx: n, ny: n, nz: n, values };

    const xs = all(extractSurface(grid, 1)).map((p) => p.x);
    expect(xs.length).toBeGreaterThan(0);
    // The cell spans x = -1 to 0; a tenth along is -0.9, the midpoint -0.5.
    for (const x of xs) expect(x).toBeCloseTo(-0.9, 6);
  });

  it("puts the surface halfway when the field really is symmetric", () => {
    const n = 3;
    const values = new Float64Array(n * n * n);
    for (let k = 0; k < n; k += 1)
      for (let j = 0; j < n; j += 1)
        for (let i = 0; i < n; i += 1) values[i + n * (j + n * k)] = i * 10;
    const grid: Grid = { nx: n, ny: n, nz: n, values };
    const xs = all(extractSurface(grid, 5)).map((p) => p.x);
    for (const x of xs) expect(x).toBeCloseTo(-0.5, 6);
  });
});

describe("a level with no shell", () => {
  it("says the level is outside the data rather than drawing nothing", () => {
    // An empty canvas is indistinguishable from a failure to load.
    const surface = extractSurface(sphere(12), 99);
    expect(surface.triangles).toHaveLength(0);
    expect(describeSurface(surface)).toContain("outside it entirely");
  });

  it("reports the measured range beside the level", () => {
    const surface = extractSurface(sphere(12), 1.0);
    expect(surface.range.min).toBeGreaterThanOrEqual(0);
    expect(describeSurface(surface)).toContain("from a field of");
  });

  it("has nothing to draw for a grid with no extent", () => {
    expect(extractSurface({ nx: 0, ny: 0, nz: 0, values: [] }, 1).triangles)
      .toHaveLength(0);
  });

  it("refuses a grid whose values do not fill its shape", () => {
    // Read past the end, every corner is undefined and every cell silently
    // becomes unusable — an empty shell that looks like an empty scan.
    const truncated: Grid = { nx: 8, ny: 8, nz: 8, values: [1, 2, 3] };
    expect(extractSurface(truncated, 1).triangles).toHaveLength(0);
  });

  it("has nothing to draw when nothing was measured", () => {
    const n = 6;
    const grid: Grid = { nx: n, ny: n, nz: n,
                         values: new Array(n * n * n).fill(NaN) };
    expect(extractSurface(grid, 1).triangles).toHaveLength(0);
  });
});

describe("a grid too large to march whole", () => {
  it("strides down and says a thin fold may be lost", () => {
    const surface = extractSurface(sphere(60), 1.0,
                                   { ...DEFAULT_SURFACE, maxCells: 2000 });
    expect(surface.stride).toBeGreaterThan(1);
    expect(describeSurface(surface)).toContain("is smoothed away");
  });

  it("puts the surface in the same place at either resolution", () => {
    /*
     * The stride changes how finely the shell is cut, never where it sits. A
     * coarser march that also shrank the shape would make two views of one
     * scan disagree about a diameter.
     */
    const radius = (s: Surface) => {
      const pts = all(s);
      return pts.reduce((m, p) => m + Math.hypot(p.x, p.y, p.z), 0) / pts.length;
    };
    const fine = extractSurface(sphere(40), 1.0, { maxCells: 1e9 });
    const coarse = extractSurface(sphere(40), 1.0, { maxCells: 500 });
    expect(coarse.stride).toBeGreaterThan(1);
    expect(radius(coarse)).toBeCloseTo(radius(fine), 1);
  });
});
