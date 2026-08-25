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

/** What this viewer reads out of a mesh; vtk.js polydata has far more. */
export type MeshData = {
  getNumberOfPoints(): number;
  getNumberOfPolys(): number;
  getNumberOfCells(): number;
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
    return { drawn: true,
      describes: `${grouped(points)} points, ${grouped(polys)} polygons.` };
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
      const reader = format === "stl" ? vtkSTLReader.newInstance()
        : format === "ply" ? vtkPLYReader.newInstance()
        : vtkXMLPolyDataReader.newInstance();
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
