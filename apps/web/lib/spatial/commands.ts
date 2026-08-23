/**
 * The vocabulary every input speaks, and the surface every visualization
 * implements.
 *
 * This file is the reason the rest of the system can exist. A gesture engine
 * that calls `camera.rotateY()` on a particular renderer is a gesture engine
 * welded to that renderer — the second visualization technology arrives and the
 * whole interaction layer is rewritten, badly, under time pressure. So nothing
 * upstream of `VisualizationController` knows what is drawing.
 *
 * The same indirection is what lets a mouse, a trackpad, a keyboard, a hand, a
 * voice command and an AI instruction be the *same* thing to the visualization:
 * they are all just sources of `IntentCommand`. Adding voice later should mean
 * writing a producer of these commands, not touching the renderer at all.
 *
 * **Commands are deltas and screen coordinates, never absolute camera state.**
 * A gesture producing "set azimuth to 1.2 radians" would need to know the
 * current camera, which means knowing the renderer, which is the coupling this
 * file exists to prevent. Deltas compose, survive a dropped frame, and mean the
 * same thing to every adapter.
 */

/** A pointer position in the visualization's own pixel space. */
export type ScreenPoint = { x: number; y: number };

/**
 * Everything an input can ask a visualization to do.
 *
 * Deliberately small. Each entry earned its place by being something a
 * researcher does to a spatial dataset — turn it, get closer, look at that one,
 * put it back. A command per UI affordance would make this file a menu, and the
 * adapters unimplementable.
 */
export type IntentCommand =
  /**
   * Turn the scene, by a distance in **screen pixels of the target's viewport**.
   *
   * The units are stated because leaving them to "the adapter decides" is what
   * broke this. The producer worked in normalised image coordinates (0–1 across
   * the camera frame) and the consumer multiplied as though it had been handed a
   * pointer drag in pixels — so a brisk hand movement arrived as 0.026, became
   * 0.0002 radians, and the scene never moved by an amount anybody could see.
   * Both sides were tested and both were self-consistent; the *contract between
   * them* was the thing nobody checked.
   *
   * Pixels, specifically, because that is what every other positional quantity
   * here already is — `hover` and `select` carry `ScreenPoint`s in viewport
   * pixels — and because it is what a mouse drag natively produces. An input
   * that has to invent its own scale is an input that will invent a different
   * one from the next.
   */
  | { kind: "rotate"; deltaX: number; deltaY: number }
  /** Multiplicative scale delta. 1 is no change; the adapter clamps. */
  | { kind: "zoom"; factor: number }
  | { kind: "pan"; deltaX: number; deltaY: number }
  /** Move the pointer without committing to anything. */
  | { kind: "hover"; at: ScreenPoint }
  /** Commit to whatever is currently under the pointer. */
  | { kind: "select"; at: ScreenPoint }
  /**
   * Everything within `radius` of a point, rather than the nearest one.
   *
   * §25 describes pointing at a cluster. This product will not call it that —
   * `throughline_domain.selection` refuses the word, because nothing was fitted
   * and no test was run — but the underlying need is real: a researcher looking
   * at a region wants to ask about the region, not about whichever single point
   * happened to be closest to their finger.
   *
   * Deliberately **not** a new gesture. §9 and Rule 6 are explicit that a
   * gesture must earn its place, and this one would not: the same point-and-
   * pinch selects, and how much it gathers is a setting rather than a second
   * thing to learn.
   */
  | { kind: "selectRegion"; at: ScreenPoint; radius: number }
  | { kind: "focus"; objectId: string }
  | { kind: "deselect" }
  | { kind: "resetView" };

/**
 * What a visualization must provide to be driven by any input.
 *
 * `hover` and `select` return the object they resolved, or null. That return is
 * not a convenience: the gesture layer needs to know whether the researcher is
 * actually near a target so it can show the difference between "pointing at
 * nothing" and "pointing at something" — §7 — and it cannot know that without
 * asking the thing that owns the geometry.
 */
/**
 * A chart's view, as far as anything outside the chart is concerned.
 *
 * Compared with `sameView`, never inspected. Each chart chooses its own shape.
 */
export type ViewState = Readonly<Record<string, number>>;

/** Whether two snapshots describe the same view, within a tolerance. */
export function sameView(a: ViewState | null, b: ViewState | null,
                         tolerance = 1e-6): boolean {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key], right = b[key];
    if (left === undefined || right === undefined) return false;
    // Relative to the magnitude, so a zoom of 4 is not judged by the same
    // absolute slack as a pitch of 0.02.
    if (Math.abs(left - right) > tolerance * Math.max(1, Math.abs(left))) {
      return false;
    }
  }
  return true;
}

