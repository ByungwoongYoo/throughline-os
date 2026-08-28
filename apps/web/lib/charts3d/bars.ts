/**
 * Bars standing in a room (§9 bars, §10).
 *
 * Four catalogue entries: a 3D bar, a 3D column, a waterfall and a 3D
 * histogram. Every one of them is marked `framed` rather than `inherently`
 * spatial, and that classification is the point of this file rather than a
 * footnote to it.
 *
 * **§10 forbids converting an ordinary chart to 3D to look futuristic**, on the
 * grounds that depth buys occlusion, perspective distortion and ambiguity. A
 * bar chart drawn in a room is exactly that conversion: the third axis is the
 * room, not the data, and the reader pays for it in three specific ways —
 * nearer bars hide farther ones, perspective makes equal bars unequal on
 * screen, and a bar's height must be judged against a baseline that is itself
 * receding.
 *
 * So this primitive exists, and it is built to *say so*. It measures how much
 * of itself is hidden and how much perspective distorts it, and hands both to
 * the caption. A reader who is told "four bars are behind others and the front
 * row reads 18% taller than the back for the same value" can decide whether to
 * turn the chart or to read the table instead.
 *
 * **The two-dimensional version is always offered.** For these four, the flat
 * chart is not a fallback — it is the better chart in most cases, and the
 * honest thing is to say which one answers the question.
 */

/** One bar: where it stands on the floor, and how tall it is. */
export type Bar = {
  /** Column position, in the caller's own units. */
  row: number;
  /** Depth position — the series, the second category. */
  column: number;
  value: number;
  label?: string;
  group?: string;
};

/** A bar placed in the unit cube, with its footprint. */
export type PlacedBar = {
  /** Centre of the base. */
  x: number; z: number;
  /** Base and top on the vertical axis. */
  base: number; top: number;
  /** Half-width of the footprint, in cube units. */
  half: number;
  value: number;
  label?: string;
  group?: string;
  /** Where it falls in the value range, 0..1, for colour. */
  level: number;
};

export type Bars = {
  bars: PlacedBar[];
  range: { min: number; max: number };
  /** Where zero sits on the vertical axis, for drawing the floor. */
  zero: number;
  /** Values that were not finite and could not be placed. */
  invalid: number;
};

export type BarSettings = {
  /**
   * How much of each cell a bar fills, 0..1.
   *
   * Below 1 leaves a gap so neighbouring bars are distinguishable. At 1 the
   * grid becomes a solid block and individual bars stop being readable at all,
   * which is the failure this chart is already close to.
   */
  fill: number;
};

export const DEFAULT_BARS: BarSettings = { fill: 0.72 };

/**
 * Place bars in the unit cube.
 *
 * **The vertical axis includes zero, always.** A bar chart whose axis starts at
 * the smallest value exaggerates differences — the classic misleading chart —
 * and in three dimensions it is worse, because the reader cannot see where the
 * floor is to notice. If every value is positive the floor is zero; if values
 * cross zero the floor is zero and bars run both ways from it.
 */
