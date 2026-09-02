/**
 * The 3D scene every spatial chart shares: one camera, one projection, one clamp.
 *
 * Extracted rather than copied, and the reason is a bug this codebase has
 * already paid for. Rotation reached the 3D scatter through a command whose
 * units nobody had written down, and the producer and the consumer each stayed
 * self-consistent while disagreeing with each other by a factor of the viewport
 * width. Two independent implementations of the same projection is the same
 * hazard with more surface: they start identical, one is tuned, and the charts
 * quietly stop behaving the same way under the same gesture.
 *
 * So the arithmetic lives here and the charts own only what is genuinely theirs
 * — what to draw, and what a point means.
 *
 * Deliberately no WebGL. A scene graph is around 600KB for what is, at this
 * scale, a 4x4 matrix and a sort, and this product's premise is that a
 * researcher installs it on a laptop. That trade is revisited when there is a
 * chart that genuinely cannot be drawn this way, not before.
 */

export type Camera = {
  yaw: number;
  pitch: number;
  /**
   * Uniform scale about the scene's centre.
   *
   * Applied to the projected radius rather than to the focal length. Moving the
   * eye instead would change how strongly perspective enlarges nearer objects —
   * and near-is-bigger is a depth cue these charts rely on, so the reader would
   * watch the depth encoding shift while they zoomed.
   */
  zoom: number;
};

/** Bounds, so a scene cannot be zoomed into nothing or out of sight (§32). */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 6;

/**
 * Three-quarters view, slightly from above.
 *
 * Not face-on: an axis-aligned start hides the third dimension completely, and
 * a reader who never rotates would take a 3D chart for a 2D one and misread
 * every depth as a position.
 */
export const DEFAULT_CAMERA: Camera = { yaw: 0.6, pitch: -0.34, zoom: 1 };

/**
 * How far a pointer drag turns the scene, per pixel.
 *
 * The one place this constant exists. Every input — pointer, keyboard, hand —
 * arrives as pixels of the viewport, so the mapping from pixels to radians is a
 * property of the scene rather than of whichever input produced them.
 */
/*
 * Not exported, and that is the point.
 *
 * The comment above says this is the one place the constant exists, and an
 * export is an invitation to a second place — a chart converting its own pixels
 * to radians, staying self-consistent, and drifting from the projection. That is
 * precisely how rotation was broken from its first commit. Anything needing to
 * turn a scene calls `rotateCamera`.
 */
const RADIANS_PER_PIXEL = 0.008;

/** Clamped short of the poles: past vertical the scene flips and up is lost. */
const MAX_PITCH = 1.35;

export function rotateCamera(camera: Camera, dxPixels: number,
                             dyPixels: number): void {
  camera.yaw += dxPixels * RADIANS_PER_PIXEL;
  camera.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH,
    camera.pitch + dyPixels * RADIANS_PER_PIXEL));
}

/** Multiply the zoom, staying inside the bounds. Returns the factor applied. */
export function zoomCamera(camera: Camera, factor: number): number {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
  const applied = next / camera.zoom;
  camera.zoom = next;
  return applied;
}

export function resetCamera(camera: Camera): void {
  camera.yaw = DEFAULT_CAMERA.yaw;
  camera.pitch = DEFAULT_CAMERA.pitch;
  camera.zoom = DEFAULT_CAMERA.zoom;
}

/** How much perspective may enlarge a nearer *mark*. */
export const DEPTH_RANGE = 0.55;

/**
 * Eye distance, in scene units, and the number that decides how violent
 * perspective is.
 *
 * Raised from 2.6, which was wrong in a way that only showed on a mesh. The unit
 * cube's corner sits 1.73 units from the centre, so at 2.6 the divisor
 * `FOCAL - z` fell to 0.87 and a near corner was enlarged 2.98x while a far one
 * shrank to 0.60x — a **4.96x swing across a single scene**. A point cloud
 * survives that, because a mark is a dot and the reader reads the change as
 * depth, which is why the 3D scatter looked fine for months. A surface does not:
 * its near cells balloon past the frame while its far cells collapse, and the
 * mesh tears into the fan of slivers that was reported.
 *
 * `DEPTH_RANGE` did not protect against this. It damps perspective when *sizing
 * a mark* and nothing damps the projected positions, which is exactly why the
 * observations in that figure looked reasonable while the surface under them
 * came apart.
 *
 * At 6 the swing is 1.81x, which is still plainly a depth cue and no longer a
 * distortion.
 */
export const FOCAL = 6;

