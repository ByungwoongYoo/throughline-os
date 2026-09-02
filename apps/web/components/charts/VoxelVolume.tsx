"use client";

/**
 * A scalar volume drawn in space (§9 volume).
 *
 * The renderer for the twenty catalogue entries that share the `volume`
 * primitive — density, temperature, pressure, seismic and atmospheric volumes,
 * electron density, quantum probability, dark matter distribution, tissue
 * volumes and the CT, MRI and PET reconstructions that arrive as voxels once
 * somebody else's reader has parsed the file.
 *
 * **Splatting, composited back to front.** Every voxel is drawn as a small
 * soft disc and the discs accumulate. This is the technique that works without
 * WebGL, and the order is not a detail: alpha compositing is not commutative,
 * so a volume drawn front to back shows the far side through the near one. The
 * picture still looks like a volume, which is what makes the error dangerous.
 *
 * **Nothing here decides what is visible.** Windowing, thinning and opacity
 * correction all happen in `lib/charts3d/voxels.ts`, where they can be tested
 * against numbers rather than pixels. This file projects, sorts, and draws.
 *
 * **A volume is the case where §10's warning is sharpest.** Depth costs
 * occlusion, and a volume is nothing but occlusion — so the count of what is
 * hidden, the window in use and the sampling stride are all stated in the
 * caption rather than left for the reader to infer from a picture that cannot
 * show them.
 */

