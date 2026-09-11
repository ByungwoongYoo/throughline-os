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

/**
 * The rotation on its own, without the perspective divide.
 *
 * Split out of `project` rather than written twice, for the reason this file
 * exists at all. The axis furniture has to ask a question the projection
 * cannot answer: which way a *direction* points once the scene has turned. A
 * face normal has no position, so putting it through `project` would divide it
 * by a depth it does not have and hand back a point instead of a heading —
 * and the answer decides which walls are drawn, so it has to come from the
 * same arithmetic the drawing does.
 */
function rotate(p: { x: number; y: number; z: number }, camera: Camera) {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);

  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  return { x: x1, y: p.y * cp - z1 * sp, z: p.y * sp + z1 * cp };
}

/** Rotate, then project. Coordinates are the unit cube; output is unitless. */
export function project(p: { x: number; y: number; z: number },
                        camera: Camera): Projected {
  const turned = rotate(p, camera);
  const w = FOCAL / (FOCAL - turned.z);
  return { x: turned.x * w, y: turned.y * w, depth: turned.z, scale: w };
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
/**
 * What a per-axis scaling costs the reader, in one sentence, defined once.
 *
 * `unitScale` stretches each axis into the unit cube on its own, and its
 * docstring has always said the consequence: the three axes become comparable
 * in *shape* and incomparable in *distance*, so a diagonal on screen is not a
 * distance in the data. It also said "every chart using this owes the reader
 * that sentence, and they say it".
 *
 * They did not. Two charts said it, in two separately worded copies, and four
 * more stretched their axes through a layout module and said nothing. Two
 * copies drift and the one nobody edits becomes the one that is wrong, so
 * there is now one string and a test that every such chart renders it.
 */
export const AXES_SCALED_SEPARATELY =
  // The wording Surface and Volume already shipped, kept rather than
  // improved: the tests that pin it are pinning what a reader has seen, and
  // rewording it would be churn charged to them.
  "The three axes are scaled independently, so distances along different axes "
  + "are not comparable.";


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


/* ------------------------------------------------------------------------ *
 * Axes: what a dimension is, and how a reader gets a number back off it.
 *
 * Every spatial chart here drew a box in space with nothing written on it. The
 * projection was right, the rotation was right, the occlusion count was right,
 * and a reader looking at the result could not say what any of the three
 * directions measured or read a single value off the picture. That is not a
 * missing polish pass; it is the difference between a figure and a shape.
 *
 * The furniture is computed as geometry and drawn separately, in two parts,
 * because the order matters and only the caller knows where its data goes:
 * panes and gridlines behind the marks, axis lines and text over them. A wall
 * painted after the data hides the data; a label painted before it disappears
 * under the first opaque cell.
 * ------------------------------------------------------------------------ */

export type Axis = "x" | "y" | "z";

/**
 * One axis, in the units the reader thinks in.
 *
 * `min` and `max` are the **data** domain — the same two numbers the chart
 * handed to `unitScale`, not the unit cube. They have to be the same numbers,
 * and nothing would look wrong if they were not: a tick reading 40 would
 * simply sit where 45 is, and the reader would read the chart off it. There is
 * no way to detect that from here, so it is stated here instead.
 */
export type AxisSpec = {
  /** What the dimension is. "Maturity", never "y". */
  label: string;
  /** Drawn in parentheses after the label. "years", "bps", "$". */
  unit?: string;
  min: number;
  max: number;
};

/**
 * The three axes of a scene, keyed by **scene** axis rather than by data name.
 *
 * Worth saying plainly, because it is the one thing a caller gets wrong. `y`
 * is the direction that runs up the screen at the default camera and `z` is
 * the one that runs into it. A chart whose height is a fitted response passes
 * that response as `y` even though its own variable is named z — `Surface`
 * already places its height on scene y and its second predictor on scene z,
 * and the furniture has to agree with the drawing rather than with the naming.
 */
export type Axes3D = { x: AxisSpec; y: AxisSpec; z: AxisSpec };

/**
 * The most ticks an axis carries, and the reason it is small.
 *
 * A tick is a label, and three axes of labels are drawn around a box that
 * already fills most of the canvas. Eight per axis is twenty-four strings
 * competing for the margin, which is how an axis stops being readable — the
 * failure is not that a number is missing but that none of them can be picked
 * out. Six is enough to interpolate between and few enough to fit.
 */
const MAX_TICKS = 6;

/**
 * Tick values a person would have chosen, on 1, 2 or 5 times a power of ten.
 *
 * Candidates are enumerated and scored rather than derived by rounding the
 * ideal step, because rounding produces the failure this is most often
 * shipped with: a domain of 0 to 28 rounds a step of 7 up to 10 and yields
 * three ticks — 0, 10, 20 — on an axis reaching 28. Three ticks is a scale
 * nobody can interpolate on. Scoring lets "too few" be a penalty rather than
 * an accident, so 0, 5, 10, 15, 20, 25 wins instead.
 *
 * Values sit inside the domain and are never extended past it; an axis whose
 * ends are 1 and 9 is not silently redrawn as 0 to 10.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  /*
   * A constant axis is one value, not a range. `unitScale` collapses it to the
   * centre of the cube rather than dividing by a zero span, and this is the
   * same decision on the label side: one tick saying what the value is. The
   * alternative is a step of zero and a loop that does not end.
   */
  if (lo === hi) return [lo];

  const wanted = Math.max(2, Math.min(12, Math.round(target)));
  const cap = Math.max(MAX_TICKS, wanted + 1);
  const span = hi - lo;

  let best: number[] | null = null;
  let bestScore = Infinity;
  const around = Math.floor(Math.log10(span / wanted));
  for (let exponent = around - 1; exponent <= around + 2; exponent += 1) {
    for (const mantissa of [1, 2, 5]) {
      const step = mantissa * Math.pow(10, exponent);
      if (!Number.isFinite(step) || step <= 0) continue;
      const whole = stepsWithin(lo, hi, step);
      /*
       * The same step with its end labels dropped, when it overruns the cap by
       * one or two. A domain that is exactly six steps wide — ±0.0003 in
       * hundred-thousandths, say — lands seven ticks, and refusing it outright
       * falls back to a step three times coarser and an axis reading only
       * -0.0002, 0, 0.0002. Trimming the ends keeps the round numbers and the
       * even spacing and costs the two labels closest to the frame, which are
       * the two a reader needs least.
       */
      const candidates = whole.length > cap && whole.length <= cap + 2
        ? [whole, whole.slice(1, -1)] : [whole];
      for (const values of candidates) {
        if (values.length < 2 || values.length > cap) continue;
        /*
         * Fewer than four is taken only when nothing else fits, which is why
         * it is a penalty and not a filter: a very short domain sometimes has
         * no rounder answer, and two honest ticks beat none.
         *
         * Measured against what the caller asked for, never against a flat
         * four. A caller asking for three and being handed six is not being
         * protected from an unreadable axis; it is being overruled, and the
         * one place that happens is a colourbar the size of a paragraph.
         */
        const floor = Math.min(4, wanted);
        const score = Math.abs(values.length - wanted)
          + (values.length < floor ? cap : 0);
        if (score < bestScore) { bestScore = score; best = values; }
      }
    }
  }
  /*
   * Nothing landed. The domain is narrower than the gap between representable
   * neighbours at this magnitude, so there is no round number between the
   * ends — the ends themselves are then the only true thing to say.
   */
  return best ?? [lo, hi];
}

