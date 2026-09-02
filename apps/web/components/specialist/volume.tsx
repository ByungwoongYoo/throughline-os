"use client";

/**
 * vtk.js, wired to a mesh or volume file off the researcher's own disk (T078).
 *
 * vtk.js is here as a *reader*, not as a second renderer. This product already
 * draws surfaces, points, glyphs and volumes from data it holds itself; what it
 * could not do was open somebody else's geometry file, and STL, OBJ, PLY and
 * the VTK XML formats are what an engineer actually has on disk after a CAD
 * export. That gap is the only thing tens of megabytes of chunk buys, so it is
 * the only thing this file claims.
 *
 * **Nothing is fetched.** Every vtk.js reader offers `setUrl` and a data-access
 * helper that would happily go to the network; neither is used. The bytes come
 * from a `File` the researcher picked, and this viewer works on a machine that
 * has been offline since it was imaged.
 *
 * **vtk.js is imported inside `loadVtk`, never at module scope.** The seam
 * awaits a real `import()` of this module in happy-dom, where there is no
 * WebGL and no WebGPU; vtk.js's rendering profiles register backends at import
 * time and would fail there. A static import would also merge the library into
 * whatever chunk this file lands in, which is the one thing the seam exists to
 * prevent.
 */

import { useEffect, useRef, useState } from "react";
import { requireWebGL } from "@/lib/specialist/contract";
import type {
  SpecialistReport, SpecialistViewerProps,
} from "@/lib/specialist/contract";

/** The file formats vtk.js reads here, keyed by the extension on disk. */
export type VtkFormat = "stl" | "obj" | "ply" | "vtp" | "vti";

const BY_EXTENSION: Record<string, VtkFormat> = {
  stl: "stl", obj: "obj", ply: "ply", vtp: "vtp", vti: "vti",
};

/** Named in every refusal, so the reader learns the answer from the failure. */
const ACCEPTED = ".stl, .obj, .ply or .vtp for geometry, .vti for a volume";

/**
 * Which reader a file name asks for, or `null` for one this viewer cannot open.
 *
 * The extension is all there is to go on before the bytes are read, and reading
 * a 400MB mesh to discover it is a spreadsheet helps nobody. A leading dot with
 * nothing before it (`.stl`) is a dotfile rather than an STL, so it is refused
 * — the alternative is treating a stray editor backup as geometry.
 */
export function formatOf(fileName: string): VtkFormat | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * The ramp a scalar field is painted with, and the one its legend shows.
 *
 * Dark to warm to near-white: sequential and perceptually ordered, so a reader
 * sees "more" as "brighter" without being told. Not a rainbow — a rainbow has
 * no ordering a reader can recover, and invents boundaries at its hue changes
 * that the data does not have, which on a stress field reads as a structural
 * feature.
 *
 * The same three colours the volume path already uses, deliberately: a stress
 * field and a density volume are both a scalar over space, and two ramps for
 * one idea makes a reader learn the chart instead of the data.
 */
export const FIELD_RAMP: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0.0, 0.02, 0.08],
  [0.45, 0.55, 0.28, 0.12],
  [1, 1.0, 0.98, 0.92],
];

/** The ramp as CSS, for a legend the reader can actually read off. */
export function rampStops(): string[] {
  return FIELD_RAMP.map(([, r, g, b]) =>
    `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`);
}

/** What this viewer reads out of a mesh; vtk.js polydata has far more. */
export type MeshData = {
  getNumberOfPoints(): number;
  getNumberOfPolys(): number;
  getNumberOfCells(): number;
  /**
   * Present on `.vtp`; the other geometry formats carry no arrays at all.
   *
   * Both are read, because a solver writes to whichever suits it: a nodal
   * result lands on the points, and an element result — stress per element is
   * the common case in FEA — lands on the cells. Reading only points told a
   * researcher with element-wise stress that their file had no values in it.
   */
  getPointData?(): {
    getScalars(): { getName(): string; getRange(): number[] } | null;
  } | null;
  getCellData?(): {
    getScalars(): { getName(): string; getRange(): number[] } | null;
  } | null;
};

/** What this viewer reads out of a volume. */
export type VolumeData = {
  getDimensions(): number[];
  getSpacing(): number[];
  getPointData(): { getScalars(): { getRange(): number[] } | null } | null;
};

/**
 * A parsed file, tagged by what it is rather than by which reader made it.
 *
 * `.vtp` and `.vti` come from the same XML family and the same-looking API, and
 * handing a volume to the mesh pipeline draws an empty box rather than raising
 * anything. The tag is what keeps that from being possible.
 */
