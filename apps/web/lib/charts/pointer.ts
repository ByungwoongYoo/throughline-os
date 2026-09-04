/**
 * Where a pointer landed, in the coordinates a chart draws in.
 *
 * A spatial chart draws in its design size — `toCanvas(node, camera, width,
 * height)` — while the canvas element is laid out at whatever width the page
 * gives it. Those are the same number only when the figure happens to be shown
 * at full size. Everywhere else a click read in screen pixels lands somewhere
 * else in the scene, and the failure is quiet: a node *is* selected, just not
 * the one under the cursor. Nothing errors, and the researcher concludes the
 * hit-testing is vague.
 *
 * The figure digitiser learned this the same way and states it in its own
 * words: clicks are recorded in the image's coordinates, not the screen's.
 * This is that rule for the charts.
 */

export type Point = { x: number; y: number };

/**
 * A pointer event in the chart's own coordinate space.
 *
 * `width` and `height` are the design size the chart draws in — the same
 * numbers it hands to `toCanvas` — not the element's rendered size.
 */
export function canvasPoint(
  event: { clientX: number; clientY: number },
  element: Element,
  width: number,
  height: number,
): Point {
  const box = element.getBoundingClientRect();
  // A zero-sized box means the element is not laid out yet. Scaling by zero
  // would put every click at the origin, which reads as "the chart always
  // selects the same node".
  if (!box.width || !box.height) {
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }
  return {
    x: (event.clientX - box.left) * (width / box.width),
    y: (event.clientY - box.top) * (height / box.height),
  };
}

/**
 * How far a pointer may travel and still count as a click.
 *
 * These canvases rotate on drag, so every selection begins as a gesture that
 * could become a rotation. Too small and a hand that moves three pixels
 * selects nothing; too large and a deliberate nudge of the camera also picks
 * a node. Four pixels is about the width of a fingertip's tremor on a mouse.
 */
export const CLICK_SLOP = 4;

/** Whether a press and release are close enough together to mean a click. */
export function isClick(from: Point | null, to: Point,
                        slop = CLICK_SLOP): boolean {
  if (!from) return false;
  return Math.hypot(to.x - from.x, to.y - from.y) <= slop;
}