/** Every multiple of `step` inside the domain, snapped clear of binary dust. */
function stepsWithin(lo: number, hi: number, step: number): number[] {
  // The tolerances matter at the ends: 0.1 * 3 is not 0.3 in binary, so an
  // exact endpoint is dropped or an outside one admitted without them.
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  const out: number[] = [];
  for (let k = first; k <= last; k += 1) out.push(snapToStep(k * step, step));
  return out;
}

/**
 * The tick's value with the floating-point residue taken off.
 *
 * `3 * 0.1` is 0.30000000000000004, and a chart that prints that has told the
 * reader its axis is uncertain in the sixteenth decimal place. The step says
 * how many places can carry meaning; one more than that is generous and still
 * far short of where the dust lives.
 */
function snapToStep(value: number, step: number): number {
  const places = Math.max(0,
    Math.min(15, 1 - Math.floor(Math.log10(Math.abs(step)))));
  const snapped = Number(value.toFixed(places));
  // Negative zero prints as "-0", which reads as a value below zero.
  return snapped === 0 ? 0 : snapped;
}

/** Digits as they are written above the line, for a power of ten. */
const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "-": "⁻",
};

/**
 * A tick value as a string a reader parses rather than counts.
 *
 * Three separate failures are being avoided, and each has been seen in a
 * shipped chart. Binary dust — `0.30000000000000004` on an axis of tenths.
 * Unseparated magnitudes — `4000000`, which is read by counting zeros and is
 * therefore read wrong. And spurious precision — `2000000.0` where the step
 * is a million.
 *
 * `step` is what decides how many decimal places carry meaning. It defaults to
 * the value's own magnitude, which is right for a lone number and wrong for a
 * series; `formatTicks` derives it from the spacing instead.
 */
