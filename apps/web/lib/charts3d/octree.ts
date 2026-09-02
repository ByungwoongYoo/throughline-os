/**
 * Barnes–Hut: a distant cluster pushes like one heavy node.
 *
 * `layoutGraph` compared every pair of nodes, which its own comment called
 * "quadratic and fine at this scale", adding that a graph big enough to hurt
 * "needs a spatial index, and building one before anything renders would be
 * optimising a picture nobody has seen". That was the right call when it was
 * written. The picture has since been seen, thirty-five catalogued
 * visualizations resolve to this one primitive, and a citation network is not
 * a small graph.
 *
 * Measured, the cost is exactly quadratic: 2.2ms at 27 nodes, 121ms at 500,
 * 1.93 **seconds** at 2000 — on the main thread, so the interface is frozen
 * for the duration. The sibling docstring claimed the iteration count was "few
 * enough to run inside a frame budget" for "a few hundred nodes"; at three
 * hundred it was already two and a half times over.
 *
 * **Why not a distance cutoff.** Ignoring pairs beyond some radius is far
 * simpler and wrong for this force. Repulsion is what separates two clusters
 * that are already apart, and a cutoff deletes exactly that long-range term —
 * the graph stops spreading and settles into whatever clumps it started in.
 * Barnes–Hut keeps the long-range force and approximates only its *source*,
 * replacing a distant group with its centre of mass, which is a statement
 * about resolution rather than about range.
 *
 * **The approximation is bounded and tunable.** A cell is used as a single
 * mass when its width divided by its distance is below `theta`. At `theta = 0`
 * nothing is ever lumped and the result is the exact all-pairs force, which is
 * what the tests use to check the traversal against brute force. The error is
 * a resolution limit on a force that is already a layout heuristic and not a
 * measurement — no number a reader sees comes from it.
 *
 * **Determinism is preserved**, which matters more here than speed. The
 * existing layout is deliberately deterministic — "a graph that arranges
 * itself differently on every open is one a researcher cannot compare with
 * what they have" — so the tree is built by a fixed subdivision of a fixed
 * bounding cube and walked in a fixed child order. The same graph still lands
 * the same way.
 */

export type Point = { x: number; y: number; z: number };

/**
 * A cell: either a leaf holding one body, or an interior node with children.
 *
 * Flat arrays rather than objects per cell. A layout builds a tree on every
 * one of its passes, and at a few thousand nodes that is millions of
 * short-lived allocations — the garbage collector then costs more than the
 * quadratic loop this replaces.
 */
export type Octree = {
  /** Summed positions per cell, and how many bodies it holds. */
  comX: Float64Array; comY: Float64Array; comZ: Float64Array;
  mass: Int32Array;
  /** Cell width, so the theta test needs no arithmetic on ids. */
  size: Float64Array;
  /** Cell centre, needed while inserting to pick an octant. */
  cx: Float64Array; cy: Float64Array; cz: Float64Array;
  /** Eight child indices per cell, -1 where empty. */
  child: Int32Array;
  /** A leaf's single body, and whether it still holds one. */
  bodyX: Float64Array; bodyY: Float64Array; bodyZ: Float64Array;
  hasBody: Uint8Array;
  /** Whether any child slot is filled — the cheap "can I recurse" test. */
  branches: Uint8Array;
  count: number;
};

/** Max subdivision, so coincident points cannot recurse for ever. */
const MAX_DEPTH = 20;

function make(capacity: number): Octree {
  return {
    comX: new Float64Array(capacity), comY: new Float64Array(capacity),
    comZ: new Float64Array(capacity), mass: new Int32Array(capacity),
    size: new Float64Array(capacity),
    cx: new Float64Array(capacity), cy: new Float64Array(capacity),
    cz: new Float64Array(capacity),
    child: new Int32Array(capacity * 8).fill(-1),
    bodyX: new Float64Array(capacity), bodyY: new Float64Array(capacity),
    bodyZ: new Float64Array(capacity), hasBody: new Uint8Array(capacity),
    branches: new Uint8Array(capacity),
    count: 0,
  };
}

/**
 * Double the arrays rather than refuse.
 *
 * The cell count is not a simple function of the node count — near-coincident
 * points subdivide until they separate — so any fixed capacity is a guess, and
 * a tree that threw on a legal graph would turn a crowded layout into a crash.
 */
