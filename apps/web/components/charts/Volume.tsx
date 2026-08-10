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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { interpolateYlGnBu } from "d3-scale-chromatic";

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

type Camera = { yaw: number; pitch: number };

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
  points, xLabel, yLabel, zLabel, valueLabel, title, caption,
  width = 720, height = 520,
}: {
  points: Point3D[];
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
  const cameraRef = useRef<Camera>({ yaw: 0.6, pitch: -0.34 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(true);
  const visibleRef = useRef(true);
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
    const unit = Math.min(width, height) * 0.30;

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
    const painted: Array<{ x: number; y: number; r: number }> = [];
    for (const m of marks) {
      // Counted before painting: a mark this one will cover is one the reader
      // cannot see, and claiming otherwise is the standard 3D lie.
      if (painted.some((q) => {
        const dx = q.x - m.x, dy = q.y - m.y;
        return Math.hypot(dx, dy) < Math.max(q.r, m.r) * 0.7;
      })) hidden += 1;

      context.beginPath();
      context.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      context.fillStyle = m.colour;
      // Nearer is more opaque: the second depth cue, since radius alone is
      // weak and the reader must not mistake it for magnitude.
      context.globalAlpha = 0.45 + 0.5 * ((m.depth + 1) / 2);
      context.fill();
      painted.push({ x: m.x, y: m.y, r: m.r });
    }
    context.globalAlpha = 1;
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

  const rotate = useCallback((dx: number, dy: number) => {
    const camera = cameraRef.current;
    camera.yaw += dx * 0.008;
    // Clamped short of the poles: past vertical the cube flips and the reader
    // loses which way is up.
    camera.pitch = Math.max(-1.35, Math.min(1.35, camera.pitch + dy * 0.008));
    dirtyRef.current = true;
    setMoved(true);
  }, []);

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
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = dragRef.current;
          if (!from) return;
          rotate(event.clientX - from.x, event.clientY - from.y);
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => { dragRef.current = null; }}
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
    </figure>
  );
}
