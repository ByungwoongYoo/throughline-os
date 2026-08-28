/**
 * The workboard's behaviour (§4, §109).
 *
 * The geometry underneath is proved separately and exhaustively, so these tests
 * are about the things composition can still get wrong: that a drag is a drag
 * and a click is a click, that the server hears once rather than per pointer
 * event, and that a failed save puts the card back instead of leaving a
 * researcher believing they moved something.
 *
 * happy-dom lays nothing out, so a real drag distance in pixels cannot be
 * measured here. What can be checked is every decision the component makes
 * *given* a pointer position, which is where the bugs in this kind of code
 * actually are.
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

function mockApi(placements: Placement[] = CARDS) {
  const put = vi.fn((body: Record<string, unknown>) => body);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      put(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }
    return new Response(JSON.stringify({ placements }), { status: 200 });
  }));
  return { put };
}

afterEach(() => { vi.unstubAllGlobals(); });

/** A card element, once the board has loaded. */
async function card(objectId: string) {
  return await waitFor(() => {
    const found = document.querySelector(`[data-object="${objectId}"]`);
    if (!found) throw new Error(`no card for ${objectId}`);
    return found as HTMLElement;
  });
}

describe("what the board shows", () => {
  it("draws a card for everything placed on it", async () => {
    mockApi();
    render(<Board projectId="prj1" />);
    expect(await screen.findByText("Sleep and reaction time")).toBeInTheDocument();
    expect(screen.getByText("Figure 2")).toBeInTheDocument();
  });

  it("says what each card is and what state it is in", async () => {
    // A board of untitled rectangles is a diagram. The type and status are
    // what let somebody scan it rather than open everything.
    mockApi();
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");
    expect(screen.getByText("analysis")).toBeInTheDocument();
    expect(screen.getByText("figure")).toBeInTheDocument();
  });

  it("lays cards out at their world position", async () => {
    /*
     * Position comes from the card's own coordinates and the plane is
     * transformed as a whole — so panning and zooming are one compositor
     * operation rather than a style recalculation per card.
     */
    mockApi();
    render(<Board projectId="prj1" />);
    const first = await card("obj1");
    expect(first.style.left).toBe("100px");
    expect(first.style.top).toBe("100px");
  });

  it("offers a way back when a board is empty", async () => {
    // An empty surface with no words on it reads as a page that failed to
    // load rather than a board waiting to be used.
    mockApi([]);
    render(<Board projectId="prj1" />);
    expect(await screen.findByText(/nothing on the board yet/i))
      .toBeInTheDocument();
  });
});

describe("moving a card", () => {
  it("saves once, on release, rather than per pointer event", async () => {
    /*
     * A request per pointermove would put a network round trip inside the drag
     * loop, which is how a board becomes something you fight rather than
     * something you arrange.
     */
    const { put } = mockApi();
    render(<Board projectId="prj1" />);
    const target = await card("obj1");

    fireEvent.pointerDown(target, { clientX: 0, clientY: 0, pointerId: 1 });
    for (let i = 1; i <= 20; i += 1) {
      fireEvent.pointerMove(target, { clientX: i * 10, clientY: i * 5, pointerId: 1 });
    }
    expect(put).not.toHaveBeenCalled();

    fireEvent.pointerUp(target, { clientX: 200, clientY: 100, pointerId: 1 });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  });

  it("sends the card's own identity and size, not just a position", async () => {
    // The endpoint is an upsert keyed by object, so a move that omitted the
    // size would silently resize the card to whatever the caller last sent.
    const { put } = mockApi();
    render(<Board projectId="prj1" />);
    const target = await card("obj1");

    fireEvent.pointerDown(target, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 90, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 90, clientY: 60, pointerId: 1 });

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0]).toMatchObject({
      object_id: "obj1", width: 200, height: 120,
    });
  });

  it("puts the card back when the move cannot be saved", async () => {
    /*
     * A card a researcher believes they moved, which returns to where it was
     * on reload, is worse than one that refused to move — the board would be
     * quietly lying about the arrangement of their work.
     */
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ detail: "no" }), { status: 400 });
      }
      return new Response(JSON.stringify({ placements: CARDS }), { status: 200 });
    }));

    render(<Board projectId="prj1" />);
    const target = await card("obj1");
    fireEvent.pointerDown(target, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 120, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 120, clientY: 80, pointerId: 1 });

    expect(await screen.findByText(/could not be saved/i)).toBeInTheDocument();
    await waitFor(async () => {
      expect((await card("obj1")).style.left).toBe("100px");
    });
  });
});