function grown(tree: Octree): Octree {
  const bigger = make(tree.comX.length * 2);
  bigger.comX.set(tree.comX); bigger.comY.set(tree.comY);
  bigger.comZ.set(tree.comZ); bigger.mass.set(tree.mass);
  bigger.size.set(tree.size);
  bigger.cx.set(tree.cx); bigger.cy.set(tree.cy); bigger.cz.set(tree.cz);
  bigger.child.set(tree.child);
  bigger.bodyX.set(tree.bodyX); bigger.bodyY.set(tree.bodyY);
  bigger.bodyZ.set(tree.bodyZ); bigger.hasBody.set(tree.hasBody);
  bigger.branches.set(tree.branches);
  bigger.count = tree.count;
  return bigger;
}

/**
 * Clear a tree's used cells so it can be filled again.
 *
 * Only the cells actually written last time, not the whole capacity: a layout
 * rebuilds the tree on every one of its passes, and wiping a capacity sized
 * for the worst case would cost more than the tree it is clearing.
 */
function reset(tree: Octree): void {
  const used = tree.count;
  tree.comX.fill(0, 0, used); tree.comY.fill(0, 0, used);
  tree.comZ.fill(0, 0, used); tree.mass.fill(0, 0, used);
  tree.hasBody.fill(0, 0, used); tree.branches.fill(0, 0, used);
  tree.child.fill(-1, 0, used * 8);
  tree.count = 0;
}

/**
 * Build a tree over `points`.
 *
 * The root is a cube rather than the true bounding box: a box makes cell width
 * ambiguous in the theta test — width along which axis? — and a cube keeps
 * "size" a single honest number.
 *
 * **A cell holding one body must push it down when it splits**, which is the
 * step a first version of this left out. Without it the body stays recorded in
 * the parent's totals but appears in no child, so any traversal that opens the
 * parent walks past it — a node that repels nothing and is repelled normally,
 * drifting into its neighbours. It produces a plausible layout, which is why
 * it is worth naming: nothing about the picture says a body went missing.
 */
export function buildOctree(points: Point[], into?: Octree | null): Octree | null {
  if (points.length === 0) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  // A degenerate extent — one node, or every node coincident — still needs a
  // positive cube, or every subdivision lands in the same octant for ever.
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);

  /*
   * Reused across passes when the caller offers a tree.
   *
   * This is the difference between Barnes-Hut being worth having and not. A
   * first version allocated thirteen typed arrays on every pass — at a
   * thousand nodes and a hundred and twenty passes that is tens of megabytes
   * of short-lived garbage, and it made the "faster" algorithm *slower* than
   * the all-pairs loop it replaced at every size up to eight hundred. The
   * asymptotics were right and the constant swamped them.
   */
  let tree = into && into.comX.length >= Math.max(64, points.length * 4)
    ? (reset(into), into)
    : make(Math.max(64, points.length * 4));
  tree.count = 1;
  tree.size[0] = span;
  tree.cx[0] = (minX + maxX) / 2;
  tree.cy[0] = (minY + maxY) / 2;
  tree.cz[0] = (minZ + maxZ) / 2;

  /** The child of `cell` that contains `(x,y,z)`, created if absent. */
  const descend = (cell: number, x: number, y: number, z: number): number => {
    const octant = (x >= tree.cx[cell] ? 1 : 0)
                 | (y >= tree.cy[cell] ? 2 : 0)
                 | (z >= tree.cz[cell] ? 4 : 0);
    let next = tree.child[cell * 8 + octant];
    if (next === -1) {
      if (tree.count >= tree.comX.length) tree = grown(tree);
      next = tree.count++;
      const half = tree.size[cell] / 2;
      tree.size[next] = half;
      tree.cx[next] = tree.cx[cell] + (octant & 1 ? half / 2 : -half / 2);
      tree.cy[next] = tree.cy[cell] + (octant & 2 ? half / 2 : -half / 2);
      tree.cz[next] = tree.cz[cell] + (octant & 4 ? half / 2 : -half / 2);
      tree.child[cell * 8 + octant] = next;
      tree.branches[cell] = 1;
    }
    return next;
  };

  for (const p of points) {
    let cell = 0;
    for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
      tree.comX[cell] += p.x; tree.comY[cell] += p.y; tree.comZ[cell] += p.z;
      tree.mass[cell] += 1;

      if (tree.mass[cell] === 1) {           // was empty: becomes a leaf
        tree.bodyX[cell] = p.x; tree.bodyY[cell] = p.y; tree.bodyZ[cell] = p.z;
        tree.hasBody[cell] = 1;
        break;
      }

      if (tree.hasBody[cell]) {              // splitting: the sitting body moves down
        const qx = tree.bodyX[cell], qy = tree.bodyY[cell], qz = tree.bodyZ[cell];
        tree.hasBody[cell] = 0;
        if (depth < MAX_DEPTH) {
          const into = descend(cell, qx, qy, qz);
          tree.comX[into] += qx; tree.comY[into] += qy; tree.comZ[into] += qz;
          tree.mass[into] += 1;
          tree.bodyX[into] = qx; tree.bodyY[into] = qy; tree.bodyZ[into] = qz;
          tree.hasBody[into] = 1;
        }
      }

      /*
       * At the depth limit the remaining bodies stay aggregated here. They are
       * coincident to within the cube divided by 2^20, so treating them as one
       * mass at their shared centre is exact rather than approximate — and
       * `repulsionOn` lumps any childless cell, so none of them is skipped.
       */
      if (depth === MAX_DEPTH) break;
      cell = descend(cell, p.x, p.y, p.z);
    }
  }
  return tree;
}

