"use client";

/**
 * P15 — a fitted surface over two predictors.
 *
 * The second chart in this product where three dimensions are the honest choice
 * rather than a decoration, and it is worth saying why, because the argument is
 * the same one that rules 3D *out* almost everywhere else.
 *
 * A bar chart in 3D is worse than a bar chart: perspective makes near bars
 * larger, occlusion hides the ones behind, and reading a value off a rotated
 * axis is measurably less accurate than reading it off a flat one. Nothing is
 * gained, because the data has one dimension and the picture has three.
 *
 * A response surface is different in kind. `z = f(x, y)` *is* a two-dimensional
 * manifold in three-space — the third dimension is in the data, not added to it.
 * Flattened to a contour plot it stays readable but loses the shape a researcher
 * is usually looking for: whether the surface has a ridge, a saddle, a plateau,
 * or a single optimum. That shape is what rotating reveals, and it is the reason
 * §3 lists mathematical surfaces and fitted responses among the visualizations
 * where spatial manipulation genuinely helps.
 *
 * **What this chart owes the reader, and says.**
 *
 *   - **A fitted surface is a model, not data.** It shows what the fit predicts
 *     at points nobody measured. The observations are drawn on top so the two
 *     are never confused, and the caption says how many there were.
 *   - **A surface hides what is behind it**, far more completely than a cloud of
 *     points does. The count of observations currently occluded is reported for
 *     the same reason P13 reports hidden points.
 *   - **Extrapolation is marked.** Cells of the grid with no observation nearby
 *     are drawn faintly, because the smoothest part of a fitted surface is
 *     usually the part with no data under it.
 */

