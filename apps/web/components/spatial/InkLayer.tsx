"use client";

/**
 * Drawing the ink, on two canvases rather than one.
 *
 * The obvious implementation keeps every stroke in one canvas and repaints the
 * lot each frame. It is correct, and it degrades in exactly the way that makes
 * air drawing unusable: the cost per frame grows with how much the researcher
 * has already drawn, so the line lags more the longer the session goes on. A
 * subsystem whose whole purpose is hiding tens of milliseconds of latency cannot
 * afford to add its own, and it must not add *increasing* latency, because that
 * is the kind people blame on their machine rather than report (§146–147).
 *
 * So the layers are split by how often they change:
 *
 *   - **committed** — every finished stroke. Repainted only when that set
 *     changes: a stroke ends, an undo, a clear. Usually not for seconds at a
 *     time, however much is on it.
 *   - **live** — the one stroke being drawn. Repainted every frame, and holds at
 *     most a few hundred points, so the per-frame cost is flat no matter how
 *     many strokes are underneath.
 *
 * Neither repaint goes through React. Frames arrive around thirty times a
 * second; re-rendering a tree at that rate is the cost the spatial session was
 * rewritten to remove, and re-introducing it here would slow down the chart the
 * ink is drawn over as well as the ink.
 */

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from "react";
import { HandFrame } from "@/lib/spatial/types";
import { InkRecorder, RecorderOptions } from "@/lib/ink/recorder";
import { InkState } from "@/lib/ink/machine";
import { SpatialStroke, StrokePoint } from "@/lib/ink/stroke";

export type InkSurface = {
  /** Feed a tracked frame. Safe to call at tracker rate. */
  step: (frame: HandFrame) => void;
  arm: () => void;
  disarm: () => void;
  clear: () => void;
  undo: () => void;
  strokes: () => SpatialStroke[];
  state: () => InkState;
};

