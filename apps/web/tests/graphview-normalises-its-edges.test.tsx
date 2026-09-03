/**
 * The research graph draws the edges the API sent.
 *
 * This component carries a comment about a bug it already had: edges arrive as
 * `source_object_id`/`target_object_id`, the renderer wants `source`/`target`,
 * and the mismatch failed *silently* — every lookup returned undefined and was
 * skipped, so the HUD counted 115 links while none were drawn and no
 * attraction acted on the layout. The fix was a normalisation at the boundary,
 * and nothing tested it, so the same rename would do the same thing again.
 *
 * The renderer is mocked. What is under test is the translation, not WebGL.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drawn: { nodes: unknown[]; edges: Array<Record<string, unknown>> }[] = [];

vi.mock("@/components/KnowledgeGraph", () => ({
  KnowledgeGraph: (props: { nodes: unknown[]; edges: Array<Record<string, unknown>> }) => {
    drawn.push({ nodes: props.nodes ?? [], edges: props.edges ?? [] });
    return <div data-testid="graph">{(props.edges ?? []).length} edges</div>;
  },
}));
vi.mock("@/components/NodeJournal", () => ({
  NodeJournal: () => <div />,
}));

import { GraphView } from "@/components/graphview";
import { api } from "@/lib/api";

const PAYLOAD = {
  nodes: [
    { id: "obj_1", title: "Consumption", object_type: "analysis" },
    { id: "obj_2", title: "Resistance", object_type: "finding" },
  ],
  edges: [{
    id: "edge_1", source_object_id: "obj_1", target_object_id: "obj_2",
    relationship_type: "derived_from", confidence: 0.9,
    edge_kind: "lineage" as const,
  }],
  total_objects: 2,
  truncated: false,
};

afterEach(cleanup);
beforeEach(() => { drawn.length = 0; vi.restoreAllMocks(); });

function view(payload: unknown = PAYLOAD) {
  vi.spyOn(api, "get").mockResolvedValue(payload as never);
  render(<GraphView projectId="prj_1" onSelect={() => {}} />);
}

describe("the research graph", () => {
  it("renders the graph at all", async () => {
    view();
    expect(await screen.findByTestId("graph")).toBeTruthy();
  });

  it("hands the renderer the edge shape it reads", async () => {
    view();
    await waitFor(() => expect(drawn.length).toBeGreaterThan(0));
    const [edge] = drawn[drawn.length - 1].edges;
    expect(edge, "no edge reached the renderer").toBeTruthy();
    expect(edge.source).toBe("obj_1");
    expect(edge.target).toBe("obj_2");
  });

  it("does not lose an edge on the way through", async () => {
    /** The failure was silent: a count that stayed right while the drawing
     *  went empty. So the count is asserted where the drawing happens. */
    view();
    await waitFor(() => expect(drawn.length).toBeGreaterThan(0));
    expect(drawn[drawn.length - 1].edges).toHaveLength(PAYLOAD.edges.length);
    expect(drawn[drawn.length - 1].nodes).toHaveLength(PAYLOAD.nodes.length);
  });

  it("survives a graph with no edges", async () => {
    view({ ...PAYLOAD, edges: [] });
    await waitFor(() => expect(drawn.length).toBeGreaterThan(0));
    expect(drawn[drawn.length - 1].edges).toHaveLength(0);
  });
});
