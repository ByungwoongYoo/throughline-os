"use client";

/**
 * A choropleth on the sphere the data actually lives on.
 *
 * The catalogue lists "3D globe", "Climate globe" and "Population globe". Two
 * of them were drawn by the `surface` renderer — a height field on a flat grid
 * — which is not an undifferentiated picture but the wrong shape for the thing
 * named. This is the shape.
 *
 * **§10 rules 3D out almost everywhere, and rules it in here.** A bar chart in
 * three dimensions is worse than a bar chart: the data has one dimension and
 * the picture has three, so perspective and occlusion are pure cost. A globe is
 * the opposite case. The Earth *is* a sphere; the country a reader is looking
 * for has a position on it, and an equal-area projection has already spent its
 * distortion budget flattening that sphere onto a page. Nothing is added here
 * that was not in the data.
 *
 * **What depth costs, said out loud.** Roughly half the world faces away at any
 * rotation, and a choropleth that quietly omits half its countries is a map
 * that lies by framing. The caption counts them, the same way `bars.ts` counts
 * the bars it hides. That number changing as the reader rotates is the honest
 * behaviour: it is a true statement about what they can currently see.
 *
 * **Equal Earth stays the default elsewhere.** `Geographic.tsx` makes the
 * argument — a choropleth's visual weight is area, and Mercator gives Greenland
 * fourteen times its due. A globe has no area distortion at all, and pays for
 * that with a hemisphere the reader has to rotate to reach. Neither is strictly
 * better; the flat map answers "compare these two countries", the globe answers
 * "where is this, and what is near it". Both are offered, and the caption on
 * each says which question it is for.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  Camera, DEFAULT_CAMERA, resetCamera, rotateCamera, toCanvas, unitLength,
  zoomCamera,
} from "@/lib/charts/scene3d";
import {
  GLOBE_ZOOM, type ScenePoint, graticule, silhouetteRadius, visibility,
} from "@/lib/charts3d/globe";
import { identity } from "./Geographic";
import { ChartExport } from "@/components/charts/ChartExport";

export type Place = {
  /** ISO 3166-1 numeric id, matching the bundled topology. */
  id: string;
  label: string;
  value: number;
};

