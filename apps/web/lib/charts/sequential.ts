/**
 * A sequential colour scale that survives being read.
 *
 * The ad-hoc ramp this replaces went blue to orange by mixing channels
 * linearly. That is the default mistake in scientific colour: the eye reads
 * lightness far more reliably than hue, and a ramp whose lightness wanders
 * puts bright bands in the middle of the data that look like structure. The
 * classic case is the rainbow, which invents boundaries where the numbers are
 * smooth — and the reason viridis exists.
 *
 * These are viridis's control points. It is used here for the two properties
 * that matter and are not aesthetic:
 *
 * **Lightness increases monotonically.** Every step up in value is a step up
 * in perceived lightness, so the ordering survives greyscale printing, a bad
 * projector, and a reader with any of the common colour deficiencies. A ramp
 * that only orders by hue does not.
 *
 * **No band is brighter than its neighbours.** There is no ridge for the eye
 * to catch on, so apparent structure in the picture is structure in the data.
 *
 * Interpolated in sRGB between the published stops rather than in a perceptual
 * space, which is a small approximation: the stops are close enough together
 * that the error is well under a just-noticeable difference, and doing it
 * properly would mean shipping a colour-space conversion for a gain nobody
 * can see.
 */

/** Viridis, sampled at eleven points. */
const VIRIDIS: Array<[number, number, number]> = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142],
  [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89],
  [180, 222, 44], [253, 231, 37], [253, 231, 37],
];

/** A value in 0..1 as an `rgb(...)` colour. */
export function sequential(level: number): string {
  const [r, g, b] = sequentialChannels(level);
  return `rgb(${r},${g},${b})`;
}

export function sequentialChannels(level: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  const last = VIRIDIS.length - 2;
  const scaled = t * last;
  const index = Math.min(last, Math.floor(scaled));
  const within = scaled - index;
  const from = VIRIDIS[index];
  const to = VIRIDIS[index + 1];
  return [
    Math.round(from[0] + (to[0] - from[0]) * within),
    Math.round(from[1] + (to[1] - from[1]) * within),
    Math.round(from[2] + (to[2] - from[2]) * within),
  ];
}

/**
 * Perceived lightness, for the guard that keeps the ramp monotonic.
 *
 * Rec. 709 luma. Not a perceptual space, and it does not need to be: what is
 * being checked is that lightness never goes *down*, and every reasonable
 * measure agrees about direction even where they disagree about magnitude.
 */
export function luma([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
