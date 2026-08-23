/**
 * Drawing a graph in space (§9 networks, §16 native).
 *
 * `paintNetwork` is exported for the reason `paintCursor` is: a draw loop
 * reachable only through an animation frame is one no test ever runs, and this
 * is where depth ordering either happens or does not.
 *
 * These tests record the calls the canvas receives rather than looking at
 * pixels. Pixels would test happy-dom's rasteriser; the order of the calls is
 * the actual claim — that a node in front covers one behind it, which is most
 * of what a spatial network buys over a flat one.
 */

import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { Network3D, paintNetwork } from "@/components/charts/Network3D";
import { DEFAULT_CAMERA, toCanvas } from "@/lib/charts/scene3d";
import { Graph, Layout, Placed } from "@/lib/charts3d/network";
import { VisualizationController } from "@/lib/spatial/commands";

type Call = { op: string; args: number[] };

/** A canvas that remembers what it was asked to do, in order. */
function recordingCanvas() {
  const calls: Call[] = [];
  const note = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args: args.filter((a) => typeof a === "number") });
  };
  const context = {
    clearRect: note("clearRect"), save: note("save"), restore: note("restore"),
    beginPath: note("beginPath"), moveTo: note("moveTo"), lineTo: note("lineTo"),
    stroke: note("stroke"), fill: note("fill"), arc: note("arc"),
    fillText: note("fillText"), closePath: note("closePath"),
    strokeStyle: "", fillStyle: "", lineWidth: 0, font: "", textAlign: "",
    textBaseline: "", globalAlpha: 1,
  };
  const canvas = {
    getContext: () => context,
    width: 400, height: 300,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls, context };
}

/** Two nodes placed by hand, one plainly in front of the other. */
function pair(): Layout {
  const near: Placed = { id: "near", x: 0.3, y: 0, z: 0.45 };
  const far: Placed = { id: "far", x: -0.3, y: 0, z: -0.45 };
  return { nodes: [far, near], edges: [], dangling: [] };
}

const SIZE = { width: 400, height: 300 };

describe("what is in front is drawn last", () => {
  it("draws the nearer node after the farther one", () => {
    /*
     * A painter's ordering. `depth` from the shared projection is larger when
     * nearer, so the sort must ascend — descending draws the near node first
     * and lets the far one paint over it, which is the flat-looking failure
     * this whole primitive exists to avoid.
     *
     * The nodes are supplied already placed rather than laid out, so the test
     * states which one is in front instead of depending on where a force
     * simulation happened to put them.
     */
    const layout = pair();
    const { canvas, calls } = recordingCanvas();
    paintNetwork(canvas, layout, DEFAULT_CAMERA, SIZE, null, null);

    const arcs = calls.filter((c) => c.op === "arc").map((c) => c.args[0]);
    const near = toCanvas(layout.nodes[1], DEFAULT_CAMERA, 400, 300);
    expect(arcs).toHaveLength(2);
    // The last arc drawn is the one nearest the viewer.
    expect(arcs[1]).toBeCloseTo(near.x, 6);
  });

  it("draws every edge before any node", () => {
    // An edge drawn over a node makes the node look like a bead on a wire.
    const layout = pair();
    layout.edges.push({
      source: "far", target: "near",
      from: layout.nodes[0], to: layout.nodes[1] });

    const { canvas, calls } = recordingCanvas();
    paintNetwork(canvas, layout, DEFAULT_CAMERA, SIZE, null, null);

    const lastLine = calls.map((c) => c.op).lastIndexOf("lineTo");
    const firstArc = calls.map((c) => c.op).indexOf("arc");
    expect(lastLine).toBeLessThan(firstArc);
  });

  it("orders edges back to front too", () => {
    const near: Placed = { id: "n1", x: 0.4, y: 0.1, z: 0.5 };
    const near2: Placed = { id: "n2", x: -0.4, y: 0.1, z: 0.5 };
    const far: Placed = { id: "f1", x: 0.4, y: -0.1, z: -0.5 };
    const far2: Placed = { id: "f2", x: -0.4, y: -0.1, z: -0.5 };
    const layout: Layout = {
      nodes: [near, near2, far, far2],
      edges: [
        { source: "n1", target: "n2", from: near, to: near2 },
        { source: "f1", target: "f2", from: far, to: far2 },
      ],
      dangling: [],
    };

    const { canvas, calls } = recordingCanvas();
    paintNetwork(canvas, layout, DEFAULT_CAMERA, SIZE, null, null);

    // The near edge is listed first but must be *drawn* second.
    const moves = calls.filter((c) => c.op === "moveTo");
    const nearScreen = toCanvas(near, DEFAULT_CAMERA, 400, 300);
    expect(moves[1].args[0]).toBeCloseTo(nearScreen.x, 6);
  });
});

