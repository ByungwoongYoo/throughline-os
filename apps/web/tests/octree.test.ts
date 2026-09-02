/**
 * The approximation agrees with the thing it approximates.
 *
 * Barnes-Hut replaced an all-pairs repulsion that was measured at 1.93 seconds
 * for two thousand nodes, on the main thread. The risk in that trade is not
 * that it is slow — it is that it is subtly wrong and still produces a
 * perfectly plausible picture, because a layout has no correct answer to
 * compare against by eye.
 *
 * So the traversal is checked against brute force directly. At `theta = 0`
 * nothing may ever be lumped and the two must agree to floating point; as
 * theta opens up, the error must stay small and must grow with theta rather
 * than wander.
 *
 * The bug this caught is worth naming. A first version never pushed a sitting
 * body down when its cell split, so that body stayed in the parent's totals
 * and appeared in no child — any traversal that opened the parent walked
 * straight past it. It repelled nothing, drifted into its neighbours, and drew
 * a layout that looked entirely reasonable.
 */

import { describe, expect, it } from "vitest";
import { buildOctree, repulsionOn, type Point } from "@/lib/charts3d/octree";

const STRENGTH = 0.0009;

/** The loop Barnes-Hut replaced, kept here as the reference answer. */
function bruteForce(points: Point[], p: Point) {
  const force = { x: 0, y: 0, z: 0 };
  for (const q of points) {
    const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 1e-12) continue;
    const floored = Math.max(d2, 1e-4);
    const d = Math.sqrt(floored);
    const push = STRENGTH / floored;
    force.x += (dx / d) * push;
    force.y += (dy / d) * push;
    force.z += (dz / d) * push;
  }
  return force;
}

/** Deterministic scatter, so a failure is reproducible. */
function scatter(n: number, seed = 1): Point[] {
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: n }, () => ({
    x: next() * 2 - 1, y: next() * 2 - 1, z: next() * 2 - 1 }));
}

const magnitude = (f: { x: number; y: number; z: number }) =>
  Math.hypot(f.x, f.y, f.z);

describe("the tree reproduces the force it approximates", () => {
  it("matches brute force exactly when nothing may be lumped", () => {
    const points = scatter(120);
    const tree = buildOctree(points);
    for (const p of points.slice(0, 20)) {
      const exact = bruteForce(points, p);
      const viaTree = repulsionOn(tree, p, STRENGTH, 0);
      expect(viaTree.x).toBeCloseTo(exact.x, 9);
      expect(viaTree.y).toBeCloseTo(exact.y, 9);
      expect(viaTree.z).toBeCloseTo(exact.z, 9);
    }
  });

  it("stays close at the theta the layout actually uses", () => {
    const points = scatter(400, 7);
    const tree = buildOctree(points);
    let worst = 0;
    for (const p of points.slice(0, 60)) {
      const exact = bruteForce(points, p);
      const viaTree = repulsionOn(tree, p, STRENGTH, 0.5);
      const error = magnitude({
        x: viaTree.x - exact.x, y: viaTree.y - exact.y, z: viaTree.z - exact.z });
      worst = Math.max(worst, error / Math.max(magnitude(exact), 1e-12));
    }
    expect(worst).toBeLessThan(0.12);
  });

  it("gets less accurate as theta opens, and not more", () => {
    /** If error did not track theta, the parameter would not be doing what its
     *  name says, and a future tuning of it would be guesswork. */
    const points = scatter(400, 11);
    const tree = buildOctree(points);
    const errorAt = (theta: number) => {
      let total = 0;
      for (const p of points.slice(0, 40)) {
        const exact = bruteForce(points, p);
        const viaTree = repulsionOn(tree, p, STRENGTH, theta);
        total += magnitude({ x: viaTree.x - exact.x, y: viaTree.y - exact.y,
                             z: viaTree.z - exact.z });
      }
      return total;
    };
    expect(errorAt(0.3)).toBeLessThan(errorAt(1.5));
    expect(errorAt(0)).toBeLessThan(errorAt(0.3));
  });

  it("loses no body when a cell splits", () => {
    /**
     * The defect that motivated this file. Total mass at the root must equal
     * the number of bodies, and — the part that actually catches it — every
     * body must still be found by a traversal that opens every cell.
     */
    const points = scatter(300, 3);
    const tree = buildOctree(points)!;
    expect(tree.mass[0]).toBe(points.length);

    // theta = 0 opens everything, so this sums one term per body.
    const origin = { x: 5, y: 5, z: 5 };
    const viaTree = repulsionOn(tree, origin, STRENGTH, 0);
    const exact = bruteForce(points, origin);
    expect(magnitude(viaTree)).toBeCloseTo(magnitude(exact), 9);
  });
});