export type Parsed =
  | { kind: "mesh"; data: MeshData }
  | { kind: "volume"; data: VolumeData };

/** A live scene: one GL context, released by `delete`. */
export type VtkView = {
  show(parsed: Parsed): void;
  /**
   * Releases the GL context and the props in it.
   *
   * Browsers hand out a small fixed number of WebGL contexts per page. A viewer
   * that opened one per file and never released them stops drawing after a
   * dozen files, silently and only for people who opened a dozen files.
   */
  delete(): void;
};

/** The parts of vtk.js this viewer uses, small enough to stand in for. */
export type VtkKit = {
  /** Parse the researcher's bytes; `null` when the reader produced nothing. */
  read(format: VtkFormat, bytes: ArrayBuffer): Parsed | null;
  open(host: HTMLElement): VtkView;
};

const NEEDS_A_FILE =
  "no file has been chosen yet. Open a mesh or volume from your own disk — "
  + ACCEPTED + " — and it will be read in this browser.";

function grouped(count: number): string {
  return count.toLocaleString("en-US");
}

/**
 * A value off a scalar range, which is a measurement rather than a count.
 *
 * Four significant figures and then back through `Number`, so a range that came
 * out of a float array reads as `-0.0125 to 3.5` instead of either the full
 * binary expansion or a padded `3.500` — a trailing zero on a measured quantity
 * is a claim about precision the file did not make.
 */
function measured(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toPrecision(4)));
}

/**
 * What the file turned out to contain, or why it will not be drawn.
 *
 * Runs before anything is put on screen, and the caller only forwards a
 * `drawn: true` report once the scene is actually built — so an empty file
 * cannot be reported as a picture nobody can see. A mesh with points but no
 * cells is the case worth naming: vtk.js parses it happily, the mapper draws
 * nothing, and without this the researcher gets a black rectangle and no reason.
 */
/**
 * The scalar array a mesh carries, and what it is attached to.
 *
 * Points first, because a nodal field is the smoother picture — vtk.js
 * interpolates it across each cell, where an element field paints each facet
 * flat. When a file has both, colouring by the points is the better default,
 * and the caption names which was used so the choice is visible rather than
 * silent.
 *
 * Reading only points was a real gap: stress per element is the ordinary way a
 * solver writes FEA results, and such a file was told it had no values in it.
 */
function fieldOn(data: MeshData):
    { array: { getName(): string; getRange(): number[] }; per: "point" | "cell" }
    | null {
  const onPoints = data.getPointData?.()?.getScalars() ?? null;
  if (onPoints) return { array: onPoints, per: "point" };
  const onCells = data.getCellData?.()?.getScalars() ?? null;
  if (onCells) return { array: onCells, per: "cell" };
  return null;
}