import {
  useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import {
  ScreenPoint, TargetRef, ViewState, VisualizationController,
} from "@/lib/spatial/commands";
import {
  Camera, DEFAULT_CAMERA, insidePolygon, resetCamera, rotateCamera, toCanvas, zoomCamera,
} from "@/lib/charts/scene3d";
import { useSpatialKeys } from "@/lib/charts/spatialKeys";
import { isZoomWheel, wheelZoomFactor } from "@/lib/charts/wheel";
import {
  DEFAULT_VOLUME, Grid, Splat, Volume, VolumeSettings, Window, describeVolume,
  prepareVolume,
} from "@/lib/charts3d/voxels";

export type VoxelVolumeProps = {
  grid: Grid;
  settings?: VolumeSettings;
  width?: number;
  height?: number;
  controllerRef?: React.RefObject<VisualizationController | null>;
  /** Told when the reader moves the window, so a caller can keep it. */
  onWindowChange?: (window: Window) => void;
  /**
   * Told whenever the view changes — camera or window.
   *
   * Exists so several volumes can be held at one view. Comparing two scans at
   * different windows is comparing two different pictures, so a workspace that
   * shows them side by side has to be able to keep them in step; without a way
   * to hear about a change it could only push, never follow.
   */
  onViewChange?: (view: ViewState) => void;
  onSelect?: (target: TargetRef | null) => void;
  caption?: string;
};

/** How near a pointer must be, in pixels, to count as on a voxel. */
const PICK_RADIUS = 10;
/** The radius of one splat, in pixels, before perspective. */
const SPLAT_RADIUS = 2.6;

export function VoxelVolume({
  grid, settings = DEFAULT_VOLUME, width = 720, height = 520, controllerRef,
  onWindowChange, onViewChange, onSelect, caption,
}: VoxelVolumeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<Camera>({ ...DEFAULT_CAMERA });
  const dirtyRef = useRef(true);
  const [window_, setWindow] = useState<Window | null>(settings.window ?? null);
  const [selected, setSelected] = useState<number | null>(null);

  /*
   * Prepared once per grid and window. Rotating asks a different question of
   * the same volume; re-windowing on every frame would make the picture change
   * as the reader turned it, which is indistinguishable from the data changing.
   */
  const volume: Volume = useMemo(
    () => prepareVolume(grid, window_ ? { ...settings, window: window_ }
                                      : settings),
    [grid, settings, window_]);

  /*
   * The window as the extractor resolved it, readable without waiting for a
   * render: the announcement below runs inside a pointer move.
   */
  const windowRef = useRef<Window>(volume.window);

  const at = useCallback((splat: Splat): ScreenPoint => {
    const q = toCanvas(splat, cameraRef.current, width, height);
    return { x: q.x, y: q.y };
  }, [width, height]);

  /**
   * Which voxel a pointer is on.
   *
   * The *nearest* one under the pointer, not the first found. In a volume
   * every pixel has hundreds of voxels behind it, and picking any but the
   * front one reports a value the reader cannot see and did not point at.
   */
  const nearest = useCallback((point: ScreenPoint): TargetRef | null => {
    let best: TargetRef | null = null;
    let bestDepth = -Infinity;
    volume.splats.forEach((splat, index) => {
      const q = toCanvas(splat, cameraRef.current, width, height);
      if (Math.hypot(q.x - point.x, q.y - point.y) > PICK_RADIUS) return;
      if (q.depth <= bestDepth) return;
      bestDepth = q.depth;
      best = { id: String(index), label: describeValue(volume, splat),
               datum: splat };
    });
    return best;
  }, [volume, width, height]);

  /*
   * Reported from one place, so a mutation that forgot to announce itself
   * cannot exist. The window is read from `volume`, which is the value the
   * caption and the extractor already agree on.
   */
  const announce = useCallback(() => {
    onViewChange?.({
      yaw: cameraRef.current.yaw, pitch: cameraRef.current.pitch,
      zoom: cameraRef.current.zoom,
      level: windowRef.current.level, window: windowRef.current.window,
    });
  }, [onViewChange]);

  const rotate = useCallback((dx: number, dy: number) => {
    rotateCamera(cameraRef.current, dx, dy);
    dirtyRef.current = true;
    announce();
  }, [announce]);

  /*
   * Zoom and reset as their own callbacks so the keyboard reaches the
   * same behaviour the controller and the wheel already do. Written here
   * rather than inlined into the key handler because three copies of a
   * clamp is how the three drift apart.
   */
  const zoom = useCallback((factor: number) => {
    zoomCamera(cameraRef.current, factor);
    dirtyRef.current = true;
    announce();
  }, [announce]);

  const reset = useCallback(() => {
    resetCamera(cameraRef.current);
    dirtyRef.current = true;
    announce();
  }, [announce]);

  /*
   * Rotation is the depth cue, not a convenience: motion parallax is the
   * strongest signal a flat screen has for which mark is in front. A
   * reader who cannot rotate sees one fixed projection of a tangle, which
   * is the picture §10 exists to forbid.
   */
  const spatialKeys = useSpatialKeys({ rotate, zoom, reset },
    "A density volume, rotatable.");

  const moveWindow = useCallback((next: Window) => {
    windowRef.current = next;
    setWindow(next);
    onWindowChange?.(next);
    onViewChange?.({
      yaw: cameraRef.current.yaw, pitch: cameraRef.current.pitch,
      zoom: cameraRef.current.zoom, level: next.level, window: next.window,
    });
  }, [onWindowChange, onViewChange]);

  useImperativeHandle(controllerRef, (): VisualizationController => ({
    rotate,
    zoom: (factor) => {
      zoomCamera(cameraRef.current, factor);
      dirtyRef.current = true;
      announce();
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
      volume, at, (p) => Math.hypot(p.x - point.x, p.y - point.y) <= radius),
    withinPolygon: (polygon) => within(volume, at,
                                       (p) => insidePolygon(polygon, p)),
    focus: (objectId) => {
      const index = Number(objectId);
      if (!Number.isInteger(index) || index < 0
          || index >= volume.splats.length) return;
      setSelected(index);
    },
    deselect: () => setSelected(null),
    resetView: () => {
      resetCamera(cameraRef.current);
      /*
       * The window is part of the view and comes back with it. A reader who
       * has narrowed to bone and asks to reset expects the whole scan again —
       * leaving the window narrowed would reset the camera into a volume that
       * still looks nearly empty, which reads as the reset having failed.
       */
      setWindow(settings.window ?? null);
      dirtyRef.current = true;
    },
    viewport: () => ({ width, height }),
    bounds: () => {
      const box = canvasRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return null;
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    },
    /*
     * The window travels with the view state, not only the camera.
     *
     * An annotation drawn on a volume means "this, at this window" — the same
     * scan at a different window is a different picture, and a mark circling a
     * lesion visible only in a soft-tissue window means nothing over a bone
     * one. §143's problem, in its sharpest form.
     */
    viewState: () => ({
      yaw: cameraRef.current.yaw, pitch: cameraRef.current.pitch,
      zoom: cameraRef.current.zoom,
      level: volume.window.level, window: volume.window.window,
    }),
    restoreViewState: (state) => {
      const numbers = ["yaw", "pitch", "zoom", "level", "window"] as const;
      // All of them or none: a restore that moved the camera but left the
      // window shows the annotated place through the wrong window, which is
      // worse than not moving at all.
      if (numbers.some((key) => typeof state[key] !== "number")) return;
      cameraRef.current.yaw = state.yaw;
      cameraRef.current.pitch = state.pitch;
      cameraRef.current.zoom = state.zoom;
      moveWindow({ level: state.level, window: state.window });
      dirtyRef.current = true;
    },
  }), [rotate, nearest, volume, at, width, height, onSelect, settings,
       moveWindow, announce]);

  useEffect(() => { dirtyRef.current = true; }, [volume, selected]);

  useEffect(() => {
    windowRef.current = volume.window;
    announce();
  }, [volume.window, announce]);

  useEffect(() => {
    if (typeof requestAnimationFrame === "undefined") return;
    let running = true;
    let handle = 0;
    const tick = () => {
      if (!running) return;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        paintVolume(canvasRef.current, volume, cameraRef.current,
                    { width, height }, selected);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(handle); };
  }, [volume, width, height, selected]);

  const dragging = useRef<{ x: number; y: number } | null>(null);

  return (
    <figure className="chart">
      <canvas
        {...spatialKeys}
        ref={canvasRef}
        width={width}
        height={height}
        data-testid="voxel-volume"
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
          // A plain wheel scrolls the page; ctrl or ⌘ zooms. Without the gate
          // a reader scrolling past three stacked charts never reaches the
          // bottom of the page. Zoom is also on the controller, so the gesture
          // layer and the keyboard reach it without a wheel at all.
          if (!isZoomWheel(event)) return;
          event.preventDefault();
          zoomCamera(cameraRef.current, wheelZoomFactor(event.deltaY));
          dirtyRef.current = true;
        }}
      />
      <div className="chart-controls">
        {/*
          * The window is a control, not a setting, because there is no single
          * right one: lung, bone and soft tissue are three windows over one
          * scan and no one of them shows all three. A volume without a
          * reachable window is a volume showing one arbitrary slice of its own
          * range and implying that is what is there.
          */}
        <label>
          Level
          <input
            type="range"
            aria-label="Window level"
            min={volume.range.min}
            max={volume.range.max}
            /*
             * Continuous, not stepped. A step derived from this volume's own
             * range snaps the thumb to that volume's grid — so several volumes
             * held at one shared window display slightly different numbers
             * while rendering identically. The pictures agree and the controls
             * appear not to, which is the worst way round: a reader checking
             * whether the comparison is honest looks at the numbers.
             */
            step="any"
            value={volume.window.level}
            onChange={(event) => moveWindow({
              level: Number(event.target.value),
              window: volume.window.window })}
          />
        </label>
        <label>
          Width
          <input
            type="range"
            aria-label="Window width"
            min={(volume.range.max - volume.range.min) / 100 || 1}
            max={(volume.range.max - volume.range.min) || 1}
            /*
             * Continuous, not stepped. A step derived from this volume's own
             * range snaps the thumb to that volume's grid — so several volumes
             * held at one shared window display slightly different numbers
             * while rendering identically. The pictures agree and the controls
             * appear not to, which is the worst way round: a reader checking
             * whether the comparison is honest looks at the numbers.
             */
            step="any"
            value={volume.window.window}
            onChange={(event) => moveWindow({
              level: volume.window.level,
              window: Number(event.target.value) })}
          />
        </label>
      </div>
      <figcaption className="chart-caption">
        {caption ? `${caption} ` : ""}
        {describeVolume(volume)}
        {selected !== null && volume.splats[selected] && (
          <> Selected: {describeValue(volume, volume.splats[selected])}.</>
        )}
      </figcaption>
    </figure>
  );
}