export const InkLayer = forwardRef<InkSurface, {
  /** Whether the pen is available at all. The first of the two locks (§139). */
  armed: boolean;
  options?: RecorderOptions;
  /** Told when a stroke is finished, so a host can offer to act on it. */
  onStroke?: (stroke: SpatialStroke) => void;
  /** Told when the pen state changes, for a status line. Never per frame. */
  onState?: (state: InkState) => void;
}>(function InkLayer({ armed, options, onStroke, onState }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const committedRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<InkRecorder | null>(null);
  /**
   * Repaint flags, as refs rather than state.
   *
   * Setting state per frame would re-render this component and everything it
   * sits over thirty times a second to move a line by three pixels.
   */
  const liveDirty = useRef(false);
  const committedDirty = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Callbacks are read through a ref so a host passing an inline arrow does not
  // have to memoise it to avoid rebuilding the recorder — and, more importantly,
  // so the recorder never ends up holding a closure over stale props.
  const handlers = useRef({ onStroke, onState });
  handlers.current = { onStroke, onState };

  if (!recorderRef.current) recorderRef.current = new InkRecorder(options);

  /** Match the backing store to the display, or every line is soft. */
  const resize = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    setSize({ width, height });
    recorderRef.current?.setViewport({ width, height });
    // A repaint is required, not optional: resizing a canvas clears it, so the
    // committed layer is blank until it is redrawn — and it is the layer that
    // may not be repainted again for a minute.
    committedDirty.current = true;
    liveDirty.current = true;
  }, []);

  useEffect(() => {
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    if (hostRef.current) observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [resize]);

  useEffect(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (armed) recorder.arm();
    else recorder.disarm();
    handlers.current.onState?.(recorder.state());
    committedDirty.current = true;
    liveDirty.current = true;
  }, [armed]);

  useImperativeHandle(ref, (): InkSurface => ({
    step(frame: HandFrame) {
      const recorder = recorderRef.current;
      if (!recorder) return;
      const result = recorder.step(frame);
      if (result.open || result.events.length) liveDirty.current = true;
      if (result.committed) {
        committedDirty.current = true;
        const strokes = recorder.strokes();
        handlers.current.onStroke?.(strokes[strokes.length - 1]);
      }
      // State is published on change only. Pushing it per frame would re-render
      // the host's status line thirty times a second to write the same word.
      if (result.events.length) handlers.current.onState?.(recorder.state());
    },
    arm() { recorderRef.current?.arm(); },
    disarm() {
      recorderRef.current?.disarm();
      committedDirty.current = true;
      liveDirty.current = true;
    },
    clear() {
      recorderRef.current?.clear();
      committedDirty.current = true;
      liveDirty.current = true;
    },
    undo() {
      recorderRef.current?.undo();
      committedDirty.current = true;
    },
    strokes() { return recorderRef.current?.strokes() ?? []; },
    state() { return recorderRef.current?.state() ?? "DISABLED"; },
  }), []);

  // The paint loop. One animation frame, repainting only what is dirty.
  useEffect(() => {
    if (typeof requestAnimationFrame === "undefined") return;
    let running = true;
    let handle = 0;

    const tick = () => {
      if (!running) return;
      const recorder = recorderRef.current;
      if (recorder) {
        if (committedDirty.current) {
          committedDirty.current = false;
          paint(committedRef.current, recorder.strokes(), size);
        }
        if (liveDirty.current) {
          liveDirty.current = false;
          const open = recorder.openStroke();
          paint(liveRef.current, open ? [open] : [], size);
        }
      }
      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(handle); };
  }, [size]);

  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const canvasStyle = {
    position: "absolute" as const, inset: 0,
    width: "100%", height: "100%",
    // The ink is an overlay: it must never eat the clicks meant for what it is
    // drawn over. Nothing here is interactive — the hand is the input.
    pointerEvents: "none" as const,
  };

  return (
    <div ref={hostRef} data-testid="ink-layer"
         style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <canvas ref={committedRef} data-testid="ink-committed" aria-hidden="true"
              width={Math.round(size.width * dpr)}
              height={Math.round(size.height * dpr)} style={canvasStyle} />
      <canvas ref={liveRef} data-testid="ink-live" aria-hidden="true"
              width={Math.round(size.width * dpr)}
              height={Math.round(size.height * dpr)} style={canvasStyle} />
    </div>
  );
});

/**
 * Paint a set of strokes onto one canvas, replacing whatever was there.
 *
 * Exported for testing: the draw loop is the part whose cost is paid per frame,
 * and leaving it reachable only through an animation frame in happy-dom means it
 * is the part no test ever runs. That was true of the volume chart's painter for
 * most of its life.
 */
export function paint(canvas: HTMLCanvasElement | null,
                      strokes: SpatialStroke[],
                      size: { width: number; height: number }): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const dpr = canvas.width && size.width ? canvas.width / size.width : 1;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, size.width, size.height);

  for (const stroke of strokes) {
    const points = stroke.points.length ? stroke.points : stroke.originalPoints;
    if (points.length < 2) {
      // A single point is not drawn as a line, and drawing it as a dot would
      // reintroduce exactly the stray mark the two-frame contact rule removes.
      continue;
    }
    context.lineWidth = stroke.style.width;
    context.strokeStyle = stroke.style.colour;
    context.globalAlpha = stroke.style.opacity;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (stroke.style.dashed) context.setLineDash([6, 5]);
    else context.setLineDash([]);

    context.beginPath();
    drawPath(context, points);
    context.stroke();
  }
  context.globalAlpha = 1;
}

/**
 * A smooth path through the points, without inventing a shape.
 *
 * Quadratic segments between midpoints: the curve passes near every observation
 * and through none of them, which removes the polygonal look of a 30 Hz sample
 * without moving the line anywhere the hand did not go. Fitting a spline
 * *through* the points would overshoot at corners — the same failure prediction
 * is clamped to avoid, arriving from the other direction.
 *
 * The rendered curve is never what a selection is resolved against. That uses
 * `originalPoints`, which this does not touch.
 */
function drawPath(context: CanvasRenderingContext2D, points: StrokePoint[]): void {
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    context.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  context.lineTo(last.x, last.y);
}