export function summarise(parsed: Parsed, fileName: string): SpecialistReport {
  if (parsed.kind === "mesh") {
    const points = parsed.data.getNumberOfPoints();
    if (points === 0) {
      return { drawn: false, because:
        `${fileName} parsed, but there are no points in it — the file holds no `
        + "geometry to draw." };
    }
    const cells = parsed.data.getNumberOfCells();
    if (cells === 0) {
      return { drawn: false, because:
        `${fileName} has ${grouped(points)} points and no cells, so there is `
        + "nothing joining them into anything visible." };
    }
    const polys = parsed.data.getNumberOfPolys();
    if (polys === 0) {
      return { drawn: true, describes:
        `${grouped(points)} points, ${grouped(cells)} cells — lines or `
        + "vertices, not a closed surface." };
    }
    /*
     * A `.vtp` may carry a value per point — stress, temperature, displacement
     * — and it is now painted, against its own range and with a legend.
     *
     * Both halves matter. It was drawn once before against vtk.js's default
     * range of [0, 1], so a stress field of 0 to 240 MPa clamped almost
     * everywhere and came out as a flat sheet with one hot spot; and it was
     * then turned off entirely, which was honest but left the researcher with
     * a shape where their result should be. A field is readable when the ramp
     * covers the data and the reader can see what the colours mean.
     */
    const field = fieldOn(parsed.data);
    const array = field?.array ?? null;
    const shape = `${grouped(points)} points, ${grouped(polys)} polygons.`;
    if (array) {
      const [low, high] = array.getRange();
      if (high === low) {
        /*
         * A constant field has no gradient to show, and a ramp across it would
         * paint noise as structure — every colour in the bar standing for one
         * value. The number is the whole of what there is to say.
         */
        return { drawn: true, describes:
          `${shape} "${array.getName()}" is ${measured(low)} at every point, `
          + "so there is no variation to colour." };
      }
      return {
        drawn: true,
        describes: `${shape} Coloured by "${array.getName()}", `
          + `${measured(low)} to ${measured(high)}, one value per `
          + `${field!.per}.`,
        /* `measured` for both, the same formatter the sentence above uses. */
        legend: { label: array.getName(), low: measured(low),
                  high: measured(high), stops: rampStops() },
      };
    }
    /*
     * Said rather than left out.
     *
     * `specialist-vtk` names the risk exactly: a researcher who picks "Stress
     * visualization", opens an STL of a bracket and is shown an uncoloured
     * shape has been handed "a placebo with a viewer around it". Painting the
     * field answers that for a `.vtp` that carries one and not for a file that
     * does not — so the file that does not carry one has to say so, or the
     * silence reads as a result.
     */
    return { drawn: true, describes:
      `${shape} No values in this file, so nothing is coloured — a field `
      + "would arrive as a .vtp carrying an array on its points or its "
      + "cells." };
  }

  const [x, y, z] = parsed.data.getDimensions();
  if (!(x > 0 && y > 0 && z > 0)) {
    return { drawn: false, because:
      `${fileName} declares a ${x} × ${y} × ${z} grid, which holds no voxels.` };
  }
  const scalars = parsed.data.getPointData()?.getScalars() ?? null;
  if (scalars === null) {
    return { drawn: false, because:
      `${fileName} is a ${x} × ${y} × ${z} grid with no scalar array on its `
      + "points, so there are no values to map to colour and opacity." };
  }
  const [low, high] = scalars.getRange();
  return { drawn: true, describes:
    `${x} × ${y} × ${z} voxels, values ${measured(low)} to ${measured(high)}.` };
}

/**
 * The real vtk.js, assembled once per open.
 *
 * The rendering profiles are side-effect imports: without them the OpenGL
 * backend has no view node registered for an actor or a volume, and the scene
 * renders as an empty canvas with nothing thrown.
 */
