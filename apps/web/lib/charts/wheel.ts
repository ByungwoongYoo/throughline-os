/**
 * What a wheel over a chart means (§10).
 *
 * A chart that zooms on a plain wheel traps a reader scrolling past it. On a
 * page with one figure that is a small annoyance; on a page with three stacked
 * charts it is a wall — the pointer is over a canvas for most of the page, so
 * scrolling zooms three charts in turn and never reaches the bottom. Found by
 * scrolling the gallery page and watching the citation network fly apart
 * instead of the page moving.
 *
 * So zoom is held behind a modifier, the way maps and embedded figures do it,
 * and a plain wheel is left alone to scroll the page. The cost is that zooming
 * is less discoverable, which is why every chart that uses this also offers
 * zoom through its controller — the gesture layer, the keyboard and the
 * on-screen controls all reach it without a wheel at all.
 */

/** Whether this wheel event is asking the chart to zoom, rather than the page
 * to scroll. Ctrl or ⌘ — ctrl is also what a trackpad pinch sends. */
export function isZoomWheel(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}

/**
 * How much to zoom for a wheel movement.
 *
 * Exponential in the distance, so a trackpad's many small events and a mouse
 * wheel's few large ones arrive at the same place for the same gesture, and
 * zooming out then in returns exactly where it began.
 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.pow(0.999, deltaY);
}
