/**
 * A spatial chart answers a keyboard, and says what it is.
 *
 * Seven charts on this page rotate. All seven listened for `pointerdown`;
 * **one** listened for a key. Six had no `tabIndex`, so Tab could not reach
 * them, and five had no label, so a screen reader met an unannotated canvas —
 * which is to say a blank.
 *
 * That is D127 again, one family over. The fix there was for lists that
 * selected a row from `onClick` with nothing focusable inside, and it was
 * guarded by asking every component the question rather than the five known
 * files. The guard asked about `onClick`, and a drag is not a click, so the
 * whole spatial family sat outside it. `spatial-charts-answer-keys.test.ts`
 * now asks the drag question the same way.
 *
 * **Why this is worse here than it looks.** Rotation is not a convenience on
 * these charts, it is the depth cue: motion parallax is the strongest signal a
 * flat screen has for which mark is in front, and §10 only tolerates three
 * dimensions where depth is carrying real information. A reader who cannot
 * rotate is not looking at a slightly less convenient 3D chart. They are
 * looking at one flat projection of a tangle, permanently — which is the
 * picture §10 exists to forbid.
 *
 * One hook rather than six copies of the globe's handler, because six copies
 * are six chances for the step sizes to drift apart, and a reader who learns
 * that Left turns the network expects Left to turn the volume by the same
 * amount.
 */

import { useCallback } from "react";

/**
 * Degrees-equivalent of drag per key press.
 *
 * `rotateCamera` takes pixels of drag, so a key press is expressed as the drag
 * it stands for. Twelve is about a fifteenth of a turn: coarse enough that a
 * reader gets somewhere without holding the key down, fine enough to line up
 * on a feature. The same number as the globe's, deliberately.
 */
export const KEY_STEP = 12;

/** Zoom per press, matching the wheel's feel rather than a rounder number. */
export const KEY_ZOOM = 1.15;

export type SpatialControls = {
  rotate: (dx: number, dy: number) => void;
  zoom?: (factor: number) => void;
  reset?: () => void;
};

/**
 * Props for a rotatable canvas: focusable, labelled, and driven by keys.
 *
 * Spread onto the `<canvas>`. It deliberately does **not** supply the pointer
 * handlers — those already exist in each chart and differ in what they select
 * or hit-test, and a hook that took them over would be a refactor of six
 * working things in order to fix a seventh missing one.
 *
 * `role="img"` with a label, rather than `application` or a bare canvas. The
 * canvas is a picture; what a screen reader needs first is what the picture
 * shows and that it can be turned, which is what the label carries.
 */
export function useSpatialKeys(controls: SpatialControls, label: string) {
  const { rotate, zoom, reset } = controls;

  const onKeyDown = useCallback((event: {
    key: string; preventDefault: () => void;
  }) => {
    switch (event.key) {
      case "ArrowLeft": rotate(-KEY_STEP, 0); break;
      case "ArrowRight": rotate(KEY_STEP, 0); break;
      case "ArrowUp": rotate(0, -KEY_STEP); break;
      case "ArrowDown": rotate(0, KEY_STEP); break;
      case "+": case "=": zoom?.(KEY_ZOOM); break;
      case "-": case "_": zoom?.(1 / KEY_ZOOM); break;
      case "Home": reset?.(); break;
      default: return;   // every other key belongs to the page
    }
    event.preventDefault();
  }, [rotate, zoom, reset]);

  return {
    /*
     * The class is part of the fix, not decoration. Adding `tabIndex` to a
     * canvas that has no focus style makes it focusable and invisible when
     * focused, which is a worse state than before — a keyboard reader tabs
     * into a chart with nothing to say they are in it. `.chart-canvas` already
     * carries the grab cursor and the focus ring for the two charts that had
     * it; this puts every rotatable canvas on the same rule rather than
     * leaving six of them to be remembered individually.
     */
    className: "chart-canvas spatial",
    tabIndex: 0,
    role: "img" as const,
    "aria-label": `${label} ${describeKeys(zoom, reset)}`,
    onKeyDown,
  };
}

/**
 * The sentence that tells a reader the keys exist.
 *
 * Written from what was actually wired rather than from a fixed string: a
 * chart with no zoom that advertises one sends somebody pressing a key that
 * does nothing, and an instruction that is wrong is worse than absent.
 */
function describeKeys(zoom?: unknown, reset?: unknown): string {
  const parts = ["Arrow keys rotate"];
  if (zoom) parts.push("plus and minus zoom");
  if (reset) parts.push("Home resets the view");
  return `${parts.join(", ")}.`;
}
