/**
 * Ordered paths through space (§9 lines).
 *
 * Seventeen named visualizations are this one primitive: planetary and
 * satellite orbits, flight paths, spacecraft and asteroid trajectories, robot
 * arm motion, neural pathways, blood vessel networks, a training trajectory
 * through parameter space, the research timeline tunnel, and — the one that
 * needs integrating rather than reading — streamlines through a vector field.
 *
 * **A gap in the data breaks the line; it never bridges it.** This is the
 * decision the whole file is built around. A satellite track with a dropout,
 * or a trajectory whose solver diverged for a hundred steps, arrives as a
 * sequence with holes in it. Skipping the missing points and joining what
 * remains draws a straight chord across the gap — a smooth, plausible,
 * confident line through territory the object was never observed in. Nothing
 * about the picture says it is an artefact, and it is the exact shape a reader
 * interprets as "it went that way". So a run of missing points ends one
 * polyline and starts another, and the count of breaks is reported.
 *
 * **Simplification preserves shape, not spacing.** A trajectory of a hundred
 * thousand points has to be thinned, and thinning it on a stride is wrong here
 * in a way it was not for a scatter: every nth point cuts corners, and the
 * corners are the data. An orbit's periapsis, the sharp turn where a robot arm
 * reverses, the spike in a sensor trace — those are exactly the samples a
 * stride is most likely to drop, because they are single extreme points among
 * many ordinary ones. Ramer–Douglas–Peucker keeps whatever is far from the
 * straight line and discards only what lies along it, so the survivors are the
 * shape rather than a uniform sample of it.
 */

/** One sample along a path. `t` orders it, where the caller has a clock. */
export type PathPoint = { x: number; y: number; z: number; t?: number };

/** A path as the caller knows it. Positions are measured, never invented. */
export type Path = {
  id: string;
  label?: string;
  /** Groups colour — a constellation, a patient, a run. */
  group?: string;
  points: PathPoint[];
  /** Whether the last point joins the first. An orbit is closed; a flight is not. */
  closed?: boolean;
};

/** A path placed in the unit cube, split wherever the data was missing. */
export type Polyline = {
  id: string;
  label?: string;
  group?: string;
  closed: boolean;
  /**
   * Contiguous runs of points, in order.
   *
   * More than one run means the data had a hole in it. They are kept apart
   * rather than concatenated, because the join would be a line nobody
   * measured.
   */
  runs: Array<Array<{ x: number; y: number; z: number }>>;
};

/** The two numbers an axis was scaled by, in the caller's own units. */
export type Extent = { min: number; max: number };

export type Paths = {
  lines: Polyline[];
  /**
   * The extent every path was scaled against, per axis, before normalisation.
   *
   * One extent over all the paths, which is the decision `preparePaths`
   * already documents: two orbits scaled separately would each fill the cube
   * and look the same size. It is handed out so an axis can be labelled from
   * the numbers the drawing used rather than from a second sweep, which is a
   * mismatch nothing in the picture could reveal.
   */
  domain: { x: Extent; y: Extent; z: Extent };
  /** How many times a path was broken by missing data. */
  breaks: number;
  /** Points that were not finite, and so were not drawn. */
  missing: number;
  /** Points removed by simplification. */
  simplified: number;
  /** Paths with fewer than two usable points: reported, never drawn as lines. */
  degenerate: string[];
};

export type PathSettings = {
  /**
   * How far a point may sit from the straight line before it must be kept,
   * as a fraction of the cube's width.
   *
   * Zero disables simplification entirely. The default is roughly half a pixel
   * at a typical figure size, so what is discarded is what could not have been
   * distinguished on screen anyway.
   */
  tolerance: number;
  /** The most points to keep across all paths, after simplification. */
  maxPoints: number;
};

export const DEFAULT_PATHS: PathSettings = {
  tolerance: 0.0015,
  maxPoints: 40000,
};

/**
 * Turn measured paths into polylines that can be drawn.
 *
 * Positions are normalised per axis into the unit cube −1..1, matching
 * `unitScale` and therefore every other spatial chart here, so the camera means
 * the same thing in a trajectory as in a scatter.
 *
 * **Normalised across all paths together, never each to its own extent.** Two
 * orbits scaled separately would each fill the cube and look the same size,
 * which is precisely the comparison a reader is making when two trajectories
 * are drawn in one frame.
 */