export interface VisualizationController {
  rotate(deltaX: number, deltaY: number): void;
  zoom(factor: number): void;
  pan(deltaX: number, deltaY: number): void;
  /** Nearest target within the adapter's tolerance, or null. */
  hover(at: ScreenPoint): TargetRef | null;
  select(at: ScreenPoint): TargetRef | null;
  selectRegion(at: ScreenPoint, radius: number): TargetRef[];
  /**
   * Every mark whose projected position falls inside a polygon.
   *
   * The chart answers this rather than a caller sampling the plane, and the
   * difference is accuracy rather than tidiness. Sampling walks a grid inside
   * the region and asks what is at each step, so a mark between two samples is
   * missed and the count is silently short — and that count is the number a
   * researcher reads, quotes, and hands to the assistant. The chart already
   * knows where each mark is; testing those positions against the polygon is
   * exact, and costs one test per observation rather than one per pixel.
   *
   * The polygon is in viewport pixels, like every other position in this seam.
   */
  withinPolygon(polygon: ScreenPoint[]): TargetRef[];
  focus(objectId: string): void;
  deselect(): void;
  resetView(): void;
  /** Pixel dimensions, so normalised hand coordinates can be mapped in. */
  viewport(): { width: number; height: number };
  /**
   * Where this chart is on the page, in client coordinates, or null if it
   * cannot be measured yet.
   *
   * Needed to answer "which figure is the hand addressing" (§189). `viewport`
   * gives the size a command is expressed in; this gives the position, and only
   * with both can a hand pointing at the second chart on a page reach it rather
   * than steering the first.
   *
   * Null rather than a zero rectangle when unmeasurable: a zero rectangle is a
   * real region that nothing is inside, and it would silently make the chart
   * unreachable instead of visibly unmounted.
   */
  bounds(): { x: number; y: number; width: number; height: number } | null;
  /**
   * An opaque snapshot of how the scene is currently being looked at.
   *
   * Opaque on purpose. The seam has no business knowing that a chart has a yaw
   * and a pitch — a map has a centre and a zoom, a timeline has a range — and a
   * seam that assumed three Euler angles would stop being usable the first time
   * a chart was not a 3D scatter. What every chart *can* answer is "is this the
   * same view as that one", and that is all the caller needs.
   *
   * It exists because ink is drawn in screen pixels and a screen loop over a 3D
   * scene has no data-space equivalent: rotate the scene and the marks move
   * while the annotation stays, so a circle that meant "these four" quietly
   * means nothing. §143 says never to treat every stroke merely as screen
   * pixels; for a 2D chart the answer is to store data coordinates, and for a
   * rotatable 3D one there is no honest conversion — so the annotation carries
   * the view it was drawn in and can say when that is no longer the view.
   */
  viewState(): ViewState;
  /** Return to a snapshot from `viewState`. Ignores one it does not recognise. */
  restoreViewState(state: ViewState): void;
}

/**
 * A thing in the visualization that a researcher can point at.
 *
 * Carries `datum` so a selection can become AI context (§26) without the
 * gesture layer knowing what a datum is. The AI layer reads it; the gesture
 * layer only ever passes it along.
 */
export type TargetRef = {
  id: string;
  label?: string;
  datum?: unknown;
};

/**
 * Apply a command to a controller.
 *
 * One place, so every input path goes through the same door and a new command
 * cannot be half-implemented by one producer. The exhaustiveness check is the
 * point: adding to `IntentCommand` without handling it here is a type error
 * rather than a command that silently does nothing at runtime — which is the
 * defect this codebase keeps finding in other forms.
 */
export function apply(controller: VisualizationController,
                      command: IntentCommand): TargetRef | TargetRef[] | null {
  switch (command.kind) {
    case "rotate":
      controller.rotate(command.deltaX, command.deltaY);
      return null;
    case "zoom":
      controller.zoom(command.factor);
      return null;
    case "pan":
      controller.pan(command.deltaX, command.deltaY);
      return null;
    case "hover":
      return controller.hover(command.at);
    case "select":
      return controller.select(command.at);
    case "selectRegion":
      return controller.selectRegion(command.at, command.radius);
    case "focus":
      controller.focus(command.objectId);
      return null;
    case "deselect":
      controller.deselect();
      return null;
    case "resetView":
      controller.resetView();
      return null;
    default: {
      const unreachable: never = command;
      throw new Error(`unhandled command: ${JSON.stringify(unreachable)}`);
    }
  }
}
