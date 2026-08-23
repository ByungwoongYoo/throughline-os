/**
 * Vectors sampled on a lattice (§9 fields).
 *
 * Twenty-six named visualizations are this one primitive: gradient fields,
 * fluid flow, wind, magnetic and electric fields, velocity, force, and — with
 * an ellipsoid in place of an arrow — tensor fields and diffusion tensors.
 *
 * **Preparing the field is separated from drawing it, and that is most of the
 * work.** A vector field drawn naively is the single most reliably unreadable
 * chart in scientific visualization: ten thousand arrows overlapping into a
 * grey mat, or nine hundred invisible ones beside a single outlier that owns
 * the entire scale. Both failures are decisions about *sampling and scaling*
 * rather than about rendering, so both are made here where they can be tested
 * without a canvas and stated to the reader in words.
 *
 * Three decisions, each of which the honest version of this chart has to admit
 * to rather than hide:
 *
 *   - **Decimation.** Above a few thousand arrows the picture is a texture, not
 *     a field. Samples are thinned on a stride so the survivors stay evenly
 *     spread — taking the first N would show a corner of the field and imply it
 *     was all of it — and the count that was dropped is reported.
 *   - **Length is clamped to the lattice spacing.** An arrow longer than the
 *     gap to its neighbour crosses it, and a field of crossing arrows reads as
 *     turbulence that is not in the data. Clamping loses magnitude at the top
 *     of the range, so magnitude is *also* carried by colour, which does not
 *     run out of room.
 *   - **Zero-length vectors are kept, not dropped.** A still point in a flow is
 *     a finding — a stagnation point, a null in a magnetic field — and dropping
 *     it because it has no direction to draw would erase exactly the feature a
 *     researcher is looking for.
 */

/** One sample: a position, and the vector measured there. */
export type Sample = {
  x: number; y: number; z: number;
  u: number; v: number; w: number;
};

/** A sample ready to draw: unit cube, with length and colour resolved. */
export type Glyph = {
  /** Where the tail sits, in the unit cube. */
  x: number; y: number; z: number;
  /** Where the head sits. Equal to the tail for a still point. */
  hx: number; hy: number; hz: number;
  /** The measured magnitude, before any clamping. */
  magnitude: number;
  /** Magnitude on 0..1 against the field's range, for colour. */
  level: number;
  /** Whether this arrow was shortened to fit its cell. */
  clamped: boolean;
};

export type Field = {
  glyphs: Glyph[];
  /** The measured range, so a legend can be honest about what colour means. */
  range: { min: number; max: number };
  /** How many samples were thinned away. */
  dropped: number;
  /** How many arrows hit the length clamp. */
  clamped: number;
  /** Samples refused because a component was not a finite number. */
  invalid: number;
};

export type FieldSettings = {
  /**
   * The most arrows to draw.
   *
   * Not a performance number. Past a few thousand the picture stops being a
   * field and becomes a texture, and the reader cannot follow any single
   * arrow — which is the only thing an arrow is for.
   */
  maxGlyphs: number;
  /**
   * The longest an arrow may be, as a fraction of the gap between samples.
   *
   * Below 1 an arrow cannot reach its neighbour's position. Above it, arrows
   * cross, and a field of crossing arrows reads as turbulence that is not in
   * the data.
   */
  reach: number;
};

export const DEFAULT_FIELD: FieldSettings = { maxGlyphs: 2000, reach: 0.9 };

/**
 * Turn measured samples into arrows that can be drawn.
 *
 * Positions are normalised per axis into the unit cube, matching every other
 * spatial chart here so the camera means the same thing in a field as in a
 * scatter. Vector *lengths* are not normalised per axis — a vector is a single
 * quantity with a direction, and stretching its components separately would
 * point it somewhere it does not point.
 */
