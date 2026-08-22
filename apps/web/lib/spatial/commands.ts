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
  /** Turn the scene. Radians-equivalent deltas; the adapter decides the mapping. */
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
export interface VisualizationController {
  rotate(deltaX: number, deltaY: number): void;
  zoom(factor: number): void;
  pan(deltaX: number, deltaY: number): void;
  /** Nearest target within the adapter's tolerance, or null. */
  hover(at: ScreenPoint): TargetRef | null;
  select(at: ScreenPoint): TargetRef | null;
  selectRegion(at: ScreenPoint, radius: number): TargetRef[];
  focus(objectId: string): void;
  deselect(): void;
  resetView(): void;
  /** Pixel dimensions, so normalised hand coordinates can be mapped in. */
  viewport(): { width: number; height: number };
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
