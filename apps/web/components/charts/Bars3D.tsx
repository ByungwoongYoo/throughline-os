"use client";

/**
 * Bars drawn in a room (§9 bars, §10).
 *
 * The renderer for the four catalogue entries that share the `bars` primitive —
 * a 3D bar, a 3D column, a waterfall and a 3D histogram — every one of them
 * classified `framed` rather than inherently spatial.
 *
 * **This chart is built to argue against itself.** §10 is explicit that turning
 * an ordinary chart into 3D to look futuristic costs occlusion, perspective
 * distortion and ambiguity, and a bar chart is the clearest case: the third
 * axis is the room, not the data. So the two costs are measured every frame and
 * put in the caption — how many bars are hidden behind others, and how much
 * taller the near row reads for the same value. A reader told both can decide
 * to turn the chart, or to read the flat version instead.
 *
 * **Each bar is four faces, not one quad.** A single filled rectangle would
 * read as a flat sticker; the two visible sides plus the top are what make it a
 * solid, and the top face is what lets the eye find the height. Faces are
 * shaded by orientation rather than lit, so the tone difference between them is
 * constant and a reader is not comparing heights across a lighting gradient.
 */

import {
  useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { ScreenPoint, TargetRef, VisualizationController } from "@/lib/spatial/commands";
import {
  Camera, DEFAULT_CAMERA, resetCamera, rotateCamera, toCanvas, zoomCamera,
} from "@/lib/charts/scene3d";
import { isZoomWheel, wheelZoomFactor } from "@/lib/charts/wheel";
import {
  Bar, Bars, BarSettings, DEFAULT_BARS, PlacedBar, describeBars, hiddenCount,
  perspectiveStretch, prepareBars,
} from "@/lib/charts3d/bars";

export type Bars3DProps = {
  bars: Bar[];
  settings?: BarSettings;
  width?: number;
  height?: number;
  controllerRef?: React.RefObject<VisualizationController | null>;
  onSelect?: (target: TargetRef | null) => void;
  caption?: string;
};

/** How near a pointer must be, in pixels, to count as on a bar. */
const PICK_RADIUS = 18;

/** Tone per face, so the sides read as sides rather than as different values. */
const FACE = { top: 1.0, left: 0.78, right: 0.6 };

export function Bars3D({
  bars, settings = DEFAULT_BARS, width = 720, height = 520, controllerRef,
  onSelect, caption,
}: Bars3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<Camera>({ ...DEFAULT_CAMERA });
  const dirtyRef = useRef(true);
  const [selected, setSelected] = useState<number | null>(null);
  /*
   * The two costs of the third dimension, measured from the current view.
   *
   * Recomputed when the camera moves, because both of them change as it does —
   * a caption that measured them once would state the occlusion of a view the
   * reader has since turned away from.
   */
  const [costs, setCosts] = useState({ hidden: 0, stretch: 1 });

  const prepared: Bars = useMemo(
    () => prepareBars(bars, settings), [bars, settings]);

  const at = useCallback((bar: PlacedBar) => {
    // The top of the bar: what a reader points at and what they compare.
    return toCanvas({ x: bar.x, y: bar.top, z: bar.z },
                    cameraRef.current, width, height);
  }, [width, height]);

  const measure = useCallback(() => {
    const camera = cameraRef.current;
    setCosts({
      hidden: hiddenCount(prepared.bars,
        (bar) => toCanvas({ x: bar.x, y: bar.top, z: bar.z },
                          camera, width, height), PICK_RADIUS),
      stretch: perspectiveStretch(prepared.bars,
        (bar) => toCanvas({ x: bar.x, y: bar.top, z: bar.z },
                          camera, width, height).scale),
    });
  }, [prepared, width, height]);

  useEffect(() => { measure(); }, [measure]);

  const nearest = useCallback((point: ScreenPoint): TargetRef | null => {
    let best: TargetRef | null = null;
    let bestDepth = -Infinity;
    prepared.bars.forEach((bar, index) => {
      const q = at(bar);
      if (Math.hypot(q.x - point.x, q.y - point.y) > PICK_RADIUS) return;
      // The nearest under the pointer: in a grid of bars the hidden ones are
      // exactly what the reader cannot see and did not point at.
      if (q.depth <= bestDepth) return;
      bestDepth = q.depth;
      best = { id: String(index),
               label: bar.label ?? `${Number(bar.value.toPrecision(4))}`,
               datum: bar };
    });
    return best;
  }, [prepared, at]);

  const rotate = useCallback((dx: number, dy: number) => {
    rotateCamera(cameraRef.current, dx, dy);
    dirtyRef.current = true;
    measure();
  }, [measure]);

  useImperativeHandle(controllerRef, (): VisualizationController => ({
    rotate,
    zoom: (factor) => {
      zoomCamera(cameraRef.current, factor);
      dirtyRef.current = true;
      measure();
    },
    pan: () => {},
    hover: (point) => nearest(point),
    select: (point) => {
      const target = nearest(point);
      setSelected(target ? Number(target.id) : null);
      onSelect?.(target);
      return target;
    },
    selectRegion: (point, radius) => within(
      prepared, at, (p) => Math.hypot(p.x - point.x, p.y - point.y) <= radius),
    withinPolygon: (polygon) => within(prepared, at,
                                       (p) => insidePolygon(polygon, p)),
    focus: (objectId) => {
      const index = Number(objectId);
      if (!Number.isInteger(index) || index < 0
          || index >= prepared.bars.length) return;
      setSelected(index);
    },
    deselect: () => setSelected(null),
    resetView: () => {
      resetCamera(cameraRef.current);
      dirtyRef.current = true;
      measure();
    },
    viewport: () => ({ width, height }),
    bounds: () => {
      const box = canvasRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return null;
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    },
    viewState: () => ({ yaw: cameraRef.current.yaw,
                        pitch: cameraRef.current.pitch,
                        zoom: cameraRef.current.zoom }),
    restoreViewState: (state) => {
      const keys = ["yaw", "pitch", "zoom"] as const;
      if (keys.some((k) => typeof state[k] !== "number")) return;
      cameraRef.current.yaw = state.yaw;
      cameraRef.current.pitch = state.pitch;
      cameraRef.current.zoom = state.zoom;
      dirtyRef.current = true;
      measure();
    },
  }), [rotate, nearest, prepared, at, width, height, onSelect, measure]);

  useEffect(() => { dirtyRef.current = true; }, [prepared, selected]);

  useEffect(() => {
    if (typeof requestAnimationFrame === "undefined") return;
    let running = true;
    let handle = 0;
    const tick = () => {
      if (!running) return;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        paintBars(canvasRef.current, prepared, cameraRef.current,
                  { width, height }, selected);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(handle); };
  }, [prepared, width, height, selected]);

  const dragging = useRef<{ x: number; y: number } | null>(null);

  return (
    <figure className="chart">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        data-testid="bars-3d"
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
          if (!isZoomWheel(event)) return;
          event.preventDefault();
          zoomCamera(cameraRef.current, wheelZoomFactor(event.deltaY));
          dirtyRef.current = true;
          measure();
        }}
      />
      <figcaption className="chart-caption">
        {caption ? `${caption} ` : ""}
        {describeBars(prepared, costs.hidden, costs.stretch)}
        {selected !== null && prepared.bars[selected] && (
          <> Selected: {Number(prepared.bars[selected].value.toPrecision(4))}.</>
        )}
      </figcaption>
    </figure>
  );
}

