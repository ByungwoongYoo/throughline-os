/**
 * Rebuilding the graph projection, as housekeeping (plan §3.4, Slice 3).
 *
 * `POST /api/projects/{id}/graph-projection` had no caller anywhere in the
 * interface, and this readout is the only place in the product that knows the
 * projection exists at all. Two things have to be true of the fix. It has to
 * read as maintenance — the projection is derived from PostgreSQL and rebuilt
 * whole (ADR 0002), so pressing it can change no result, and a control on a
 * settings screen that a researcher suspects might touch their data is one
 * they will not press. And when Neo4j is absent it has to say so, because the
 * honest fact there is a reduced feature set, not a missing button: a control
 * that vanishes leaves a reader unable to tell a feature they do not have from
 * one that failed to render.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "@/components/settings";
import { ApiError, api } from "@/lib/api";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

const MODELS = {
  installed: [],
  selection: { provider: "ollama", model: null, source: "default" },
  active: { name: "none", model: "", usable: false, local: true,
            structured: false, note: null },
  history: [], note: null, how_to_install: "",
};

const REACHABLE = {
  configured: true, reachable: true,
  queries: ["shortest_path", "centrality", "communities"],
  nodes: 412, edges: 980, built_at: "2026-09-04T08:00:00Z",
  note: "A derived projection of the PostgreSQL record.",
};

const ABSENT = {
  configured: false, reachable: false, queries: [],
  note: "Path-finding, influence ranking and clustering are unavailable.",
};

function serve(projection: unknown) {
  return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.includes("/system/models")) return MODELS as never;
    if (path.includes("/system/capabilities")) {
      return { graph_projection: projection, packs: {} } as never;
    }
    if (path.includes("/accounts")) return [] as never;
    if (path.includes("/version")) return { version: "1.8.0" } as never;
    return {} as never;
  });
}

describe("the maintenance action beside the projection readout", () => {
  it("says it changes nothing on the record", async () => {
    /**
     * Framed as housekeeping, not research. Without that sentence the button
     * sits under a heading about graph queries on a screen full of model
     * choices, and the reasonable reading is that it might rewrite something.
     */
    serve(REACHABLE);
    render(<Settings projectId="prj_1" />);

    expect(await screen.findByText(/changes no result, no analysis and\s+nothing on the record/))
      .toBeTruthy();
  });

  it("rebuilds this project's projection when pressed", async () => {
    /** Per project, because the route is: the projection is a project's own
     *  derived copy, not a property of the machine. */
    serve(REACHABLE);
    const post = vi.spyOn(api, "post").mockResolvedValue(
      { nodes: 412, edges: 980, source_watermark: null } as never);
    render(<Settings projectId="prj_1" />);

    fireEvent.click(await screen.findByRole(
      "button", { name: /rebuild the graph projection/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/projects/prj_1/graph-projection", {}));
  });

  it("reports what was projected, in the server's numbers", async () => {
    /** Nothing is computed in the browser: both counts come back from the
     *  rebuild itself. */
    serve(REACHABLE);
    vi.spyOn(api, "post").mockResolvedValue(
      { nodes: 412, edges: 980, source_watermark: "2026-09-05" } as never);
    render(<Settings projectId="prj_1" />);

    fireEvent.click(await screen.findByRole(
      "button", { name: /rebuild the graph projection/i }));
    const said = await screen.findByRole("status");
    expect(said.textContent).toContain("412");
    expect(said.textContent).toContain("980");
  });

  it("says what the server said when the rebuild fails", async () => {
    /**
     * §104. The route answers 503 with the projection's own sentence when
     * Neo4j cannot be reached, and that sentence is the whole diagnosis —
     * "something went wrong" would send a reader to the logs for it.
     */
    serve(REACHABLE);
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(
      503, "Neo4j is configured but not reachable at bolt://localhost:7687."));
    render(<Settings projectId="prj_1" />);

    fireEvent.click(await screen.findByRole(
      "button", { name: /rebuild the graph projection/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not reachable/);
  });
});

describe("when this machine has no Neo4j", () => {
  it("states the reduced feature set instead of disappearing", async () => {
    /*
     * The failure guarded: the whole maintenance block rendered only when the
     * projection was reachable, so on the majority deployment — PostgreSQL and
     * nothing else — a reader saw a panel about graph queries and no
     * explanation of why nothing on it could be done.
     */
    serve(ABSENT);
    render(<Settings />);

    expect(await screen.findByText(/There is no projection to rebuild/))
      .toBeTruthy();
    expect(screen.getByText(/Neo4j is not configured/)).toBeTruthy();
    expect(screen.getByText(/PostgreSQL is the record/)).toBeTruthy();
  });

  it("offers no control that would fail if pressed", async () => {
    /** §123 — a control does what it appears to do. */
    serve(ABSENT);
    render(<Settings projectId="prj_1" />);

    await screen.findByText(/There is no projection to rebuild/);
    expect(screen.queryByRole("button", { name: /rebuild the graph projection/i }))
      .toBeNull();
  });

  it("distinguishes unreachable from never configured", async () => {
    /**
     * Two different facts with two different next steps: one is an install,
     * the other is a service that is down. The capability endpoint reports
     * them separately and this screen must not collapse them.
     */
    serve({ ...ABSENT, configured: true });
    render(<Settings projectId="prj_1" />);

    expect(await screen.findByText(/cannot be reached/)).toBeTruthy();
  });

  it("says rebuilding is per project when no project is in hand", async () => {
    /** Settings is a screen about the machine; the projection is not. Said
     *  rather than shown as a dead control. */
    serve(REACHABLE);
    render(<Settings />);

    expect(await screen.findByText(/rebuilt one project at a time/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /rebuild the graph projection/i }))
      .toBeNull();
  });
});
