/**
 * Level curves of a height field.
 *
 * A contour plot and a filled surface are the same numbers and different
 * questions. A surface shows the shape; a contour shows where the field
 * crosses a value, which is what you read when the question is "how steep" or
 * "where is the boundary" rather than "what does it look like".
 *
 * Marching squares, per cell, with the segment endpoints interpolated along the
 * edges. Linear interpolation is the honest choice here: it puts the crossing
 * where the two corner heights say it is, and any smoothing would move a line a
 * reader is about to measure against an axis.
 */

export type Grid = { x: number[]; y: number[]; z: Array<Array<number | null>> };
export type Segment = {
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  level: number;
};

/** Where `level` sits between two corner heights, as a fraction. */
function crossing(low: number, high: number, level: number): number {
  const span = high - low;
  // Equal corners: the level is either everywhere on this edge or nowhere on
  // it, and half-way is the only answer that does not lie about a gradient.
  return span === 0 ? 0.5 : (level - low) / span;
}

/**
 * The levels to draw, given the field's range.
 *
 * Round numbers rather than equal fractions of the range: a contour a reader
 * cannot name is a contour they cannot use, and "12.5 to 17.5 by 1" is
 * readable in a way that "12.43 to 17.61 in eight steps" is not.
 */
export function levelsFor(lo: number, hi: number, target = 8): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];
  const raw = (hi - lo) / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10]
    .map((m) => m * magnitude)
    .find((s) => (hi - lo) / s <= target * 1.5) ?? magnitude * 10;
  const first = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = first; v <= hi + step * 1e-9; v += step) {
    // Guard against the accumulating error that puts 0.30000000000000004 on an
    // axis a reader is checking against a round number.
    out.push(Number(v.toFixed(10)));
  }
  return out;
}

/**
 * Every segment where the field crosses each level.
 *
 * Cells with a missing corner are skipped rather than interpolated across: a
 * fitted surface declines to predict in places, and drawing a contour through
 * the gap would invent the one thing the fit refused to say.
 */
export function contourSegments(grid: Grid, levels: number[]): Segment[] {
  const out: Segment[] = [];
  for (const level of levels) {
    for (let j = 0; j + 1 < grid.y.length; j += 1) {
      for (let i = 0; i + 1 < grid.x.length; i += 1) {
        const corners = [
          { x: grid.x[i], y: grid.y[j], z: grid.z[j]?.[i] },
          { x: grid.x[i + 1], y: grid.y[j], z: grid.z[j]?.[i + 1] },
          { x: grid.x[i + 1], y: grid.y[j + 1], z: grid.z[j + 1]?.[i + 1] },
          { x: grid.x[i], y: grid.y[j + 1], z: grid.z[j + 1]?.[i] },
        ];
        if (corners.some((c) => c.z === null || c.z === undefined
                             || !Number.isFinite(c.z as number))) {
          continue;
        }

        const hits: Array<{ x: number; y: number; z: number }> = [];
        for (let k = 0; k < 4; k += 1) {
          const from = corners[k], to = corners[(k + 1) % 4];
          const a = from.z as number, b = to.z as number;
          // One endpoint on each side of the level: the edge is crossed once.
          if ((a < level && b >= level) || (b < level && a >= level)) {
            const t = crossing(a, b, level);
            hits.push({
              x: from.x + (to.x - from.x) * t,
              y: from.y + (to.y - from.y) * t,
              z: level,
            });
          }
        }
        // Two crossings is one segment. Four is a saddle cell, drawn as two
        // segments in the order found — which is ambiguous by nature, and the
        // ambiguity belongs to the data rather than to this choice.
        for (let k = 0; k + 1 < hits.length; k += 2) {
          out.push({ a: hits[k], b: hits[k + 1], level });
        }
      }
    }
  }
  return out;
}
