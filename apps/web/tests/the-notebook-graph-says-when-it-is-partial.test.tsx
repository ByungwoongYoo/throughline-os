/**
 * The notebook graph, when the project is larger than the view.
 *
 * `graphs.py` caps the knowledge graph and computes, for exactly this case,
 * `truncated`, `total_objects`, and a finished sentence — "Showing 200 of 412
 * objects. Expand from a node to load more." Its own comment is "say when the
 * view is partial rather than implying completeness". The screen's type named
 * none of the three, so a truncated graph rendered as though it were the
 * whole project. This screen had no test at all until this file.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The force layout needs a real canvas and measures nothing in happy-dom; what
// is under test here is the sentence beside it, not the drawing.
vi.mock("@/components/KnowledgeGraph", () => ({
  KnowledgeGraph: () => null,
}));

import { NoteGraph } from "@/components/notegraph";
import { api } from "@/lib/api";

const NOTES = {
  nodes: [{ id: "note_1", title: "Why resistance lags", object_type: "note",
            note_kind: "note" }],
  edges: [],
  note: "Links you typed.",
};

function research(over: Record<string, unknown> = {}) {
  return {
    nodes: [{ id: "obj_1", title: "amr.csv", object_type: "dataset",
              importance: 3 }],
    edges: [],
    total_objects: 1,
    truncated: false,
    note: null,
    ...over,
  };
}

function serve(graph: unknown) {
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (String(path).includes("/notebook/graph")) return NOTES as never;
    if (String(path).includes("/knowledge-graph")) return graph as never;
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("a graph that is only part of the project", () => {
  it("says so, in the server's own sentence", async () => {
    serve(research({
      truncated: true, total_objects: 412,
      note: "Showing 300 of 412 objects. Expand from a node to load more.",
    }));
    render(<NoteGraph projectId="prj_1" />);

    const partial = await screen.findByText(/Showing 300 of 412 objects/);
    expect(partial.getAttribute("role")).toBe("status");
  });

  it("says nothing when the graph is the whole project", async () => {
    // A notice on every graph would teach people to ignore the one that
    // matters.
    serve(research());
    render(<NoteGraph projectId="prj_1" />);

    await screen.findByText(/Your links and the computed provenance/);
    expect(screen.queryByText(/Showing \d+ of \d+ objects/)).toBeNull();
  });
});
