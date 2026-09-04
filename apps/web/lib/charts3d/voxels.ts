/**
 * A scalar sampled through a box (§9 volume).
 *
 * Thirty-one named visualizations need voxels: twenty draw the volume itself —
 * density, temperature, pressure, seismic, electron density, quantum
 * probability, dark matter, CT and MRI — and eleven draw a shell through it as
 * an isosurface. One grid type serves both, so this file is the grid and what
 * can be asked of it, and the two renderers differ only in what they do with
 * the answers.
 *
 * **A volume cannot be drawn without deciding what to hide.** A 256³ grid is
 * sixteen million samples and every one of them is in front of another; drawn
 * opaque it is a solid block, drawn uniformly transparent it is fog. The
 * decision — which values are visible and how strongly — is the *transfer
 * function*, and it is the whole of what makes a volume readable. It lives
 * here, testable without a canvas, rather than being buried in a draw loop.
 *
 * **Missing is not zero.** In a CT, 0 HU is water: a real, common, meaningful
 * value. Substituting zero for an unmeasured voxel does not leave a gap, it
 * silently fills the gap with water — and the picture gives no sign. Missing
 * voxels are carried as NaN, excluded from the range, and never drawn.
 */

/**
 * A regular grid of scalar samples.
 *
 * Values are indexed x-fastest — `values[i + nx * (j + ny * k)]` — which is the
 * order NumPy, NIfTI and every raw volume file on disk already use, so a caller
 * reading one does not have to transpose it and cannot transpose it wrongly.
 */
export type Grid = {
  nx: number; ny: number; nz: number;
  values: ArrayLike<number>;
  /** What the numbers mean: "HU", "mg/cm³". Shown, never interpreted. */
  units?: string;
};

/** Read one sample. Out of bounds is NaN — an absent value, not a zero one. */
export function valueAt(grid: Grid, i: number, j: number, k: number): number {
  if (i < 0 || j < 0 || k < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz) {
    return NaN;
  }
  return grid.values[i + grid.nx * (j + grid.ny * k)];
}

/**
 * The window a reader is looking through.
 *
 * Named as radiology names it, because that is the vocabulary of the largest
 * group of people who read volumes: `level` is the value at the centre of the
 * window and `window` is its width. Everything below the window is invisible,
 * everything above is fully opaque, and the range between is where the picture
 * is. Lung, bone and soft tissue are three windows over one scan, and no single
 * one of them shows all three.
 */
export type Window = { level: number; window: number };

export type VolumeSettings = {
  /** Which values are visible. Absent means the middle 90% of the data. */
  window?: Window;
  /**
   * How opaque a fully-in-window voxel is, before spacing correction.
   *
   * Low, because a volume is a stack of hundreds of these and they accumulate.
   */
  opacity: number;
  /**
   * The most splats to draw. Above this the grid is strided down.
   *
   * A frame budget, and the number is measured rather than chosen. Every
   * splat is projected, depth-sorted and drawn on every frame the camera
   * moves, so the cost is linear in this and paid while the reader is
   * dragging — the one moment lag is least tolerable, because rotation is how
   * a volume becomes legible at all.
   */
  maxSplats: number;
};

/**
 * The least opacity a canvas can actually show: one part in 255.
 *
 * Below this the arithmetic still produces a number and the pixel still
 * receives nothing.
 */
export const MIN_VISIBLE_ALPHA = 1 / 255;

export const DEFAULT_VOLUME: VolumeSettings = {
  /*
   * Raised from 0.06, on a measurement rather than a preference.
   *
   * The old value assumed "a stack of hundreds of these" accumulating. Real
   * volumes do not stack that deep: sampled in a browser, the busiest pixel of
   * a 4,776-splat volume had accumulated an alpha of 0.23, and the brightest
   * thing on the canvas reached 1.51:1 against the page. Nothing was even at
   * 2:1 — the whole figure was invisible rather than subtle.
   *
   * A core needs roughly 0.4 accumulated to clear 3:1. 0.12 was the first
   * step and got the brightest pixel to 2.53 — measured again rather than
   * assumed, which is how this landed at 0.16 instead. Still low enough that
   * a single voxel is nearly transparent, which is the property the value
   * exists for.
   */
  opacity: 0.16,
  /*
   * Measured in a browser, not guessed: projecting and sorting takes 13.4ms at
   * 60,000 splats and 4.1ms at 25,000, and drawing them costs a further 13ms
   * and 5.6ms. Sixty thousand is a 26ms frame — under 40 per second, visibly
   * behind the hand. Twenty-five thousand is about 10ms, which leaves room for
   * everything else on the page.
   */
  maxSplats: 25000,
};