describe("a click is not a drag", () => {
  it("raises a card that was pressed and released in place", async () => {
    /*
     * A press raises. It now also opens the card beside the board, which it
     * could not do while nothing in this workspace showed a research object on
     * its own — the comment here used to say so, and a callback the host
     * cannot satisfy would have been dead surface.
     *
     * Raising stays, because it is what a board is for: cards overlap, and the
     * one pressed is the one meant. This test is about the raise; the opening
     * is covered below.
     */
    const raised: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/front")) {
        raised.push(String(url));
        return new Response(JSON.stringify({ z: 9 }), { status: 200 });
      }
      return new Response(JSON.stringify({ placements: CARDS }), { status: 200 });
    }));

    render(<Board projectId="prj1" />);
    const target = await card("obj1");
    fireEvent.pointerDown(target, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 40, clientY: 40, pointerId: 1 });

    await waitFor(() => expect(raised).toHaveLength(1));
    expect(raised[0]).toContain("/board/obj1/front");
  });

  it("still counts as a press when the hand wobbled a pixel", async () => {
    /*
     * The case the threshold actually exists for, and the one the first version
     * of these tests missed entirely: a real click carries a pixel or two of
     * jitter, so a click with no pointermove at all is not a click anybody
     * performs. Without the threshold that jitter makes every click a
     * one-pixel drag — the card is not raised, and the non-move is saved.
     *
     * A mutation removing the threshold survived until this existed.
     */
    const { put } = mockApi();
    render(<Board projectId="prj1" />);
    const target = await card("obj1");

    fireEvent.pointerDown(target, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 41, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 41, clientY: 40, pointerId: 1 });

    // Not saved as a move. Whether it raised is the previous test's business.
    expect(put).not.toHaveBeenCalled();
  });

  it("does not raise a card that was dragged", async () => {
    const raised: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/front")) { raised.push(String(url)); }
      return new Response(JSON.stringify({ placements: CARDS }), { status: 200 });
    }));

    render(<Board projectId="prj1" />);
    const target = await card("obj1");
    fireEvent.pointerDown(target, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 150, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 150, clientY: 90, pointerId: 1 });
    expect(raised).toEqual([]);
  });

  it("does not save a move for a press", async () => {
    const { put } = mockApi();
    render(<Board projectId="prj1" />);
    const target = await card("obj1");
    fireEvent.pointerDown(target, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(put).not.toHaveBeenCalled();
  });
});