export function formatTick(value: number, step = Math.abs(value) || 1): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  /*
   * Past a million, or under a ten-thousandth, the digits stop being a number
   * anybody reads and become a row of zeros they have to count. The exponent
   * is the form the readers of these charts already use.
   */
  if (magnitude >= 1e6 || magnitude < 1e-4) return scientific(value);
  const places = Math.max(0,
    Math.min(12, -Math.floor(Math.log10(Math.abs(step)))));
  return groupThousands(trimTrailingZeros(value.toFixed(places)));
}

/** One step for the whole series, so the ticks are formatted alike. */
export function formatTicks(values: number[]): string[] {
  if (values.length === 0) return [];
  let step = Infinity;
  for (let i = 1; i < values.length; i += 1) {
    const gap = Math.abs(values[i] - values[i - 1]);
    if (gap > 0 && gap < step) step = gap;
  }
  if (!Number.isFinite(step)) step = Math.abs(values[0]) || 1;
  return values.map((value) => formatTick(value, step));
}

function scientific(value: number): string {
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = Number((value / Math.pow(10, exponent)).toPrecision(3));
  const digits = String(exponent).split("")
    .map((character) => SUPERSCRIPT[character] ?? character).join("");
  return `${mantissa}×10${digits}`;
}

function trimTrailingZeros(fixed: string): string {
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

function groupThousands(text: string): string {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf(".");
  const whole = dot === -1 ? body : body.slice(0, dot);
  const fraction = dot === -1 ? "" : body.slice(dot);
  return (negative ? "-" : "")
    + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + fraction;
}

export type ScreenPoint = { x: number; y: number };
export type LabelAnchor = "start" | "middle" | "end";
export type LabelBaseline = "top" | "middle" | "bottom";

/**
 * Everything around the data, as geometry, in canvas pixels.
 *
 * Geometry rather than drawing calls, so the same computation can be tested
 * without a canvas, drawn in two passes around the marks, and reused by an
 * exporter that paints into something other than a 2D context.
 */
export type Furniture = {
  /** The walls facing away from the reader. Never in front of a mark. */
  panes: Array<{ points: ScreenPoint[] }>;
  /** Lines across those walls, at tick positions, plus each wall's border. */
  gridlines: Array<{ a: ScreenPoint; b: ScreenPoint }>;
  /**
   * The cube edge each axis is labelled along.
   *
   * Not in the sketch this was built from, and added rather than folded into
   * `gridlines` because the two are drawn at different weights, in different
   * colours, on different sides of the data. An axis is the line a reader
   * follows to a number; a gridline is a wash that carries the eye to it.
   */
  axisLines: Array<{ axis: Axis; a: ScreenPoint; b: ScreenPoint }>;
  ticks: Array<{
    axis: Axis; text: string; at: ScreenPoint;
    anchor: LabelAnchor; baseline: LabelBaseline;
  }>;
  titles: Array<{
    axis: Axis; text: string; at: ScreenPoint;
    anchor: LabelAnchor; baseline: LabelBaseline;
    /**
     * Radians, and zero for every axis that is not steep on screen. Also not
     * in the sketch: without it the caller cannot draw a title along a
     * near-vertical edge, and horizontal text beside one needs a column of
     * margin the canvas does not have.
     */
    rotation: number;
  }>;
};

/** Type size for a tick, in CSS pixels. */
/**
 * How wide the halo under a label is.
 *
 * Wide enough to separate 10.5px type from a mark behind it, narrow enough
 * that it reads as a thin outline rather than a plate. Stroked at twice this
 * because a stroke straddles the path.
 */
const HALO_WIDTH = 2.5;

const TICK_TYPE = 10.5;
/**
 * The height a tick label is treated as occupying when testing for collisions.
 *
 * Tighter than a line box on purpose. A tick is digits, and digits reach a cap
 * height of roughly 0.72 em with no descender below the baseline, so measuring
 * one as a full leaded line throws away labels that in fact clear each other
 * by a comfortable margin — an axis lost its 100 between its 80 and its 120
 * that way.
 */
const TICK_LINE = TICK_TYPE * 0.95;
/** Type size for an axis title. Weight, never bold — see `drawFurniture`. */
const TITLE_TYPE = 11.5;
const TITLE_WEIGHT = 560;
/** From the axis edge to its tick text. */
const TICK_GAP = 8;
/** From the far side of the tick text to the title. */
const TITLE_GAP = 7;
/** No label sits closer than this to the edge of the canvas. */
const EDGE_PAD = 3;
/**
 * How much of the wall's colour a pane carries.
 *
 * A wall is a surface the eye should be able to ignore. Above about 0.2 it
 * reads as a filled shape and starts competing with the data drawn against it.
 */
const PANE_ALPHA = 0.12;

/** The two axes a face spans, given the one it fixes. */
const FREE_AXES: Record<Axis, [Axis, Axis]> = {
  x: ["y", "z"], y: ["z", "x"], z: ["x", "y"],
};

const AXIS_ORDER: Axis[] = ["x", "y", "z"];

/**
 * Roughly how wide a string is, with no context to measure it in.
 *
 * `axisFurniture` is deliberately callable without a canvas — it is geometry,
 * and the tests exercise it in a DOM with no layout engine — so the width that
 * decides whether two ticks collide has to be estimated.
 *
 * Per character rather than an average, because a tick is not average text.
 * "-0.0001" is five digits and two of the narrowest glyphs in the font, and
 * one flat rate wide enough for digits made it a fifth wider than it is —
 * which is enough to make an axis drop half its labels as colliding when they
 * do not.
 */
const ADVANCE: Record<string, number> = {
  ".": 0.3, ",": 0.3, "-": 0.36, "−": 0.36, "1": 0.52, "×": 0.62,
  "⁰": 0.4, "¹": 0.4, "²": 0.4, "³": 0.4, "⁴": 0.4,
  "⁵": 0.4, "⁶": 0.4, "⁷": 0.4, "⁸": 0.4, "⁹": 0.4, "⁻": 0.28,
};

function estimateWidth(text: string, size: number): number {
  let ems = 0;
  for (const character of text) ems += ADVANCE[character] ?? 0.58;
  return ems * size;
}

/**
 * The unit normal to a screen segment, pointing away from the picture's centre.
 *
 * Every label on an edge is offset along the same direction, which is what
 * makes a row of ticks read as one axis rather than as a scatter of numbers.
 * Returns null for an edge seen exactly end-on, which has no side to be
 * outside of.
 */
function outwardNormal(from: ScreenPoint, to: ScreenPoint,
                       centre: ScreenPoint): ScreenPoint | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const normal = { x: -dy / length, y: dx / length };
  const away = normal.x * (mid.x - centre.x) + normal.y * (mid.y - centre.y);
  return away < 0 ? { x: -normal.x, y: -normal.y } : normal;
}