/** One voxel ready to draw: the unit cube -1..1, opacity already resolved. */
export type Splat = {
  x: number; y: number; z: number;
  /** The measured value, before windowing. */
  value: number;
  /** Where it falls in the window, 0..1. Drives colour. */
  level: number;
  /** How opaque to draw it, spacing-corrected. 0..1. */
  alpha: number;
};

export type Volume = {
  splats: Splat[];
  /** The window actually used, whether given or chosen. */
  window: Window;
  /** The measured range of the data, which the window may not cover. */
  range: { min: number; max: number };
  /** How many voxels the grid holds in total. */
  total: number;
  /** How many were skipped by striding. */
  strided: number;
  /** How many fell below the window and are not drawn at all. */
  hidden: number;
  /**
   * How many sit inside the window but too faint for a pixel to show.
   *
   * Counted apart from `hidden` because the remedy is the opposite one:
   * something below the window needs the window widened or lowered to reach
   * it, and something merely too faint needs it *narrowed*, which raises where
   * every remaining value sits on the ramp. One count could only carry advice
   * that is wrong half the time.
   */
  faint: number;
  /** How many held no measurement. */
  missing: number;
  /** The stride used, for the caption and for opacity correction. */
  stride: number;
  units?: string;
};

/**
 * Turn a grid into splats that can be composited.
 *
 * Positions are normalised into the unit cube per axis, matching every other
 * spatial chart here, so the camera means the same thing in a volume as in a
 * scatter.
 */
