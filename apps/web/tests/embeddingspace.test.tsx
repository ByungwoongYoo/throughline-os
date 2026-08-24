/**
 * The screen where the gesture work stops being an engine.
 *
 * Everything before this drove a demo cloud belonging to no project. Here the
 * points are passages, so pointing at one and asking about it produces an
 * answer recorded against something real — which is the loop §26 describes and
 * §49 calls the actual value proposition.
 *
 * Most of these tests are about what the screen refuses to do. A projection
 * always looks like structure, so the ways it can mislead are the ways it will.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmbeddingSpace } from "@/components/embeddingspace";

// The camera layer is stubbed: this file is about the chart and the question,
// and hand tracking needs a WASM runtime and a person.
vi.mock("@/lib/spatial/mediapipe", () => ({
  MediaPipeHandTracker: class {
    async load() {}
    start() {}
    stop() {}
    close() {}
    status() { return "running" as const; }
  },
}));

function space(overrides: Record<string, unknown> = {}) {
  return {
    points: Array.from({ length: 6 }, (_, i) => ({
      id: `psg_${i}`,
      label: `A paper — Methods`,
      source_id: "src_1",
      object_id: "obj_paper",
      x: Math.cos(i) * 4, y: Math.sin(i) * 3, z: (i % 3) - 1,
    })),
    model: "test-embed",
    dimension: 256,
    explained_variance: [0.31, 0.19, 0.12],
    explained_total: 0.62,
    truncated: false,
    total_available: 6,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  vi.stubGlobal("navigator", {});   // no camera in this file
  fetchMock = vi.fn(async () => ({
    ok: true, json: async () => space(),
  })) as never;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("saying how much of the corpus the picture contains", () => {
  it("reports the explained variance before the chart, not after", async () => {
    /**
     * Three components carrying 60% and three carrying 6% look identical on
     * screen. A caption underneath is read after an impression has already
     * formed, so the number would be a correction rather than a frame.
     */
    render(<EmbeddingSpace projectId="prj_1" />);

    const line = await screen.findByText(/carry/i);
    expect(line.textContent).toContain("62%");
    expect(line.textContent).toContain("256 dimensions");
  });

  it("says what a weak projection means rather than only its number", async () => {
    /**
     * 9% is a number most readers cannot convert into "this picture is close to
     * noise". Leaving them to do that conversion is how a decimal becomes a
     * misleading chart with a technically accurate caption above it.
     */
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => space({ explained_variance: [0.04, 0.03, 0.02],
                                explained_total: 0.09 }),
    });
    render(<EmbeddingSpace projectId="prj_1" />);

    const line = await screen.findByText(/carry/i);
    expect(line.textContent).toMatch(/not.*visible here/i);
    expect(line.textContent).toMatch(/weak guide/i);
  });

  it("does not editorialise when the projection is strong", async () => {
    render(<EmbeddingSpace projectId="prj_1" />);

    const line = await screen.findByText(/carry/i);
    expect(line.textContent).not.toMatch(/weak guide/i);
  });

  it("says when it is showing only part of the corpus", async () => {
    /**
     * A researcher looking at 2,000 of 5,000 passages and believing they are
     * looking at all of them draws conclusions about a corpus they have not
     * seen.
     */
    fetchMock.mockResolvedValue({
      ok: true, json: async () => space({ truncated: true, total_available: 900 }),
    });
    render(<EmbeddingSpace projectId="prj_1" />);

    expect(await screen.findByText(/not all of it/i)).toBeTruthy();
  });
});

describe("never drawing an empty chart", () => {
  it("shows the reason a projection could not be made", async () => {
    /**
     * The whole point of the 503. An empty scatter is indistinguishable from a
     * corpus with no structure, and a reader takes the second meaning when the
     * truth is the first — that the embedding step never ran.
     */
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "This project has 0 embedded passage(s)." }),
    });
    render(<EmbeddingSpace projectId="prj_1" />);

    expect(await screen.findByText(/0 embedded passage/i)).toBeTruthy();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("survives an API that is not answering", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<EmbeddingSpace projectId="prj_1" />);

    expect(await screen.findByText(/not answering/i)).toBeTruthy();
  });
});