/** The rectangle a label's text will occupy, once its anchor is applied. */
type LabelBox = { left: number; top: number; right: number; bottom: number };

function boxOf(at: ScreenPoint, anchor: LabelAnchor, baseline: LabelBaseline,
               textWidth: number, textHeight: number): LabelBox {
  const left = anchor === "start" ? at.x
    : anchor === "end" ? at.x - textWidth : at.x - textWidth / 2;
  const top = baseline === "top" ? at.y
    : baseline === "bottom" ? at.y - textHeight : at.y - textHeight / 2;
  return { left, top, right: left + textWidth, bottom: top + textHeight };
}

/**
 * Whether two labels would sit on top of each other.
 *
 * The boxes are estimates, so they are shrunk by a pixel before the test.
 * Being slightly generous about width and then strict about touching would
 * throw away ticks that in fact clear each other, and a dropped tick is a
 * worse fault than two labels a hair apart.
 */
function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right - 1 && b.left < a.right - 1
    && a.top < b.bottom - 1 && b.top < a.bottom - 1;
}

/** Nudge a label back onto the canvas, given the box its text will occupy. */
function clampOntoCanvas(at: ScreenPoint, anchor: LabelAnchor,
                         baseline: LabelBaseline, textWidth: number,
                         textHeight: number, width: number,
                         height: number): ScreenPoint {
  const left = anchor === "start" ? at.x
    : anchor === "end" ? at.x - textWidth : at.x - textWidth / 2;
  const top = baseline === "top" ? at.y
    : baseline === "bottom" ? at.y - textHeight : at.y - textHeight / 2;
  const dx = Math.min(0, width - EDGE_PAD - (left + textWidth))
    + Math.max(0, EDGE_PAD - left);
  const dy = Math.min(0, height - EDGE_PAD - (top + textHeight))
    + Math.max(0, EDGE_PAD - top);
  return { x: at.x + dx, y: at.y + dy };
}

/**
 * The whole frame of reference around a scene, at this camera, in pixels.
 *
 * Recomputed every frame on purpose. Which walls face away and which edge an
 * axis is labelled along both change continuously as the scene turns, and a
 * cached answer is a wall drawn over the data for half of a rotation — a
 * failure that looks like a rendering bug rather than like a stale value.
 */