describe("moving the board itself", () => {
  it("pans when the empty surface is dragged", async () => {
    mockApi();
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");
    const surface = screen.getByTestId("board-surface");
    const plane = screen.getByTestId("board-plane");
    const before = plane.style.transform;

    fireEvent.pointerDown(surface, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 260, clientY: 240, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 260, clientY: 240, pointerId: 1 });

    expect(plane.style.transform).not.toBe(before);
  });

  it("does not save anything for a pan", async () => {
    // The camera is where somebody is looking, not a property of the project.
    // Persisting it would make one researcher's view everybody's view.
    const { put } = mockApi();
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");
    const surface = screen.getByTestId("board-surface");

    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 300, clientY: 300, pointerId: 1 });
    expect(put).not.toHaveBeenCalled();
  });

  it("zooms on the wheel, and shows what the zoom is", async () => {
    mockApi();
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.wheel(screen.getByTestId("board-surface"),
                    { deltaY: -500, clientX: 100, clientY: 100 });
    await waitFor(() => expect(screen.queryByText("100%")).toBeNull());
  });

  it("can be put back to where it started", async () => {
    // "Where did everything go" needs an answer that does not require finding
    // the work again by dragging.
    mockApi();
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");
    const plane = screen.getByTestId("board-plane");
    const home = plane.style.transform;

    fireEvent.wheel(screen.getByTestId("board-surface"),
                    { deltaY: -800, clientX: 10, clientY: 10 });
    await waitFor(() => expect(plane.style.transform).not.toBe(home));

    fireEvent.click(screen.getByRole("button", { name: /reset view/i }));
    await waitFor(() => expect(plane.style.transform).toBe(home));
  });

  it("will not offer to fit an empty board", async () => {
    mockApi([]);
    render(<Board projectId="prj1" />);
    await screen.findByText(/nothing on the board yet/i);
    expect(screen.getByRole("button", { name: /fit to contents/i }))
      .toBeDisabled();
  });
});

