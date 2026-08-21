"use client";

/**
 * P13 — 3D surfaces (Part F).
 *
 * Embedding space in three components, relationship space, and fitted response
 * surfaces over two predictors.
 *
 * **Written against canvas with its own projection, not three.js.** A WebGL
 * scene graph is ~600KB for what is, at this scale, a 4×4 matrix and a sort.
 * The premise of the product is that a researcher installs it on their laptop,
 * and a chart library that costs more than the analysis engine fails that.
 *
 * **The honest position on 3D is that it is usually worse than 2D**, and this
 * component is built to say so rather than to flatter the format:
 *
 *   - **Occlusion loses data.** A point behind another point is not visible.
 *     The count of points currently hidden is computed each frame and shown, so
 *     "I can see everything" is never assumed.
 *   - **A static 3D image cannot be read.** Depth on a flat screen comes from
 *     motion parallax; without rotating it, a projected position is ambiguous.
 *     The chart says this and rotation is a first-class control, not a flourish.
 *   - **Perspective makes near things bigger.** That is a depth cue, and it is
 *     also a size channel the reader may misread as magnitude. So marks encode
 *     value in *colour*, never in radius — radius is depth and nothing else.
 *
 * Motion is user-driven. There is no idle auto-rotation: it would be animation
 * standing between the reader and the data, which the brief forbids, and it
 * makes the frame budget a permanent cost rather than one paid while dragging.
 */

import {
  useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { ScreenPoint, TargetRef, VisualizationController } from "@/lib/spatial/commands";
import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { interpolateYlGnBu } from "d3-scale-chromatic";
import { ChartTable } from "./ChartTable";

export type Point3D = {
  /** Stable identity. */
  id: string;
  /** Display name (Part C). */
  label: string;
  x: number;
  y: number;
  z: number;
  /** What colour encodes. Radius is reserved for depth. */
  value?: number;
};

type Camera = {
  yaw: number;
  pitch: number;
  /**
   * Uniform scale about the cube's centre.
   *
   * Applied to the projected radius rather than to `FOCAL`, so zooming does not
   * change the perspective strength. Moving the eye instead would alter how
   * much nearer marks are enlarged, and mark size is this chart's depth cue —
   * the reader would see the depth encoding shift while they zoomed.
   */
  zoom: number;
};

/** Bounds, so the cloud cannot be lost off-screen or scaled into a dot. */
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 6;

const MARK_RADIUS = 3.4;
const DEPTH_RANGE = 0.55;   // how much perspective may scale a mark
const FOCAL = 2.6;

/** Rotate then project. Returns screen position plus normalised depth. */
function project(p: { x: number; y: number; z: number }, camera: Camera) {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);

  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const y2 = p.y * cp - z1 * sp;
  const z2 = p.y * sp + z1 * cp;

  // Perspective divide. `z2` is toward the viewer, so a larger `z2` is nearer.
  const w = FOCAL / (FOCAL - z2);
  return { x: x1 * w, y: y2 * w, depth: z2, scale: w };
}