export function prepareField(samples: Sample[],
                             settings: FieldSettings = DEFAULT_FIELD): Field {
  const finite = (n: number) => Number.isFinite(n);
  const usable = samples.filter(
    (s) => finite(s.x) && finite(s.y) && finite(s.z)
        && finite(s.u) && finite(s.v) && finite(s.w));
  const invalid = samples.length - usable.length;

  if (usable.length === 0) {
    return { glyphs: [], range: { min: 0, max: 0 }, dropped: 0, clamped: 0,
             invalid };
  }

  /*
   * Thinned on a stride rather than by taking the first N. A prefix is a corner
   * of the field presented as though it were the whole of it, which is not a
   * simplification but a different picture.
   */
  const stride = Math.max(1, Math.ceil(usable.length / settings.maxGlyphs));
  const kept = usable.filter((_, i) => i % stride === 0);
  const dropped = usable.length - kept.length;

  /*
   * Measured over every usable sample, not only the survivors of thinning.
   *
   * Normalised against the kept ones, a field thinned down to a corner would be
   * *stretched to fill the cube* and look exactly like the whole field — the
   * decimation would be undetectable in the picture. It also means that if a
   * stride happens to drop the extremes, the field does not silently expand to
   * take their place.
   */
  const spans = axisSpans(usable);
  const place = (value: number, axis: "x" | "y" | "z") => {
    const { min, span } = spans[axis];
    // A flat axis becomes the centre rather than NaN: a field sampled on a
    // plane is an ordinary case, not an error.
    return span > 1e-12 ? ((value - min) / span) - 0.5 : 0;
  };

  const magnitudes = kept.map((s) => Math.hypot(s.u, s.v, s.w));
  const max = Math.max(...magnitudes);
  const min = Math.min(...magnitudes);

  /*
   * Arrows are scaled against the 95th percentile, not the maximum.
   *
   * Against the maximum, one outlier owns the whole scale: a field with a
   * single vector a hundred times the rest draws that one at full length and
   * every other as a dot, which is a picture of the outlier rather than of the
   * field. Against a high percentile the bulk of the field is visible and the
   * few above it clamp — a bounded, reported loss at the top of the range
   * instead of an unbounded silent one across the middle.
   */
  const reference = percentile(magnitudes, 0.95);

  /*
   * The gap between neighbouring samples, in cube units. Estimated from the
   * count rather than by assuming a regular lattice: a field sampled on a
   * scatter of points has no spacing to read off, and the cube root of the
   * count is the spacing a regular lattice of that size would have had.
   */
  const spacing = 1 / Math.max(1, Math.cbrt(kept.length));
  const longest = spacing * settings.reach;

  let clamped = 0;
  const glyphs: Glyph[] = kept.map((s, i) => {
    const magnitude = magnitudes[i];
    const x = place(s.x, "x"), y = place(s.y, "y"), z = place(s.z, "z");
    /*
     * A ratio against the reference, which means a field whose vectors are all
     * tiny still fills the frame. The legend carries the absolute number,
     * because the arrows cannot.
     */
    const fraction = reference > 0 ? magnitude / reference : 0;
    let length = longest * fraction;
    let hit = false;
    if (length > longest) { length = longest; hit = true; clamped += 1; }

    // A zero vector has no direction; its head sits on its tail. Kept rather
    // than dropped — a stagnation point is a finding.
    const unit = magnitude > 0
      ? { u: s.u / magnitude, v: s.v / magnitude, w: s.w / magnitude }
      : { u: 0, v: 0, w: 0 };

    return {
      x, y, z,
      hx: x + unit.u * length,
      hy: y + unit.v * length,
      hz: z + unit.w * length,
      magnitude,
      level: max > min ? (magnitude - min) / (max - min) : 0,
      clamped: hit,
    };
  });

  return { glyphs, range: { min, max }, dropped, clamped, invalid };
}

/**
 * A percentile of a set of values.
 *
 * Nearest-rank, and deliberately not interpolated: the reference is a length
 * to scale arrows by, and a value that is actually in the data is easier to
 * defend than one between two of them.
 */
export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1,
                         Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function axisSpans(samples: Sample[]) {
  const of = (axis: "x" | "y" | "z") => {
    let lo = Infinity, hi = -Infinity;
    for (const s of samples) { lo = Math.min(lo, s[axis]); hi = Math.max(hi, s[axis]); }
    return { min: lo, span: hi - lo };
  };
  return { x: of("x"), y: of("y"), z: of("z") };
}

/**
 * Sample a vector function on a regular lattice.
 *
 * For the analytic members of the family — a gradient field, a Jacobian, an
 * electric field around a charge — where there are no measurements, only a
 * formula the researcher wants to see the shape of.
 */
export function sampleFunction(
  fn: (x: number, y: number, z: number) => [number, number, number],
  steps = 6,
  bounds: { min: number; max: number } = { min: -1, max: 1 },
): Sample[] {
  const out: Sample[] = [];
  // At least two steps per axis, or "a lattice" is one point and the field has
  // no extent at all.
  const n = Math.max(2, Math.floor(steps));
  const at = (i: number) =>
    bounds.min + ((bounds.max - bounds.min) * i) / (n - 1);

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let k = 0; k < n; k += 1) {
        const x = at(i), y = at(j), z = at(k);
        const [u, v, w] = fn(x, y, z);
        out.push({ x, y, z, u, v, w });
      }
    }
  }
  return out;
}

/**
 * What the field says about itself, including what it could not show.
 *
 * Thinning and clamping are both losses, and a reader who does not know a
 * field was decimated will read the sparseness as the measurement. §10's
 * requirement that a spatial chart admit what depth costs it applies at least
 * as much to what sampling costs it.
 */
export function describeField(field: Field): string {
  if (field.glyphs.length === 0) return "No vectors to draw.";

  const n = field.glyphs.length;
  let text = `${n} vector${n === 1 ? "" : "s"}, `
           + `magnitude ${format(field.range.min)} to ${format(field.range.max)}.`;
  if (field.dropped > 0) {
    text += ` ${field.dropped} more sampled away to keep the arrows readable;`
          + " the field is denser than it looks.";
  }
  if (field.clamped > 0) {
    text += ` ${field.clamped} arrow${field.clamped === 1 ? " is" : "s are"}`
          + " shortened to fit — read those by colour.";
  }
  if (field.invalid > 0) {
    text += ` ${field.invalid} sample${field.invalid === 1 ? "" : "s"} could`
          + " not be read.";
  }
  return text;
}

function format(value: number): string {
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1000 || magnitude < 0.01) return value.toExponential(1);
  return value.toFixed(2).replace(/\.?0+$/, "");
}