import {
  useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import {
  Camera, DEFAULT_CAMERA, DEPTH_RANGE, project, resetCamera, rotateCamera,
  toCanvas, unitScale, zoomCamera,
} from "@/lib/charts/scene3d";
import { ScreenPoint, TargetRef, VisualizationController } from "@/lib/spatial/commands";
import { interpolateYlGnBu } from "d3-scale-chromatic";
import { ChartTable } from "./ChartTable";

export type SurfaceObservation = {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
};

export type SurfaceGrid = {
  /** Ascending predictor values along each axis. */
  x: number[];
  y: number[];
  /** `z[yIndex][xIndex]` — the fitted response. `null` where the fit declines. */
  z: Array<Array<number | null>>;
};

/**
 * How far from an observation a cell may sit before it is drawn as extrapolation,
 * as a fraction of the grid's extent.
 *
 * A judgement, stated so it can be argued with. Too small and a sparse but
 * perfectly reasonable design is greyed out everywhere; too large and the
 * warning stops meaning anything.
 */
const SUPPORT_RADIUS = 0.18;

export function Surface({
  grid, observations = [], controllerRef, onSelect, onDetent,
  xLabel, yLabel, zLabel, title, caption, width = 720, height = 520,
}: {
  grid: SurfaceGrid;
  /** What was actually measured. Drawn over the fit, never merged into it. */
  observations?: SurfaceObservation[];
  controllerRef?: React.RefObject<VisualizationController | null>;
  onSelect?: (target: TargetRef | null) => void;
  onDetent?: (moment: "hover" | "select") => void;
  xLabel: string;
  yLabel: string;
  zLabel: string;
  title?: string;
  caption?: string;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>({ ...DEFAULT_CAMERA });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(true);
  const focusedRef = useRef(false);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const hiddenRef = useRef(0);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The fit and the observations placed in one shared unit cube. */
  const scene = useMemo(() => {
    const zValues = grid.z.flat().filter((v): v is number => v !== null);
    const allZ = [...zValues, ...observations.map((o) => o.z)];
    const sx = unitScale(grid.x);
    const sy = unitScale(grid.y);
    const sz = unitScale(allZ.length ? allZ : [0, 1]);

    const lo = Math.min(...(allZ.length ? allZ : [0]));
    const hi = Math.max(...(allZ.length ? allZ : [1]));
    const colourOf = (z: number) =>
      interpolateYlGnBu(hi === lo ? 0.5 : (z - lo) / (hi - lo));

    // Support is measured in the normalised square, so it does not depend on
    // whichever units the two predictors happen to be in.
    const support = observations.map((o) => ({ x: sx(o.x), y: sy(o.y) }));
    const supported = (nx: number, ny: number) =>
      support.length === 0
      || support.some((s) => Math.hypot(s.x - nx, s.y - ny) <= SUPPORT_RADIUS * 2);

    return {
      sx, sy, sz, colourOf, supported,
      points: observations.map((o) => ({
        id: o.id, label: o.label, datum: o,
        x: sx(o.x), y: sz(o.z), z: sy(o.y),
      })),
    };
  }, [grid, observations]);

  /**
   * The mesh as quads, each with its own depth.
   *
   * Quads rather than a single path: a surface has to be drawn back to front or
   * the far side paints over the near side, and that sort has to happen per
   * cell. A wireframe would avoid the sort and also avoid conveying the shape,
   * which is the only reason this chart exists.
   */
  const cells = useMemo(() => {
    const out: Array<{
      corners: Array<{ x: number; y: number; z: number }>;
      z: number; supported: boolean;
    }> = [];
    for (let j = 0; j + 1 < grid.y.length; j += 1) {
      for (let i = 0; i + 1 < grid.x.length; i += 1) {
        const quad = [[j, i], [j, i + 1], [j + 1, i + 1], [j + 1, i]] as const;
        const heights = quad.map(([qj, qi]) => grid.z[qj]?.[qi]);
        if (heights.some((h) => h === null || h === undefined)) continue;

        const corners = quad.map(([qj, qi], k) => ({
          x: scene.sx(grid.x[qi]),
          y: scene.sz(heights[k] as number),
          z: scene.sy(grid.y[qj]),
        }));
        const mean = (heights as number[]).reduce((a, b) => a + b, 0) / 4;
        const nx = (scene.sx(grid.x[i]) + scene.sx(grid.x[i + 1])) / 2;
        const ny = (scene.sy(grid.y[j]) + scene.sy(grid.y[j + 1])) / 2;
        out.push({ corners, z: mean, supported: scene.supported(nx, ny) });
      }
    }
    return out;
  }, [grid, scene]);

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

    // Painter's algorithm over the cells: far to near, so a near cell covers a
    // far one and the surface reads as solid rather than as a tangle.
    const painted = cells
      .map((cell) => {
        const screen = cell.corners.map((c) => toCanvas(c, camera, width, height));
        const depth = screen.reduce((sum, s) => sum + s.depth, 0) / screen.length;
        return { ...cell, screen, depth };
      })
      .sort((a, b) => a.depth - b.depth);

    for (const cell of painted) {
      context.beginPath();
      context.moveTo(cell.screen[0].x, cell.screen[0].y);
      for (const corner of cell.screen.slice(1)) context.lineTo(corner.x, corner.y);
      context.closePath();
      context.fillStyle = scene.colourOf(cell.z);
      // Unsupported cells are drawn faintly. The smoothest part of a fitted
      // surface is usually the part with no data under it, and a reader has no
      // way to tell that from the shape alone.
      context.globalAlpha = cell.supported ? 0.92 : 0.28;
      context.fill();
      context.globalAlpha = cell.supported ? 0.5 : 0.2;
      context.strokeStyle = "rgba(20,30,50,0.55)";
      context.lineWidth = 0.5;
      context.stroke();
    }
    context.globalAlpha = 1;

    // Observations last, over the fit, and never merged into it: the surface is
    // a model and these are the measurements it was fitted to.
    let hidden = 0;
    for (const point of scene.points) {
      const at = toCanvas(point, camera, width, height);
      const radius = 3.2 * (1 + (at.scale - 1) * DEPTH_RANGE);

      // Behind the surface if a cell nearer the viewer covers this position.
      const covered = painted.some((cell) =>
        cell.depth > at.depth + 0.02 && insideQuad(at, cell.screen));
      if (covered) { hidden += 1; continue; }

      context.beginPath();
      context.arc(at.x, at.y, radius, 0, Math.PI * 2);
      context.fillStyle = "#12203a";
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = "rgba(255,255,255,0.85)";
      context.stroke();

      if (point.id === selectedRef.current || point.id === hoveredRef.current) {
        context.beginPath();
        context.arc(at.x, at.y, radius + 4, 0, Math.PI * 2);
        context.strokeStyle = point.id === selectedRef.current
          ? "#1443B8" : "rgba(20,67,184,0.55)";
        context.lineWidth = point.id === selectedRef.current ? 2 : 1.25;
        context.stroke();
      }
    }

    if (focusedRef.current) {
      const cx = width / 2, cy = height / 2;
      context.strokeStyle = "rgba(20,67,184,0.55)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(cx - 7, cy); context.lineTo(cx - 2, cy);
      context.moveTo(cx + 2, cy); context.lineTo(cx + 7, cy);
      context.moveTo(cx, cy - 7); context.lineTo(cx, cy - 2);
      context.moveTo(cx, cy + 2); context.lineTo(cx, cy + 7);
      context.stroke();
    }

    hiddenRef.current = hidden;
    if (settleRef.current !== null) clearTimeout(settleRef.current);
    // Published once the view settles, for the same reason P13 does it: a count
    // that changes eight times a second while the scene turns is unreadable and
    // costs a React render per painted frame.
    settleRef.current = setTimeout(() => {
      settleRef.current = null;
      setHiddenCount(hiddenRef.current);
    }, 120);
  }, [cells, scene, width, height]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (dirtyRef.current) { dirtyRef.current = false; draw(); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (settleRef.current !== null) clearTimeout(settleRef.current);
    };
  }, [draw]);

  useEffect(() => { dirtyRef.current = true; }, [cells]);
  useEffect(() => { selectedRef.current = selected; dirtyRef.current = true; },
            [selected]);

  const nearest = useCallback((at: ScreenPoint, radius = 28): TargetRef | null => {
    const camera = cameraRef.current;
    let best: { target: TargetRef; d: number } | null = null;
    for (const point of scene.points) {
      const p = toCanvas(point, camera, width, height);
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (d <= radius && (best === null || d < best.d)) {
        best = { target: { id: point.id, label: point.label, datum: point.datum }, d };
      }
    }
    return best?.target ?? null;
  }, [scene, width, height]);

  useImperativeHandle(controllerRef, (): VisualizationController => ({
    rotate: (dx, dy) => { rotateCamera(cameraRef.current, dx, dy); dirtyRef.current = true; },
    zoom: (factor) => { zoomCamera(cameraRef.current, factor); dirtyRef.current = true; },
    pan: () => {},
    hover: (at) => {
      const target = nearest(at);
      hoveredRef.current = target?.id ?? null;
      dirtyRef.current = true;
      return target;
    },
    select: (at) => {
      const target = nearest(at);
      setSelected(target?.id ?? null);
      onSelect?.(target);
      return target;
    },
    withinPolygon: (polygon) => {
      // Exact, like the scatter's: every observation tested against the region
      // rather than the region sampled for observations.
      const camera = cameraRef.current;
      return scene.points
        .map((point) => ({ point, at: toCanvas(point, camera, width, height) }))
        .filter(({ at }) => insideQuad(at, polygon))
        .map(({ point }) =>
          ({ id: point.id, label: point.label, datum: point.datum }));
    },
    selectRegion: (at, radius) => {
      const camera = cameraRef.current;
      const found = scene.points
        .map((point) => ({ point, at: toCanvas(point, camera, width, height) }))
        .map(({ point, at: p }) => ({ point, d: Math.hypot(p.x - at.x, p.y - at.y) }))
        .filter(({ d }) => d <= radius)
        .sort((a, b) => a.d - b.d)
        .map(({ point }) =>
          ({ id: point.id, label: point.label, datum: point.datum }));
      setSelected(found[0]?.id ?? null);
      return found;
    },
    focus: (objectId) => { setSelected(objectId); dirtyRef.current = true; },
    deselect: () => { setSelected(null); dirtyRef.current = true; onSelect?.(null); },
    resetView: () => { resetCamera(cameraRef.current); dirtyRef.current = true; },
    viewport: () => ({ width, height }),
  }), [nearest, onSelect, scene, width, height]);

  const rows = observations.map((o) => ({
    label: o.label, x: o.x, y: o.y, z: o.z,
  }));
  const columns = [
    { key: "label", header: "Observation" },
    { key: "x", header: xLabel, numeric: true },
    { key: "y", header: yLabel, numeric: true },
    { key: "z", header: zLabel, numeric: true },
  ];

  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}
      <canvas
        ref={canvasRef}
        className="chart-canvas volume"
        style={{ width, height: "auto", aspectRatio: `${width} / ${height}`,
                 maxWidth: "100%", touchAction: "none" }}
        role="img"
        tabIndex={0}
        aria-label={
          `${title ?? "Fitted surface"}. ${zLabel} predicted from ${xLabel} and `
          + `${yLabel}, over ${observations.length} observations. `
          + `Arrow keys rotate, plus and minus zoom, Home resets the view. `
          + `Enter selects the observation nearest the centre, Escape clears it.`}
        onFocus={() => { focusedRef.current = true; dirtyRef.current = true; }}
        onBlur={() => { focusedRef.current = false; dirtyRef.current = true; }}
        onPointerDown={(event) => {
          dragRef.current = { x: event.clientX, y: event.clientY };
          pressRef.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = dragRef.current;
          const box = event.currentTarget.getBoundingClientRect();
          const at = { x: event.clientX - box.left, y: event.clientY - box.top };
          if (!from) {
            const target = nearest(at);
            if (target && target.id !== hoveredRef.current) onDetent?.("hover");
            if ((target?.id ?? null) !== hoveredRef.current) {
              hoveredRef.current = target?.id ?? null;
              dirtyRef.current = true;
            }
            return;
          }
          rotateCamera(cameraRef.current, event.clientX - from.x,
                       event.clientY - from.y);
          dirtyRef.current = true;
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const press = pressRef.current;
          dragRef.current = null;
          pressRef.current = null;
          if (!press) return;
          if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3) return;
          const box = event.currentTarget.getBoundingClientRect();
          const target = nearest({ x: event.clientX - box.left,
                                   y: event.clientY - box.top });
          setSelected(target?.id ?? null);
          if (target) onDetent?.("select");
          onSelect?.(target);
        }}
        onWheel={(event) => {
          zoomCamera(cameraRef.current, event.deltaY < 0 ? 1.08 : 1 / 1.08);
          dirtyRef.current = true;
        }}
        onKeyDown={(event) => {
          const step = 12;
          if (event.key === "ArrowLeft") rotateCamera(cameraRef.current, -step, 0);
          else if (event.key === "ArrowRight") rotateCamera(cameraRef.current, step, 0);
          else if (event.key === "ArrowUp") rotateCamera(cameraRef.current, 0, -step);
          else if (event.key === "ArrowDown") rotateCamera(cameraRef.current, 0, step);
          else if (event.key === "+" || event.key === "=") zoomCamera(cameraRef.current, 1.15);
          else if (event.key === "-" || event.key === "_") zoomCamera(cameraRef.current, 1 / 1.15);
          else if (event.key === "Home") resetCamera(cameraRef.current);
          else if (event.key === "Enter" || event.key === " ") {
            const target = nearest({ x: width / 2, y: height / 2 }, 60);
            setSelected(target?.id ?? null);
            if (target) onDetent?.("select");
            onSelect?.(target);
          } else if (event.key === "Escape") {
            setSelected(null);
            onSelect?.(null);
          } else return;
          dirtyRef.current = true;
          event.preventDefault();
        }}
      />

      <figcaption className="chart-caption">
        {caption}{" "}
        <strong>This surface is a fit, not data.</strong> It shows what the model
        predicts at points nobody measured; the {observations.length} observations
        it was fitted to are drawn on top.{" "}
        {hiddenCount > 0
          ? <><strong>{hiddenCount} of them are behind the surface right now.</strong>{" "}
              Rotate to see them.</>
          : "No observations are hidden behind the surface right now."}{" "}
        Faint cells have no observation near them — the smoothest part of a
        fitted surface is usually the part with no data under it. The three axes
        are scaled independently, so distances along different axes are not
        comparable.
      </figcaption>

      <ChartTable
        rows={rows}
        columns={columns}
        label="the observations this surface was fitted to"
        note="The surface itself is a fit and has no rows: it is defined
              everywhere, including where nothing was measured." />
    </figure>
  );
}

/** Whether a point falls inside a projected quad, by the winding test. */
function insideQuad(point: { x: number; y: number },
                    quad: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i, i += 1) {
    const a = quad[i];
    const b = quad[j];
    if ((a.y > point.y) !== (b.y > point.y)
        && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