function describeValue(volume: Volume, splat: Splat): string {
  const units = volume.units ? ` ${volume.units}` : "";
  return `${Number(splat.value.toPrecision(4))}${units}`;
}

function within(volume: Volume, at: (s: Splat) => ScreenPoint,
                inside: (p: ScreenPoint) => boolean): TargetRef[] {
  const found: TargetRef[] = [];
  volume.splats.forEach((splat, index) => {
    if (!inside(at(splat))) return;
    found.push({ id: String(index), label: describeValue(volume, splat),
                 datum: splat });
  });
  return found;
}


/**
 * Colour for a value's place in the window.
 *
 * A single ramp from cool to warm through lightness, not a rainbow: a rainbow
 * has no perceptual order, and in a volume — where colours are composited on
 * top of one another — its hue boundaries accumulate into bands that look like
 * structures.
 */
export function volumeColour(level: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, level));
  return [
    Math.round(40 + 215 * t),
    Math.round(70 + 130 * t * t),
    Math.round(150 - 90 * t),
  ];
}

/**
 * One frame of the volume.
 *
 * Exported for the same reason `paintNetwork` and `paintField` are: a draw
 * loop reachable only through an animation frame is one no test ever runs, and
 * compositing order is the thing here that is either right or silently wrong.
 */
