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
export const RADIANS_PER_PIXEL = 0.008;

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

/** How much perspective may enlarge a nearer object. */
export const DEPTH_RANGE = 0.55;
const FOCAL = 2.6;

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
  const unit = Math.min(width, height) * 0.30 * camera.zoom;
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
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  // A constant axis collapses to the centre rather than dividing by zero, which
  // would put every point at NaN and draw nothing at all.
  if (!Number.isFinite(span) || span === 0) return () => 0;
  return (value: number) => ((value - lo) / span) * 2 - 1;
}
