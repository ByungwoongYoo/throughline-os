/**
 * Where things are on the board, and where they appear on screen (§4, §109).
 *
 * §109 calls the workboard Phase 0 and says *mouse first* — "if mouse
 * architecture is bad, gesture will amplify the problem." That warning is the
 * reason this file exists before anything visible does: every object on the
 * board, every drag, every hit test and eventually every hand pointed at it
 * resolves through this transform, so an error here is an error everywhere and
 * it will look like a dozen unrelated bugs.
 *
 * **Objects live in world coordinates and the camera moves.** The alternative —
 * storing where things appear on screen — is the same mistake the PDF reader
 * would have made by storing marks in pixels: a position that means nothing at
 * any other zoom, on any other window, to any other person. A board saved on a
 * laptop must open on a monitor with everything in the same relation.
 *
 * **The pan area is unlimited and the zoom is not.** §4 asks for a "virtually
 * unlimited pan area", which costs nothing because panning is subtraction. Zoom
 * is bounded in both directions for a reason a limit reads as arbitrary until
 * you hit it: past a certain point the numbers stop being representable at the
 * precision a drag needs, and a researcher who zooms out far enough to lose
 * their work has been given an infinity they never wanted.
 */

/** A position on the board itself. Saved, shared, and stable forever. */
export type WorldPoint = { x: number; y: number };

/** A position in the canvas's own pixels. Derived, never stored. */
export type ScreenPoint = { x: number; y: number };

/**
 * What part of the board is being looked at.
 *
 * `x` and `y` are the world point shown at the canvas's top-left corner, and
 * `zoom` is screen pixels per world unit. Expressed as a corner rather than a
 * centre because the corner is what the arithmetic needs; a centre reads more
 * naturally and turns every conversion into two operations instead of one,
 * which is exactly the kind of small tax that eventually gets paid wrongly.
 */
export type Camera = { x: number; y: number; zoom: number };

/** Comfortably closer than reading distance, and far enough to see a project. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

export const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };

/** Zoom clamped, and never NaN. */
export function clampZoom(zoom: number): number {
  // NaN fails both comparisons, so it is caught explicitly rather than falling
  // through to a camera that renders nothing and reports no error.
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function toScreen(point: WorldPoint, camera: Camera): ScreenPoint {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  };
}

export function toWorld(point: ScreenPoint, camera: Camera): WorldPoint {
  return {
    x: point.x / camera.zoom + camera.x,
    y: point.y / camera.zoom + camera.y,
  };
}

/**
 * Move the board under the pointer by a screen-space delta.
 *
 * Divided by zoom, which is the whole of it: a drag of forty pixels should move
 * the board forty pixels whatever the zoom, and that means moving it by forty
 * *screen* units, which is fewer world units when zoomed in. Without the
 * division the board lurches when zoomed and crawls when zoomed out, and the
 * complaint that arrives is "dragging feels wrong", which is unactionable.
 */
export function pan(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom };
}

/**
 * Zoom while keeping one screen point fixed.
 *
 * The point under the cursor must not move. This is the difference between
 * zooming that feels like leaning in and zooming that feels like the board
 * sliding away, and it is almost always got wrong by zooming about the origin
 * or about the centre of the viewport instead.
 *
 * The arithmetic: hold the world point currently under `at`, apply the new
 * zoom, then choose the camera position that puts that same world point back
 * under `at`.
 */
export function zoomAt(camera: Camera, at: ScreenPoint, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  /*
   * The same camera, not an equal one, when the zoom cannot change.
   *
   * A wheel at the limit fires dozens of events that would otherwise each
   * allocate a new object and invalidate every consumer comparing by reference
   * — so the board re-renders continuously while nothing moves.
   *
   * An earlier comment here claimed this prevented positional drift. It does
   * not: measured over ten thousand clamped events the error is around 1e-13
   * world units, because the anchor arithmetic is exactly self-inverse when the
   * zoom is unchanged. Mutation testing removed this line and every test still
   * passed, which is how the false claim was found.
   */
  if (zoom === camera.zoom) return camera;

  const anchor = toWorld(at, camera);
  return {
    zoom,
    x: anchor.x - at.x / zoom,
    y: anchor.y - at.y / zoom,
  };
}

/** A rectangle on the board. */
export type WorldRect = { x: number; y: number; width: number; height: number };

/** What the camera can currently see, in world coordinates. */
export function visibleRect(camera: Camera,
                            viewport: { width: number; height: number }): WorldRect {
  return {
    x: camera.x,
    y: camera.y,
    width: viewport.width / camera.zoom,
    height: viewport.height / camera.zoom,
  };
}

/**
 * Whether a rectangle is worth drawing.
 *
 * A board holds everything a project ever put on it, and drawing all of it at
 * every frame is how a canvas becomes unusable at exactly the moment a
 * researcher has enough on it to care. Generous by a margin so an object being
 * dragged in from off-screen appears before its edge does.
 */
export function isVisible(rect: WorldRect, camera: Camera,
                          viewport: { width: number; height: number },
                          margin = 200): boolean {
  const view = visibleRect(camera, viewport);
  const slack = margin / camera.zoom;
  return rect.x + rect.width >= view.x - slack
      && rect.x <= view.x + view.width + slack
      && rect.y + rect.height >= view.y - slack
      && rect.y <= view.y + view.height + slack;
}

/**
 * A camera that shows everything, with room around it.
 *
 * What "fit to contents" and "where did my work go" both need. Returns the
 * origin for an empty board rather than a camera derived from infinities.
 */
export function fitTo(rects: readonly WorldRect[],
                      viewport: { width: number; height: number },
                      padding = 80): Camera {
  if (rects.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return ORIGIN;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rect of rects) {
    if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) continue;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!Number.isFinite(minX)) return ORIGIN;

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const zoom = clampZoom(Math.min(
    (viewport.width - padding * 2) / width,
    (viewport.height - padding * 2) / height,
  ));

  // Centred: the remaining space is split rather than left on one side, which
  // is what makes "fit" look deliberate instead of merely sufficient.
  return {
    zoom,
    x: minX - (viewport.width / zoom - width) / 2,
    y: minY - (viewport.height / zoom - height) / 2,
  };
}

/** Whether a world point is inside a rectangle. Edges count as inside. */
export function hits(point: WorldPoint, rect: WorldRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width
      && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/**
 * The topmost rectangle under a point, or nothing.
 *
 * Last wins, because later entries are drawn on top — the same rule the paper
 * eraser uses, and for the same reason: taking the one underneath removes
 * something the researcher cannot see at the place they pointed.
 */
export function topmostAt<T extends { rect: WorldRect }>(
  point: WorldPoint, items: readonly T[],
): T | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (hits(point, items[i].rect)) return items[i];
  }
  return null;
}
