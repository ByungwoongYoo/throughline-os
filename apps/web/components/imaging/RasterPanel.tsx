"use client";

/**
 * One flat image, under a window the whole comparison shares.
 *
 * The volume panel beside this one answers "what is in this stack"; this
 * answers the same question for a plane, which is what a micrograph, a gel, a
 * plate and a figure lifted out of a paper all are. Written as a sibling of
 * `VoxelVolume` rather than a mode inside it, because almost nothing is shared:
 * a plane has no camera to orbit, no depth to composite and no slice to pick,
 * and a component carrying both would be a switch statement wearing a costume.
 *
 * **The window is the point, not a nicety.** Two images of one specimen at
 * different exposures look like two specimens, and the eye is completely
 * unreliable about it — which is the same observation the comparability engine
 * is built on, applied to the display rather than to the verdict. Holding every
 * panel at one window is what makes a difference between two images a
 * difference between two images, so the window lives with the comparison and is
 * reported outward on every change.
 *
 * **Colour is preserved, and the window still applies.** Stains carry meaning:
 * turning an H&E section grey to make the arithmetic tidier would discard the
 * signal the researcher is reading. So the contrast stretch is applied to each
 * channel alike, which moves brightness without moving hue.
 */

import { useEffect, useRef, useState } from "react";
import { ChartExport } from "@/components/charts/ChartExport";
import { canvasPoint } from "@/lib/charts/pointer";
import { Raster, windowedBytes } from "@/lib/imaging/raster";
import type {
  ScreenPoint, TargetRef, ViewState, VisualizationController,
} from "@/lib/spatial/commands";

export type RasterPanelProps = {
  raster: Raster;
  width: number;
  height: number;
  /** Registered by the case screen so one view can be pushed to every panel. */
  controllerRef?: React.MutableRefObject<VisualizationController | null>;
  /** Told whenever the window, zoom or pan changes. */
  onViewChange?: (view: ViewState) => void;
  caption?: string;
  /** What this image is, for the accessible label. */
  name?: string;
};