export function Volume({
  points, controllerRef, onSelect, xLabel, yLabel, zLabel, valueLabel, title,
  caption, width = 720, height = 520,
}: {
  points: Point3D[];
  /**
   * Exposes this chart as a `VisualizationController`.
   *
   * The one seam any input drives the scene through — mouse, keyboard, hand,
   * and later voice. Optional, because a chart in a report is not being driven
   * by anything and should not pay for the machinery.
   */
  controllerRef?: React.RefObject<VisualizationController | null>;
  /** Told when a point is chosen, so a selection can become AI context. */
  onSelect?: (target: TargetRef | null) => void;
  xLabel: string;
  yLabel: string;
  zLabel: string;
  /** What colour means. Omitted when the points carry no value. */
  valueLabel?: string;
  title?: string;
  caption?: string;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>({ yaw: 0.6, pitch: -0.34, zoom: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  /*
   * Where the pointer went *down*, kept apart from `dragRef`.
   *
   * `dragRef` is reassigned on every move so each frame rotates by one step's
   * delta. Measuring "did this click travel" against it therefore always
   * reports roughly zero, and every drag would end by selecting whatever the
   * finger happened to stop over.
   */
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(true);
  const visibleRef = useRef(true);
  const hoveredRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /*
   * The draw loop reads the selection through a ref, not the state.
   *
   * `draw` is memoised on its dependencies; adding `selected` would rebuild it
   * on every selection and re-run the effect that owns the animation frame. The
   * ref keeps the render loop stable while still letting it see the current
   * value.
   */
  const selectedRef = useRef<string | null>(null);
  const [occluded, setOccluded] = useState(0);
  const [moved, setMoved] = useState(false);

  /** Unit cube, so the three axes are comparable regardless of their units. */
  const normalised = useMemo(() => {
    const span = (key: "x" | "y" | "z") => {
      const [lo, hi] = extent(points, (p) => p[key]) as [number, number];
      return scaleLinear().domain([lo, hi]).range([-1, 1]);
    };
    const sx = span("x"), sy = span("y"), sz = span("z");
    const values = points.map((p) => p.value).filter(
      (v): v is number => v !== undefined);
    const [vlo, vhi] = extent(values) as [number, number];
    const vscale = scaleLinear().domain([vlo ?? 0, vhi ?? 1]).range([0, 1]);
    return points.map((p) => ({
      id: p.id, label: p.label,
      x: sx(p.x), y: sy(p.y), z: sz(p.z),
      colour: p.value === undefined
        ? interpolateYlGnBu(0.62)
        : interpolateYlGnBu(vscale(p.value)),
    }));
  }, [points]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== width * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const camera = cameraRef.current;
    const cx = width / 2, cy = height / 2;
    const unit = Math.min(width, height) * 0.30 * camera.zoom;

    // The bounding cube, so a projected position has a frame to be read against.
    const corners: Array<[number, number, number]> = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7],
                   [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const screen = corners.map(([x, y, z]) => {
      const q = project({ x, y, z }, camera);
      return { x: cx + q.x * unit, y: cy - q.y * unit, depth: q.depth };
    });
    context.strokeStyle = "rgba(128,138,155,0.30)";
    context.lineWidth = 1;
    for (const [a, b] of edges) {
      context.beginPath();
      context.moveTo(screen[a].x, screen[a].y);
      context.lineTo(screen[b].x, screen[b].y);
      context.stroke();
    }

    // Painter's algorithm: far to near, so nearer marks correctly cover
    // farther ones. Drawing in data order would let a distant point paint
    // over a close one and reverse the depth the projection just computed.
    const marks = normalised
      .map((p) => {
        const q = project(p, camera);
        return {
          id: p.id, colour: p.colour,
          x: cx + q.x * unit, y: cy - q.y * unit,
          depth: q.depth,
          r: MARK_RADIUS * (1 + (q.scale - 1) * DEPTH_RANGE),
        };
      })
      .sort((a, b) => a.depth - b.depth);

    let hidden = 0;
    /*
     * Occlusion is counted against a uniform grid rather than against every
     * mark painted so far.
     *
     * The naive version compares each mark to all its predecessors, which is
     * quadratic — a 260-point cloud is ~34,000 distance checks *per frame*, and
     * this redraws on every pointer move during a drag. Since a mark can only
     * hide another within a few pixels, bucketing by that radius makes it
     * linear: each mark checks the nine cells around it and no more.
     */
    const cell = MARK_RADIUS * 3;
    const grid = new Map<string, Array<{ x: number; y: number; r: number }>>();
    const keyAt = (x: number, y: number) =>
      `${Math.floor(x / cell)},${Math.floor(y / cell)}`;

    for (const m of marks) {
      // Counted before painting: a mark this one will cover is one the reader
      // cannot see, and claiming otherwise is the standard 3D lie.
      // Named apart from the canvas centre `cx`/`cy` above: these are cell
      // indices, and shadowing the centre here would be a quiet trap.
      const cellX = Math.floor(m.x / cell);
      const cellY = Math.floor(m.y / cell);
      let covered = false;
      for (let gx = cellX - 1; gx <= cellX + 1 && !covered; gx += 1) {
        for (let gy = cellY - 1; gy <= cellY + 1 && !covered; gy += 1) {
          const bucket = grid.get(`${gx},${gy}`);
          if (!bucket) continue;
          for (const q of bucket) {
            if (Math.hypot(q.x - m.x, q.y - m.y) < Math.max(q.r, m.r) * 0.7) {
              covered = true;
              break;
            }
          }
        }
      }
      if (covered) hidden += 1;

      context.beginPath();
      context.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      context.fillStyle = m.colour;
      // Nearer is more opaque: the second depth cue, since radius alone is
      // weak and the reader must not mistake it for magnitude.
      context.globalAlpha = 0.45 + 0.5 * ((m.depth + 1) / 2);
      context.fill();
      const key = keyAt(m.x, m.y);
      const bucket = grid.get(key);
      if (bucket) bucket.push({ x: m.x, y: m.y, r: m.r });
      else grid.set(key, [{ x: m.x, y: m.y, r: m.r }]);
    }
    context.globalAlpha = 1;
    // Emphasis is painted last, over the finished cloud.
    //
    // Drawn inside the depth sort it would be occluded by nearer marks — the
    // reader would point at something, be told it was found, and see nothing.
    // A ring rather than a colour change, because colour is the value channel
    // here and borrowing it would make a highlighted point read as a different
    // measurement (§20: feedback that does not clutter, and never at the cost
    // of the encoding).
    for (const m of marks) {
      const isSelected = m.id === selectedRef.current;
      const isHovered = m.id === hoveredRef.current;
      if (!isSelected && !isHovered) continue;
      context.beginPath();
      context.arc(m.x, m.y, m.r + (isSelected ? 5 : 3.5), 0, Math.PI * 2);
      context.strokeStyle = isSelected ? "#1443B8" : "rgba(20,67,184,0.55)";
      context.lineWidth = isSelected ? 2 : 1.25;
      context.stroke();
    }

    setOccluded(hidden);
  }, [normalised, width, height]);

  // rAF loop gated on both dirtiness and visibility — an idle chart must not
  // hold a repaint budget it is not using.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (dirtyRef.current && visibleRef.current) {
        dirtyRef.current = false;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const canvas = canvasRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting) dirtyRef.current = true;
      }, { rootMargin: "200px" });
    if (canvas) observer.observe(canvas);

    const onVisibility = () => {
      visibleRef.current = !document.hidden;
      dirtyRef.current = true;
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [draw]);

  useEffect(() => { dirtyRef.current = true; }, [normalised]);

  /**
   * The nearest mark to a screen point, or null.
   *
   * Nearest-within-a-radius rather than exact containment (§7). A researcher
   * pointing at a cloud is indicating a region, not hitting a 3.4px target, and
   * requiring precision would make pointing feel broken rather than forgiving.
   *
   * Runs on demand, never per frame. The draw loop went to some trouble to stay
   * linear, and a hit test on every redraw would undo that.
   */
  const nearest = useCallback((at: ScreenPoint, radius = 28): TargetRef | null => {
    const camera = cameraRef.current;
    const cx = width / 2, cy = height / 2;
    const unit = Math.min(width, height) * 0.30 * camera.zoom;

    let best: { id: string; label: string; datum: Point3D; d: number } | null = null;
    for (let i = 0; i < normalised.length; i += 1) {
      const q = project(normalised[i], camera);
      const sx = cx + q.x * unit;
      const sy = cy - q.y * unit;
      const d = Math.hypot(sx - at.x, sy - at.y);
      // Ties break toward the nearer point in depth: when two marks overlap on
      // screen the front one is the one the reader can actually see, and
      // selecting the hidden one would be indefensible.
      if (d <= radius && (best === null || d < best.d)) {
        best = { id: normalised[i].id, label: normalised[i].label,
                 datum: points[i], d };
      }
    }
    return best ? { id: best.id, label: best.label, datum: best.datum } : null;
  }, [normalised, points, width, height]);

  const rotate = useCallback((dx: number, dy: number) => {
    const camera = cameraRef.current;
    camera.yaw += dx * 0.008;
    // Clamped short of the poles: past vertical the cube flips and the reader
    // loses which way is up.
    camera.pitch = Math.max(-1.35, Math.min(1.35, camera.pitch + dy * 0.008));
    dirtyRef.current = true;
    setMoved(true);
  }, []);

  useImperativeHandle(controllerRef, (): VisualizationController => ({
    rotate: (dx, dy) => rotate(dx, dy),
    zoom: (factor) => {
      const camera = cameraRef.current;
      camera.zoom = Math.min(Math.max(camera.zoom * factor, MIN_ZOOM), MAX_ZOOM);
      dirtyRef.current = true;
      setMoved(true);
    },
    // Panning is not offered rather than stubbed. This chart centres a unit
    // cube; there is nothing off-frame to pan toward, and a control that
    // silently does nothing is worse than one that is absent.
    pan: () => {},
    hover: (at) => {
      const target = nearest(at);
      if ((target?.id ?? null) !== hoveredRef.current) {
        hoveredRef.current = target?.id ?? null;
        dirtyRef.current = true;
      }
      return target;
    },
    select: (at) => {
      const target = nearest(at);
      setSelected(target?.id ?? null);
      dirtyRef.current = true;
      onSelect?.(target);
      return target;
    },
    focus: (objectId) => { setSelected(objectId); dirtyRef.current = true; },
    deselect: () => { setSelected(null); dirtyRef.current = true; onSelect?.(null); },
    resetView: () => {
      cameraRef.current = { yaw: 0.6, pitch: -0.34, zoom: 1 };
      dirtyRef.current = true;
    },
    viewport: () => ({ width, height }),
  }), [nearest, onSelect, rotate, width, height, controllerRef]);

  useEffect(() => {
    selectedRef.current = selected;
    dirtyRef.current = true;
  }, [selected]);

  const hasValue = points.some((p) => p.value !== undefined);
  const tableColumns = [
    { key: "label", header: "Label" },
    { key: "x", header: xLabel, numeric: true },
    { key: "y", header: yLabel, numeric: true },
    { key: "z", header: zLabel, numeric: true },
    ...(hasValue ? [{ key: "value", header: valueLabel ?? "Value", numeric: true }] : []),
  ];
  const tableRows = points.map((p) => ({
    id: p.id, label: p.label, x: p.x, y: p.y, z: p.z, value: p.value,
  }));

  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}

      <canvas
        ref={canvasRef}
        className="chart-canvas volume"
        style={{ width, height, maxWidth: "100%", touchAction: "none" }}
        role="img"
        tabIndex={0}
        aria-label={
          `${title ?? "Three-dimensional scatter"}. ${points.length} points `
          + `positioned by ${xLabel}, ${yLabel} and ${zLabel}`
          + (valueLabel ? `, coloured by ${valueLabel}` : "")
          + `. Drag or use the arrow keys to rotate. `
          + `${occluded} points are currently hidden behind others.`}
        onPointerDown={(event) => {
          dragRef.current = { x: event.clientX, y: event.clientY };
          pressRef.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = dragRef.current;
          if (!from) {
            // Hovering, not dragging. Built for the mouse as well as the hand:
            // a capability reachable only by gesture would make the camera
            // mandatory for part of the chart, which Rule 5 forbids.
            const box = event.currentTarget.getBoundingClientRect();
            const at = { x: event.clientX - box.left, y: event.clientY - box.top };
            const target = nearest(at);
            if ((target?.id ?? null) !== hoveredRef.current) {
              hoveredRef.current = target?.id ?? null;
              dirtyRef.current = true;
            }
            return;
          }
          rotate(event.clientX - from.x, event.clientY - from.y);
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerLeave={() => {
          if (hoveredRef.current !== null) {
            hoveredRef.current = null;
            dirtyRef.current = true;
          }
        }}
        onPointerUp={(event) => {
          const press = pressRef.current;
          dragRef.current = null;
          pressRef.current = null;
          // A click is a pointer that did not travel — measured from where it
          // went down, not from the last move.
          if (!press) return;
          const travelled = Math.hypot(event.clientX - press.x,
                                       event.clientY - press.y);
          if (travelled > 3) return;
          const box = event.currentTarget.getBoundingClientRect();
          const target = nearest({ x: event.clientX - box.left,
                                   y: event.clientY - box.top });
          setSelected(target?.id ?? null);
          onSelect?.(target);
        }}
        onKeyDown={(event) => {
          const step = 12;
          if (event.key === "ArrowLeft") rotate(-step, 0);
          else if (event.key === "ArrowRight") rotate(step, 0);
          else if (event.key === "ArrowUp") rotate(0, -step);
          else if (event.key === "ArrowDown") rotate(0, step);
          else return;
          event.preventDefault();
        }}
      />

      <figcaption className="chart-caption">
        {caption ? `${caption} ` : ""}
        {points.length.toLocaleString()} points positioned by {xLabel},{" "}
        {yLabel} and {zLabel}
        {valueLabel && <>, coloured by {valueLabel} — colour carries the value,
          and mark size carries depth only</>}. The three axes are scaled to a
        cube independently, so distances along different axes are not
        comparable.{" "}
        <b>
          {occluded > 0
            ? `${occluded} of these points are hidden behind others right now.`
            : "No points are currently hidden."}
        </b>{" "}
        Rotate to see them — depth on a flat screen comes from motion, and a
        single still view of a 3D scatter cannot be read reliably.{" "}
        {!moved && "Drag the chart, or focus it and use the arrow keys. "}
        If two of these three variables answer your question, a flat scatter
        will answer it more accurately than this will.
      </figcaption>

      <ChartTable
        columns={tableColumns}
        rows={tableRows}
        label={title ?? `Points positioned by ${xLabel}, ${yLabel} and ${zLabel}`}
      />
    </figure>
  );
}
