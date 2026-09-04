/**
 * The projection every 3D chart shares, and the one property none of them tested.
 *
 * Both charts had tests for what they drew and neither had a test for whether it
 * *fit on the canvas*. It did not: at the default camera, with no zoom applied,
 * the corners of the unit cube landed at 137% of the half-canvas. A point cloud
 * hid that — a cloud rarely puts a mark at a cube corner in all three axes at
 * once — so the fault sat there until a surface, whose mesh spans the whole
 * square by definition, tore itself apart in a figure somebody was reading.
 *
 * The lesson is the one this file already carries about units: a property that
 * belongs to the shared projection has to be tested on the shared projection,
 * because testing it on each chart tests each chart's data instead.
 */

import { describe, expect, it } from "vitest";
import {
  Camera, DEFAULT_CAMERA, MAX_ZOOM, MIN_ZOOM, project, resetCamera,
  rotateCamera, toCanvas, unitScale, zoomCamera,
} from "@/lib/charts/scene3d";

/** Every corner and face centre of the unit cube the scales map into. */
const CUBE = (() => {
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    out.push({ x, y, z });
  }
  return out;
})();

/** Yaw all the way round, pitch across its clamped range. */
function everyAngle(): Camera[] {
  const cameras: Camera[] = [];
  for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.2) {
    for (let pitch = -1.35; pitch <= 1.35; pitch += 0.135) {
      cameras.push({ yaw, pitch, zoom: 1 });
    }
  }
  return cameras;
}

describe("the whole scene fits on the canvas", () => {
  const WIDTH = 720, HEIGHT = 520;

  it("keeps the unit cube inside the frame from every angle, unzoomed", () => {
    /**
     * The defect, stated as the property that was missing. A reader who has not
     * touched the controls must be able to see the whole of what they were
     * shown — anything else reads as the chart being broken, and they are right.
     */
    for (const camera of everyAngle()) {
      for (const corner of CUBE) {
        const at = toCanvas(corner, camera, WIDTH, HEIGHT);
        expect(at.x).toBeGreaterThanOrEqual(0);
        expect(at.x).toBeLessThanOrEqual(WIDTH);
        expect(at.y).toBeGreaterThanOrEqual(0);
        expect(at.y).toBeLessThanOrEqual(HEIGHT);
      }
    }
  });

  it("fits in a square, where the margin is tightest", () => {
    // A wide canvas has slack in x that hides an overflow. A square does not.
    for (const camera of everyAngle()) {
      for (const corner of CUBE) {
        const at = toCanvas(corner, camera, 400, 400);
        expect(at.x).toBeGreaterThanOrEqual(0);
        expect(at.x).toBeLessThanOrEqual(400);
        expect(at.y).toBeGreaterThanOrEqual(0);
        expect(at.y).toBeLessThanOrEqual(400);
      }
    }
  });

  it("still uses most of the canvas rather than fitting by shrinking", () => {
    // The lazy fix for an overflow is to scale everything down until it fits,
    // which trades a clipped chart for an unreadable one.
    let furthest = 0;
    for (const camera of everyAngle()) {
      for (const corner of CUBE) {
        const at = toCanvas(corner, camera, 400, 400);
        furthest = Math.max(furthest, Math.hypot(at.x - 200, at.y - 200));
      }
    }
    expect(furthest).toBeGreaterThan(160);   // at least 80% of the half-extent
  });
});

describe("perspective is a depth cue and not a distortion", () => {
  it("never enlarges the near side more than about twice the far side", () => {
    /**
     * The number that broke the surface chart. At `FOCAL = 2.6` a near corner
     * was drawn 2.98x while a far one was drawn 0.60x — nearly a five-fold
     * swing within one scene, which a mesh cannot survive.
     */
    let near = 0, far = Infinity;
    for (const camera of everyAngle()) {
      for (const corner of CUBE) {
        const { scale } = project(corner, camera);
        near = Math.max(near, scale);
        far = Math.min(far, scale);
      }
    }
    expect(near / far).toBeLessThan(2.2);
  });

  it("keeps some perspective, so depth is still legible", () => {
    // Removing it entirely would be orthographic, and a 3D scene with no size
    // cue at all is harder to read, not easier.
    const camera = { ...DEFAULT_CAMERA };
    const nearer = project({ x: 0, y: 0, z: 1 }, camera).scale;
    const further = project({ x: 0, y: 0, z: -1 }, camera).scale;
    expect(nearer).toBeGreaterThan(further * 1.15);
  });

  it("never divides by a near-zero depth", () => {
    // If the eye distance ever fell inside the scene the divisor would cross
    // zero and geometry would invert — the failure that turns a mesh into a fan
    // of slivers radiating from a point.
    for (const camera of everyAngle()) {
      for (const corner of CUBE) {
        const { scale } = project(corner, camera);
        expect(Number.isFinite(scale)).toBe(true);
        expect(scale).toBeGreaterThan(0);
      }
    }
  });
});