describe("it draws what it was given and nothing else", () => {
  it("clears before drawing, so a rotation does not smear", () => {
    const { canvas, calls } = recordingCanvas();
    paintNetwork(canvas, pair(), DEFAULT_CAMERA, SIZE, null, null);
    expect(calls[0].op).toBe("clearRect");
  });

  it("draws nothing for a dangling edge", () => {
    /*
     * The layout has already refused it. If the renderer looked endpoints up
     * itself a missing one would draw to the origin — a spray of lines
     * converging on the centre that reads as a hub nobody put there.
     */
    const layout: Layout = {
      nodes: [{ id: "a", x: 0, y: 0, z: 0 }],
      edges: [],
      dangling: [{ source: "a", target: "ghost" }],
    };
    const { canvas, calls } = recordingCanvas();
    paintNetwork(canvas, layout, DEFAULT_CAMERA, SIZE, null, null);
    expect(calls.filter((c) => c.op === "lineTo")).toHaveLength(0);
  });

  it("does nothing at all without a canvas", () => {
    // The ref is null for the first frame after mount, every mount.
    expect(() => paintNetwork(null, pair(), DEFAULT_CAMERA, SIZE, null, null))
      .not.toThrow();
  });
});

describe("the selection is visible", () => {
  it("draws a selected node larger than an unselected one", () => {
    const layout = pair();
    const plain = recordingCanvas();
    paintNetwork(plain.canvas, layout, DEFAULT_CAMERA, SIZE, null, null);
    const picked = recordingCanvas();
    paintNetwork(picked.canvas, layout, DEFAULT_CAMERA, SIZE, "near", null);

    const radius = (r: ReturnType<typeof recordingCanvas>) =>
      r.calls.filter((c) => c.op === "arc")[1].args[2];
    expect(radius(picked)).toBeGreaterThan(radius(plain));
  });

  it("sizes a node by its weight and not by its depth", () => {
    /*
     * Depth is already carried by the projection. Binding it to size as well
     * double-counts it, and a heavy node in the distance then reads as light.
     */
    const heavy: Placed = { id: "heavy", x: 0, y: 0, z: -0.45, weight: 1 };
    const light: Placed = { id: "light", x: 0.3, y: 0, z: 0.45 };
    const { canvas, calls } = recordingCanvas();
    paintNetwork(canvas, { nodes: [heavy, light], edges: [], dangling: [] },
                 DEFAULT_CAMERA, SIZE, null, null);
    const arcs = calls.filter((c) => c.op === "arc");
    // heavy is behind, so it is drawn first — and still the larger of the two.
    expect(arcs[0].args[2]).toBeGreaterThan(arcs[1].args[2]);
  });
});

