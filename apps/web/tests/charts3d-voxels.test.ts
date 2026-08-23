/**
 * A scalar sampled through a box (§9 volume).
 *
 * Thirty-one named visualizations rest on this grid, so these tests are about
 * the properties all of them depend on: that an unmeasured voxel is not
 * quietly given a value, that thinning a volume does not change how solid it
 * looks, and that the window a reader is looking through is stated rather than
 * assumed.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOLUME, Grid, defaultWindow, describeVolume, gridFromFunction,
  prepareVolume, valueAt,
} from "@/lib/charts3d/voxels";

/** A cube of `n³` samples, filled by a function of the indices. */
const cube = (n: number, fill: (i: number, j: number, k: number) => number): Grid => {
  const values = new Float64Array(n * n * n);
  for (let k = 0; k < n; k += 1)
    for (let j = 0; j < n; j += 1)
      for (let i = 0; i < n; i += 1) values[i + n * (j + n * k)] = fill(i, j, k);
  return { nx: n, ny: n, nz: n, values };
};

/** A grid where every voxel is inside any sensible window. */
const uniform = (n: number, value = 1) => cube(n, () => value);

describe("reading a voxel", () => {
  it("indexes x-fastest, the order every volume file on disk uses", () => {
    /*
     * Getting this wrong transposes the volume. Nothing errors, nothing looks
     * obviously broken, and a scan is shown with its axes swapped — which for
     * anything anatomical is a picture of a different thing entirely.
     */
    const grid: Grid = { nx: 2, ny: 3, nz: 4,
                         values: Array.from({ length: 24 }, (_, n) => n) };
    expect(valueAt(grid, 1, 0, 0)).toBe(1);
    expect(valueAt(grid, 0, 1, 0)).toBe(2);
    expect(valueAt(grid, 0, 0, 1)).toBe(6);
  });

  it("reports outside the box as absent, not as zero", () => {
    // Zero is a real value — water, in a CT — so returning it for a voxel that
    // is not there invents a measurement rather than admitting the edge.
    const grid = uniform(2, 5);
    expect(valueAt(grid, 2, 0, 0)).toBeNaN();
    expect(valueAt(grid, -1, 0, 0)).toBeNaN();
    expect(valueAt(grid, 0, 0, 9)).toBeNaN();
  });
});

describe("missing is not zero", () => {
  it("excludes an unmeasured voxel from the range", () => {
    /*
     * The specific clinical trap: substituting zero for a missing voxel in a
     * CT does not leave a gap, it fills the gap with water. The range then
     * reaches down to 0 HU and the window opens to cover a value nothing
     * measured.
     */
    const grid = cube(3, (i) => (i === 0 ? NaN : 100 + i));
    const volume = prepareVolume(grid);
    expect(volume.range.min).toBeGreaterThan(0);
    expect(volume.missing).toBe(9);
  });

  it("does not draw one", () => {
    const grid = cube(2, (i, j, k) => (i + j + k === 0 ? NaN : 10));
    const volume = prepareVolume(grid);
    expect(volume.splats.every((s) => Number.isFinite(s.value))).toBe(true);
    expect(volume.missing).toBe(1);
  });

  it("says how many held no measurement", () => {
    const grid = cube(2, (i) => (i === 0 ? NaN : 10));
    expect(describeVolume(prepareVolume(grid))).toContain("hold no measurement");
  });

  it("says so plainly when nothing was measured at all", () => {
    const volume = prepareVolume(cube(2, () => NaN));
    expect(volume.splats).toHaveLength(0);
    expect(describeVolume(volume)).toBe("No measurements in this volume.");
  });

  it("refuses a grid whose values do not fill its shape", () => {
    /*
     * Read past the end, every index is undefined and every voxel silently
     * becomes NaN — an empty picture that looks like an empty scan rather than
     * like a truncated file.
     */
    const truncated: Grid = { nx: 4, ny: 4, nz: 4, values: [1, 2, 3] };
    const volume = prepareVolume(truncated);
    expect(volume.splats).toHaveLength(0);
    expect(volume.total).toBe(64);
  });
});