function within(prepared: Bars, at: (b: PlacedBar) => { x: number; y: number },
                inside: (p: { x: number; y: number }) => boolean): TargetRef[] {
  const found: TargetRef[] = [];
  prepared.bars.forEach((bar, index) => {
    if (!inside(at(bar))) return;
    found.push({ id: String(index),
                 label: bar.label ?? `${Number(bar.value.toPrecision(4))}`,
                 datum: bar });
  });
  return found;
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

/** The fill for one face of a bar at a given level. */
export function barColour(level: number, face: keyof typeof FACE): string {
  const t = Math.max(0, Math.min(1, level));
  const shade = FACE[face];
  return `rgb(${Math.round((70 + 150 * t) * shade)},`
       + `${Math.round((110 + 90 * t) * shade)},`
       + `${Math.round((190 - 40 * t) * shade)})`;
}

/**
 * One frame of the bars.
 *
 * Exported for the same reason the other painters are: a draw loop reachable
 * only through an animation frame is one no test ever runs, and here that is
 * where the occlusion the caption reports either happens or does not.
 */
export function paintBars(
  canvas: HTMLCanvasElement | null,
  prepared: Bars,
  camera: Camera,
  size: { width: number; height: number },
  selected: number | null,
): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const { width, height } = size;
  context.clearRect(0, 0, width, height);

  const project = (x: number, y: number, z: number) =>
    toCanvas({ x, y, z }, camera, width, height);

  const order = drawOrder(prepared, camera, size);

  for (const { bar, index } of order) {
    const h = bar.half;
    // The four base corners and the four top corners.
    const corners = [
      [-h, -h], [h, -h], [h, h], [-h, h],
    ].map(([dx, dz]) => ({
      base: project(bar.x + dx, bar.base, bar.z + dz),
      top: project(bar.x + dx, bar.top, bar.z + dz),
    }));

    /*
     * All four sides, drawn back to front, rather than the two that face the
     * viewer.
     *
     * Culling by projected winding was the first attempt and it was wrong on
     * screen: it selected two *opposite* faces rather than two adjacent ones,
     * so each bar came out as a floating top with a spike under it. The winding
     * of a side quad depends on the corner order it was built with as well as
     * on the camera, and getting that consistent for all four is fiddly in a
     * way that produces a plausible-looking wrong picture.
     *
     * Four quads sorted by their own depth is provably right for a convex box:
     * the near faces are drawn last and cover the far ones exactly. The cost is
     * two extra fills per bar, which is nothing, and the result cannot be
     * subtly wrong.
     */
    const faces: Array<[number, number, keyof typeof FACE]> = [
      [0, 1, "left"], [1, 2, "right"], [2, 3, "left"], [3, 0, "right"],
    ];

    context.save();
    const sides = faces
      .map(([i, j, tone]) => ({
        quad: [corners[i].base, corners[j].base, corners[j].top, corners[i].top],
        tone,
        depth: (corners[i].base.depth + corners[j].base.depth) / 2,
      }))
      .sort((a, b) => a.depth - b.depth);

    for (const side of sides) {
      fillPath(context, side.quad, barColour(bar.level, side.tone));
    }

    // The top last, so it sits over the sides it shares an edge with.
    fillPath(context, corners.map((c) => c.top), barColour(bar.level, "top"));

    if (index === selected) {
      context.strokeStyle = "rgba(20,67,184,0.95)";
      context.lineWidth = 2;
      context.beginPath();
      corners.forEach((c, i) => {
        if (i === 0) context.moveTo(c.top.x, c.top.y);
        else context.lineTo(c.top.x, c.top.y);
      });
      context.closePath();
      context.stroke();
    }
    context.restore();
  }
}

