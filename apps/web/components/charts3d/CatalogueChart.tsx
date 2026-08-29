"use client";

/**
 * Any catalogue entry, drawn.
 *
 * The spatial-charts page said "199 of 238 catalogued visualizations can be
 * drawn today" and demonstrated six. The other 193 were a claim about the
 * renderers rather than something a reader could look at: the machinery could
 * draw them, and nothing did.
 *
 * This closes that. One entry in, one chart out, through the renderer its
 * `primitive` names and the data its `needs` shape describes — so an entry
 * that claims to be drawable is drawable by demonstration, and an entry that
 * cannot be drawn says which of the two halves is missing rather than
 * rendering an empty box.
 *
 * **The data is generated, and the caption says so every time.** These shapes
 * exercise a renderer; they are not measurements, and a chart drawn from one
 * must never be mistaken for a chart drawn from a researcher's dataset. That
 * distinction is the whole reason `exampleFor` is separate from anything that
 * touches a project.
 */

import { Bars3D } from "@/components/charts/Bars3D";
import { Field3D } from "@/components/charts/Field3D";
import { Isosurface3D } from "@/components/charts/Isosurface3D";
import { Lines3D } from "@/components/charts/Lines3D";
import { Network3D } from "@/components/charts/Network3D";
import { Surface } from "@/components/charts/Surface";
import { Volume } from "@/components/charts/Volume";
import { VoxelVolume } from "@/components/charts/VoxelVolume";
import { exampleFor } from "@/lib/charts3d/examples";
import type { Visualization } from "@/lib/charts3d/registry";

/** Paths for the line renderer, integrated from the same vortex the field uses. */
function pathsFromField(
  samples: Array<{ x: number; y: number; z: number; u: number; v: number; w: number }>,
) {
  const seeds = samples.filter((_, i) => i % 17 === 0).slice(0, 12);
  return seeds.map((seed, index) => {
    const points = [];
    let { x, y, z } = seed;
    for (let step = 0; step < 40; step++) {
      points.push({ x, y, z, t: step });
      // The same vortex, integrated rather than sampled — which is the whole
      // difference between an arrow field and a streamline.
      const u = -y, v = x, w = 0.35 * z;
      const length = Math.hypot(u, v, w) || 1;
      x += (u / length) * 0.18;
      y += (v / length) * 0.18;
      z += (w / length) * 0.18;
    }
    return { id: `path-${index}`, label: `Path ${index + 1}`, points };
  });
}

export function CatalogueChart({ entry, width = 620, height = 420 }: {
  entry: Visualization;
  width?: number;
  height?: number;
}) {
  const data = exampleFor(entry);

  if (!data) {
    /*
     * Said plainly, and it is two different sentences. A missing renderer is
     * work in this codebase; a `geometry` shape is a file only the researcher
     * has. Collapsing them into "unavailable" would hide which one is which.
     */
    return (
      <p className="note" role="status">
        {entry.needs === "geometry"
          ? `${entry.name} is drawn from vertices and faces in a file, so there `
            + "is nothing to show until you open one."
          : `No renderer here draws a ${entry.primitive} yet, so ${entry.name} `
            + "cannot be shown."}
      </p>
    );
  }

  const caption = `${entry.name} — generated data, shown to exercise the `
    + `${entry.primitive} renderer. Not a measurement.`;

  switch (data.shape) {
    case "xyz":
    case "xyzv":
      return (
        <Volume points={data.points} width={width} height={height}
                xLabel="x" yLabel="y" zLabel="z"
                valueLabel={data.shape === "xyzv" ? "value" : undefined}
                title={entry.name} caption={caption} />
      );
    case "grid":
      return (
        <Surface grid={data.grid} width={width} height={height}
                 xLabel="x" yLabel="y" zLabel="z"
                 title={entry.name} caption={caption} />
      );
    case "field":
      return entry.primitive === "lines"
        ? <Lines3D paths={pathsFromField(data.samples)} width={width}
                   height={height} caption={caption} />
        : <Field3D samples={data.samples} width={width} height={height}
                   caption={caption} />;
    case "voxels":
      return entry.primitive === "isosurface"
        ? <Isosurface3D grid={data.grid} level={40} width={width}
                        height={height} caption={caption} />
        : <VoxelVolume grid={data.grid} width={width} height={height}
                       caption={caption} />;
    case "graph":
      return (
        <Network3D graph={data.graph} width={width} height={height}
                   caption={caption} />
      );
    case "series":
      return (
        <Bars3D bars={data.bars} width={width} height={height}
                caption={caption} />
      );
  }
}