describe("putting something on the board", () => {
  const AVAILABLE = [
    { id: "obj9", object_type: "analysis", title: "Not placed yet",
      status: "complete" },
  ];

  function mockWithPicker(available = AVAILABLE) {
    const put = vi.fn((body: Record<string, unknown>) => body);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        put(body);
        return new Response(JSON.stringify({
          id: "plc9", object_id: body.object_id, x: body.x, y: body.y,
          width: body.width, height: body.height, z: 0,
        }), { status: 200 });
      }
      if (String(url).includes("/available")) {
        return new Response(JSON.stringify({ objects: available }),
                            { status: 200 });
      }
      return new Response(JSON.stringify({ placements: CARDS }), { status: 200 });
    }));
    return { put };
  }

  it("offers what is not on the board yet", async () => {
    mockWithPicker();
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");

    fireEvent.click(screen.getByRole("button", { name: /put something on the board/i }));
    expect(await screen.findByText("Not placed yet")).toBeInTheDocument();
  });

  it("asks for nothing until the picker is opened", async () => {
    /*
     * A board is opened far more often than something is added to it, so a
     * list of everything unplaced is a query nobody asked for on every visit.
     */
    mockWithPicker();
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");

    const asked = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .some((c) => String(c[0]).includes("/available"));
    expect(asked).toBe(false);
  });

  it("places it where the researcher is looking, not at the origin", async () => {
    /*
     * A card placed at (0, 0) on a board that has been panned away lands off
     * screen, and the researcher's conclusion is that the button did nothing.
     *
     * happy-dom reports a zero-sized surface, so the centre of the view is the
     * camera's own corner — which is still the point: it follows the camera
     * rather than sitting at the world origin.
     */
    const { put } = mockWithPicker();
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");

    const surface = screen.getByTestId("board-surface");
    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: -600, clientY: -400, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: -600, clientY: -400, pointerId: 1 });

    fireEvent.click(screen.getByRole("button", { name: /put something on the board/i }));
    fireEvent.click(await screen.findByText("Not placed yet"));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0][0] as { x: number; y: number };
    expect(body.x).toBeGreaterThan(100);
    expect(body.y).toBeGreaterThan(100);
  });

  it("gives a new card a size it can be read at", async () => {
    // The table refuses anything under forty units, and a card that arrived
    // too small to click would be indistinguishable from one that failed.
    const { put } = mockWithPicker();
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");
    fireEvent.click(screen.getByRole("button", { name: /put something on the board/i }));
    fireEvent.click(await screen.findByText("Not placed yet"));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0][0] as { width: number; height: number };
    expect(body.width).toBeGreaterThanOrEqual(40);
    expect(body.height).toBeGreaterThanOrEqual(40);
  });

  it("shows the new card without waiting for a reload", async () => {
    mockWithPicker();
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");
    fireEvent.click(screen.getByRole("button", { name: /put something on the board/i }));
    fireEvent.click(await screen.findByText("Not placed yet"));

    await waitFor(() => {
      expect(document.querySelector('[data-object="obj9"]')).not.toBeNull();
    });
  });

  it("says so when there is nothing left to place", async () => {
    // Rather than an empty panel, which reads as a list that failed to load.
    mockWithPicker([]);
    render(<Board projectId="prj1" />);
    await screen.findByText("Sleep and reaction time");
    fireEvent.click(screen.getByRole("button", { name: /put something on the board/i }));
    expect(await screen.findByText(/already on the board/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Taking a card off (§96)
//
// The board could add a card and bring one to the front, and never remove one:
// `DELETE /projects/{id}/board/{object_id}` had no caller, so a board only
// ever accumulated. §96 asks for soft delete with an immediate undo rather
// than a confirmation on everything, and this is that case exactly — the
// object is untouched, only its position goes, and the same PUT that placed it
// puts it back.
// ---------------------------------------------------------------------------

describe("taking a card off the board", () => {
  function mockWithDelete(placements: Placement[] = CARDS) {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? "GET", url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ removed: "obj1" }), { status: 200 });
      }
      if (init?.method === "PUT") {
        return new Response(JSON.stringify(CARDS[0]), { status: 200 });
      }
      return new Response(JSON.stringify({ placements }), { status: 200 });
    }));
    return calls;
  }

  it("asks the server to take that object off", async () => {
    const calls = mockWithDelete();
    render(<Board projectId="prj_1" />);
    const remove = await screen.findByRole("button",
      { name: /Take Sleep and reaction time off the board/ });

    fireEvent.click(remove);
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(calls.find((c) => c.method === "DELETE")!.url)
      .toBe("/api/projects/prj_1/board/obj1");
  });

  it("takes the card off the screen without waiting for the server", async () => {
    // A card still sitting under a press that plainly did something reads as a
    // board that ignores you.
    mockWithDelete();
    render(<Board projectId="prj_1" />);
    fireEvent.click(await screen.findByRole("button",
      { name: /Take Sleep and reaction time off the board/ }));

    await waitFor(() =>
      expect(document.querySelector('[data-object="obj1"]')).toBeNull());
    // And only that one.
    expect(document.querySelector('[data-object="obj2"]')).not.toBeNull();
  });

  it("offers to put it back rather than asking first", async () => {
    mockWithDelete();
    render(<Board projectId="prj_1" />);
    fireEvent.click(await screen.findByRole("button",
      { name: /Take Sleep and reaction time off the board/ }));

    const undo = await screen.findByRole("button", { name: /Put it back/ });
    fireEvent.click(undo);

    await waitFor(() =>
      expect(document.querySelector('[data-object="obj1"]')).not.toBeNull());
  });

  it("puts it back where it was, not at the origin", async () => {
    const calls = mockWithDelete();
    render(<Board projectId="prj_1" />);
    fireEvent.click(await screen.findByRole("button",
      { name: /Take Sleep and reaction time off the board/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Put it back/ }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({
      object_id: "obj1", x: 100, y: 100, width: 200, height: 120,
    });
  });

  it("puts the card back when the server refuses to remove it", async () => {
    /*
     * A card the researcher believes they removed, which returns on reload, is
     * worse than one that refused to go — the board would be lying about what
     * it holds.
     */
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ detail: "not on this board" }),
                            { status: 404 });
      }
      return new Response(JSON.stringify({ placements: CARDS }), { status: 200 });
    }));
    render(<Board projectId="prj_1" />);
    fireEvent.click(await screen.findByRole("button",
      { name: /Take Sleep and reaction time off the board/ }));

    await waitFor(() =>
      expect(document.querySelector('[data-object="obj1"]')).not.toBeNull());
    expect(screen.getByText(/could not be taken off the board/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Put it back/ })).toBeNull();
  });

  it("does not start a drag when the remove control is pressed", async () => {
    /*
     * The press would otherwise reach the surface underneath and be read as
     * the beginning of a drag, leaving a gesture in flight for a card that is
     * on its way out.
     */
    const calls = mockWithDelete();
    render(<Board projectId="prj_1" />);
    const remove = await screen.findByRole("button",
      { name: /Take Sleep and reaction time off the board/ });

    fireEvent.pointerDown(remove, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(document.querySelector('[data-testid="board-surface"]')!,
                          { clientX: 90, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(document.querySelector('[data-testid="board-surface"]')!,
                        { clientX: 90, clientY: 90, pointerId: 1 });

    // No move was saved, because no drag ever started.
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });
});


describe("opening a card", () => {
  function mockOpenable() {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/front")) {
        return new Response(JSON.stringify({ z: 9 }), { status: 200 });
      }
      if (path.includes("/impact")) {
        return new Response(JSON.stringify({
          object_id: "obj1", dependent_artifacts: 0, by_type: {},
          findings_losing_evidence: 0, artifacts: [],
        }), { status: 200 });
      }
      if (path.includes("/mentions")) {
        return new Response("[]", { status: 200 });
      }
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ removed: "obj1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ placements: CARDS }), { status: 200 });
    }));
  }

  /** Press and release in place, which is a press rather than a drag. */
  async function press(objectId: string) {
    const element = await card(objectId);
    fireEvent.pointerDown(element, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(document.querySelector('[data-testid="board-surface"]')!,
                        { clientX: 40, clientY: 40, pointerId: 1 });
  }

  it("shows what is behind the card that was pressed", async () => {
    mockOpenable();
    render(<Board projectId="prj_1" />);
    await press("obj1");

    const panel = await screen.findByRole("complementary",
      { name: /About Sleep and reaction time/ });
    expect(panel).toBeTruthy();
  });

  it("shows nothing until a card is pressed", async () => {
    mockOpenable();
    render(<Board projectId="prj_1" />);
    await card("obj1");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("closes when the card it describes is taken off the board", async () => {
    // Otherwise the panel goes on describing a card that is no longer there.
    mockOpenable();
    render(<Board projectId="prj_1" />);
    await press("obj1");
    await screen.findByRole("complementary");

    fireEvent.click(screen.getByRole("button",
      { name: /Take Sleep and reaction time off the board/ }));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  });

  it("does not bring the panel back when the card is put back", async () => {
    /*
     * The panel closes on removal because it is derived from the cards on the
     * board — so that much needs no code. What does need code is forgetting
     * *which* card was open: putting it back would otherwise resurrect a panel
     * the researcher had already dismissed by taking the card off.
     */
    mockOpenable();
    render(<Board projectId="prj_1" />);
    await press("obj1");
    await screen.findByRole("complementary");

    fireEvent.click(screen.getByRole("button",
      { name: /Take Sleep and reaction time off the board/ }));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());

    fireEvent.click(await screen.findByRole("button", { name: /Put it back/ }));
    await waitFor(() =>
      expect(document.querySelector('[data-object="obj1"]')).not.toBeNull());
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("keeps the panel open when a different card is taken off", async () => {
    mockOpenable();
    render(<Board projectId="prj_1" />);
    await press("obj1");
    await screen.findByRole("complementary");

    fireEvent.click(screen.getByRole("button", { name: /Take Figure 2 off the board/ }));
    await waitFor(() =>
      expect(document.querySelector('[data-object="obj2"]')).toBeNull());
    expect(screen.queryByRole("complementary")).not.toBeNull();
  });

  it("does not open a card that was dragged rather than pressed", async () => {
    // A drag is a move. Opening whatever was moved would put a panel over the
    // board every time somebody tidied it.
    mockOpenable();
    render(<Board projectId="prj_1" />);
    const element = await card("obj1");
    fireEvent.pointerDown(element, { clientX: 40, clientY: 40, pointerId: 1 });
    const surface = document.querySelector('[data-testid="board-surface"]')!;
    fireEvent.pointerMove(surface, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 300, clientY: 300, pointerId: 1 });

    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  });
});