export function prepareVolume(grid: Grid,
                              settings: VolumeSettings = DEFAULT_VOLUME): Volume {
  const total = grid.nx * grid.ny * grid.nz;
  const empty: Volume = {
    splats: [], window: { level: 0, window: 1 }, range: { min: 0, max: 0 },
    total, strided: 0, hidden: 0, faint: 0, missing: 0, stride: 1,
    units: grid.units,
  };
  if (total <= 0 || grid.values.length < total) {
    // A grid whose values do not fill its shape is refused rather than read
    // past the end, where every index returns undefined and every voxel
    // silently becomes NaN.
    return { ...empty, total: Math.max(0, total) };
  }

  /*
   * Swept in one pass, and never with `Math.min(...values)`.
   *
   * Spreading an array into a call passes one argument per element, and past
   * roughly a hundred thousand that overflows the stack — which for a volume
   * is not an edge case but the ordinary size. A 256³ scan is sixteen million.
   * The failure is a RangeError from inside a min, nowhere near anything that
   * looks like a size limit.
   */
  let min = Infinity, max = -Infinity;
  let measuredCount = 0;
  let missing = 0;
  for (let n = 0; n < total; n += 1) {
    const v = grid.values[n];
    if (!Number.isFinite(v)) { missing += 1; continue; }
    measuredCount += 1;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (measuredCount === 0) return { ...empty, missing };

  const window = settings.window ?? defaultWindow(sampleValues(grid, total));

  /*
   * The stride is per axis, not over a flat list.
   *
   * Striding a flattened volume takes every nth sample in x-fastest order,
   * which thins one axis a hundred times harder than the others and turns a
   * cube into a set of combs. A per-axis stride keeps the sample spacing equal
   * in all three directions, which is also what makes the opacity correction
   * below a single number rather than three.
   */
  const stride = strideFor(grid, settings.maxSplats);

  /*
   * Opacity corrected for the sample spacing.
   *
   * A ray crossing the volume passes through `stride` times fewer samples, so
   * without correction a strided volume is that much more transparent — the
   * same data looking thinner because it was drawn faster, which is a change
   * to the picture that nobody asked for. Each drawn splat stands in for
   * `stride` of them, and the chance of a ray being stopped by `s` layers of
   * opacity `a` is `1 - (1-a)^s`.
   */
  const alphaFull = 1 - Math.pow(1 - settings.opacity, stride);

  const span = { x: grid.nx - 1, y: grid.ny - 1, z: grid.nz - 1 };
  const place = (index: number, extent: number) =>
    // A single-sample axis sits at the centre rather than dividing by zero: a
    // volume one slice thick is an ordinary case.
    extent > 0 ? (index / extent) * 2 - 1 : 0;

  const lo = window.level - window.window / 2;
  const width = window.window > 0 ? window.window : 1;

  const splats: Splat[] = [];
  let hidden = 0;
  let faint = 0;
  let strided = 0;

  for (let k = 0; k < grid.nz; k += 1) {
    for (let j = 0; j < grid.ny; j += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        if (i % stride !== 0 || j % stride !== 0 || k % stride !== 0) {
          strided += 1;
          continue;
        }
        const value = valueAt(grid, i, j, k);
        if (!Number.isFinite(value)) continue;

        const level = (value - lo) / width;
        // Below the window is invisible — that is what a window is for, and
        // counting it lets the caption say how much of the volume is hidden.
        if (level <= 0) { hidden += 1; continue; }

        const clamped = Math.min(1, level);
        const alpha = alphaFull * clamped;
        /*
         * An alpha below one part in 255 cannot change a single pixel — the
         * canvas has eight bits to say it with. Keeping such a voxel is worse
         * than useless: it is drawn, it costs a frame, it is invisible, and it
         * is *counted*, so the caption reports thousands of voxels drawn over
         * a blank canvas. That combination is the one thing a volume must not
         * do, because a reader believes the number over the emptiness.
         *
         * This bites hardest exactly where volumes usually live: a box that is
         * mostly empty space. The percentile window then sits with its lower
         * edge inside the emptiness, and almost every voxel lands a hair above
         * it. Counted as hidden, the caption says so and tells the reader to
         * widen the window, which is the true situation.
         */
        if (alpha < MIN_VISIBLE_ALPHA) { faint += 1; continue; }

        splats.push({
          x: place(i, span.x), y: place(j, span.y), z: place(k, span.z),
          value,
          level: clamped,
          // Opacity ramps across the window rather than switching on at its
          // edge: a hard edge draws a contour that is an artefact of the
          // window setting and reads as a boundary in the data.
          alpha,
        });
      }
    }
  }

  return { splats, window, range: { min, max }, total, strided, hidden,
           faint, missing, stride, units: grid.units };
}

/**
 * The smallest per-axis stride whose surviving voxels fit the limit.
 *
 * The estimate `cbrt(total / limit)` is not enough on its own, because the
 * count that survives is `ceil(nx/s) * ceil(ny/s) * ceil(nz/s)` — three
 * roundings up, each of which adds a whole plane. A 50³ grid limited to 2000
 * comes out at 2197 that way: about ten percent over a number that reads as a
 * ceiling. Raising the stride until it actually fits makes the limit a limit.
 */
function strideFor(grid: Grid, limit: number): number {
  const kept = (s: number) => Math.ceil(grid.nx / s) * Math.ceil(grid.ny / s)
                            * Math.ceil(grid.nz / s);
  let stride = Math.max(1, Math.floor(
    Math.cbrt((grid.nx * grid.ny * grid.nz) / Math.max(1, limit))));
  // Bounded by the longest axis: beyond that a larger stride keeps exactly one
  // plane and the loop would never end for a limit smaller than one voxel.
  const most = Math.max(grid.nx, grid.ny, grid.nz);
  while (stride < most && kept(stride) > limit) stride += 1;
  return stride;
}

/**
 * A bounded sample of a grid's measured values, for estimating percentiles.
 *
 * Sorting sixteen million values to find two of them costs more than drawing
 * the volume does. A percentile of a uniform sample is an unbiased estimate of
 * the percentile of the whole, and the window it picks is a starting point the
 * reader adjusts anyway — so the estimate is a real saving rather than a
 * corner cut.
 *
 * Strided rather than random, so opening the same scan twice offers the same
 * window. A window that moved between sessions would look like the data had.
 */