export function preparePaths(paths: Path[],
                             settings: PathSettings = DEFAULT_PATHS): Paths {
  const finite = (p: PathPoint) =>
    Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

  let missing = 0;
  for (const path of paths) {
    for (const point of path.points) if (!finite(point)) missing += 1;
  }

  const span = extent(paths, finite);
  const place = (value: number, axis: "x" | "y" | "z") => {
    const { min, size } = span[axis];
    // A flat axis becomes the centre rather than NaN — a planar orbit, or a
    // trajectory through two parameters, is an ordinary case rather than an
    // error.
    return size > 1e-12 ? (((value - min) / size) * 2) - 1 : 0;
  };

  const lines: Polyline[] = [];
  const degenerate: string[] = [];
  let breaks = 0;
  let simplified = 0;

  for (const path of paths) {
    /*
     * Split on the missing points rather than filtering them out. A filtered
     * sequence is continuous and wrong; a split one has a visible hole, which
     * is what the data actually says.
     */
    const runs: Array<Array<{ x: number; y: number; z: number }>> = [];
    let run: Array<{ x: number; y: number; z: number }> = [];
    for (const point of path.points) {
      if (!finite(point)) {
        if (run.length > 0) { runs.push(run); run = []; }
        continue;
      }
      run.push({ x: place(point.x, "x"), y: place(point.y, "y"),
                 z: place(point.z, "z") });
    }
    if (run.length > 0) runs.push(run);

    // A run of one point is a position, not a path. Kept out of the line list
    // so the renderer never has to ask what direction a single point goes in.
    const usable = runs.filter((r) => r.length >= 2);
    breaks += Math.max(0, usable.length - 1);

    if (usable.length === 0) { degenerate.push(path.id); continue; }

    const kept = usable.map((r) => {
      if (settings.tolerance <= 0) return r;
      const out = simplify(r, settings.tolerance);
      simplified += r.length - out.length;
      return out;
    });

    lines.push({
      id: path.id,
      label: path.label,
      group: path.group,
      // A path broken into several runs cannot be closed: the join would cross
      // the very gap that broke it.
      closed: (path.closed ?? false) && kept.length === 1,
      runs: kept,
    });
  }

  // Read off the same sweep `place` used. A set of paths with no finite point
  // has no extent to report, and zero to zero is the domain `niceTicks` and
  // `unitScale` both already treat as a single value rather than a range.
  const reach = (axis: "x" | "y" | "z"): Extent => {
    const { min, size } = span[axis];
    return Number.isFinite(min) && Number.isFinite(size)
      ? { min, max: min + size } : { min: 0, max: 0 };
  };

  return { lines: thin(lines, settings.maxPoints),
           domain: { x: reach("x"), y: reach("y"), z: reach("z") },
           breaks, missing, simplified, degenerate };
}

