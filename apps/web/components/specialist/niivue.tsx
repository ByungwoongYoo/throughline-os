"use client";

/**
 * A researcher's own NIfTI volume, drawn by NiiVue (T079).
 *
 * NiiVue is the neuroimaging community's viewer: it reads NIfTI, MGH/MGZ and a
 * dozen adjacent formats, orients them from the header rather than from the
 * voxel order, and draws axial/coronal/sagittal together. That last part is why
 * a library is worth tens of megabytes here — the repo's own `volume` primitive
 * splats voxels perfectly well, but it does not know what `sform`, `qform` or an
 * oblique acquisition mean, and a brain drawn in the wrong handedness is a
 * picture that looks right and has left and right swapped.
 *
 * **The file is read in this browser and goes nowhere.** No accession lookup, no
 * PACS, no server round trip: `loadFromFile` is handed the `File` object from
 * the picker and nothing else is ever fetched. Drag-and-drop is switched off in
 * the NiiVue instance for the same reason — not because dropping a file is
 * unsafe, but because it is a second way in that would bypass the format check
 * and the honest report below, and a viewer with two doors reports on one.
 *
 * **What this viewer refuses to claim.** It reads *volumes*: `.nii`, `.nii.gz`,
 * `.mgh`, `.mgz`. NiiVue can also read surfaces and tractography, and this file
 * deliberately does not offer them — the catalogue's mesh entries stay
 * `needs-library` rather than being flipped on the strength of a library
 * feature nobody here has exercised. DICOM stays refused outright, in words,
 * because ingestion does not read DICOM anywhere in this system (ROADMAP's
 * library audit) and a viewer that accepted `.dcm` and failed inside NiiVue
 * would look like a broken file rather than an absent capability.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { requireWebGL } from "@/lib/specialist/contract";
import type { SpecialistViewerProps } from "@/lib/specialist/contract";

/**
 * Suffixes this viewer claims, matched whole.
 *
 * `.gz` is deliberately not among them. Compression is not a format, and a
 * viewer that accepted any gzipped thing would hand `results.tar.gz` to a NIfTI
 * parser and report whatever it said about the first bytes of a tar header.
 */
const READS = [".nii.gz", ".nii", ".mgz", ".mgh"] as const;

/** Written out for the reader; the refusals list the same four. */
const READS_SENTENCE = ".nii, .nii.gz, .mgh and .mgz";

/**
 * Names that mean "this is DICOM straight off the scanner".
 *
 * A file with no suffix at all belongs here: that is what a DICOM instance
 * looks like inside an exported study directory, and NiiVue itself treats an
 * empty extension as DICOM.
 */
const DICOM_SUFFIXES = [".dcm", ".dicom", ".ima"] as const;

export type FormatVerdict =
  | { readable: true; suffix: string }
  | { readable: false; because: string };

/**
 * Whether NiiVue will be given this file at all, decided from its name.
 *
 * Before the library, and before the file is read. Extension sniffing is
 * usually a poor test, but here it is the same test NiiVue makes internally —
 * it dispatches on the suffix — so checking first costs nothing and turns "a
 * parser threw somewhere inside a 30MB bundle" into a sentence that names the
 * file and says what would work instead.
 */
export function readableVolume(fileName: string): FormatVerdict {
  const name = fileName.toLowerCase();

  for (const suffix of READS) {
    if (name.endsWith(suffix)) return { readable: true, suffix };
  }

  const dicom = DICOM_SUFFIXES.some((s) => name.endsWith(s))
    || !name.slice(name.lastIndexOf("/") + 1).includes(".");
  if (dicom) {
    return {
      readable: false,
      because: `${fileName} looks like DICOM, and nothing in this system reads `
        + "DICOM — not this viewer and not ingestion. Convert the series to "
        + "NIfTI (dcm2niix produces a .nii.gz) and open that instead. The file "
        + "was not read and was not sent anywhere.",
    };
  }

  return {
    readable: false,
    because: `${fileName} is not a volume this viewer reads. It reads `
      + `${READS_SENTENCE}. The file was not read and was not sent anywhere.`,
  };
}