export function paintVolume(
  canvas: HTMLCanvasElement | null,
  volume: Volume,
  camera: Camera,
  size: { width: number; height: number },
  selected: number | null,
): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const { width, height } = size;
  context.clearRect(0, 0, width, height);

  /*
   * Back to front, and this sort is the correctness of the whole chart.
   *
   * Alpha compositing is not commutative: `a over b` is not `b over a`. Drawn
   * in the wrong order the far side of the volume shows through the near side,
   * and the result still looks like a plausible volume — which is exactly what
   * makes it dangerous. `depth` is larger when nearer, so this ascends.
   */
  const drawn = volume.splats
    .map((splat, index) => ({
      splat, index, at: toCanvas(splat, camera, width, height),
    }))
    .sort((a, b) => a.at.depth - b.at.depth);

  for (const { splat, index, at } of drawn) {
    const [r, g, b] = volumeColour(splat.level);
    context.save();
    context.globalAlpha = splat.alpha;
    context.fillStyle = `rgb(${r},${g},${b})`;
    context.beginPath();
    // Scaled by the perspective factor, so a voxel nearer the eye is larger —
    // the same depth cue the rest of the scene uses, and without it the volume
    // reads as flat however well it is composited.
    context.arc(at.x, at.y, SPLAT_RADIUS * at.scale, 0, Math.PI * 2);
    context.fill();
    context.restore();

    if (index === selected) {
      /*
       * Drawn opaque, over the splat, in the same pass — so it is occluded by
       * whatever is genuinely in front of it. A marker drawn afterwards on top
       * of everything would tell the reader a voxel is visible when it is
       * buried, which is the one thing a volume must not do.
       */
      context.save();
      context.strokeStyle = "rgba(20,67,184,0.95)";
      context.lineWidth = 1.6;
      context.beginPath();
      context.arc(at.x, at.y, SPLAT_RADIUS * at.scale + 3, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }
}
