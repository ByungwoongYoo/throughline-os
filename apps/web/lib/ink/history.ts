/**
 * Taking things back (§42, §179).
 *
 * The specification calls undo mandatory and gives the reason rather than
 * leaving it as a convention: "spatial interaction dramatically increases
 * accidental-action risk". That is not a general observation about software. A
 * mouse click is a decision made with a finger resting on a button; a pinch is a
 * decision made by a hand that is also being used to gesture while talking, in
 * a room, with a camera guessing at the boundary between the two. The rate at
 * which somebody does something they did not mean is simply higher, and the
 * remedy is that everything can be undone rather than that nothing is
 * misrecognised.
 *
 * **This covers the destructive action that actually exists.** Rotating is
 * reversible by rotating back, selecting changes nothing, and a stroke can be
 * removed — but *Clear* discards every annotation on the canvas at once and,
 * until now, permanently. Forty marks made over twenty minutes, gone to one
 * misplaced press, with the interface offering nothing. Building undo for the
 * camera instead would have moved a requirement to "done" while leaving the one
 * genuinely irreversible thing exactly as it was.
 *
 * **Nothing is reconstructed.** An undone clear returns *the same stroke
 * objects*, not strokes rebuilt from a description of them. A history that
 * re-derives what it discarded will eventually re-derive it slightly
 * differently, and the researcher gets back something that resembles their
 * annotation — which is worse than losing it, because they will not notice.
 *
 * **Undo is synchronous and local** (§179). No network, no await, nothing that
 * can fail. An undo that might not work is not an undo.
 */

import { SpatialStroke } from "./stroke";

/**
 * Something that happened and can be taken back.
 *
 * Deliberately concrete rather than a pair of closures. An operation that
 * carries its own inverse as a function is impossible to inspect, so nothing can
 * say "undo clearing 12 strokes" — and an undo that will not tell you what it is
 * about to undo is a gamble rather than a control.
 */
export type InkOperation =
  | { kind: "draw"; stroke: SpatialStroke }
  | { kind: "erase"; stroke: SpatialStroke; index: number }
  /**
   * One pass of the eraser, start to finish (§178).
   *
   * Holds the whole canvas either side rather than the strokes that changed.
   * That is deliberately the blunt version: a pass can remove strokes, split
   * one into two, and split another into three, and reversing that by splicing
   * fragments back at remembered indices is arithmetic with several ways to be
   * subtly wrong. Two lists of references cost almost nothing and are exactly
   * reversible — and exactness is the property that matters, because an undo
   * that *nearly* restores a figure is one nobody notices is wrong.
   *
   * One operation per pass, not per frame: a wipe is a single thing the
   * researcher did, and undoing it a frame at a time would be unusable.
   */
  | { kind: "rub"; before: SpatialStroke[]; after: SpatialStroke[] }
  /** A shape offer the researcher accepted (§181). Reversible like anything. */
  | { kind: "tidy"; before: SpatialStroke; after: SpatialStroke }
  | { kind: "clear"; strokes: SpatialStroke[] };

export type HistoryLimits = {
  /**
   * How many operations are kept.
   *
   * Bounded because the strokes themselves are held: an unbounded history of a
   * long session keeps every mark ever drawn alive in memory, including the ones
   * cleared an hour ago. Deep enough that nobody reaches the end while trying to
   * recover from a mistake, which is the only moment the depth matters.
   */
  depth: number;
};

export const DEFAULT_LIMITS: HistoryLimits = { depth: 100 };

export class InkHistory {
  private done: InkOperation[] = [];
  private undone: InkOperation[] = [];
  private limits: HistoryLimits;