export function axisFurniture(axes: Axes3D, camera: Camera,
                              width: number, height: number): Furniture {
  const specs: Record<Axis, AxisSpec> = { x: axes.x, y: axes.y, z: axes.z };
  const values: Record<Axis, number[]> = {
    x: niceTicks(axes.x.min, axes.x.max),
    y: niceTicks(axes.y.min, axes.y.max),
    z: niceTicks(axes.z.min, axes.z.max),
  };
  const texts: Record<Axis, string[]> = {
    x: formatTicks(values.x),
    y: formatTicks(values.y),
    z: formatTicks(values.z),
  };

  const at = (p: { x: number; y: number; z: number }) =>
    toCanvas(p, camera, width, height);
  const centre = at({ x: 0, y: 0, z: 0 });

  /** Where a data value sits along its axis of the unit cube. */
  const onCube = (axis: Axis, value: number): number => {
    const spec = specs[axis];
    const span = spec.max - spec.min;
    // The same answer `unitScale` gives a constant axis, for the same reason.
    if (!Number.isFinite(span) || span === 0) return 0;
    const t = ((value - spec.min) / span) * 2 - 1;
    return Math.max(-1, Math.min(1, t));
  };

  /**
   * Whether the wall fixing `axis` at `sign` faces away from the reader.
   *
   * A dot product against the view direction, which after the rotation is just
   * the sign of the normal's z — `project` documents z as toward the viewer.
   * Reasoning about which wall "should" be the floor does not survive a camera
   * that can pass through any orientation; this does.
   */
  const facesAway = (axis: Axis, sign: number): boolean => {
    const normal = { x: 0, y: 0, z: 0 };
    normal[axis] = sign;
    return rotate(normal, camera).z < 0;
  };

  const panes: Furniture["panes"] = [];
  const gridlines: Furniture["gridlines"] = [];

  for (const axis of AXIS_ORDER) {
    for (const sign of [-1, 1]) {
      if (!facesAway(axis, sign)) continue;
      const [across, along] = FREE_AXES[axis];
      const corner = (a: number, b: number) => {
        const p = { x: 0, y: 0, z: 0 };
        p[axis] = sign; p[across] = a; p[along] = b;
        return at(p);
      };
      panes.push({
        points: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
      });
      // The wall's own border. Without it a pane stops wherever the last tick
      // fell and reads as a wash rather than as a surface with an extent.
      gridlines.push({ a: corner(-1, -1), b: corner(1, -1) });
      gridlines.push({ a: corner(1, -1), b: corner(1, 1) });
      gridlines.push({ a: corner(1, 1), b: corner(-1, 1) });
      gridlines.push({ a: corner(-1, 1), b: corner(-1, -1) });
      /*
       * The lines that make the wall worth drawing: a value's height on one
       * axis carried across the scene to where that axis is labelled. Without
       * them the panes are decoration and the ticks are unreachable.
       */
      for (const value of values[across]) {
        const t = onCube(across, value);
        gridlines.push({ a: corner(t, -1), b: corner(t, 1) });
      }
      for (const value of values[along]) {
        const t = onCube(along, value);
        gridlines.push({ a: corner(-1, t), b: corner(1, t) });
      }
    }
  }

  const axisLines: Furniture["axisLines"] = [];
  const ticks: Furniture["ticks"] = [];
  const titles: Furniture["titles"] = [];
  /*
   * Every label already placed, from every axis.
   *
   * Kept because the collisions that actually happen are between axes, not
   * within one: two axes meet at a corner of the box and their end ticks land
   * within a few pixels of each other. Checking each axis against only its own
   * labels would pass and still produce the overlap.
   */
  const placed: LabelBox[] = [];

  for (const axis of AXIS_ORDER) {
    const [across, along] = FREE_AXES[axis];
    let chosen: {
      across: number; along: number; distance: number;
      from: ScreenPoint; to: ScreenPoint; out: ScreenPoint;
    } | null = null;

    /*
     * The silhouette first, every parallel edge second.
     *
     * A silhouette edge is one whose two walls disagree — one faces away, one
     * faces the reader — which is precisely the outline of the drawn box. An
     * edge between two back walls runs through the middle of the picture and
     * one between two front walls is hidden behind it, so either would put the
     * numbers on top of the data.
     *
     * The second pass exists because that test has no answer for a camera
     * looking straight down an axis. At yaw and pitch of exactly zero, four of
     * the six walls are edge-on — neither away nor toward — every pair agrees,
     * and the third axis was left with no line, no ticks and no title at all.
     * A degenerate view is the one a reader most needs told which direction
     * they have collapsed.
     */
    for (const relaxed of [false, true]) {
      if (chosen) break;
      for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        if (!relaxed && facesAway(across, a) === facesAway(along, b)) continue;
        const end = (t: number) => {
          const p = { x: 0, y: 0, z: 0 };
          p[axis] = t; p[across] = a; p[along] = b;
          return at(p);
        };
        const from = end(-1), to = end(1);
        const out = outwardNormal(from, to, centre);
        if (!out) continue;
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const distance = Math.hypot(mid.x - centre.x, mid.y - centre.y);
        const candidate = { across: a, along: b, distance, from, to, out };
        /*
         * Below the box, where an axis is read, whenever there is a clear
         * choice — the two silhouette edges of a near-horizontal axis have
         * roughly opposite normals, so one of them points down and that is the
         * one a reader expects the numbers on. Picking by distance alone put
         * the strike axis along the *top* rear edge of the box, above the
         * chart, with its title crossing the last tick.
         *
         * The margin matters. A near-vertical axis has both normals close to
         * horizontal, and a hair of difference between them is not a reason to
         * prefer either; there the tie falls through to distance, which puts
         * the labels on the outside of the silhouette.
         */
        if (!chosen) { chosen = candidate; continue; }
        const preferDown = out.y - chosen.out.y;
        if (preferDown > 0.25) { chosen = candidate; continue; }
        if (preferDown < -0.25) continue;
        if (distance > chosen.distance) chosen = candidate;
      }
      }
    }
    // Nothing left to label: every edge parallel to this axis projects to a
    // single point, which is a scene with no third dimension on screen.
    if (!chosen) continue;
    const edge = chosen;
    axisLines.push({ axis, a: edge.from, b: edge.to });

    const anchor: LabelAnchor = edge.out.x > 0.35 ? "start"
      : edge.out.x < -0.35 ? "end" : "middle";
    const baseline: LabelBaseline = edge.out.y > 0.35 ? "top"
      : edge.out.y < -0.35 ? "bottom" : "middle";

    /*
     * Where each of this axis's ticks would go, before anything is dropped.
     *
     * A tick is never *moved* to avoid a collision: a number moved off its
     * value is the one thing a tick may never be, and it would look correct.
     * So the only remedy is to draw fewer of them.
     */
    const wanted = values[axis].map((value, i) => {
      const p = { x: 0, y: 0, z: 0 };
      p[axis] = onCube(axis, value);
      p[across] = edge.across; p[along] = edge.along;
      const on = at(p);
      const text = texts[axis][i];
      const textWidth = estimateWidth(text, TICK_TYPE);
      const spot = clampOntoCanvas(
        { x: on.x + edge.out.x * TICK_GAP, y: on.y + edge.out.y * TICK_GAP },
        anchor, baseline, textWidth, TICK_LINE, width, height);
      return {
        text, at: spot, width: textWidth,
        box: boxOf(spot, anchor, baseline, textWidth, TICK_LINE),
      };
    });

    /*
     * Thinned by taking every second or every third value, never by keeping
     * whichever ones happened to fit.
     *
     * An axis seen nearly end-on crowds its labels, and dropping the
     * individual offenders leaves 20, 40, 60, 80 with 100 missing and 120
     * still there — a sequence a reader takes for an even one and reads
     * wrong. A stride keeps the axis regular, which is the property the
     * numbers are being read for.
     *
     * Both the stride and where it starts. Starting always at the first value
     * meant one label blocked at one end of an axis took the whole axis with
     * it: every stride kept the blocked tick, every set collided, and a
     * maturity axis spanning 229 pixels ended up with no numbers on it at all
     * because the y axis had already claimed the corner where its zero sat.
     * Offsetting by one keeps 0.5, 1.5, 2.5 — just as regular, and drawable.
     */
    let kept = wanted;
    let found = false;
    for (let stride = 1; !found && stride <= wanted.length; stride += 1) {
      for (let offset = 0; offset < stride; offset += 1) {
        const set = wanted.filter((_, i) => (i - offset) % stride === 0);
        const clear = set.every((tick, i) =>
          !placed.some((other) => overlaps(other, tick.box))
          && set.every((another, j) => j >= i
            || !overlaps(another.box, tick.box)));
        if (!clear) continue;
        kept = set;
        found = true;
        break;
      }
    }
    // No arrangement fits. The last one tried is a single label, and the guard
    // below drops even that if something already occupies the spot.
    if (!found) kept = wanted.slice(0, 1);

    // How far the tick text reaches along the outward normal, so the title can
    // clear the longest of them rather than the first.
    let reach = 0;
    for (const tick of kept) {
      // A last guard for the case no stride could fix: another axis's label
      // already occupies this spot, and two numbers on top of each other are
      // worth less than one.
      if (placed.some((other) => overlaps(other, tick.box))) continue;
      placed.push(tick.box);
      ticks.push({ axis, text: tick.text, at: tick.at, anchor, baseline });
      reach = Math.max(reach, Math.abs(edge.out.x) * tick.width
        + Math.abs(edge.out.y) * TICK_LINE);
    }

    const spec = specs[axis];
    const text = spec.unit ? `${spec.label} (${spec.unit})` : spec.label;
    const mid = {
      x: (edge.from.x + edge.to.x) / 2, y: (edge.from.y + edge.to.y) / 2,
    };
    /*
     * Turned only where the edge is steeper than it is wide. Horizontal text
     * beside a near-vertical axis needs a column of margin no canvas here has,
     * and text turned on a near-horizontal axis is harder to read for nothing.
     */
    const dx = edge.to.x - edge.from.x, dy = edge.to.y - edge.from.y;
    const steep = Math.abs(dy) > Math.abs(dx);
    let rotation = 0;
    if (steep) {
      rotation = Math.atan2(dy, dx);
      // Half a turn either way, so a title is never upside down.
      if (rotation > Math.PI / 2) rotation -= Math.PI;
      if (rotation < -Math.PI / 2) rotation += Math.PI;
    }
    const textWidth = estimateWidth(text, TITLE_TYPE);
    const textHeight = TITLE_TYPE * 1.25;
    /*
     * A turned title is centred on its point rather than hung off a baseline,
     * and pushed out by half a line to make up for it.
     *
     * The alternative was a bug that only a sweep found. "Below the baseline"
     * is sideways once the text is turned, so the box the collision test used
     * and the box the canvas painted were two different rectangles, and a
     * title crossed the tick reading 1.5 while every check said it was clear.
     * One box, in screen coordinates, for both.
     */
    const titleBaseline: LabelBaseline = steep ? "middle"
      : edge.out.y > 0.35 ? "top" : edge.out.y < -0.35 ? "bottom" : "middle";
    // Turning the text turns the box it needs: a title along a vertical axis
    // is one line tall and many wide, and occupies the transpose of that.
    const boxWidth = Math.abs(Math.cos(rotation)) * textWidth
      + Math.abs(Math.sin(rotation)) * textHeight;
    const boxHeight = Math.abs(Math.sin(rotation)) * textWidth
      + Math.abs(Math.cos(rotation)) * textHeight;
    /*
     * Pushed out until it is clear of every label already on the canvas.
     *
     * A title is centred on its edge and is usually wider than the span
     * between two ticks, so on a slanted edge its ends reach past the ticks
     * near the middle and meet the ones at the end — which is exactly what
     * happened to "NVDA strike price ($)" and the tick reading 180. Computing
     * a clearance from the geometry gets this right for one camera angle;
     * stepping out until the boxes no longer meet gets it right for all of
     * them, and costs at most a few comparisons against six labels.
     */
    let spot = mid;
    // The half line a centred turned title gives back, so it sits as far
    // outside the ticks as a hung one would.
    let gap = TICK_GAP + reach + TITLE_GAP + (steep ? textHeight / 2 : 0);
    let box = boxOf(spot, "middle", titleBaseline, boxWidth, boxHeight);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      spot = clampOntoCanvas(
        { x: mid.x + edge.out.x * gap, y: mid.y + edge.out.y * gap },
        "middle", titleBaseline, boxWidth, boxHeight, width, height);
      box = boxOf(spot, "middle", titleBaseline, boxWidth, boxHeight);
      if (!placed.some((other) => overlaps(other, box))) break;
      gap += 5;
    }
    placed.push(box);
    titles.push({
      axis, text, rotation, at: spot,
      anchor: "middle", baseline: titleBaseline,
    });
  }

  return { panes, gridlines, axisLines, ticks, titles };
}