async function loadVtk(): Promise<VtkKit> {
  const [
    { default: vtkSTLReader },
    { default: vtkOBJReader },
    { default: vtkPLYReader },
    { default: vtkXMLPolyDataReader },
    { default: vtkXMLImageDataReader },
    { default: vtkGenericRenderWindow },
    { default: vtkActor },
    { default: vtkMapper },
    { default: vtkVolume },
    { default: vtkVolumeMapper },
    { default: vtkColorTransferFunction },
    { default: vtkPiecewiseFunction },
  ] = await Promise.all([
    import("@kitware/vtk.js/IO/Geometry/STLReader"),
    import("@kitware/vtk.js/IO/Misc/OBJReader"),
    import("@kitware/vtk.js/IO/Geometry/PLYReader"),
    import("@kitware/vtk.js/IO/XML/XMLPolyDataReader"),
    import("@kitware/vtk.js/IO/XML/XMLImageDataReader"),
    import("@kitware/vtk.js/Rendering/Misc/GenericRenderWindow"),
    import("@kitware/vtk.js/Rendering/Core/Actor"),
    import("@kitware/vtk.js/Rendering/Core/Mapper"),
    import("@kitware/vtk.js/Rendering/Core/Volume"),
    import("@kitware/vtk.js/Rendering/Core/VolumeMapper"),
    import("@kitware/vtk.js/Rendering/Core/ColorTransferFunction"),
    import("@kitware/vtk.js/Common/DataModel/PiecewiseFunction"),
    import("@kitware/vtk.js/Rendering/Profiles/Geometry"),
    import("@kitware/vtk.js/Rendering/Profiles/Volume"),
  ]);

  return {
    read(format, bytes) {
      if (format === "obj") {
        // The OBJ reader is text-only; every other reader here sniffs ASCII
        // against binary itself, so they are given the buffer untouched.
        const reader = vtkOBJReader.newInstance();
        reader.parseAsText(new TextDecoder().decode(bytes));
        const data = reader.getOutputData() as MeshData | null;
        return data === null ? null : { kind: "mesh", data };
      }
      if (format === "vti") {
        const reader = vtkXMLImageDataReader.newInstance();
        reader.parseAsArrayBuffer(bytes);
        const data = reader.getOutputData() as VolumeData | null;
        return data === null ? null : { kind: "volume", data };
      }
      /*
       * The XML reader is parsed differently from the other two, and collapsing
       * them was a bug that made `.vtp` unopenable.
       *
       * `vtkSTLReader` and `vtkPLYReader` both expose `parse`; `vtkXMLPolyDataReader`
       * does not — it takes `parseAsArrayBuffer`, exactly as the `.vti` branch
       * above already calls it. So every `.vtp` failed with "reader.parse is not
       * a function", while the format sat in the accepted list this viewer
       * offers, and `.vtp` is the one of the four that carries a scalar array
       * per point. The tests missed it because they exercise the seam through a
       * stand-in reader, and a stand-in has whatever method it is given.
       */
      if (format === "vtp") {
        const reader = vtkXMLPolyDataReader.newInstance();
        reader.parseAsArrayBuffer(bytes);
        const data = reader.getOutputData() as MeshData | null;
        return data === null ? null : { kind: "mesh", data };
      }
      const reader = format === "stl" ? vtkSTLReader.newInstance()
        : vtkPLYReader.newInstance();
      reader.parse(bytes);
      const data = reader.getOutputData() as MeshData | null;
      return data === null ? null : { kind: "mesh", data };
    },

    open(host) {
      const session = vtkGenericRenderWindow.newInstance({
        background: [0.06, 0.07, 0.09],
      });
      session.setContainer(host);
      session.resize();
      const renderer = session.getRenderer();

      return {
        show(parsed) {
          if (parsed.kind === "mesh") {
            const mapper = vtkMapper.newInstance();
            const attached = fieldOn(parsed.data);
            const range = attached ? attached.array.getRange() : null;

            /*
             * Painted over the array's own range, or not painted at all.
             *
             * vtk.js leaves `scalarVisibility` on and defaults the mapper's
             * range to [0, 1], which is the bug this replaces: a stress field
             * of 0 to 240 MPa clamped almost everywhere and drew a flat sheet
             * with one hot spot — a picture that reads as a solved field and
             * is not one.
             *
             * `useLookupTableScalarRange` is what makes the ramp follow the
             * data: without it the mapper keeps its own range and the transfer
             * function is sampled through the wrong window, which is the same
             * defect wearing a lookup table.
             *
             * A constant field is left uncoloured on purpose — see `summarise`.
             */
            if (range && range[1] > range[0]) {
              const [low, high] = range;
              const ramp = vtkColorTransferFunction.newInstance();
              for (const [t, r, g, b] of FIELD_RAMP) {
                ramp.addRGBPoint(low + (high - low) * t, r, g, b);
              }
              mapper.setLookupTable(ramp);
              mapper.setUseLookupTableScalarRange(true);
              mapper.setScalarVisibility(true);
              /*
               * Told explicitly which arrays to read. The default mode picks
               * for itself, and a mesh whose field is on its cells would be
               * searched for point scalars and drawn plain — the field
               * present, the picture blank, and nothing saying so.
               */
              if (attached!.per === "cell") mapper.setScalarModeToUseCellData();
              else mapper.setScalarModeToUsePointData();
            } else {
              mapper.setScalarVisibility(false);
            }
            mapper.setInputData(parsed.data);
            const actor = vtkActor.newInstance();
            actor.setMapper(mapper);
            renderer.addActor(actor);
          } else {
            const image = parsed.data;
            const [low, high] =
              image.getPointData()?.getScalars()?.getRange() ?? [0, 1];
            const span = high - low || 1;

            const colours = vtkColorTransferFunction.newInstance();
            colours.addRGBPoint(low, 0.0, 0.02, 0.08);
            colours.addRGBPoint(low + span * 0.45, 0.55, 0.28, 0.12);
            colours.addRGBPoint(high, 1.0, 0.98, 0.92);

            // The low fifth of the range is held fully transparent: a scanned
            // or simulated volume is mostly the empty medium around the thing
            // being looked at, and a ramp starting at zero draws that fog over
            // everything else.
            const opacity = vtkPiecewiseFunction.newInstance();
            opacity.addPoint(low, 0.0);
            opacity.addPoint(low + span * 0.2, 0.0);
            opacity.addPoint(low + span * 0.6, 0.18);
            opacity.addPoint(high, 0.55);

            const mapper = vtkVolumeMapper.newInstance();
            mapper.setInputData(image);
            mapper.setBlendModeToComposite();
            const step = Math.min(...image.getSpacing());
            if (Number.isFinite(step) && step > 0) {
              mapper.setSampleDistance(step * 0.8);
            }

            const volume = vtkVolume.newInstance();
            volume.setMapper(mapper);
            volume.getProperty().setRGBTransferFunction(0, colours);
            volume.getProperty().setScalarOpacity(0, opacity);
            volume.getProperty().setInterpolationTypeToLinear();
            volume.getProperty().setShade(true);
            renderer.addVolume(volume);
          }

          renderer.resetCamera();
          session.getRenderWindow().render();
        },

        delete() {
          session.delete();
        },
      };
    },
  };
}