/** How far the view can be pushed before the image is no longer being read. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 40;

export function RasterPanel({
  raster, width, height, controllerRef, onViewChange, caption, name = "Image",
}: RasterPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dirtyRef = useRef(true);

  /*
   * The window starts at the range actually present rather than at the
   * container's nominal range. An image using the bottom tenth of sixteen bits
   * — routine for a fluorescence channel — is otherwise shown as black, and a
   * black panel reads as "nothing there" rather than as "wrong window".
   */
  const [level, setLevel] = useState((raster.min + raster.max) / 2);
  const [windowWidth, setWindowWidth] = useState(
    Math.max(raster.max - raster.min, 1));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const viewRef = useRef({ level, windowWidth, zoom, pan });
  viewRef.current = { level, windowWidth, zoom, pan };

  /*
   * Reported from an effect rather than from each handler.
   *
   * The first version called a `report()` that read a ref, and the ref is only
   * written during render — so every change was announced with the *previous*
   * view. The shared window is the whole point of this panel, and it would have
   * been one step stale everywhere, which is the kind of wrong that looks right
   * until two panels are compared carefully. Reporting after the state commits
   * announces exactly what is on screen, once per change.
   */
  useEffect(() => {
    onViewChange?.({
      level, window: windowWidth, zoom, panX: pan.x, panY: pan.y,
    });
  }, [level, windowWidth, zoom, pan, onViewChange]);

  /* ---------------------------------------------------------------- drawing */

  useEffect(() => {
    dirtyRef.current = true;
  }, [raster, level, windowWidth, zoom, pan, width, height]);

  /*
   * The windowed pixels, rebuilt only when the pixels or the window change.
   *
   * This work used to sit inside the frame loop: every dirty frame allocated a
   * canvas, allocated an `ImageData`, and walked every pixel — and panning and
   * zooming both mark the panel dirty. On a 2048-square micrograph that is four
   * million iterations and two allocations per frame while the researcher is
   * dragging, which is a freeze rather than a slow frame. None of it depends on
   * where the image is on screen: a pan moves the picture, it does not change
   * a single pixel's value.
   *
   * So the window is baked into an offscreen buffer here, and the frame loop
   * below does one `drawImage`. The buffer is reused across renders rather than
   * reallocated, because a new canvas per window nudge is the same allocation
   * pressure moved one level out.
   */
  const bufferRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const buffer = bufferRef.current ?? document.createElement("canvas");
    bufferRef.current = buffer;
    if (buffer.width !== raster.width || buffer.height !== raster.height) {
      buffer.width = raster.width;
      buffer.height = raster.height;
    }
    const into = buffer.getContext("2d");
    if (into === null) return;

    const image = into.createImageData(raster.width, raster.height);
    image.data.set(windowedBytes(raster, level, windowWidth));
    into.putImageData(image, 0, 0);
    dirtyRef.current = true;
  }, [raster, level, windowWidth]);

  /*
   * The frame loop. Deliberately not keyed on the pan or the zoom: those are
   * read from `viewRef`, so moving the image does not tear down and rebuild the
   * loop on every pointer move.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    let running = true;
    let frame = 0;

    const draw = () => {
      if (!running) return;
      frame = requestAnimationFrame(draw);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const buffer = bufferRef.current;
      if (buffer === null || buffer.width === 0) return;

      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const { zoom: currentZoom, pan: currentPan } = viewRef.current;
      context.save();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.scale(dpr, dpr);
      // Fit first, then the researcher's zoom on top, so zoom 1 always means
      // "the whole image", whatever its pixel dimensions.
      const fit = Math.min(width / raster.width, height / raster.height);
      const scale = fit * currentZoom;
      context.translate(width / 2 + currentPan.x, height / 2 + currentPan.y);
      context.scale(scale, scale);
      context.imageSmoothingEnabled = scale < 1;
      context.drawImage(buffer, -raster.width / 2, -raster.height / 2);
      context.restore();
    };

    frame = requestAnimationFrame(draw);
    return () => { running = false; cancelAnimationFrame(frame); };
  }, [raster.width, raster.height, width, height]);

  /* ------------------------------------------------------------- the seam */

  useEffect(() => {
    if (controllerRef === undefined) return;
    const controller: VisualizationController = {
      /*
       * A plane has no camera to orbit. Ignored rather than quietly remapped
       * onto panning: a hand rotating a flat image and watching it slide would
       * be told the gesture works when it does not.
       */
      rotate: () => {},
      zoom: (factor) => {
        setZoom((z) => clamp(z * factor, MIN_ZOOM, MAX_ZOOM));
        dirtyRef.current = true;
      },
      pan: (dx, dy) => {
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        dirtyRef.current = true;
      },
      hover: (at) => pixelAt(at),
      select: (at) => pixelAt(at),
      selectRegion: (at) => {
        const one = pixelAt(at);
        return one === null ? [] : [one];
      },
      /*
       * Empty, and correctly so: a raster has no discrete observations to fall
       * inside a polygon. Returning every pixel would answer a question about
       * data with a count of screen area, which is exactly the kind of
       * confident wrong number this seam exists to avoid.
       */
      withinPolygon: () => [],
      focus: () => {},
      deselect: () => {},
      resetView: () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setLevel((raster.min + raster.max) / 2);
        setWindowWidth(Math.max(raster.max - raster.min, 1));
        dirtyRef.current = true;
      },
      viewport: () => ({ width, height }),
      bounds: () => {
        const box = canvasRef.current?.getBoundingClientRect();
        if (box === undefined) return null;
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      },
      viewState: () => {
        const v = viewRef.current;
        return { level: v.level, window: v.windowWidth,
                 zoom: v.zoom, panX: v.pan.x, panY: v.pan.y };
      },
      restoreViewState: (state) => {
        /*
         * Each key applied only if the snapshot carries it. A view pushed from
         * a volume panel has a window and a level and no pan, and taking the
         * shared window while leaving this panel's own framing alone is exactly
         * what the case screen wants.
         */
        if (typeof state.level === "number") setLevel(state.level);
        if (typeof state.window === "number") {
          setWindowWidth(Math.max(state.window, 1));
        }
        if (typeof state.zoom === "number") {
          setZoom(clamp(state.zoom, MIN_ZOOM, MAX_ZOOM));
        }
        if (typeof state.panX === "number" && typeof state.panY === "number") {
          setPan({ x: state.panX, y: state.panY });
        }
        dirtyRef.current = true;
      },
    };

    const pixelAt = (at: ScreenPoint): TargetRef | null => {
      const point = imagePixel(at);
      if (point === null) return null;
      const index = point.y * raster.width + point.x;
      const value = raster.values[index];
      return {
        id: `${point.x},${point.y}`,
        label: `${point.x}, ${point.y}: ${Number(value.toPrecision(4))}`,
        datum: { x: point.x, y: point.y, value },
      };
    };

    const imagePixel = (at: ScreenPoint) => {
      const v = viewRef.current;
      const fit = Math.min(width / raster.width, height / raster.height);
      const scale = fit * v.zoom;
      const x = Math.floor(
        (at.x - width / 2 - v.pan.x) / scale + raster.width / 2);
      const y = Math.floor(
        (at.y - height / 2 - v.pan.y) / scale + raster.height / 2);
      if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return null;
      return { x, y };
    };

    controllerRef.current = controller;
    return () => { controllerRef.current = null; };
  }, [controllerRef, raster, width, height]);

  /* --------------------------------------------------------------- input */

  const dragRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <figure className="chart">
      <canvas
        ref={canvasRef}
        className="chart-canvas"
        role="img"
        tabIndex={0}
        aria-label={
          `${name}. ${raster.width} by ${raster.height} pixels, `
          + `${raster.colour ? "colour" : "greyscale"}. Shown at window `
          + `${Number(windowWidth.toPrecision(3))} centred on `
          + `${Number(level.toPrecision(3))}. Arrow keys pan, plus and minus `
          + "zoom, Home resets the view."}
        style={{ width: "100%", maxWidth: width, touchAction: "none" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const from = dragRef.current;
          if (from === null) return;
          setPan((p) => ({
            x: p.x + (event.clientX - from.x),
            y: p.y + (event.clientY - from.y),
          }));
          dragRef.current = { x: event.clientX, y: event.clientY };
          dirtyRef.current = true;
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onWheel={(event) => {
          // A plain wheel scrolls the page; ctrl or ⌘ zooms — the same gate the
          // spatial charts use, so three stacked panels do not trap the reader.
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setZoom((z) => clamp(z * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
                               MIN_ZOOM, MAX_ZOOM));
          dirtyRef.current = true;
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 40 : 10;
          if (event.key === "ArrowLeft") setPan((p) => ({ ...p, x: p.x + step }));
          else if (event.key === "ArrowRight") setPan((p) => ({ ...p, x: p.x - step }));
          else if (event.key === "ArrowUp") setPan((p) => ({ ...p, y: p.y + step }));
          else if (event.key === "ArrowDown") setPan((p) => ({ ...p, y: p.y - step }));
          else if (event.key === "+" || event.key === "=") {
            setZoom((z) => clamp(z * 1.2, MIN_ZOOM, MAX_ZOOM));
          } else if (event.key === "-") {
            setZoom((z) => clamp(z / 1.2, MIN_ZOOM, MAX_ZOOM));
          } else if (event.key === "Home") {
            setZoom(1); setPan({ x: 0, y: 0 });
          } else return;
          event.preventDefault();
          dirtyRef.current = true;
        }}
        onClick={(event) => {
          // Kept so a click focuses the canvas for the keyboard controls above.
          canvasPoint(event.nativeEvent, event.currentTarget, width, height);
        }}
      />

      <div className="chart-controls">
        {/*
          * The same two controls the volume panel offers, and deliberately the
          * same words. A researcher holding a micrograph beside a scan should
          * not have to learn that one calls it brightness and the other level.
          */}
        <label>
          Level
          <input
            type="range"
            aria-label="Window level"
            min={raster.min}
            max={raster.max}
            step="any"
            value={level}
            onChange={(event) => {
              setLevel(Number(event.target.value));
              dirtyRef.current = true;
            }}
          />
        </label>
        <label>
          Width
          <input
            type="range"
            aria-label="Window width"
            min={Math.max((raster.max - raster.min) / 100, 1)}
            max={Math.max(raster.max - raster.min, 1)}
            step="any"
            value={windowWidth}
            onChange={(event) => {
              setWindowWidth(Number(event.target.value));
              dirtyRef.current = true;
            }}
          />
        </label>
      </div>

      {/* No `rotate`, so no orbit recording is offered: there is no turn to
          record. An export control that produced a still video of a still image
          would be a button that works and means nothing. */}
      <ChartExport canvasRef={canvasRef} name={name}
                   redraw={() => { dirtyRef.current = true; }} />

      <figcaption className="chart-caption">
        {caption ? `${caption} ` : ""}
        {raster.width} × {raster.height} pixels,{" "}
        {raster.colour ? "colour" : "greyscale"}. Values{" "}
        {Number(raster.min.toPrecision(3))} to {Number(raster.max.toPrecision(3))},
        {" "}shown at window {Number(windowWidth.toPrecision(3))} centred on{" "}
        {Number(level.toPrecision(3))}.
      </figcaption>
    </figure>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
