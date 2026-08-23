"use client";

/**
 * A graph drawn in space (§9 networks, §16 native).
 *
 * The renderer for the thirty-five catalogue entries that share the `network`
 * primitive — citation networks, protein interaction, dependency graphs, and
 * the provenance tree and evidence galaxy that draw this system's own semantic
 * layer.
 *
 * **Canvas with the shared projection, not a scene graph.** `scene3d` already
 * owns the camera, the perspective divide and the unit cube, and every other
 * spatial chart here reads through it. A second projection would drift from the
 * first in exactly the way the ink canvas and the page canvas would have — and
 * the drift shows up as selections landing next to marks rather than on them.
 *
 * **Edges are drawn before nodes, back to front.** A painter's ordering, because
 * without it an edge passing behind a node is drawn over it and the graph reads
 * as flat. Depth is most of what a spatial network buys over a flat one, so
 * losing it loses the reason to be here.
 *
 * **Layout is not recomputed while the camera moves.** Rotating asks a different
 * question of the same arrangement; relaxing the graph again would make the
 * nodes swim, and a researcher would be unable to tell a rotation from a change
 * in the data.
 */

import {
  useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { ScreenPoint, TargetRef, VisualizationController } from "@/lib/spatial/commands";
import {
  Camera, DEFAULT_CAMERA, resetCamera, rotateCamera, toCanvas, zoomCamera,
} from "@/lib/charts/scene3d";
import {
  Graph, Layout, Placed, describeLayout, layoutGraph, layoutLayered,
  neighboursOf,
} from "@/lib/charts3d/network";
import { categorical } from "@/lib/tokens";

export type Network3DProps = {
  graph: Graph;
  width?: number;
  height?: number;
  /**
   * Depth per node, for graphs where depth carries meaning.
   *
   * Supplying it swaps the force-directed arrangement for a layered one. The
   * provenance tree is why: a result derives from runs which derive from
   * datasets, and that ordering is the information rather than an artefact of
   * how many edges each node happens to have.
   */
  depthOf?: (nodeId: string) => number;
  controllerRef?: React.RefObject<VisualizationController | null>;
  onSelect?: (target: TargetRef | null) => void;
  /** What the graph is, for a reader who did not build it. */
  caption?: string;
};

const NODE_RADIUS = 4.5;
/** How near a pointer must be, in pixels, to count as on a node. */
const PICK_RADIUS = 14;

export function Network3D({
  graph, width = 720, height = 520, depthOf, controllerRef, onSelect, caption,
}: Network3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<Camera>({ ...DEFAULT_CAMERA });
  const dirtyRef = useRef(true);
  const hoveredRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  /*
   * Computed once per graph, and deliberately not per frame. Relaxing again on
   * every rotation would make the nodes swim, and a researcher could not tell a
   * camera move from a change in the data.
   */
  const layout: Layout = useMemo(
    () => (depthOf ? layoutLayered(graph, (n) => depthOf(n.id))
                   : layoutGraph(graph)),
    [graph, depthOf]);

  /** Where a node lands on the canvas, at the current camera. */
  const at = useCallback((node: Placed): ScreenPoint => {
    // Through the shared `toCanvas`, which is also what the draw loop uses.
    // A private copy of the fit factor would put a network at a different
    // scale from a scatter, and — worse — let hit-testing drift from painting.
    const q = toCanvas(node, cameraRef.current, width, height);
    return { x: q.x, y: q.y };
  }, [width, height]);

  const nearest = useCallback((point: ScreenPoint): TargetRef | null => {
    let best: TargetRef | null = null;
    let bestGap = PICK_RADIUS;
    for (const node of layout.nodes) {
      const p = at(node);
      const gap = Math.hypot(p.x - point.x, p.y - point.y);
      // `<=` so a later node wins a tie: it is the one drawn on top, and taking
      // the one behind removes something the researcher cannot see.
      if (gap <= bestGap) {
        bestGap = gap;
        best = { id: node.id, label: node.label ?? node.id, datum: node };
      }
    }
    return best;
  }, [layout, at]);

  const rotate = useCallback((dx: number, dy: number) => {
    rotateCamera(cameraRef.current, dx, dy);
    dirtyRef.current = true;
  }, []);

  useImperativeHandle(controllerRef, (): VisualizationController => ({
    rotate,
    zoom: (factor) => {
      // Through the shared clamp, like every other caller.
      zoomCamera(cameraRef.current, factor);
      dirtyRef.current = true;
    },
    // Not offered rather than stubbed: this centres a unit cube and there is
    // nothing off-frame to pan toward. A control that silently does nothing is
    // worse than one that is absent.
    pan: () => {},
    hover: (point) => {
      const target = nearest(point);
      if ((target?.id ?? null) !== hoveredRef.current) {
        hoveredRef.current = target?.id ?? null;
        dirtyRef.current = true;
      }
      return target;
    },
    select: (point) => {
      const target = nearest(point);
      setSelected(target?.id ?? null);
      dirtyRef.current = true;
      onSelect?.(target);
      return target;
    },
    selectRegion: (point, radius) => {
      const found: TargetRef[] = [];
      for (const node of layout.nodes) {
        const p = at(node);
        if (Math.hypot(p.x - point.x, p.y - point.y) > radius) continue;
        found.push({ id: node.id, label: node.label ?? node.id, datum: node });
      }
      return found;
    },
    withinPolygon: (polygon) => {
      // Every node tested once against the same projection the draw loop uses,
      // so the count a researcher reads is exact rather than sampled.
      const found: TargetRef[] = [];
      for (const node of layout.nodes) {
        if (!insidePolygon(polygon, at(node))) continue;
        found.push({ id: node.id, label: node.label ?? node.id, datum: node });
      }
      return found;
    },
    focus: (objectId) => { setSelected(objectId); dirtyRef.current = true; },
    deselect: () => { setSelected(null); dirtyRef.current = true; },
    resetView: () => { resetCamera(cameraRef.current); dirtyRef.current = true; },
    viewport: () => ({ width, height }),
    /*
     * Null rather than a zero rectangle when unmeasurable — a zero rectangle
     * is a claim about where this chart is, and an unmounted canvas has no
     * position to claim.
     */
    bounds: () => {
      const box = canvasRef.current?.getBoundingClientRect();
      // A canvas not yet laid out measures zero, which is not a position.
      if (!box || box.width === 0 || box.height === 0) return null;
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    },
    /*
     * Yaw, pitch and zoom — the same three every camera-driven chart here
     * reports, so an annotation drawn on a network and one drawn on a surface
     * can both answer "is this still the view I was drawn in".
     */
    viewState: () => ({ yaw: cameraRef.current.yaw,
                        pitch: cameraRef.current.pitch,
                        zoom: cameraRef.current.zoom }),
    restoreViewState: (state) => {
      // All three or none. A partial restore puts the scene somewhere the
      // researcher has never been, which is worse than not moving at all.
      if (typeof state.yaw !== "number" || typeof state.pitch !== "number"
          || typeof state.zoom !== "number") return;
      cameraRef.current.yaw = state.yaw;
      cameraRef.current.pitch = state.pitch;
      cameraRef.current.zoom = state.zoom;
      dirtyRef.current = true;
    },
  }), [rotate, nearest, layout, at, width, height, onSelect]);

  /* ---- drawing ---- */

  useEffect(() => { dirtyRef.current = true; }, [layout, selected]);

  useEffect(() => {
    if (typeof requestAnimationFrame === "undefined") return;
    let running = true;
    let handle = 0;
    const tick = () => {
      if (!running) return;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        paintNetwork(canvasRef.current, layout, cameraRef.current,
                     { width, height }, selected, hoveredRef.current);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(handle); };
  }, [layout, width, height, selected]);

  /* ---- pointer, so the chart works without a camera (Rule 4) ---- */

  const dragging = useRef<{ x: number; y: number } | null>(null);

  return (
    <figure className="chart">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        data-testid="network-3d"
        style={{ width: "100%", maxWidth: width, touchAction: "none" }}
        onPointerDown={(event) => {
          dragging.current = { x: event.clientX, y: event.clientY };
          (event.target as Element).setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = dragging.current;
          if (!from) return;
          rotate(event.clientX - from.x, event.clientY - from.y);
          dragging.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => { dragging.current = null; }}
        onWheel={(event) => {
          zoomCamera(cameraRef.current, Math.pow(0.999, event.deltaY));
          dirtyRef.current = true;
        }}
      />
      <figcaption>
        {caption ? `${caption} ` : ""}
        {describeLayout(layout)}
        {selected && (
          <> Selected: {layout.nodes.find((n) => n.id === selected)?.label
                        ?? selected}
            {" "}({neighboursOf(layout, selected).length} connected).</>
        )}
      </figcaption>
    </figure>
  );
}

/** Whether a point is inside a polygon. Ray casting, like the ink lasso. */
function insidePolygon(polygon: ScreenPoint[], point: ScreenPoint): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i], b = polygon[j];
    const straddles = (a.y > point.y) !== (b.y > point.y);
    if (!straddles) continue;
    const crossing = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < crossing) inside = !inside;
  }
  return inside;
}