export function prepareBars(input: Bar[],
                            settings: BarSettings = DEFAULT_BARS): Bars {
  const usable = input.filter(
    (b) => Number.isFinite(b.value) && Number.isFinite(b.row)
        && Number.isFinite(b.column));
  const invalid = input.length - usable.length;

  if (usable.length === 0) {
    return { bars: [], range: { min: 0, max: 0 }, zero: -1, invalid };
  }

  const values = usable.map((b) => b.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min;

  const rows = [...new Set(usable.map((b) => b.row))].sort((a, b) => a - b);
  const columns = [...new Set(usable.map((b) => b.column))].sort((a, b) => a - b);

  /*
   * A single row or column sits in the middle rather than at the edge. Dividing
   * by a count of one is a division by zero, and the alternative — placing it
   * at -1 — would put a lone bar in the corner of an empty room.
   */
  const place = (index: number, count: number) =>
    count > 1 ? (index / (count - 1)) * 2 - 1 : 0;

  // Half a cell, minus the gap. With one row the cell is the whole cube.
  const halfOf = (count: number) =>
    (count > 1 ? 1 / (count - 1) : 1) * settings.fill;
  const half = Math.min(halfOf(rows.length), halfOf(columns.length));

  const toHeight = (value: number) =>
    span > 1e-12 ? ((value - min) / span) * 2 - 1 : 0;
  const zero = toHeight(0);

  const bars: PlacedBar[] = usable.map((bar) => {
    const top = toHeight(bar.value);
    return {
      x: place(rows.indexOf(bar.row), rows.length),
      z: place(columns.indexOf(bar.column), columns.length),
      // Bars run from zero, not from the bottom of the cube: a negative value
      // hanging down from the floor is the shape of the data.
      base: zero,
      top,
      half,
      value: bar.value,
      label: bar.label,
      group: bar.group,
      level: span > 1e-12 ? (bar.value - min) / span : 0,
    };
  });

  return { bars, range: { min, max }, zero, invalid };
}

/**
 * How much of the chart is hidden behind itself, at a given view.
 *
 * The number §10 asks for. Two bars overlap when their projected footprints
 * intersect and one is nearer; the nearer one hides some fraction of the
 * farther. This counts bars that are *substantially* covered rather than
 * measuring exact areas — a reader needs "four of these are behind others", not
 * a percentage of occluded pixels.
 *
 * `depthOf` and `screenOf` are supplied by the renderer so this stays testable
 * without a canvas, and so there is exactly one projection in the system.
 */
export function hiddenCount(
  bars: PlacedBar[],
  screenOf: (bar: PlacedBar) => { x: number; y: number; depth: number },
  radius: number,
): number {
  const placed = bars.map((bar) => ({ bar, at: screenOf(bar) }));
  let hidden = 0;

  for (const subject of placed) {
    for (const other of placed) {
      if (other === subject) continue;
      // Nearer, and overlapping on screen. `depth` is larger when nearer.
      if (other.at.depth <= subject.at.depth) continue;
      const gap = Math.hypot(other.at.x - subject.at.x,
                             other.at.y - subject.at.y);
      if (gap < radius) { hidden += 1; break; }
    }
  }
  return hidden;
}

/**
 * How much perspective stretches the near row against the far one.
 *
 * Returned as a ratio: 1.18 means a bar at the front reads eighteen per cent
 * taller than an identical bar at the back. This is the distortion §10 warns
 * about, and it is invisible unless measured — the picture looks correct, and
 * the reader compares heights that the projection has already changed.
 */
export function perspectiveStretch(
  bars: PlacedBar[],
  scaleOf: (bar: PlacedBar) => number,
): number {
  if (bars.length === 0) return 1;
  const scales = bars.map(scaleOf).filter((s) => Number.isFinite(s) && s > 0);
  if (scales.length === 0) return 1;
  return Math.max(...scales) / Math.min(...scales);
}

/**
 * What the chart says about itself, including that it is probably the wrong
 * chart.
 *
 * The last clause is not self-deprecation. §10's position is that a bar chart
 * gains nothing from a third dimension, and a reader deciding whether to trust
 * a comparison they are making by eye is better served by being told the flat
 * version exists than by being flattered.
 */
export function describeBars(bars: Bars, hidden: number,
                             stretch: number): string {
  if (bars.bars.length === 0) return "No bars to draw.";

  const n = bars.bars.length;
  let text = `${n} bar${n === 1 ? "" : "s"}, `
           + `${format(bars.range.min)} to ${format(bars.range.max)}.`;

  if (hidden > 0) {
    text += ` ${hidden} ${hidden === 1 ? "is" : "are"} behind another and`
          + " cannot be read from here — turn the chart, or read the table.";
  }
  if (stretch > 1.05) {
    text += ` Perspective makes the near row read `
          + `${Math.round((stretch - 1) * 100)}% larger than the far one for`
          + " the same value.";
  }
  if (bars.invalid > 0) {
    text += ` ${bars.invalid} value${bars.invalid === 1 ? "" : "s"} could not`
          + " be read.";
  }

  text += " The third axis here is the room, not the data: this is a bar chart"
        + " placed in space, and the flat version of it is easier to read.";
  return text;
}

function format(value: number): string {
  if (!Number.isFinite(value)) return "?";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 10000 || magnitude < 0.01) return value.toExponential(1);
  return Number(value.toFixed(2)).toString();
}