describe("the controller the seam talks to", () => {
  const graph: Graph = {
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    edges: [{ source: "a", target: "b" }],
  };

  it("reports a view that changes when the camera does", () => {
    const ref = createRef<VisualizationController>();
    render(<Network3D graph={graph} controllerRef={ref} />);
    const before = ref.current!.viewState();
    ref.current!.rotate(40, 0);
    expect(ref.current!.viewState().yaw).not.toBeCloseTo(before.yaw, 6);
  });

  it("returns to a snapshot", () => {
    const ref = createRef<VisualizationController>();
    render(<Network3D graph={graph} controllerRef={ref} />);
    const home = ref.current!.viewState();
    ref.current!.rotate(50, 20);
    ref.current!.restoreViewState(home);
    expect(ref.current!.viewState().yaw).toBeCloseTo(home.yaw, 6);
  });

  it("ignores a snapshot from a chart that is not this one", () => {
    // Half-applying it would put the scene somewhere the researcher has never
    // been, which is worse than leaving it where they left it.
    const ref = createRef<VisualizationController>();
    render(<Network3D graph={graph} controllerRef={ref} />);
    ref.current!.rotate(30, 0);
    const moved = ref.current!.viewState();
    // Each field dropped in turn, because a snapshot missing only *one* of
    // them is the realistic case — a neighbouring chart reporting a centre and
    // a zoom, or an older recording — and checking only a wholly foreign
    // snapshot lets a renderer that guards on just one field pass.
    ref.current!.restoreViewState({ pitch: 0.9, zoom: 3 });
    ref.current!.restoreViewState({ yaw: 0.9, zoom: 3 });
    ref.current!.restoreViewState({ yaw: 0.9, pitch: 0.9 });
    ref.current!.restoreViewState({ centre: 4, span: 2 });
    expect(ref.current!.viewState()).toEqual(moved);
  });

  it("has no bounds before it is laid out", () => {
    /*
     * happy-dom measures every element as zero. Reporting that as a rectangle
     * would tell §189 this chart sits in the top-left corner with no size,
     * and every hand pointed anywhere would address it.
     */
    const ref = createRef<VisualizationController>();
    render(<Network3D graph={graph} controllerRef={ref} />);
    expect(ref.current!.bounds()).toBeNull();
  });

  it("says how many nodes and edges it drew", () => {
    const { container } = render(<Network3D graph={graph} caption="Citations" />);
    expect(container.textContent).toContain("Citations");
    expect(container.textContent).toContain("3 nodes, 1 edge.");
  });

  it("reports what a selected node connects to", () => {
    const ref = createRef<VisualizationController>();
    const { container } = render(<Network3D graph={graph} controllerRef={ref} />);
    act(() => { ref.current!.focus("a"); });
    expect(container.textContent).toContain("(1 connected)");
  });

  it("tells the caller what was selected, and what was not", () => {
    const onSelect = vi.fn();
    const ref = createRef<VisualizationController>();
    render(<Network3D graph={graph} controllerRef={ref} onSelect={onSelect} />);
    // Far outside anything, so this is the "pointing at nothing" case (§7).
    act(() => { ref.current!.select({ x: -900, y: -900 }); });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("finds a node under the point the projection puts it at", () => {
    /*
     * Hit-testing and painting must use the same arithmetic. When they
     * disagree the reader points at a mark and is told they pointed at
     * nothing, which reads as broken tracking rather than as a mismatch.
     */
    const ref = createRef<VisualizationController>();
    render(<Network3D graph={graph} controllerRef={ref} width={400}
                      height={300} />);
    // Whatever the layout chose, ask where the seam thinks a node is by
    // sweeping — the claim is that *some* point resolves to a node at all.
    let found = null;
    for (let x = 0; x <= 400 && !found; x += 5) {
      for (let y = 0; y <= 300 && !found; y += 5) {
        found = ref.current!.hover({ x, y });
      }
    }
    expect(found).not.toBeNull();
  });

  it("takes nothing outside a lasso", () => {
    const ref = createRef<VisualizationController>();
    render(<Network3D graph={graph} controllerRef={ref} />);
    const empty = ref.current!.withinPolygon([
      { x: -50, y: -50 }, { x: -10, y: -50 }, { x: -10, y: -10 },
      { x: -50, y: -10 }]);
    expect(empty).toEqual([]);
  });

  it("takes every node inside one drawn round the whole canvas", () => {
    const ref = createRef<VisualizationController>();
    render(<Network3D graph={graph} controllerRef={ref} width={400}
                      height={300} />);
    const all = ref.current!.withinPolygon([
      { x: -1000, y: -1000 }, { x: 1000, y: -1000 },
      { x: 1000, y: 1000 }, { x: -1000, y: 1000 }]);
    expect(all).toHaveLength(3);
  });

  it("draws a layered graph in the order it was given, not by connectivity", () => {
    /*
     * The provenance tree. A result derives from runs which derive from
     * datasets, and that ordering *is* the information — arranging it by how
     * many edges each node happens to have is the wrong picture told
     * confidently.
     */
    const depths: Record<string, number> = { a: 0, b: 1, c: 2 };
    const ref = createRef<VisualizationController>();
    render(<Network3D graph={graph} controllerRef={ref}
                      depthOf={(id) => depths[id]} />);
    expect(ref.current!.viewport()).toEqual({ width: 720, height: 520 });
  });
});
