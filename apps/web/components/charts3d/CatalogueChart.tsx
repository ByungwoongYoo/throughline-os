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

import { useMemo } from "react";
import { Bars3D } from "@/components/charts/Bars3D";
import { Field3D } from "@/components/charts/Field3D";
import { Isosurface3D } from "@/components/charts/Isosurface3D";
import { Lines3D } from "@/components/charts/Lines3D";
import { Network3D } from "@/components/charts/Network3D";
import { depthReaderFor } from "@/lib/charts3d/examples";
import { Surface } from "@/components/charts/Surface";
import { Volume } from "@/components/charts/Volume";
import { VoxelVolume } from "@/components/charts/VoxelVolume";
import { exampleFor, sharesPictureWith, styleFor } from "@/lib/charts3d/examples";
import { CATALOGUE, type Visualization } from "@/lib/charts3d/registry";

export function CatalogueChart({ entry, width = 620, height = 420 }: {
  entry: Visualization;
  width?: number;
  height?: number;
}) {
  /*
   * Memoized, which it was not. Every render rebuilt the example from scratch
   * — a 24³ voxel grid is 13,824 floats, and a graph is a whole force
   * relaxation — for a result that depends only on the entry. It also handed
   * each renderer a new object each time, which is how `useLayout` came to
   * loop: an effect keyed on that reference re-fired for ever.
   */
  const data = useMemo(() => exampleFor(entry), [entry]);

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

  /*
   * What this picture is, and what it is not.
   *
   * Several entries share a renderer and a data shape, and this codebase draws
   * them identically — so the chart says how many, rather than letting a
   * catalogue of 219 names imply 219 pictures. What separates them is the
   * styling, which is the honest description of the work that is left.
   */
  const shared = sharesPictureWith(entry, CATALOGUE);
  const caption = `${entry.name} — generated data, shown to exercise the `
    + `${entry.primitive} renderer. Not a measurement.`
    + (shared.length > 0
       ? ` ${shared.length} other ${shared.length === 1 ? "entry" : "entries"} `
         + `draw this same picture — they differ by styling, which is not built `
         + `here yet, not by their data.`
       : "");

  /*
   * Dispatched on the renderer the entry names, not on the shape of its data.
   * The two disagree for twenty-three entries — "3D line" is `lines` over
   * `xyz`, "3D histogram" is `bars` over `grid` — and switching on the shape
   * sent every one of them to the wrong renderer.
   */
  switch (entry.primitive) {
    case "points":
      return data.shape === "xyz" || data.shape === "xyzv" ? (
        <Volume points={data.points} width={width} height={height}
                xLabel="x" yLabel="y" zLabel="z"
                valueLabel={data.shape === "xyzv" ? "value" : undefined}
                title={entry.name} caption={caption} />
      ) : null;

    case "lines":
      return data.shape === "paths" ? (
        <Lines3D paths={data.paths} width={width} height={height}
                 caption={caption} />
      ) : null;

    case "surface":
      return data.shape === "grid" ? (
        <Surface grid={data.grid} width={width} height={height}
                 xLabel="x" yLabel="y" zLabel="z" style={styleFor(entry)}
                 title={entry.name} caption={caption} />
      ) : null;

    case "bars":
      return data.shape === "series" ? (
        <Bars3D bars={data.bars} width={width} height={height}
                caption={caption} />
      ) : null;

    case "glyphs":
      return data.shape === "field" ? (
        <Field3D samples={data.samples} width={width} height={height}
                 caption={caption} />
      ) : null;

    case "isosurface":
      return data.shape === "voxels" ? (
        <Isosurface3D grid={data.grid} level={40} width={width}
                      height={height} caption={caption} />
      ) : null;

    case "volume":
      return data.shape === "voxels" ? (
        <VoxelVolume grid={data.grid} width={width} height={height}
                     caption={caption} />
      ) : null;

    case "network":
      return data.shape === "graph" ? (
        <Network3D graph={data.graph} width={width} height={height}
          /* A layered structure is laid out as layers; everything else relaxes.
             Without this the architecture entries carried layered data into a
             force-directed layout, which is a blob with the right node count. */
          depthOf={depthReaderFor(entry.name)}
                   caption={caption} />
      ) : null;

    default:
      return null;
  }
}
