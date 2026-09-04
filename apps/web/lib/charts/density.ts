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

/** How many bins across the plot, per axis. */
export const BINS = 64;

export type Density = {
  /** A value in 0..1 per input point, in the order they were given. */
  levels: number[];
  /** Points in the busiest bin — the top of the scale. */
  peak: number;
  /** How many bins hold at least one point. */
  occupied: number;
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
export function densityOf(points: readonly Point[], bins = BINS): Density {
  if (points.length === 0) return { levels: [], peak: 0, occupied: 0 };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { levels: points.map(() => 0), peak: 0, occupied: 0 };
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

  // Rank, not magnitude. Ties share a rank, so two equally busy bins are the
  // same colour — a reader comparing them is comparing counts, not positions
  // in a list.
  const distinct = [...new Set(counts.values())].sort((a, b) => a - b);
  const rankOf = new Map(distinct.map((count, i) => [
    count, distinct.length === 1 ? 1 : i / (distinct.length - 1),
  ]));

  const levels = points.map((p) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
    return rankOf.get(counts.get(index(p)) ?? 0) ?? 0;
  });

  return {
    levels,
    peak: distinct.length ? distinct[distinct.length - 1] : 0,
    occupied: counts.size,
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
    `${sampled} · colour is how many points share a cell of a ${BINS}×${BINS} `
    + `grid, up to ${density.peak.toLocaleString()} in the busiest · scaled `
    + "within this plot, so colours cannot be compared between plots"
  );
}
