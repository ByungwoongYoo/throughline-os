/**
 * Taking back what happened to the board (§4, §109).
 *
 * §109 lists undo among the Phase 0 essentials for a reason worth restating:
 * the cost of a mistake sets how freely somebody moves things, and a board
 * nobody rearranges is a diagram.
 *
 * These tests are mostly about the two rules that make undo confusing when they
 * are got wrong — that a new action discards the redo stack, and that undo
 * hands back the *inverse* rather than the original. Both are invisible until
 * somebody undoes three things, does a fourth, and watches the board rearrange
 * itself into a state that never existed.
 */

import { describe, expect, it } from "vitest";
import {
  BoardCommand, BoardHistory, Frame, describeCommand, invert,
} from "@/lib/board/history";

const HERE: Frame = { x: 100, y: 100, width: 200, height: 120 };
const THERE: Frame = { x: 400, y: 250, width: 200, height: 120 };

const moved: BoardCommand = {
  kind: "move", objectId: "obj1", from: HERE, to: THERE };

describe("a command run backwards", () => {
  it("moves a card back where it was", () => {
    expect(invert(moved)).toEqual({
      kind: "move", objectId: "obj1", from: THERE, to: HERE });
  });

  it("lowers a card that was raised", () => {
    expect(invert({ kind: "raise", objectId: "obj1", from: 0, to: 9 }))
      .toEqual({ kind: "raise", objectId: "obj1", from: 9, to: 0 });
  });

  it("takes off what was put on, and puts back what was taken", () => {
    /*
     * Two commands rather than one with a direction. They are different acts,
     * they read differently in a history, and a single toggling command would
     * make "undo" and "do the opposite" the same operation — which is how a
     * redo ends up deleting something.
     */
    const placed: BoardCommand = {
      kind: "place", objectId: "obj1", frame: HERE, z: 2 };
    expect(invert(placed).kind).toBe("remove");
    expect(invert(invert(placed)).kind).toBe("place");
  });

  it("returns to where it started when run twice", () => {
    // The property that matters more than any individual case: undo then redo
    // is the identity, whatever the command.
    const commands: BoardCommand[] = [
      moved,
      { kind: "raise", objectId: "o", from: 1, to: 4 },
      { kind: "place", objectId: "o", frame: HERE, z: 5 },
      { kind: "remove", objectId: "o", frame: THERE, z: 3 },
    ];
    for (const command of commands) {
      expect(invert(invert(command))).toEqual(command);
    }
  });
});

describe("stepping back and forward", () => {
  it("has nothing to undo to begin with", () => {
    const history = new BoardHistory();
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();
  });

  it("hands back the inverse, not the original", () => {
    /*
     * So a caller cannot apply the wrong direction by mistake. An undo that
     * returned the original would move the card *to* where it already is, and
     * the researcher would press it repeatedly while nothing happened.
     */
    const history = new BoardHistory();
    history.did(moved);
    expect(history.undo()).toEqual({
      kind: "move", objectId: "obj1", from: THERE, to: HERE });
  });

  it("hands back the original on redo", () => {
    const history = new BoardHistory();
    history.did(moved);
    history.undo();
    expect(history.redo()).toEqual(moved);
  });

  it("walks back through several steps in order", () => {
    const history = new BoardHistory();
    const first: BoardCommand = { kind: "raise", objectId: "a", from: 0, to: 1 };
    const second: BoardCommand = { kind: "raise", objectId: "b", from: 0, to: 2 };
    history.did(first);
    history.did(second);

    // The most recent first, which is what "undo" means.
    expect(history.undo()?.objectId).toBe("b");
    expect(history.undo()?.objectId).toBe("a");
    expect(history.canUndo()).toBe(false);
  });

  it("forgets the redo stack once something new is done", () => {
    /*
     * The rule that is invisible until it is missing. Once a new thing has been
     * done, the undone commands describe a board that no longer exists —
     * replaying them would move cards to positions computed against an
     * arrangement nobody is looking at any more.
     */
    const history = new BoardHistory();
    history.did(moved);
    history.undo();
    expect(history.canRedo()).toBe(true);

    history.did({ kind: "raise", objectId: "other", from: 0, to: 1 });
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeNull();
  });

  it("keeps a bounded number of steps", () => {
    // A session spent arranging a board produces a command per drag, and an
    // unbounded list is a slow leak nobody attributes to undo.
    const history = new BoardHistory({ depth: 3 });
    for (let i = 0; i < 10; i += 1) {
      history.did({ kind: "raise", objectId: `o${i}`, from: 0, to: i });
    }
    const seen: string[] = [];
    while (history.canUndo()) seen.push(history.undo()!.objectId);
    expect(seen).toEqual(["o9", "o8", "o7"]);
  });

  it("drops the oldest, not the newest, when it is full", () => {
    // Losing the step just taken would make undo useless exactly when the
    // history is deepest — which is when somebody is most likely to need it.
    const history = new BoardHistory({ depth: 2 });
    history.did({ kind: "raise", objectId: "old", from: 0, to: 1 });
    history.did({ kind: "raise", objectId: "mid", from: 0, to: 2 });
    history.did({ kind: "raise", objectId: "new", from: 0, to: 3 });
    expect(history.undo()?.objectId).toBe("new");
  });

  it("forgets everything when asked", () => {
    const history = new BoardHistory();
    history.did(moved);
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});

describe("saying what undo would do", () => {
  const titleOf = (id: string) => (id === "obj1" ? "Figure 2" : id);

  it("names the thing and the act", () => {
    /*
     * A button that does not say what it will take back is one people press
     * hopefully — and on a board that means pressing it repeatedly until
     * something recognisable returns.
     */
    expect(describeCommand(moved, titleOf)).toBe("Undo moving Figure 2");
    expect(describeCommand(
      { kind: "place", objectId: "obj1", frame: HERE, z: 0 }, titleOf))
      .toBe("Undo putting Figure 2 on the board");
  });

  it("says plainly when there is nothing to take back", () => {
    expect(describeCommand(null, titleOf)).toBe("Nothing to undo");
  });

  it("peeks without consuming", () => {
    const history = new BoardHistory();
    history.did(moved);
    expect(history.peek()).toEqual(moved);
    expect(history.canUndo()).toBe(true);
  });
});