describe("the window is the whole of what makes a volume readable", () => {
  it("covers the middle of the data, not its extremes", () => {
    /*
     * A metal implant in a CT, or a saturated detector, is a handful of voxels
     * thousands of units from everything else. A window stretched to include
     * them squeezes what the researcher came to look at into the bottom few
     * percent of the ramp, where it is one flat colour.
     */
    const values = [...Array.from({ length: 98 }, () => 100), 0, 100000];
    const window = defaultWindow(values);
    expect(window.level).toBeLessThan(1000);
  });

  it("hides what falls below it, and counts what it hid", () => {
    const grid = cube(4, (i) => (i < 2 ? 0 : 100));
    const volume = prepareVolume(grid, {
      ...DEFAULT_VOLUME, window: { level: 100, window: 20 } });
    expect(volume.hidden).toBe(32);
    expect(volume.splats).toHaveLength(32);
  });

  it("tells the reader what it is hiding rather than letting it look empty", () => {
    const grid = cube(4, (i) => (i < 2 ? 0 : 100));
    const text = describeVolume(prepareVolume(grid, {
      ...DEFAULT_VOLUME, window: { level: 100, window: 20 } }));
    expect(text).toContain("below the window");
    expect(text).toContain("widen it");
  });

  it("says when the window excludes everything", () => {
    // Otherwise a window set past the data is an empty canvas that reads as a
    // failure to load.
    const volume = prepareVolume(uniform(3, 5), {
      ...DEFAULT_VOLUME, window: { level: 1000, window: 10 } });
    expect(describeVolume(volume)).toContain("every voxel is below it");
  });

  it("reports the measured range beside the window, not instead of it", () => {
    // The two differ by design, and a reader comparing two scans needs the
    // absolute numbers rather than "whatever this window happened to be".
    const grid = cube(3, (i) => i * 100);
    const volume = prepareVolume(grid, {
      ...DEFAULT_VOLUME, window: { level: 100, window: 50 } });
    expect(volume.range).toEqual({ min: 0, max: 200 });
    expect(volume.window).toEqual({ level: 100, window: 50 });
  });

  it("ramps opacity across the window rather than switching on at its edge", () => {
    /*
     * A hard edge draws a contour that is an artefact of the window setting.
     * A reader cannot tell it from a boundary in the data, and it moves when
     * the window moves — which is the signature of a picture of the controls.
     */
    const grid = cube(4, (i) => i);
    const volume = prepareVolume(grid, {
      ...DEFAULT_VOLUME, window: { level: 1.5, window: 3 } });
    const alphas = new Set(volume.splats.map((s) => s.alpha.toFixed(6)));
    expect(alphas.size).toBeGreaterThan(1);
  });

  it("survives a window of no width", () => {
    // A constant volume has none, and dividing by it is how a whole picture
    // becomes NaN and renders as nothing at all.
    const volume = prepareVolume(uniform(3, 7), {
      ...DEFAULT_VOLUME, window: { level: 7, window: 0 } });
    expect(volume.splats.every((s) => Number.isFinite(s.alpha))).toBe(true);
  });

  it("windows a constant volume without dividing by zero", () => {
    const window = defaultWindow([4, 4, 4, 4]);
    expect(window.window).toBeGreaterThan(0);
    expect(Number.isFinite(window.level)).toBe(true);
  });
});

describe("thinning does not change how solid it looks", () => {
  it("corrects opacity for the stride", () => {
    /*
     * A ray crossing a strided volume passes through that many fewer samples.
     * Uncorrected, the same data drawn faster looks *thinner* — a change to
     * the reader's impression of density that nobody asked for and nothing
     * announces.
     */
    const dense = prepareVolume(uniform(40), { ...DEFAULT_VOLUME, maxSplats: 1e9 });
    const thin = prepareVolume(uniform(40), { ...DEFAULT_VOLUME, maxSplats: 500 });
    expect(thin.stride).toBeGreaterThan(1);
    expect(thin.splats[0].alpha).toBeGreaterThan(dense.splats[0].alpha);
  });

  it("accumulates to about the same total opacity along a ray", () => {
    /*
     * The claim the correction actually makes, stated as a ray rather than as
     * a formula: stack the drawn voxels of one column and the chance of the
     * ray being stopped should be near enough the same either way.
     */
    const through = (maxSplats: number) => {
      const volume = prepareVolume(uniform(27), { ...DEFAULT_VOLUME, maxSplats });
      const column = volume.splats.filter(
        (s) => Math.abs(s.x - volume.splats[0].x) < 1e-9
            && Math.abs(s.y - volume.splats[0].y) < 1e-9);
      return 1 - column.reduce((acc, s) => acc * (1 - s.alpha), 1);
    };
    const dense = through(1e9);
    const thin = through(200);
    expect(Math.abs(dense - thin)).toBeLessThan(0.06);
  });

  it("strides each axis rather than a flattened list", () => {
    /*
     * Striding the flat array takes every nth sample in x-fastest order, which
     * thins x a hundred times harder than z and turns a cube into a set of
     * combs. Every axis must keep more than a couple of distinct positions.
     */
    const volume = prepareVolume(uniform(30), { ...DEFAULT_VOLUME, maxSplats: 400 });
    for (const axis of ["x", "y", "z"] as const) {
      const distinct = new Set(volume.splats.map((s) => s[axis].toFixed(6)));
      expect(distinct.size).toBeGreaterThan(3);
    }
  });

  it("keeps the whole grid when it fits", () => {
    const volume = prepareVolume(uniform(8), { ...DEFAULT_VOLUME, maxSplats: 1e6 });
    expect(volume.stride).toBe(1);
    expect(volume.splats).toHaveLength(512);
    expect(volume.strided).toBe(0);
  });

  it("warns that a narrow feature may not survive the thinning", () => {
    const volume = prepareVolume(uniform(40), { ...DEFAULT_VOLUME, maxSplats: 500 });
    expect(describeVolume(volume)).toContain("may not appear");
  });

  it("keeps the drawn count under the limit", () => {
    const volume = prepareVolume(uniform(50), { ...DEFAULT_VOLUME, maxSplats: 2000 });
    expect(volume.splats.length).toBeLessThanOrEqual(2000);
  });
});