export function Globe3D({
  places, world, valueLabel, title, caption, width = 620, height = 460,
}: {
  places: Place[];
  world: FeatureCollection<Geometry, { name?: string }>;
  valueLabel: string;
  title?: string;
  caption?: string;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /*
   * `FIT` frames the unit cube, whose corner is √3 out; a radius-1 sphere left
   * at that zoom is a small ball in a large empty panel. See `GLOBE_ZOOM`.
   */
  const cameraRef = useRef<Camera>({ ...DEFAULT_CAMERA, zoom: GLOBE_ZOOM });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(true);
  const [hiddenCount, setHiddenCount] = useState(0);

  const byId = useMemo(() => {
    const map = new Map<string, Place>();
    for (const place of places) map.set(place.id, place);
    return map;
  }, [places]);

  /** Shading runs over the values present, so an absent country is not a zero. */
  const range = useMemo(() => {
    const values = places.map((p) => p.value).filter(Number.isFinite);
    return values.length
      ? { low: Math.min(...values), high: Math.max(...values) }
      : null;
  }, [places]);

  const lines = useMemo(() => graticule(30), []);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== width * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const camera = cameraRef.current;
      const at = (p: ScenePoint) => toCanvas(p, camera, width, height);
      const depthOf = (p: ScenePoint) => at(p).depth;

      const style = getComputedStyle(canvas);
      const ink = style.getPropertyValue("--ink").trim() || "#111";
      const line = style.getPropertyValue("--line").trim() || "#ccc";
      const accent = style.getPropertyValue("--accent").trim() || "#2563EB";

      // The ocean, so the sphere reads as a solid body rather than a wire cage.
      //
      // The radius is the silhouette of the sphere, not the projection of some
      // point on it: an earlier version measured to `{x:1,y:0,z:0}`, which is
      // on the outline only when the camera looks down z, and drew a sea a
      // third of its true size with the coastlines outside it.
      const centre = at({ x: 0, y: 0, z: 0 });
      const radius = silhouetteRadius(unitLength(camera, width, height));
      context.beginPath();
      context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      /*
       * Shaded rather than flat-filled, and this is a depth cue rather than a
       * decoration: the brightness falls off with the angle between the surface
       * and the viewer, so it is the surface normal drawn as light. Flat-filled,
       * the globe read as a circle with lines on it — the roundness the whole
       * primitive exists to show was the one thing the picture did not say.
       * The offset centre is why it reads as lit from somewhere rather than
       * glowing at the middle.
       */
      const lit = context.createRadialGradient(
        centre.x - radius * 0.35, centre.y - radius * 0.35, radius * 0.05,
        centre.x, centre.y, radius);
      const body = style.getPropertyValue("--panel").trim() || "#f6f6f6";
      lit.addColorStop(0, body);
      /*
       * `--bg`, chosen because it is darker than `--panel` in both themes — the
       * lit centre stays the lighter end either way. A first attempt used a
       * `--surface` token this stylesheet does not define, which is not an
       * error anywhere: the fallback made both stops identical and the gradient
       * became the flat fill it was meant to replace, silently.
       */
      lit.addColorStop(1, style.getPropertyValue("--bg").trim() || body);
      context.fillStyle = lit;
      context.fill();
      context.strokeStyle = line;
      context.lineWidth = 1;
      context.stroke();

      // A sphere has no edges, so the graticule supplies the orientation cues
      // a flat map gets from its frame.
      context.strokeStyle = line;
      context.lineWidth = 0.5;
      for (const ring of lines) {
        context.beginPath();
        let drawing = false;
        for (const point of ring) {
          const p = at(point);
          if (p.depth <= 0) { drawing = false; continue; }
          if (!drawing) { context.moveTo(p.x, p.y); drawing = true; }
          else context.lineTo(p.x, p.y);
        }
        context.stroke();
      }

      const { drawn, hidden } = visibility(world.features as Feature[], depthOf);
      setHiddenCount(hidden);

      for (const { feature, rings } of drawn) {
        const place = byId.get(identity(feature as never));
        for (const ring of rings) {
          context.beginPath();
          let started = false;
          for (const point of ring) {
            const p = at(point);
            // Per-vertex, not per-ring: a country on the limb is drawn as the
            // crescent that is actually facing the reader.
            if (p.depth <= 0) { started = false; continue; }
            if (!started) { context.moveTo(p.x, p.y); started = true; }
            else context.lineTo(p.x, p.y);
          }
          context.closePath();

          if (place && range) {
            const t = range.high > range.low
              ? (place.value - range.low) / (range.high - range.low)
              : 1;
            context.globalAlpha = 0.18 + 0.72 * t;
            context.fillStyle = accent;
            context.fill();
            context.globalAlpha = 1;
          } else {
            // Absent, not zero. Left unfilled and counted in the caption, the
            // same distinction `Geographic` hatches for.
            context.fillStyle = "transparent";
          }
          /*
           * 0.9, not 0.4. At 0.4 on a 2x display a coastline is under one
           * device pixel and the browser resolves it as a partly transparent
           * grey — the outlines were technically drawn and practically
           * invisible, which is the same failure as a divider with no width.
           */
          context.strokeStyle = ink;
          context.lineWidth = 0.9;
          context.stroke();
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [world, byId, range, lines, width, height]);

  const withData = places.filter((p) => Number.isFinite(p.value)).length;

  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}
      <canvas
        ref={canvasRef}
        className="chart-canvas globe"
        style={{ width, height: "auto", aspectRatio: `${width} / ${height}`,
                 maxWidth: "100%", touchAction: "none" }}
        role="img"
        tabIndex={0}
        aria-label={
          `${title ?? "Globe"}. ${valueLabel} for ${withData} countries on a `
          + `rotatable sphere. ${hiddenCount} countries face away from the `
          + `viewer and are not drawn. Arrow keys rotate, plus and minus zoom, `
          + `Home resets the view.`}
        onPointerDown={(event) => {
          dragRef.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = dragRef.current;
          if (!from) return;
          rotateCamera(cameraRef.current, event.clientX - from.x,
                       event.clientY - from.y);
          dragRef.current = { x: event.clientX, y: event.clientY };
          dirtyRef.current = true;
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
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
          else if (event.key === "Home") {
            resetCamera(cameraRef.current);
            cameraRef.current.zoom = GLOBE_ZOOM;   // the globe's frame, not the cube's
          }
          else return;
          event.preventDefault();
          dirtyRef.current = true;
        }}
      />
      {/* §75: the globe is the chart most worth recording — half of it is
          always facing away, and a still cannot show the other half. */}
      <ChartExport
        canvasRef={canvasRef}
        name={title ?? "Globe"}
        rotate={(degrees) => rotateCamera(cameraRef.current, degrees, 0)}
        redraw={() => { dirtyRef.current = true; }}
      />

      <figcaption className="chart-caption">
        {caption ?? `${valueLabel} for ${withData} countries.`}{" "}
        <b>{hiddenCount} countries face away</b> and are not drawn — rotate to
        reach them. A globe distorts no areas, which is what it buys by hiding
        half the world at once; the flat map answers a comparison, this answers
        where something is.
      </figcaption>
    </figure>
  );
}
