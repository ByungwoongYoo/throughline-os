/**
 * Colouring a scatter by how many points are near, so a blob becomes a shape.
 *
 * A scatter of twenty thousand observations drawn in one colour is a blob.
 * Every point is there, nothing is hidden, and the reader still cannot see
 * where the mass is — which is the specific way an honest chart fails to
 * inform. Flow cytometry solved this decades ago by colouring each point by
 * local density, and it is the single largest legibility gain available to
 * this scatter.
 *
 * Three decisions, and the first two are about not manufacturing a claim.
 *
 * **The colour is a count of neighbours, and the caption says so.** Density is
 * computed from the points actually drawn, by binning them on a fixed grid —
 * arithmetic on what is on screen, not a smoothed estimate with a bandwidth
 * nobody chose. A kernel estimate would need a bandwidth, and bandwidth
 * changes the shape, which makes it an analytical choice that belongs in
 * executed code with a stated rule rather than in a browser-side renderer.
 *
 * **The scale is local to the plot, and that must be stated.** The busiest bin
 * defines the top of the ramp, so the same colour in two plots means two
 * different counts. Left unsaid, a reader compares two panels and reads a
 * difference that is an artefact of scaling. Saying "scaled within this plot"
 * costs one line and removes the failure.
 *
 * **Counts are ranked, not scaled linearly.** Point density is heavy-tailed:
 * one dense core and a long thin skirt. On a linear ramp the core saturates
 * and everything else is the same dark blue, which is the blob again in
 * colour. The rank of a bin among the *distinct counts present* spreads the
 * ramp over the
 * structure that exists — the same reasoning the binned chart already applies
 * when it defaults its count scale to logarithmic.
 */

export type Point = { x: number; y: number };

/** The most bins across the plot, per axis. */
export const BINS = 64;

/** The fewest, below which "nearby" stops being local at all. */
export const MIN_BINS = 8;

/**
 * How many points a cell should hold on average, for density to mean anything.
 *
 * A fixed 64x64 grid was the first version and it was wrong for small data:
 * 320 points across 4,096 cells leaves almost every point alone in its own
 * cell, so every count is 1, every rank is the same, and the figure is
 * coloured by nothing while looking as though it has been coloured by
 * something. The grid has to be coarse enough that sharing a cell is a fact
 * about the data rather than an accident of resolution.
 *
 * Four is the smallest average occupancy at which the counts have any spread
 * to rank; below it the ramp collapses towards two colours.
 */
export const TARGET_PER_CELL = 4;

/**
 * The grid for this many points: fine enough to show structure, coarse enough
 * that a cell holds several points.
 */
export function binsFor(count: number): number {
  if (count <= 0) return MIN_BINS;
  const ideal = Math.sqrt(count / TARGET_PER_CELL);
  return Math.max(MIN_BINS, Math.min(BINS, Math.round(ideal)));
}

export type Density = {
  /** A value in 0..1 per input point, in the order they were given. */
  levels: number[];
  /** Points in the busiest bin — the top of the scale. */
  peak: number;
  /** How many bins hold at least one point. */
  occupied: number;
  /** The grid actually used, which the caption has to name. */
  bins: number;
};

/**
 * Density for each point, as its bin's rank among the distinct counts present.
 *
 * *Distinct* is load-bearing, and it was stated wrongly here first. Ranking
 * among cells rather than among values makes a cell's colour depend on how
 * many *other* cells happen to share each count, so adding sparse cells
 * anywhere shifts the colour of a busy cell that did not change. Ranking among
 * distinct counts means a colour answers one question — how busy is this cell
 * against the range of busyness present — and nothing else.
 *
 * Deterministic: the same points in the same order give the same levels, so
 * an exported figure and the one on screen cannot disagree.
 */
export function densityOf(points: readonly Point[],
                          bins = 0): Density {
  bins = bins || binsFor(points.length);
  if (points.length === 0) return { levels: [], peak: 0, occupied: 0, bins };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { levels: points.map(() => 0), peak: 0, occupied: 0, bins };
  }

  // A dimension with no extent would divide by zero. One bin is the honest
  // answer: every point really does sit at the same place on that axis.
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const index = (p: Point) => {
    const cx = Math.min(bins - 1, Math.floor(((p.x - minX) / spanX) * bins));
    const cy = Math.min(bins - 1, Math.floor(((p.y - minY) / spanY) * bins));
    return cy * bins + cx;
  };

  const counts = new Map<number, number>();
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const cell = index(p);
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }

  /*
   * A cell counted together with the eight around it.
   *
   * Counting one cell alone makes the grid itself visible: rendered on two
   * thousand points the dense core came out as a mosaic of coloured
   * rectangles, and those rectangles are an artefact of where the boundaries
   * happen to fall rather than anything in the data. Including the neighbours
   * removes most of it while the quantity stays a plain count — no kernel, no
   * bandwidth, nothing chosen that changes the shape. It is still one sentence
   * to explain, which is the constraint that ruled a smoothed estimate out.
   *
   * A cell at the edge has fewer neighbours and so a lower count. That is
   * honest: there really are fewer points near the edge of the data, and
   * dividing by the neighbours present would invent density where it stops.
   */
  const neighbourhood = new Map<number, number>();
  for (const cell of counts.keys()) {
    const cx = cell % bins;
    const cy = Math.floor(cell / bins);
    let sum = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= bins || ny >= bins) continue;
        sum += counts.get(ny * bins + nx) ?? 0;
      }
    }
    neighbourhood.set(cell, sum);
  }

  // Rank, not magnitude. Ties share a rank, so two equally busy
  // neighbourhoods are the same colour — a reader comparing them is comparing
  // counts, not positions in a list.
  const distinct = [...new Set(neighbourhood.values())].sort((a, b) => a - b);
  const rankOf = new Map(distinct.map((count, i) => [
    count, distinct.length === 1 ? 1 : i / (distinct.length - 1),
  ]));

  const levels = points.map((p) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
    return rankOf.get(neighbourhood.get(index(p)) ?? 0) ?? 0;
  });

  return {
    levels,
    peak: distinct.length ? distinct[distinct.length - 1] : 0,
    occupied: counts.size,
    bins,
  };
}

/**
 * The sentence that has to travel with the colour.
 *
 * `drawn` and `total` differ when the figure sampled for display: a reader
 * looking at twenty thousand marks from a hundred thousand rows is looking at
 * a real distribution, and is owed the fact that it is a sample of one.
 */
export function densityNote(density: Density, drawn: number,
                            total = drawn): string {
  if (!drawn) return "";
  const sampled = total > drawn
    ? `${drawn.toLocaleString()} drawn of ${total.toLocaleString()}`
    : `${drawn.toLocaleString()} points`;
  return (
    `${sampled} · colour is how many points lie in each cell of a `
    + `${density.bins}×${density.bins} grid and the eight around it, up to `
    + `${density.peak.toLocaleString()} in the busiest · scaled `
    + "within this plot, so colours cannot be compared between plots"
  );
}