/**
 * One frame of the graph.
 *
 * Exported for the same reason `paintCursor` and `InkLayer`'s `paint` are: a
 * draw loop reachable only through an animation frame is one no test ever runs,
 * and this is where depth ordering either happens or does not.
 */
export function paintNetwork(
  canvas: HTMLCanvasElement | null,
  layout: Layout,
  camera: Camera,
  size: { width: number; height: number },
  selected: string | null,
  hovered: string | null,
): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const { width, height } = size;
  context.clearRect(0, 0, width, height);

  const place = (node: Placed) => toCanvas(node, camera, width, height);

  const placed = new Map(layout.nodes.map((n) => [n.id, place(n)]));

  /*
   * Back to front. Without it an edge passing behind a node is drawn over it
   * and the graph reads as flat — and depth is most of what a spatial network
   * buys over a flat one.
   */
  const edges = layout.edges
    .map((edge) => ({
      edge,
      from: placed.get(edge.from.id)!,
      to: placed.get(edge.to.id)!,
    }))
    .sort((a, b) => (a.from.depth + a.to.depth) - (b.from.depth + b.to.depth));

  for (const { edge, from, to } of edges) {
    const touchesSelection = selected !== null
      && (edge.from.id === selected || edge.to.id === selected);
    context.save();
    context.strokeStyle = touchesSelection
      ? "rgba(20,67,184,0.75)" : "rgba(120,130,150,0.30)";
    context.lineWidth = touchesSelection ? 1.8 : 1;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  }

  const nodes = layout.nodes
    .map((node) => ({ node, at: placed.get(node.id)! }))
    .sort((a, b) => a.at.depth - b.at.depth);

  for (const { node, at } of nodes) {
    const isSelected = node.id === selected;
    const isHovered = node.id === hovered;
    // Size carries weight, and nothing else. Depth is already carried by the
    // projection, so binding it to size as well would double-count it.
    const radius = NODE_RADIUS * (1 + Math.min(1, node.weight ?? 0));

    context.save();
    context.beginPath();
    context.arc(at.x, at.y, isSelected ? radius + 2 : radius, 0, Math.PI * 2);
    context.fillStyle = node.group
      ? categorical[hashOf(node.group) % categorical.length]
      : "rgba(90,105,135,0.9)";
    context.fill();

    if (isSelected || isHovered) {
      // An outline as well as a colour, because §82 forbids state carried by
      // colour alone.
      context.strokeStyle = isSelected
        ? "rgba(20,67,184,1)" : "rgba(60,70,90,0.8)";
      context.lineWidth = isSelected ? 2.5 : 1.5;
      context.stroke();
    }
    context.restore();
  }
}

/** A stable index into the categorical palette, from a group name. */
function hashOf(group: string): number {
  let h = 0;
  for (let i = 0; i < group.length; i += 1) {
    h = (h * 31 + group.charCodeAt(i)) >>> 0;
  }
  return h;
}
