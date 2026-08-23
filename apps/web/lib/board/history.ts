/**
 * Taking back what happened to the board (§4, §109).
 *
 * §109 lists undo among the Phase 0 essentials, beside the object model and the
 * command layer, and the ordering is not an accident: a surface where every
 * action is immediate and permanent is one a researcher arranges carefully and
 * then stops touching. The cost of a mistake sets how freely somebody moves
 * things, and a board nobody rearranges is a diagram.
 *
 * **A command describes the change, not the result.** Each one carries where a
 * thing was as well as where it went, so undoing is applying the same
 * description backwards rather than restoring a snapshot. Snapshots of a board
 * would be simpler and would quietly grow with the board, and two researchers
 * moving different cards would each undo the other's work by restoring a
 * picture taken before it.
 *
 * **Nothing here talks to the server.** The history says what to do; the caller
 * does it and persists it. That keeps every rule about ordering, depth and what
 * clears the redo stack checkable without a network, which is where the
 * confusing bugs in undo actually live.
 */

/** What a card looked like, for the parts a command can change. */
export type Frame = { x: number; y: number; width: number; height: number };

/**
 * Something that happened to the board.
 *
 * `place` and `remove` are deliberately separate rather than one command with a
 * direction: they are different acts, they read differently in a history, and
 * a single toggling command would make "undo" and "do the opposite" the same
 * operation — which is exactly the confusion that lets a redo delete something.
 */
export type BoardCommand =
  | { kind: "move"; objectId: string; from: Frame; to: Frame }
  | { kind: "raise"; objectId: string; from: number; to: number }
  | { kind: "place"; objectId: string; frame: Frame; z: number }
  | { kind: "remove"; objectId: string; frame: Frame; z: number };

/**
 * The same change, backwards.
 *
 * Total rather than partial: every command has an inverse, and the compiler
 * checks that a new kind cannot be added without one. An undo that silently
 * did nothing for an unhandled case would be worse than an error — the
 * researcher presses undo, the board does not move, and nothing says why.
 */
export function invert(command: BoardCommand): BoardCommand {
  switch (command.kind) {
    case "move":
      return { kind: "move", objectId: command.objectId,
               from: command.to, to: command.from };
    case "raise":
      return { kind: "raise", objectId: command.objectId,
               from: command.to, to: command.from };
    case "place":
      return { kind: "remove", objectId: command.objectId,
               frame: command.frame, z: command.z };
    case "remove":
      /*
       * The depth travels with the placement, and it was not carried at first.
       * A card removed from depth three, undone and redone came back at zero —
       * so taking something off the board and putting it back sent it behind
       * everything it had been in front of. The round-trip property test caught
       * it: inverting twice must be the identity, and it was not.
       */
      return { kind: "place", objectId: command.objectId,
               frame: command.frame, z: command.z };
  }
}

/** How many steps back a researcher can go. */
export type HistoryLimits = { depth: number };

/*
 * Deep enough that nobody reaches the end while recovering from a mistake,
 * which is the only moment the depth is noticed. Bounded because a session
 * spent arranging a board produces a command per drag, and an unbounded list
 * of them is a slow leak nobody attributes to undo.
 */
const DEFAULT_LIMITS: HistoryLimits = { depth: 200 };

export class BoardHistory {
  private done: BoardCommand[] = [];
  private undone: BoardCommand[] = [];
  private limits: HistoryLimits;

  constructor(limits: Partial<HistoryLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /**
   * Record something that just happened.
   *
   * Clears the redo stack. Once a new thing has been done, the commands that
   * were undone describe a board that no longer exists — replaying them would
   * move cards to positions that were computed against an arrangement nobody
   * is looking at any more.
   */
  did(command: BoardCommand): void {
    this.done.push(command);
    if (this.done.length > this.limits.depth) this.done.shift();
    this.undone = [];
  }

  canUndo(): boolean { return this.done.length > 0; }
  canRedo(): boolean { return this.undone.length > 0; }

  /**
   * The change to apply to go back one step, or nothing.
   *
   * Returns the *inverse* rather than the original, so a caller cannot apply
   * the wrong direction by mistake. The original is what is kept for redo.
   */
  undo(): BoardCommand | null {
    const command = this.done.pop();
    if (!command) return null;
    this.undone.push(command);
    return invert(command);
  }

  /** The change to apply to go forward again, or nothing. */
  redo(): BoardCommand | null {
    const command = this.undone.pop();
    if (!command) return null;
    this.done.push(command);
    return command;
  }

  /** What undoing would do, for a control that should say so. */
  peek(): BoardCommand | null {
    return this.done.length ? this.done[this.done.length - 1] : null;
  }

  /** Everything forgotten. For opening a different project's board. */
  clear(): void {
    this.done = [];
    this.undone = [];
  }
}

/**
 * What a command did, in words a researcher would use.
 *
 * So an undo control can say "Undo moving Figure 2" rather than "Undo". A
 * button that does not say what it will take back is one people press
 * hopefully, and on a board that means pressing it repeatedly until something
 * recognisable returns.
 */
export function describeCommand(command: BoardCommand | null,
                                titleOf: (objectId: string) => string): string {
  if (!command) return "Nothing to undo";
  const title = titleOf(command.objectId);
  switch (command.kind) {
    case "move": return `Undo moving ${title}`;
    case "raise": return `Undo raising ${title}`;
    case "place": return `Undo putting ${title} on the board`;
    case "remove": return `Undo taking ${title} off the board`;
  }
}