/**
 * Sum the repulsion on `p` from every body in the tree.
 *
 * `strength / d²`, matching the all-pairs loop this replaces exactly, so the
 * only difference between them is which bodies are lumped together.
 *
 * The body at `p` itself contributes nothing: its own cell resolves to a
 * distance of zero, and the floor below would turn that into a finite but
 * enormous self-push. Subtracting it afterwards would be arithmetic on a
 * near-infinity, so it is skipped where it is found — by position, since a
 * leaf carries no identity.
 */
/** Traversal scratch, shared because the walk is synchronous and very hot. */
let stack = new Int32Array(1024);

export function repulsionOn(tree: Octree | null, p: Point, strength: number,
                            theta: number,
                            out?: { x: number; y: number; z: number },
                           ): { x: number; y: number; z: number } {
  const force = out ?? { x: 0, y: 0, z: 0 };
  force.x = 0; force.y = 0; force.z = 0;
  if (!tree) return force;

  /*
   * A shared stack, grown as needed and never freed. The traversal runs once
   * per node per pass — hundreds of thousands of times for a large graph — and
   * a fresh array each time is the same allocation problem as the tree.
   */
  if (stack.length < tree.count + 8) stack = new Int32Array((tree.count + 8) * 2);
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const cell = stack[--top];
    const mass = tree.mass[cell];
    if (mass === 0) continue;

    const dx = p.x - tree.comX[cell] / mass;
    const dy = p.y - tree.comY[cell] / mass;
    const dz = p.z - tree.comZ[cell] / mass;
    const d2 = dx * dx + dy * dy + dz * dz;

    /*
     * Childless cells are lumped whatever theta says. Usually that means a
     * single body; at the depth limit it means several coincident ones, and
     * recursing into children that do not exist would silently drop them.
     */
    const lumpable = !tree.branches[cell]
      || tree.size[cell] * tree.size[cell] < theta * theta * d2;

    if (lumpable) {
      /*
       * The body at `p` itself, or one sitting exactly on it.
       *
       * Defensive rather than load-bearing, and checked: a mutation replacing
       * this with `if (false)` passes every test in the suite. It has to,
       * because at a separation this small the direction components are
       * themselves ~0, so the term contributes ~0 whether it is skipped or
       * not. The neighbouring all-pairs floor carries the same note for the
       * same reason.
       *
       * It stays for the case the arithmetic does not excuse: a separation
       * that is tiny but *not* zero. `d2` is floored at 1e-4 while the
       * direction is not, so at a separation of 1e-7 the pair yields a force
       * of the order of the repulsion constant itself, out of nowhere, and
       * normalisation then divides the whole graph by that span.
       */
      if (d2 < 1e-12) continue;
      const floored = Math.max(d2, 1e-4);
      const d = Math.sqrt(floored);
      const push = (strength * mass) / floored;
      force.x += (dx / d) * push;
      force.y += (dy / d) * push;
      force.z += (dz / d) * push;
      continue;
    }
    for (let octant = 0; octant < 8; octant += 1) {
      const next = tree.child[cell * 8 + octant];
      if (next !== -1) stack[top++] = next;
    }
  }
  return force;
}