describe("what `depth` means", () => {
  /*
   * Every 3D chart in this codebase composites by sorting on `depth`
   * ascending, and each of them is right only because a larger `depth` means
   * *nearer*. Not one of their tests says so: they compare the draw order
   * against the same sort the renderer applies, so they agree with the
   * implementation instead of checking it. Flipping the sign in `project` —
   * which would make every translucent chart composite inside out — left the
   * volume's own "composites back to front" test passing, and every test of
   * the surface, network, line and field charts passing too.
   *
   * The convention is shared, so it is pinned here once rather than
   * separately in each chart. Stated in terms of what a reader sees: the
   * nearer of two points is the one drawn bigger.
   */
  it("gives a nearer point a larger depth than a farther one", () => {
    const camera = { ...DEFAULT_CAMERA, yaw: 0, pitch: 0 };
    // With no rotation the view axis is z, and +z is toward the viewer.
    const near = project({ x: 0, y: 0, z: 0.9 }, camera);
    const far = project({ x: 0, y: 0, z: -0.9 }, camera);

    expect(near.depth).toBeGreaterThan(far.depth);
  });

  it("draws the point with the larger depth bigger, which is what makes it near",
     () => {
    const camera = { ...DEFAULT_CAMERA, yaw: 0, pitch: 0 };
    const near = project({ x: 0, y: 0, z: 0.9 }, camera);
    const far = project({ x: 0, y: 0, z: -0.9 }, camera);

    // `scale` is the perspective factor every chart multiplies its mark size
    // by. If these two ever disagreed, "sort ascending and draw" would put
    // the big marks first and the charts would composite backwards.
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.depth > far.depth).toBe(near.scale > far.scale);
  });

  it("keeps that agreement whichever way the camera is turned", () => {
    for (const yaw of [0, 0.7, 1.9, 3.4, 5.2]) {
      for (const pitch of [-0.9, 0, 0.6]) {
        const camera = { ...DEFAULT_CAMERA, yaw, pitch };
        const a = project({ x: 0.4, y: -0.2, z: 0.8 }, camera);
        const b = project({ x: -0.3, y: 0.5, z: -0.7 }, camera);
        expect(a.depth > b.depth).toBe(a.scale > b.scale);
      }
    }
  });
});


describe("the camera's own rules", () => {
  it("clamps zoom at both ends", () => {
    const camera = { ...DEFAULT_CAMERA };
    for (let i = 0; i < 100; i += 1) zoomCamera(camera, 1.5);
    expect(camera.zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 100; i += 1) zoomCamera(camera, 0.5);
    expect(camera.zoom).toBe(MIN_ZOOM);
  });

  it("clamps pitch short of vertical, where up would be lost", () => {
    const camera = { ...DEFAULT_CAMERA };
    rotateCamera(camera, 0, 100000);
    expect(Math.abs(camera.pitch)).toBeLessThan(Math.PI / 2);
    rotateCamera(camera, 0, -200000);
    expect(Math.abs(camera.pitch)).toBeLessThan(Math.PI / 2);
  });

  it("returns to exactly the default, so a reset is a way out", () => {
    // The recovery path for a reader who has rotated into something unreadable.
    const camera = { ...DEFAULT_CAMERA };
    rotateCamera(camera, 900, -400);
    zoomCamera(camera, 4);
    resetCamera(camera);
    expect(camera).toEqual(DEFAULT_CAMERA);
  });

  it("puts the scene centre at the canvas centre", () => {
    const at = toCanvas({ x: 0, y: 0, z: 0 }, DEFAULT_CAMERA, 720, 520);
    expect(at.x).toBeCloseTo(360, 6);
    expect(at.y).toBeCloseTo(260, 6);
  });
});

describe("unitScale", () => {
  it("maps a range onto the cube's full width", () => {
    const s = unitScale([2, 6, 10]);
    expect(s(2)).toBeCloseTo(-1, 9);
    expect(s(10)).toBeCloseTo(1, 9);
    expect(s(6)).toBeCloseTo(0, 9);
  });

  it("collapses a constant axis to the centre rather than to NaN", () => {
    const s = unitScale([4, 4, 4]);
    expect(s(4)).toBe(0);
  });
});

describe("scaling a dataset large enough to be real", () => {
  it("does not overflow the stack on a hundred thousand points", () => {
    /*
     * `Math.min(...values)` passes one argument per element and dies somewhere
     * past a hundred thousand — a size an embedding space or a single-cell
     * dataset reaches easily. The failure is a RangeError raised inside a min,
     * which reads as anything except a limit on how much data a chart takes.
     */
    const many = Array.from({ length: 200000 }, (_, i) => i);
    const scale = unitScale(many);
    expect(scale(0)).toBeCloseTo(-1, 9);
    expect(scale(199999)).toBeCloseTo(1, 9);
  });
});