/** The header fields this viewer states, common to NIfTI-1 and NIfTI-2. */
export type VolumeHeader = {
  /** `dims[0]` is the rank; `dims[1..3]` the size; `dims[4]` the frame count. */
  dims: number[];
  pixDims: number[];
  xyzt_units: number;
};

/**
 * What one voxel measures, or `null` when the file does not say.
 *
 * The low three bits of `xyzt_units` are the spatial unit in both NIfTI-1 and
 * NIfTI-2 (`NIFTI_UNITS_METER`, `_MM`, `_MICRON`). Zero means unspecified, and
 * printing "mm" there would state a scale the file does not carry — which for a
 * microscopy volume mislabels the subject by three orders of magnitude.
 */
export function spatialUnit(xyztUnits: number): string | null {
  switch (xyztUnits & 0x07) {
    case 1: return "m";
    case 2: return "mm";
    case 3: return "µm";
    default: return null;
  }
}

/** Two decimals at most, without the trailing zeros `toFixed` leaves. */
function short(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The sentence shown once something is actually on screen.
 *
 * Deliberately arithmetic rather than adjectival: a size, a voxel scale and,
 * for a 4D series, which frame is being looked at. NiiVue shows the first
 * frame of a timeseries and says nothing about the rest, so a researcher
 * scrolling an fMRI run would otherwise have no way to tell 240 volumes from
 * one.
 */
export function describeVolume(
  fileName: string, header: VolumeHeader | null,
): string {
  if (header === null) {
    return `${fileName} is drawn, but it carries no header this viewer can `
      + "read, so nothing is claimed about its size.";
  }

  const [rank = 0, nx = 0, ny = 0, nz = 0, frames = 1] = header.dims;
  if (![nx, ny, nz].every((n) => Number.isFinite(n) && n > 0)) {
    return `${fileName} is drawn, but its header gives no usable voxel counts, `
      + "so its size is not stated.";
  }

  const unit = spatialUnit(header.xyzt_units);
  const [, dx = 0, dy = 0, dz = 0] = header.pixDims;
  const scale = unit === null || ![dx, dy, dz].every((d) => d > 0)
    ? ""
    : ` at ${short(dx)} × ${short(dy)} × ${short(dz)} ${unit} per voxel`;

  const series = rank >= 4 && frames > 1
    ? `, frame 1 of ${frames} shown`
    : "";

  return `${fileName}: ${nx} × ${ny} × ${nz} voxels${scale}${series}, drawn `
    + "axial, coronal and sagittal.";
}

/** Whatever the library or the browser said, as a sentence for a person. */
function detailOf(cause: unknown): string {
  if (cause instanceof Error && cause.message !== "") return cause.message;
  const text = String(cause);
  return text === "" ? "no reason was given" : text;
}

const NO_FILE_YET =
  `no volume has been chosen yet. This viewer reads ${READS_SENTENCE} from `
  + "your own disk — nothing is fetched and nothing is uploaded.";

/** What has happened to the file currently in hand. */
type Load =
  | { kind: "reading" }
  | { kind: "drawn"; describes: string }
  | { kind: "failed"; because: string };

export default function NiivueViewer(
  { file, onClose, onStatus }: SpecialistViewerProps,
) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [gate, setGate] = useState<{ checked: boolean; refusal: string | null }>(
    { checked: false, refusal: null });
  const [load, setLoad] = useState<Load | null>(null);

  /*
   * A layout effect, not an ordinary one: it decides whether a canvas is ever
   * mounted, and an ordinary effect runs after paint, so a browser with no
   * WebGL would show an empty black frame for one frame before the refusal
   * replaced it. That flash is exactly the "your file must be empty" reading
   * this seam exists to prevent.
   */
  useLayoutEffect(() => {
    setGate({ checked: true, refusal: requireWebGL(holderRef.current) });
  }, []);

  const verdict = file === undefined ? null : readableVolume(file.name);
  const wanted = gate.checked && gate.refusal === null
    && verdict !== null && verdict.readable;

  useEffect(() => {
    if (!gate.checked) return;
    if (gate.refusal !== null) {
      onStatus?.({ drawn: false, because: gate.refusal });
      return;
    }
    if (file === undefined) {
      setLoad(null);
      onStatus?.({ drawn: false, because: NO_FILE_YET });
      return;
    }

    const format = readableVolume(file.name);
    if (!format.readable) {
      setLoad({ kind: "failed", because: format.because });
      onStatus?.({ drawn: false, because: format.because });
      return;
    }

    let live = true;
    // Captured so the cleanup below can dispose an instance the async body
    // creates after that cleanup has already run — the ordinary outcome of a
    // researcher choosing a second file while the first is still decompressing.
    let engine: { cleanup(): void } | null = null;

    const dispose = (): void => {
      const doomed = engine;
      engine = null;
      try {
        doomed?.cleanup();
      } catch {
        // A half-attached instance can throw on the way down. The reason the
        // reader needs is the one that got us here, not this one.
      }
    };

    setLoad({ kind: "reading" });

    void (async () => {
      let stage: "starting" | "reading" = "starting";
      try {
        // Imported here rather than at module scope: NiiVue touches the DOM and
        // the GPU as it initialises, and a static import would put all of it in
        // the page every researcher loads first, including everyone who never
        // opens a scan.
        const { Niivue, SLICE_TYPE } = await import("@niivue/niivue");
        if (!live) return;

        const instance = new Niivue({
          sliceType: SLICE_TYPE.MULTIPLANAR,
          isColorbar: true,
          // One door: the mount's picker. See the note at the top of the file.
          dragAndDropEnabled: false,
        });
        engine = instance;
        if (!live) { dispose(); return; }

        const canvas = canvasRef.current;
        if (canvas === null) {
          throw new Error("the viewer's canvas was gone before the volume "
            + "could be attached to it");
        }
        await instance.attachToCanvas(canvas);
        if (!live) { dispose(); return; }

        stage = "reading";
        await instance.loadFromFile(file);
        if (!live) { dispose(); return; }

        const describes = describeVolume(
          file.name, instance.volumes[0]?.hdr ?? null);
        setLoad({ kind: "drawn", describes });
        onStatus?.({ drawn: true, describes });
      } catch (cause) {
        dispose();
        if (!live) return;
        const because = stage === "starting"
          ? `NiiVue could not start on this page: ${detailOf(cause)}. It needs `
            + "WebGL2 specifically, which a browser can lack while still "
            + `offering the older WebGL this page checked for. ${file.name} `
            + "was not read."
          : `${file.name} was opened in this browser but NiiVue could not read `
            + `it: ${detailOf(cause)}. Nothing was sent anywhere.`;
        setLoad({ kind: "failed", because });
        onStatus?.({ drawn: false, because });
      }
    })();

    return () => { live = false; dispose(); };
  }, [file, gate.checked, gate.refusal, onStatus]);

  const refusal = gate.refusal
    ?? (load !== null && load.kind === "failed" ? load.because : null);

  return (
    <div ref={holderRef}>
      {refusal !== null && (
        <figure className="chart chart-refused">
          <p className="chart-refusal">Nothing is drawn.</p>
          <p className="chart-refusal-detail">{refusal}</p>
          <figcaption className="chart-caption">
            NiiVue draws {READS_SENTENCE} volumes from your own disk. Nothing
            here is fetched, and no file you choose leaves this browser.
          </figcaption>
        </figure>
      )}

      {/* Mounted only when there is a readable volume to put in it: an empty
          canvas is indistinguishable from an empty scan. */}
      {wanted && refusal === null && (
        <canvas
          ref={canvasRef}
          width={720}
          height={520}
          style={{ width: "100%", maxWidth: 720, height: 520, display: "block" }}
        />
      )}

      {gate.checked && gate.refusal === null && file === undefined && (
        <p className="spatial-note">
          Choose a {READS_SENTENCE} volume. It is read here, in this browser.
        </p>
      )}

      {load !== null && load.kind === "reading" && (
        <p className="spatial-note">Reading {file?.name}…</p>
      )}

      {load !== null && load.kind === "drawn" && (
        <p className="spatial-note">{load.describes}</p>
      )}

      {onClose !== undefined && (
        <button type="button" className="spatial-quiet" onClick={onClose}>
          Close this viewer
        </button>
      )}
    </div>
  );
}
