/**
 * A researcher can take back a move on the board.
 *
 * `lib/board/history.ts` is a careful piece of work: every command records
 * where a thing *was* as well as where it went, `invert` is total so the
 * compiler refuses a new command kind without an inverse, and
 * `describeCommand` exists so a control can say "Undo moving Figure 2" rather
 * than "Undo". It has its own test file and a hundred lines of reasoning.
 *
 * Nothing imported it. `Board.tsx` — eight hundred lines, the surface §4 calls
 * the central one — had no undo at all, and the module was reachable only from
 * its own test. Built and unreachable, which is the defect this codebase finds
 * more often than any other.
 *
 * Removal was already recoverable through "Put back", so this covers the
 * action that was not: moving a card, which is the thing a researcher does
 * every few seconds and could not take back.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Board, Placement } from "@/components/board/Board";

const CARDS: Placement[] = [
  { id: "plc1", object_id: "obj1", x: 100, y: 100, width: 200, height: 120,
    z: 0, object_type: "analysis", title: "Sleep and reaction time",
    status: "complete" },
  { id: "plc2", object_id: "obj2", x: 500, y: 300, width: 200, height: 120,
    z: 1, object_type: "figure", title: "Figure 2", status: "complete" },
];

function detailResponse(url: string): Response | null {
  if (url.includes("/impact")) {
    return new Response(JSON.stringify({
      object_id: "obj1", dependent_artifacts: 0, by_type: {},
      findings_losing_evidence: 0, artifacts: [],
    }), { status: 200 });
  }
  if (url.includes("/mentions")) return new Response("[]", { status: 200 });
  return null;
}

function mockApi() {
  const put = vi.fn((body: Record<string, unknown>) => body);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      put(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }
    return detailResponse(String(url))
      ?? new Response(JSON.stringify({ placements: CARDS }), { status: 200 });
  }));
  return { put };
}

afterEach(() => { vi.unstubAllGlobals(); });

async function card(objectId: string) {
  return await waitFor(() => {
    const found = document.querySelector(`[data-object="${objectId}"]`);
    if (!found) throw new Error(`no card for ${objectId}`);
    return found as HTMLElement;
  });
}

async function dragBy(objectId: string, dx: number, dy: number) {
  const target = await card(objectId);
  fireEvent.pointerDown(target, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(target, { clientX: dx, clientY: dy, pointerId: 1 });
  fireEvent.pointerUp(target, { clientX: dx, clientY: dy, pointerId: 1 });
}

describe("undoing work on the board", () => {
  it("offers nothing to undo on a board nobody has touched", async () => {
    mockApi();
    render(<Board projectId="prj_1" />);
    await card("obj1");
    expect(screen.getByRole("button", { name: /nothing to undo/i }))
      .toBeDisabled();
  });

  it("says what it would take back, by name", async () => {
    /** "Undo" alone is a button people press hopefully, and on a board that
     *  means pressing it until something recognisable comes back. */
    const { put } = mockApi();
    render(<Board projectId="prj_1" />);
    await dragBy("obj1", 90, 60);
    await waitFor(() => expect(put).toHaveBeenCalled());

    expect(await screen.findByRole(
      "button", { name: /undo moving Sleep and reaction time/i })).toBeTruthy();
  });

  it("puts the card back where it was", async () => {
    const { put } = mockApi();
    render(<Board projectId="prj_1" />);
    await dragBy("obj1", 90, 60);
    await waitFor(() => expect(put).toHaveBeenCalled());
    const moved = put.mock.calls.at(-1)![0];
    expect(moved.x).not.toBe(100);

    fireEvent.click(screen.getByRole("button", { name: /undo moving/i }));

    await waitFor(() => {
      const back = put.mock.calls.at(-1)![0];
      expect(back.object_id).toBe("obj1");
      expect(back.x).toBe(100);
      expect(back.y).toBe(100);
    });
  });

  it("can be redone after it is undone", async () => {
    const { put } = mockApi();
    render(<Board projectId="prj_1" />);
    await dragBy("obj1", 90, 60);
    await waitFor(() => expect(put).toHaveBeenCalled());
    const moved = put.mock.calls.at(-1)![0];

    fireEvent.click(screen.getByRole("button", { name: /undo moving/i }));
    await waitFor(() => expect(put.mock.calls.at(-1)![0].x).toBe(100));

    fireEvent.click(screen.getByRole("button", { name: /redo/i }));
    await waitFor(() => {
      const again = put.mock.calls.at(-1)![0];
      expect(again.x).toBe(moved.x);
      expect(again.y).toBe(moved.y);
    });
  });
});