describe("the degenerate shapes do not break it", () => {
  it("has nothing to say about an empty set", () => {
    expect(buildOctree([])).toBeNull();
    expect(repulsionOn(null, { x: 0, y: 0, z: 0 }, STRENGTH, 0.5))
      .toEqual({ x: 0, y: 0, z: 0 });
  });

  it("does not push a lone body around", () => {
    const only = [{ x: 0.2, y: -0.4, z: 0.1 }];
    const force = repulsionOn(buildOctree(only), only[0], STRENGTH, 0.5);
    expect(magnitude(force)).toBe(0);
  });

  it("terminates on coincident bodies rather than subdividing for ever", () => {
    /** Every point identical: each subdivision sends them all to one octant,
     *  so only the depth limit stops it. */
    const stack = Array.from({ length: 50 }, () => ({ x: 0.5, y: 0.5, z: 0.5 }));
    const tree = buildOctree(stack)!;
    expect(tree.mass[0]).toBe(50);
    const force = repulsionOn(tree, { x: 0.5, y: 0.5, z: 0.5 }, STRENGTH, 0.5);
    expect(Number.isFinite(magnitude(force))).toBe(true);
  });

  it("counts every body when they are all in one place", () => {
    const stack = Array.from({ length: 40 }, () => ({ x: 0, y: 0, z: 0 }));
    const away = { x: 1, y: 0, z: 0 };
    const viaTree = repulsionOn(buildOctree(stack), away, STRENGTH, 0.5);
    // Forty bodies at distance one: forty times the single-body push.
    expect(viaTree.x).toBeCloseTo(40 * STRENGTH, 9);
  });

  it("still finds coincident bodies when nothing may be lumped", () => {
    /**
     * The case that makes the childless-cell rule load-bearing, and it was
     * missing: every other coincident test runs at theta 0.5, where the angle
     * test lumps the cell anyway and hides whether the rule is doing anything.
     * A mutation replacing it with `mass === 1` passed the whole file.
     *
     * At theta 0 the angle test never fires, so a childless cell holding forty
     * bodies stacked at the depth limit is recursed into, finds eight empty
     * child slots, and contributes nothing at all — forty bodies silently
     * absent from the force.
     */
    const stack = Array.from({ length: 40 }, () => ({ x: 0, y: 0, z: 0 }));
    const away = { x: 1, y: 0, z: 0 };
    const viaTree = repulsionOn(buildOctree(stack), away, STRENGTH, 0);
    expect(viaTree.x).toBeCloseTo(40 * STRENGTH, 9);
  });

  it("survives a graph laid out on a line", () => {
    /** A degenerate axis makes the bounding cube collapse on two of three
     *  dimensions, which is where a naive bounding box divides by zero. */
    const line = Array.from({ length: 60 }, (_, i) => ({ x: i / 60, y: 0, z: 0 }));
    const tree = buildOctree(line)!;
    expect(tree.mass[0]).toBe(60);
    for (const p of line.slice(0, 10)) {
      expect(Number.isFinite(magnitude(repulsionOn(tree, p, STRENGTH, 0.5)))).toBe(true);
    }
  });
});