describe("where the voxels land", () => {
  it("fills the unit cube", () => {
    const volume = prepareVolume(uniform(5));
    for (const splat of volume.splats) {
      for (const axis of [splat.x, splat.y, splat.z]) {
        expect(axis).toBeGreaterThanOrEqual(-0.5);
        expect(axis).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("puts a volume one slice thick in the middle of that axis", () => {
    // An ordinary case — a single acquired slice — and dividing by its zero
    // extent is how the whole picture becomes NaN.
    const slab: Grid = { nx: 3, ny: 3, nz: 1,
                         values: Array.from({ length: 9 }, () => 5) };
    const volume = prepareVolume(slab);
    expect(volume.splats.every((s) => s.z === 0)).toBe(true);
    expect(volume.splats.every((s) => Number.isFinite(s.x))).toBe(true);
  });

  it("places a voxel by its index, not by its position in the list", () => {
    const grid = cube(3, () => 1);
    const volume = prepareVolume(grid);
    const corner = volume.splats.find(
      (s) => s.x === -0.5 && s.y === -0.5 && s.z === -0.5);
    expect(corner).toBeDefined();
  });

  it("has nothing to draw for a grid with no extent", () => {
    const nothing = prepareVolume({ nx: 0, ny: 0, nz: 0, values: [] });
    expect(nothing.splats).toHaveLength(0);
    expect(describeVolume(nothing)).toBe("No volume to draw.");
  });
});

describe("sampling a function that has no scan", () => {
  it("evaluates at the position it reports", () => {
    // A grid whose values were evaluated at different points than the
    // positions they are drawn at is a picture of the wrong function.
    const grid = gridFromFunction((x, y, z) => x + 10 * y + 100 * z, 3,
                                  { min: 0, max: 2 });
    expect(valueAt(grid, 0, 0, 0)).toBe(0);
    expect(valueAt(grid, 1, 0, 0)).toBe(1);
    expect(valueAt(grid, 0, 1, 0)).toBe(10);
    expect(valueAt(grid, 0, 0, 2)).toBe(200);
  });

  it("covers both ends of the bounds", () => {
    const grid = gridFromFunction((x) => x, 5, { min: -2, max: 2 });
    expect(valueAt(grid, 0, 0, 0)).toBe(-2);
    expect(valueAt(grid, 4, 0, 0)).toBe(2);
  });

  it("refuses a lattice of one point", () => {
    // With one step per axis there is no extent, and the spacing division is
    // by zero.
    const grid = gridFromFunction(() => 1, 1);
    expect(grid.nx).toBeGreaterThan(1);
    expect(Array.from(grid.values).every(Number.isFinite)).toBe(true);
  });

  it("carries the units through to the caption", () => {
    const grid = gridFromFunction((x, y, z) => x * x + y * y + z * z, 4,
                                  { min: -1, max: 1 }, "HU");
    expect(describeVolume(prepareVolume(grid))).toContain("HU");
  });
});

describe("the settings are a decision, not a magic number", () => {
  it("keeps a single voxel nearly transparent, because hundreds stack", () => {
    expect(DEFAULT_VOLUME.opacity).toBeLessThan(0.2);
    expect(DEFAULT_VOLUME.opacity).toBeGreaterThan(0);
  });

  it("draws enough splats to be a volume rather than a cloud", () => {
    expect(DEFAULT_VOLUME.maxSplats).toBeGreaterThan(10000);
  });
});