describe("asking about what was selected", () => {
  /**
   * Click until a point is selected, rather than guessing where one is.
   *
   * The chart projects its own coordinates, so the pixel a given passage lands
   * on depends on the camera, the zoom and the data — none of which this file
   * should encode. An earlier version picked the canvas centre and selected
   * nothing, because the origin of the *data* is rarely where a point is.
   * Sweeping is robust to every one of those changing, and it is also what a
   * researcher does.
   */
  async function selectAPoint() {
    render(<EmbeddingSpace projectId="prj_1" />);
    await screen.findByText(/carry/i);
    const canvas = document.querySelector("canvas")!;
    const { fireEvent } = await import("@testing-library/react");

    for (let x = 40; x <= 680; x += 20) {
      for (let y = 40; y <= 480; y += 20) {
        fireEvent.pointerDown(canvas, { clientX: x, clientY: y });
        fireEvent.pointerUp(canvas, { clientX: x, clientY: y });
        if (document.querySelector(".es-selected")) return;
      }
    }
    throw new Error("no point could be selected anywhere on the canvas");
  }

  it("sends the selected point as coordinates, not as a summary", async () => {
    /**
     * The integrity property, checked at the boundary that could break it.
     *
     * Every statistic the model sees is computed on the server from these
     * numbers. A mean sent from the browser would be indistinguishable — to the
     * model, and to whoever reads the note next week — from one somebody
     * calculated.
     */
    const user = userEvent.setup();
    await selectAPoint();
    await waitFor(() => screen.getByRole("button", { name: /^ask$/i }));

    await user.type(screen.getByRole("textbox"), "Why does this sit here?");
    fetchMock.mockResolvedValueOnce({
      ok: true, json: async () => ({ body: "It is near the methods passages." }),
    });
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    const ask = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => String(url).includes("/ask"));
      if (!call) throw new Error("no ask request yet");
      return call;
    });
    const body = JSON.parse(ask[1].body);
    expect(body.selection.points).toHaveLength(1);
    expect(typeof body.selection.points[0].x).toBe("number");
    // No statistics of any kind travel from here.
    expect(body.selection.summary).toBeUndefined();
    expect(JSON.stringify(body.selection)).not.toMatch(/mean|count|stddev/i);
  });

  it("records the answer against the object the passage belongs to", async () => {
    const user = userEvent.setup();
    await selectAPoint();
    await waitFor(() => screen.getByRole("button", { name: /^ask$/i }));
    await user.type(screen.getByRole("textbox"), "Why?");
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ body: "…" }) });

    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    await waitFor(() => expect(
      fetchMock.mock.calls.some(
        ([url]) => String(url).includes("/objects/obj_paper/ask"))).toBe(true));
  });

  it("attributes the answer to the model, never to the researcher", async () => {
    /** The journal's second invariant, which is easy to hold in the data and
     * easy to lose on screen. */
    const user = userEvent.setup();
    await selectAPoint();
    await waitFor(() => screen.getByRole("button", { name: /^ask$/i }));
    await user.type(screen.getByRole("textbox"), "Why?");
    fetchMock.mockResolvedValueOnce({
      ok: true, json: async () => ({ body: "These sit near the methods." }),
    });

    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    const answer = await screen.findByText(/These sit near the methods/);
    expect(answer).toBeTruthy();
    expect(screen.getByText(/written by the model/i)).toBeTruthy();
  });

  it("explains why it cannot ask, rather than disabling a control in silence",
     async () => {
    /**
     * A passage whose source has no research object has nothing for an answer
     * to be recorded against. A greyed-out button with no reason reads as the
     * feature being broken.
     */
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => space({
        points: space().points.map((p) => ({ ...p, object_id: null })),
      }),
    });
    await selectAPoint();

    expect(await screen.findByText(/nothing to be recorded against/i))
      .toBeTruthy();
    expect(screen.queryByRole("button", { name: /^ask$/i })).toBeNull();
  });

  it("reports a refused question instead of appearing to succeed", async () => {
    const user = userEvent.setup();
    await selectAPoint();
    await waitFor(() => screen.getByRole("button", { name: /^ask$/i }));
    await user.type(screen.getByRole("textbox"), "Why?");
    fetchMock.mockResolvedValueOnce({
      ok: false, json: async () => ({ detail: "No model is configured." }),
    });

    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/no model is configured/i);
  });
});

describe("asking about a region rather than one passage", () => {
  async function open() {
    render(<EmbeddingSpace projectId="prj_1" />);
    await screen.findByText(/carry/i);
  }

  it("selects one passage by default", async () => {
    /** The reach starts at zero: a researcher who never touches the control
     * gets the precise behaviour, which is the one that needs no explaining. */
    await open();
    expect(screen.getByText(/one passage/i)).toBeTruthy();
  });

  it("gathers the passages near where you pointed once the reach is widened",
     async () => {
    const { fireEvent } = await import("@testing-library/react");
    await open();

    fireEvent.change(screen.getByLabelText(/selection reach/i),
                     { target: { value: "200" } });
    const canvas = document.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 360, clientY: 260 });
    fireEvent.pointerUp(canvas, { clientX: 360, clientY: 260 });

    expect(await screen.findByText(/passages near where you pointed/i))
      .toBeTruthy();
  });

  it("refuses to call the region a cluster, on screen as well as in the prompt",
     async () => {
    /**
     * §25 asks for cluster selection; this product will not say the word,
     * because nothing was fitted and no test was run. The backend enforces it
     * in the text sent to the model — this holds the same line in the interface,
     * where a researcher would read it and reasonably believe a grouping had
     * been computed.
     */
    const { fireEvent } = await import("@testing-library/react");
    await open();
    fireEvent.change(screen.getByLabelText(/selection reach/i),
                     { target: { value: "200" } });
    const canvas = document.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 360, clientY: 260 });
    fireEvent.pointerUp(canvas, { clientX: 360, clientY: 260 });

    const note = await screen.findByText(/passages near where you pointed/i);
    expect(note.textContent).toMatch(/not a group the data defines/i);
    expect(note.textContent).toMatch(/nothing was fitted/i);
    expect(document.body.textContent?.toLowerCase()).not.toContain("cluster");
  });

  it("sends every point in the region, not only the nearest", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const user = userEvent.setup();
    await open();
    fireEvent.change(screen.getByLabelText(/selection reach/i),
                     { target: { value: "200" } });
    const canvas = document.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 360, clientY: 260 });
    fireEvent.pointerUp(canvas, { clientX: 360, clientY: 260 });
    await screen.findByText(/passages near where you pointed/i);

    await user.type(screen.getByRole("textbox"), "What is here?");
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ body: "…" }) });
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    const ask = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => String(url).includes("/ask"));
      if (!call) throw new Error("no ask request yet");
      return call;
    });
    const body = JSON.parse(ask[1].body);
    expect(body.selection.points.length).toBeGreaterThan(1);
    // Still coordinates only — a region is more points, not a summary.
    expect(JSON.stringify(body.selection)).not.toMatch(/mean|count|stddev/i);
  });
});