function sampleValues(grid: Grid, total: number, cap = 20000): number[] {
  const step = Math.max(1, Math.floor(total / cap));
  const out: number[] = [];
  for (let n = 0; n < total; n += step) {
    const v = grid.values[n];
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * A window covering the middle of the data.
 *
 * The 5th to 95th percentile rather than the full range: volumes routinely
 * carry a few extreme voxels — a metal implant in a CT, a saturated detector —
 * and a window stretched to cover those leaves everything a researcher came to
 * look at squeezed into the bottom few percent of the ramp.
 */
export function defaultWindow(values: number[]): Window {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (f: number) =>
    sorted[Math.min(sorted.length - 1,
                    Math.max(0, Math.ceil(f * sorted.length) - 1))];
  const lo = pick(0.05);
  const hi = pick(0.95);
  // A constant volume has no width to window; 1 keeps the arithmetic finite
  // and every voxel lands at the same level, which is the truth about it.
  const width = hi > lo ? hi - lo : 1;
  return { level: (lo + hi) / 2, window: width };
}

/**
 * Sample a scalar function through a box.
 *
 * For the analytic members of the family — a quantum probability density, an
 * electron orbital, an implicit surface — where there is no scan to load, only
 * a formula the researcher wants to see the shape of.
 */
export function gridFromFunction(
  fn: (x: number, y: number, z: number) => number,
  steps = 24,
  bounds: { min: number; max: number } = { min: -1, max: 1 },
  units?: string,
): Grid {
  // At least two per axis, or the lattice has no extent and the spacing
  // division is by zero.
  const n = Math.max(2, Math.floor(steps));
  const values = new Float64Array(n * n * n);
  const at = (index: number) =>
    bounds.min + ((bounds.max - bounds.min) * index) / (n - 1);

  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        values[i + n * (j + n * k)] = fn(at(i), at(j), at(k));
      }
    }
  }
  return { nx: n, ny: n, nz: n, values, units };
}

/**
 * What the volume says about itself, including what it is not showing.
 *
 * A volume hides most of itself by design, and a reader who does not know how
 * much is hidden will read the window as the data. §10's requirement that a
 * spatial chart admit what depth costs it applies at least as strongly to what
 * a transfer function costs it.
 */
export function describeVolume(volume: Volume): string {
  if (volume.total === 0) return "No volume to draw.";
  if (volume.splats.length === 0 && volume.missing === volume.total) {
    return "No measurements in this volume.";
  }
  if (volume.splats.length === 0 && volume.faint > 0) {
    return `Nothing is visible: ${volume.faint.toLocaleString()} voxels sit `
         + "inside the window but too faint to show. Narrow the window.";
  }
  if (volume.splats.length === 0) {
    return "Nothing is inside the window; every voxel is below it.";
  }

  const units = volume.units ? ` ${volume.units}` : "";
  const lo = volume.window.level - volume.window.window / 2;
  const hi = volume.window.level + volume.window.window / 2;
  let text = `${volume.splats.length.toLocaleString()} of `
           + `${volume.total.toLocaleString()} voxels drawn, `
           + `showing ${format(lo)} to ${format(hi)}${units}`
           + ` of a measured ${format(volume.range.min)} to `
           + `${format(volume.range.max)}${units}.`;

  if (volume.hidden > 0) {
    text += ` ${volume.hidden.toLocaleString()} fall below the window and are`
          + " not drawn — widen it, or lower the level, to reach them.";
  }
  if (volume.faint > 0) {
    // The opposite remedy, and worth stating: these are inside the window but
    // so near its lower edge that a pixel cannot show them at all.
    text += ` ${volume.faint.toLocaleString()} are inside the window but too`
          + " faint to show — narrow it to bring them up.";
  }
  if (volume.stride > 1) {
    text += ` Sampled every ${volume.stride}${ordinal(volume.stride)} voxel in`
          + " each direction; a feature narrower than that may not appear.";
  }
  if (volume.missing > 0) {
    text += ` ${volume.missing.toLocaleString()} hold no measurement.`;
  }
  return text;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

function format(value: number): string {
  if (!Number.isFinite(value)) return "?";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 10000 || magnitude < 0.01) return value.toExponential(1);
  return Number(value.toFixed(2)).toString();
}