function extent(paths: Path[], finite: (p: PathPoint) => boolean) {
  const of = (axis: "x" | "y" | "z") => {
    let min = Infinity, max = -Infinity;
    for (const path of paths) {
      for (const point of path.points) {
        if (!finite(point)) continue;
        const v = point[axis];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return { min, size: max - min };
  };
  return { x: of("x"), y: of("y"), z: of("z") };
}

/**
 * Ramer–Douglas–Peucker, in three dimensions.
 *
 * Iterative rather than recursive: a hundred-thousand-point trajectory
 * recurses deeper than the stack allows, and the failure is a RangeError from
 * inside a geometry routine — which reads as anything except a length limit.
 */
export function simplify(points: Array<{ x: number; y: number; z: number }>,
                         tolerance: number): Array<{ x: number; y: number; z: number }> {
  if (points.length <= 2 || tolerance <= 0) return points;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = 0;
    let at = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = distanceToSegment(points[i], points[first], points[last]);
      if (d > worst) { worst = d; at = i; }
    }
    // Strictly greater, so a tolerance of exactly the deviation discards it:
    // the point is on the line to within what the reader was told to expect.
    if (at !== -1 && worst > tolerance) {
      keep[at] = true;
      stack.push([first, at], [at, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Distance from a point to a *segment*, not to the infinite line.
 *
 * Clamped to the endpoints. Against the infinite line, a point beyond the end
 * of a segment measures as near it, so a trajectory that doubles back on
 * itself has its turn discarded as though it lay along the path.
 */
function distanceToSegment(p: { x: number; y: number; z: number },
                           a: { x: number; y: number; z: number },
                           b: { x: number; y: number; z: number }): number {
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const wx = p.x - a.x, wy = p.y - a.y, wz = p.z - a.z;
  const vv = vx * vx + vy * vy + vz * vz;
  // A zero-length segment is a point; the distance is to that point.
  const t = vv > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / vv)) : 0;
  return Math.hypot(wx - t * vx, wy - t * vy, wz - t * vz);
}

/**
 * Thin the whole set down to a budget, if simplification left it too large.
 *
 * Applied across paths in proportion rather than to each equally: a set holding
 * one dense trajectory and twenty short ones should lose points from the dense
 * one. Every path keeps its ends whatever the budget.
 */
function thin(lines: Polyline[], maxPoints: number): Polyline[] {
  const total = lines.reduce(
    (n, l) => n + l.runs.reduce((m, r) => m + r.length, 0), 0);
  if (total <= maxPoints || total === 0) return lines;

  const factor = maxPoints / total;
  return lines.map((line) => ({
    ...line,
    runs: line.runs.map((run) => {
      const budget = Math.max(2, Math.floor(run.length * factor));
      if (budget >= run.length) return run;
      const step = run.length / budget;
      const out: typeof run = [];
      for (let i = 0; i < budget; i += 1) out.push(run[Math.floor(i * step)]);
      // The last point is kept explicitly: an orbit thinned to a stride that
      // does not divide its length would otherwise stop short of closing.
      out[out.length - 1] = run[run.length - 1];
      return out;
    }),
  }));
}

/**
 * What the paths say about themselves, including what could not be drawn.
 *
 * The breaks are the part worth stating in words. A reader looking at a track
 * with a hole in it cannot tell, from the picture alone, whether the object
 * stopped being observed or stopped moving.
 */
export function describePaths(paths: Paths): string {
  const n = paths.lines.length;
  if (n === 0 && paths.degenerate.length === 0) return "No paths to draw.";
  if (n === 0) {
    return `Nothing to draw: ${paths.degenerate.length} path`
         + `${paths.degenerate.length === 1 ? " has" : "s have"} fewer than two`
         + " measured points.";
  }

  const points = paths.lines.reduce(
    (m, l) => m + l.runs.reduce((k, r) => k + r.length, 0), 0);
  let text = `${n} path${n === 1 ? "" : "s"}, `
           + `${points.toLocaleString()} points.`;

  if (paths.breaks > 0) {
    text += ` ${paths.breaks} gap${paths.breaks === 1 ? "" : "s"} where`
          + " measurements are missing — the line stops rather than crossing"
          + " ground nothing was recorded on.";
  }
  if (paths.missing > 0) {
    text += ` ${paths.missing.toLocaleString()} point`
          + `${paths.missing === 1 ? "" : "s"} could not be read.`;
  }
  if (paths.simplified > 0) {
    text += ` ${paths.simplified.toLocaleString()} points lie along the line`
          + " and are not drawn separately; the shape is unchanged.";
  }
  if (paths.degenerate.length > 0) {
    text += ` ${paths.degenerate.length} path`
          + `${paths.degenerate.length === 1 ? "" : "s"} had too few points`
          + " to draw.";
  }
  return text;
}

/* ---- streamlines ------------------------------------------------------- */

export type StreamSettings = {
  /** How far each integration step moves, in cube units. */
  step: number;
  /** The most steps before a line is stopped regardless. */
  maxSteps: number;
  /**
   * Below this speed the line is stopped.
   *
   * A stagnation point is a fixed point of the integration: without this, the
   * solver takes ten thousand steps that go nowhere and draws a dot at the end
   * of a line, having spent the whole budget arriving at it.
   */
  minSpeed: number;
};

export const DEFAULT_STREAM: StreamSettings = {
  step: 0.02,
  maxSteps: 600,
  minSpeed: 1e-4,
};

/** Why a streamline stopped, so the picture can say rather than imply. */
export type StreamEnd = "left the field" | "stalled" | "ran out of steps";

export type Streamline = {
  points: Array<{ x: number; y: number; z: number }>;
  ended: StreamEnd;
};

/**
 * Integrate a path through a vector field.
 *
 * Fourth-order Runge–Kutta rather than Euler, and the reason is visible in the
 * picture rather than academic: Euler turns a circular flow into an outward
 * spiral, because every step leaves the curve along its tangent and never
 * comes back. A reader shown that spiral sees a source that is not in the data.
 *
 * `velocityAt` returns null outside the field. A sampler that instead returned
 * zero would leave every line stalled at the boundary and indistinguishable
 * from a real stagnation point.
 */
export function streamline(
  velocityAt: (x: number, y: number, z: number)
    => { u: number; v: number; w: number } | null,
  seed: { x: number; y: number; z: number },
  settings: StreamSettings = DEFAULT_STREAM,
): Streamline {
  const points = [{ ...seed }];
  let at = { ...seed };
  let ended: StreamEnd = "ran out of steps";

  for (let n = 0; n < settings.maxSteps; n += 1) {
    const k1 = velocityAt(at.x, at.y, at.z);
    if (!k1) { ended = "left the field"; break; }
    if (Math.hypot(k1.u, k1.v, k1.w) < settings.minSpeed) {
      ended = "stalled";
      break;
    }

    const h = settings.step;
    // Normalised so the step is a distance rather than a time: a field whose
    // magnitudes are 1e6 would otherwise leave the cube in one step, and one
    // whose magnitudes are 1e-6 would never move.
    const unit = (k: { u: number; v: number; w: number }) => {
      const m = Math.hypot(k.u, k.v, k.w);
      return m > 0 ? { u: k.u / m, v: k.v / m, w: k.w / m }
                   : { u: 0, v: 0, w: 0 };
    };
    const a = unit(k1);
    const k2 = velocityAt(at.x + a.u * h / 2, at.y + a.v * h / 2, at.z + a.w * h / 2);
    if (!k2) { ended = "left the field"; break; }
    const b = unit(k2);
    const k3 = velocityAt(at.x + b.u * h / 2, at.y + b.v * h / 2, at.z + b.w * h / 2);
    if (!k3) { ended = "left the field"; break; }
    const c = unit(k3);
    const k4 = velocityAt(at.x + c.u * h, at.y + c.v * h, at.z + c.w * h);
    if (!k4) { ended = "left the field"; break; }
    const d = unit(k4);

    at = {
      x: at.x + (h / 6) * (a.u + 2 * b.u + 2 * c.u + d.u),
      y: at.y + (h / 6) * (a.v + 2 * b.v + 2 * c.v + d.v),
      z: at.z + (h / 6) * (a.w + 2 * b.w + 2 * c.w + d.w),
    };
    points.push({ ...at });
  }

  return { points, ended };
}

/**
 * A sampler over scattered measurements, for fields that are not a formula.
 *
 * Nearest neighbour, and it is worth being plain that this makes the field
 * piecewise constant: an integration through it is only ever as smooth as the
 * sampling, and RK4's accuracy is wasted on a discontinuous field. It is the
 * honest default for scattered data, where there is no lattice to interpolate
 * along. A caller with a formula should pass the formula.
 */
export function nearestSampler(
  samples: Array<{ x: number; y: number; z: number; u: number; v: number; w: number }>,
  radius = 0.25,
) {
  return (x: number, y: number, z: number) => {
    let best = null as null | typeof samples[0];
    let bestGap = radius;
    for (const s of samples) {
      const gap = Math.hypot(s.x - x, s.y - y, s.z - z);
      if (gap > bestGap) continue;
      bestGap = gap;
      best = s;
    }
    // Outside the sampled region there is no measurement, and saying so is what
    // lets a line stop at the boundary rather than stall on an invented zero.
    return best ? { u: best.u, v: best.v, w: best.w } : null;
  };
}