/**
 * The bars, back to front.
 *
 * Ordered by the *base* rather than the top: the height is the data, and where
 * a bar stands on the floor is what decides which is in front. Sorting by the
 * top would put a short near bar behind a tall far one and the grid would
 * interleave.
 *
 * Exported because it is the ordering decision, and a decision buried in a draw
 * loop is one no test reaches.
 */
export function drawOrder(prepared: Bars, camera: Camera,
                          size: { width: number; height: number }) {
  return prepared.bars
    .map((bar, index) => ({
      bar, index,
      at: toCanvas({ x: bar.x, y: bar.base, z: bar.z },
                   camera, size.width, size.height),
    }))
    .sort((a, b) => a.at.depth - b.at.depth);
}

function fillPath(context: CanvasRenderingContext2D,
                  points: Array<{ x: number; y: number }>, fill: string): void {
  context.fillStyle = fill;
  // Stroked in its own colour as well: canvas antialiasing leaves a hairline of
  // background between abutting fills, and a bar cracked along every edge reads
  // as a rendering fault.
  context.strokeStyle = fill;
  context.lineWidth = 0.6;
  context.beginPath();
  points.forEach((p, i) => {
    if (i === 0) context.moveTo(p.x, p.y);
    else context.lineTo(p.x, p.y);
  });
  context.closePath();
  context.fill();
  context.stroke();
}