export type VolumeViewerProps = SpecialistViewerProps & {
  /**
   * How vtk.js is obtained.
   *
   * Injectable for the same single reason the mount's `loadViewer` is: the
   * paths worth testing — a file this viewer will not read, an empty parse, a
   * reader that throws, a GL context released on unmount — all sit behind a
   * library that cannot run in a DOM with no GPU. Production passes nothing.
   */
  vtk?: () => Promise<VtkKit>;
};

type Phase =
  | { kind: "reading"; fileName: string }
  | { kind: "drawn"; describes: string }
  | { kind: "refused"; because: string };

export default function VolumeViewer(
  { file, onClose, onStatus, vtk = loadVtk }: VolumeViewerProps,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>(
    { kind: "refused", because: NEEDS_A_FILE });

  useEffect(() => {
    const host = hostRef.current;

    const refuse = (because: string) => {
      setPhase({ kind: "refused", because });
      onStatus?.({ drawn: false, because });
    };

    const blocked = requireWebGL(host);
    if (blocked !== null) {
      refuse(blocked);
      return;
    }
    if (file === undefined) {
      refuse(NEEDS_A_FILE);
      return;
    }

    const format = formatOf(file.name);
    if (format === null) {
      // Refused before the chunk is fetched: downloading tens of megabytes to
      // tell somebody their spreadsheet is a spreadsheet is its own defect.
      refuse(`${file.name} is not a format this viewer reads. It opens `
        + `${ACCEPTED}.`);
      return;
    }

    setPhase({ kind: "reading", fileName: file.name });

    let view: VtkView | null = null;
    let live = true;

    void (async () => {
      try {
        const kit = await vtk();
        const bytes = await file.arrayBuffer();
        if (!live || host === null) return;

        const parsed = kit.read(format, bytes);
        if (parsed === null) {
          refuse(`${file.name} produced no dataset — the reader for `
            + `.${format} files found nothing in it.`);
          return;
        }

        const report = summarise(parsed, file.name);
        if (!report.drawn) {
          refuse(report.because);
          return;
        }

        view = kit.open(host);
        view.show(parsed);
        // The file may have changed while the chunk was arriving. The scene is
        // built either way — it is cheaper than unwinding the parse — but the
        // context is released now rather than left to a cleanup that has
        // already run.
        if (!live) {
          view.delete();
          view = null;
          return;
        }
        setPhase({ kind: "drawn", describes: report.describes });
        onStatus?.(report);
      } catch (cause) {
        if (!live) return;
        const detail = cause instanceof Error ? cause.message : String(cause);
        refuse(`${file.name} was not read: ${detail}`);
      }
    })();

    return () => {
      live = false;
      view?.delete();
      view = null;
    };
  }, [file, onStatus, vtk]);

  return (
    <figure
      className={phase.kind === "refused" ? "chart chart-refused" : "chart"}
    >
      {/*
        Rendered in every phase, and sized only once something is in it. The
        WebGL probe needs an element in the live document to test, and an
        always-present host keeps that probe from reporting "no element" the
        second time round. Empty and unsized it is not a frame — an empty frame
        is exactly what a researcher reads as an empty file.
      */}
      <div
        ref={hostRef}
        style={phase.kind === "drawn"
          ? { width: "100%", height: 420 }
          : undefined}
      />

      {phase.kind === "reading" && (
        <p className="spatial-note">
          Reading {phase.fileName} and fetching vtk.js…
        </p>
      )}
      {phase.kind === "refused" && (
        <p className="chart-refusal">{phase.because}</p>
      )}

      <figcaption className="chart-caption">
        {phase.kind === "drawn"
          ? "Drawn by vtk.js from the file you chose, read in this browser. "
            + "Nothing was uploaded and nothing was fetched."
          : "vtk.js reads the file in this browser. Nothing is uploaded, and "
            + "no geometry is looked up by name anywhere."}
      </figcaption>

      {onClose !== undefined && (
        <button type="button" className="spatial-quiet" onClick={onClose}>
          Close viewer
        </button>
      )}
    </figure>
  );
}