/**
 * The family the page is set in, asked of the canvas rather than written down.
 *
 * A canvas is painted with literal values, so it cannot inherit a font the way
 * the rest of the interface does — but it can be asked what it inherited. The
 * fallback is for a context with no document behind it: an export, a worker,
 * a test.
 */
function fontFamilyOf(ctx: CanvasRenderingContext2D): string {
  try {
    const canvas = ctx.canvas;
    const view = canvas?.ownerDocument?.defaultView;
    const family = view?.getComputedStyle(canvas).fontFamily;
    if (family) return family;
  } catch {
    // Nothing to recover: the fallback below is the whole remedy.
  }
  return "system-ui, -apple-system, \"Segoe UI\", sans-serif";
}

/**
 * Paint the furniture, in the two passes the draw order requires.
 *
 * `stage` is the part of this that is not obvious and is not optional. The
 * walls and their gridlines belong **behind** the data — a pane painted after
 * the marks hides them, which is the whole reason the panes are the far walls
 * and not the near ones. The axis lines and every piece of text belong **over**
 * the data, because a label under an opaque surface cell is a label nobody
 * reads. So a chart calls this twice per frame:
 *
 *     drawFurniture(ctx, furniture, colours, 1, "behind");
 *     ...draw the marks...
 *     drawFurniture(ctx, furniture, colours, 1, "front");
 *
 * The default, `"all"`, is for a caller with nothing to put between the two —
 * an axis preview, a test, an empty scene.
 *
 * Colours are passed in rather than read here because only the caller knows
 * which element carries the theme. They are the page's own tokens: `line` is
 * `--line-strong`, `grid` is `--line`, `text` is `--ink-faint`, and `title` is
 * `--ink-soft`, each read with `getComputedStyle` so a reader who switches
 * theme with a figure on screen gets the palette for the page they are on.
 */