  constructor(limits: Partial<HistoryLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /**
   * Record something that just happened.
   *
   * Clears the redo stack, which is the conventional behaviour and worth saying
   * why it is right here: once a new mark exists, the operations that were
   * undone describe a canvas that no longer exists, and replaying them would
   * put strokes back at indices that now mean something else.
   */
  did(operation: InkOperation): void {
    this.done.push(operation);
    if (this.done.length > this.limits.depth) this.done.shift();
    this.undone = [];
  }

  canUndo(): boolean { return this.done.length > 0; }
  canRedo(): boolean { return this.undone.length > 0; }

  /** The operation to reverse, moved onto the redo stack. */
  undo(): InkOperation | null {
    const operation = this.done.pop();
    if (!operation) return null;
    this.undone.push(operation);
    return operation;
  }

  /** The operation to reapply, moved back onto the undo stack. */
  redo(): InkOperation | null {
    const operation = this.undone.pop();
    if (!operation) return null;
    this.done.push(operation);
    return operation;
  }

  /** What undo would do, in the researcher's terms rather than the machine's. */
  describeUndo(): string | null {
    return describe(this.done[this.done.length - 1] ?? null, "Undo");
  }

  describeRedo(): string | null {
    return describe(this.undone[this.undone.length - 1] ?? null, "Redo");
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }

  /**
   * Take on another history wholesale.
   *
   * For the one case where the recorder is replaced mid-session — a change of
   * stabilisation level. Both stacks move, because carrying only the undo stack
   * would leave a researcher who had just undone something unable to redo it,
   * for a reason they could not possibly connect to the slider they moved.
   */
  adoptFrom(other: InkHistory): void {
    this.done = [...other.done];
    this.undone = [...other.undone];
  }
}

function describe(operation: InkOperation | null, verb: string): string | null {
  if (!operation) return null;
  switch (operation.kind) {
    case "draw":
      return `${verb} drawing a stroke`;
    case "erase":
      return `${verb} removing a stroke`;
    case "rub": {
      // What the pass actually did, counted from the difference rather than
      // from the size of the canvas — "erasing across 12 strokes" when eleven
      // were untouched would be a number that misdescribes the action.
      const after = new Set(operation.after.map((s) => s.id));
      const touched = operation.before.filter((s) => !after.has(s.id)).length;
      return touched === 1
        ? `${verb} erasing part of a stroke`
        : `${verb} erasing across ${touched} strokes`;
    }
    case "tidy":
      return `${verb} tidying into ${operation.after.interpretation?.kind
                                     ?? "a shape"}`;
    case "clear":
      // The count is the point. "Undo clear" is not a decision anybody can
      // make; "Undo clearing 12 strokes" is.
      return operation.strokes.length === 1
        ? `${verb} clearing 1 stroke`
        : `${verb} clearing ${operation.strokes.length} strokes`;
  }
}

/**
 * Apply an operation to a list of strokes, or reverse it.
 *
 * Kept apart from the recorder so it can be reasoned about on its own: this is
 * the arithmetic of undo, and the recorder is a state machine with a camera
 * attached. Returns a new array rather than mutating, so an operation cannot
 * half-apply and leave the canvas in a state no sequence of actions could reach.
 */
export function applyOperation(strokes: readonly SpatialStroke[],
                               operation: InkOperation,
                               direction: "do" | "undo"): SpatialStroke[] {
  const forward = direction === "do";
  switch (operation.kind) {
    case "draw":
      return forward
        ? [...strokes, operation.stroke]
        : strokes.filter((s) => s.id !== operation.stroke.id);
    case "erase": {
      if (forward) return strokes.filter((s) => s.id !== operation.stroke.id);
      // Put back where it was, not on the end. Order is draw order, and a
      // restored stroke on top would paint over marks that were above it.
      const next = [...strokes];
      next.splice(Math.min(operation.index, next.length), 0, operation.stroke);
      return next;
    }
    case "rub":
      // The canvas as it was, or as it became. The same objects in the same
      // order, so an undone erasure is the figure that was there and not a
      // near-miss of it.
      return forward ? [...operation.after] : [...operation.before];
    case "tidy": {
      const from = forward ? operation.before : operation.after;
      const to = forward ? operation.after : operation.before;
      // Swapped in place, so a tidied mark stays where it was in the drawing
      // order rather than jumping on top of everything drawn since.
      return strokes.map((s) => (s.id === from.id ? to : s));
    }
    case "clear":
      // The same objects, in the same order. Nothing is rebuilt.
      return forward ? [] : [...operation.strokes];
  }
}