/**
 * Scene units per half-canvas, before zoom.
 *
 * Lowered from 0.30, which never framed the thing it was framing. A unit cube
 * rotated to an arbitrary angle has a projected radius of at least √3 ≈ 1.73 —
 * that is just its diagonal, before perspective — and 0.30 only accommodates
 * 1.67 (half of one, over the factor). So the corners of every 3D scene here
 * were outside the canvas at the default camera with no zoom applied at all.
 *
 * 0.26 is derived rather than chosen: sampling the cube over the full range of
 * yaw and the clamped range of pitch, the largest projected radius at
 * `FOCAL = 6` is 1.81, and 0.47 / 1.81 = 0.26 keeps it inside the frame with a
 * little margin. `tests/scene3d.test.ts` recomputes that sweep, so changing
 * either constant without the other fails.
 */
const FIT = 0.26;

/**
 * Canvas pixels per scene unit, at this camera and canvas size.
 *
 * Split out of `toCanvas` rather than copied, for the reason `toCanvas` itself
 * gives: a second copy of this arithmetic is a copy that can disagree. The
 * globe needs it to size the sphere's silhouette, which is not the projection
 * of any one point and so cannot be read off a `toCanvas` result.
 */
export function unitLength(camera: Camera, width: number,
                           height: number): number {
  return Math.min(width, height) * FIT * camera.zoom;
}

export type Projected = {
  x: number;
  y: number;
  /** Toward the viewer, so larger is nearer. Used to sort back to front. */
  depth: number;
  /** The perspective factor, for scaling a mark by its distance. */
  scale: number;
};

/** Rotate, then project. Coordinates are the unit cube; output is unitless. */
export function project(p: { x: number; y: number; z: number },
                        camera: Camera): Projected {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);

  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const y2 = p.y * cp - z1 * sp;
  const z2 = p.y * sp + z1 * cp;

  const w = FOCAL / (FOCAL - z2);
  return { x: x1 * w, y: y2 * w, depth: z2, scale: w };
}

/**
 * Where a scene point lands on the canvas.
 *
 * Shared because the inverse question — "which object is under this pixel" — has
 * to use exactly the same arithmetic as the drawing did. When hit-testing and
 * painting disagree, the reader points at a mark and is told they pointed at
 * nothing, which reads as broken tracking rather than as a mismatch.
 */
export function toCanvas(p: { x: number; y: number; z: number }, camera: Camera,
                         width: number, height: number) {
  const q = project(p, camera);
  const unit = unitLength(camera, width, height);
  return {
    x: width / 2 + q.x * unit,
    y: height / 2 - q.y * unit,
    depth: q.depth,
    scale: q.scale,
  };
}

/**
 * Scale a set of values into the unit cube.
 *
 * Per axis, which is a decision worth stating rather than hiding: it makes the
 * three axes comparable in *shape* and incomparable in *distance*, so a diagonal
 * on screen is not a real distance in the data. Every chart using this owes the
 * reader that sentence, and they say it.
 */
export function unitScale(values: number[]): (value: number) => number {
  /*
   * Swept, never `Math.min(...values)`.
   *
   * Spreading an array into a call passes one argument per element, and past
   * roughly a hundred thousand that overflows the stack. An embedding space or
   * a single-cell dataset reaches that easily, and the failure is a RangeError
   * from inside a min — nowhere near anything that reads as a size limit.
   */
  let lo = Infinity, hi = -Infinity;
  for (const value of values) {
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  const span = hi - lo;
  // A constant axis collapses to the centre rather than dividing by zero, which
  // would put every point at NaN and draw nothing at all.
  if (!Number.isFinite(span) || span === 0) return () => 0;
  return (value: number) => ((value - lo) / span) * 2 - 1;
}

/**
 * Whether a screen point lies inside a lasso.
 *
 * Ray casting: count how many polygon edges a ray to the left crosses, and an
 * odd count means inside. Standard, and correct for a self-intersecting lasso
 * as well, which a hand-drawn one frequently is.
 *
 * **This lives here because it had six copies.** Every 3D chart carried its
 * own, five of them byte-identical and the sixth the same formula rearranged.
 * Nothing had diverged yet, and that is the whole point of moving it: a lasso
 * is one gesture in one command architecture, and the moment two charts answer
 * it differently the difference shows up as a chart that "feels wrong" rather
 * than as a failing test.
 */
export function insidePolygon(polygon: Array<{ x: number; y: number }>,
                              point: { x: number; y: number }): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = (a.y > point.y) !== (b.y > point.y);
    if (!straddles) continue;
    const crossing = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < crossing) inside = !inside;
  }
  return inside;
}