export function drawFurniture(
  ctx: CanvasRenderingContext2D,
  furniture: Furniture,
  colours: { line: string; grid: string; text: string; title?: string;
             ground?: string },
  scale = 1,
  stage: "behind" | "front" | "all" = "all",
): void {
  if (stage !== "front") {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.fillStyle = colours.grid;
    ctx.globalAlpha = PANE_ALPHA;
    for (const pane of furniture.panes) {
      if (pane.points.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(pane.points[0].x, pane.points[0].y);
      for (let i = 1; i < pane.points.length; i += 1) {
        ctx.lineTo(pane.points[i].x, pane.points[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colours.grid;
    ctx.lineWidth = 0.75 * scale;
    ctx.beginPath();
    for (const line of furniture.gridlines) {
      ctx.moveTo(line.a.x, line.a.y);
      ctx.lineTo(line.b.x, line.b.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (stage === "behind") return;

  const family = fontFamilyOf(ctx);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colours.line;
  ctx.lineWidth = 1.1 * scale;
  ctx.beginPath();
  for (const line of furniture.axisLines) {
    ctx.moveTo(line.a.x, line.a.y);
    ctx.lineTo(line.b.x, line.b.y);
  }
  ctx.stroke();

  // "middle" is this module's word for a centred label; the canvas calls the
  // same thing "center" horizontally and "middle" vertically.
  const align = (anchor: LabelAnchor): CanvasTextAlign =>
    anchor === "middle" ? "center" : anchor;

  /*
   * A halo in the page's own ground, drawn under every label.
   *
   * The furniture sits on the cube's edges and the marks fill the cube, so a
   * tall mark near an edge is drawn *behind* the label but *under* it on
   * screen — and `--ink-faint` was chosen to be quiet against the page, not
   * legible against a bar. Found by looking: on the light theme the value
   * axis read 50, 40, 30 clearly and then lost 20, 10 and 0 into the bars
   * standing in front of them.
   *
   * Stroked before filling rather than boxed behind, because a filled plate
   * would hide the data the label is standing on, and the point of putting
   * the text on top was never to conceal what it overlaps.
   */
  const halo = colours.ground;
  const withHalo = (text: string, x: number, y: number) => {
    if (halo) {
      ctx.strokeStyle = halo;
      ctx.lineWidth = HALO_WIDTH * scale;
      ctx.lineJoin = "round";
      ctx.strokeText(text, x, y);
    }
    ctx.fillText(text, x, y);
  };

  ctx.fillStyle = colours.text;
  ctx.font = `${TICK_TYPE * scale}px ${family}`;
  for (const tick of furniture.ticks) {
    ctx.textAlign = align(tick.anchor);
    ctx.textBaseline = tick.baseline;
    withHalo(tick.text, tick.at.x, tick.at.y);
  }

  // Weight, never bold. A title names a dimension; it is not a heading, and at
  // this size bold turns into a smear before it turns into emphasis.
  ctx.fillStyle = colours.title ?? colours.text;
  ctx.font = `${TITLE_WEIGHT} ${TITLE_TYPE * scale}px ${family}`;
  for (const title of furniture.titles) {
    ctx.save();
    ctx.translate(title.at.x, title.at.y);
    if (title.rotation) ctx.rotate(title.rotation);
    ctx.textAlign = align(title.anchor);
    ctx.textBaseline = title.baseline;
    withHalo(title.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
