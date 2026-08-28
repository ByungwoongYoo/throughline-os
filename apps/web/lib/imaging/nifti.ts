/**
 * Reading a NIfTI volume, in the browser, without sending it anywhere.
 *
 * NIfTI-1 first and DICOM deliberately not, which is a judgement worth stating.
 * A NIfTI is one file with a fixed 348-byte header and a contiguous block of
 * voxels: parseable exactly, in a page of code, with no library and no network.
 * A DICOM *series* is hundreds of files, a dozen transfer syntaxes and often
 * JPEG-2000 compression — real work that wants a real library, which is what
 * the specialist pack is for. Pretending to read DICOM by handling only
 * uncompressed explicit-VR would open a quarter of what researchers actually
 * have and fail confusingly on the rest.
 *
 * **What a NIfTI header can and cannot say is itself the interesting part.** It
 * records geometry — voxel dimensions, orientation — precisely. It does not
 * record modality, sequence weighting, contrast phase or field strength at all;
 * those live in the DICOM the NIfTI was converted from and are simply gone.
 *
 * So a pair of NIfTIs opened here will usually come back as *cannot be judged*
 * rather than *comparable*, and that is correct rather than a shortcoming. The
 * file genuinely does not say whether it is a CT or an MR. The alternative —
 * assuming, or inferring from the filename — is exactly the "silence read as
 * agreement" failure the comparability engine exists to refuse.
 */

import { Grid } from "@/lib/charts3d/voxels";
import { Study, blankStudy, fromHeader } from "./study";

/** The fixed size of a NIfTI-1 header, and the value that identifies one. */
const HEADER_BYTES = 348;

/** What a successful read produces: the voxels, and what the header said. */
export type ReadResult = {
  grid: Grid;
  study: Study;
  /** Facts the header does not carry at all, named so a caller can ask. */
  absent: string[];
};

export class NiftiError extends Error {}

/**
 * Whether these bytes are gzipped.
 *
 * `.nii.gz` is the common form on disk, and the magic is the honest test — a
 * filename is a claim about the contents rather than the contents.
 */
export function isGzipped(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Decompress if needed, using the platform's own gzip.
 *
 * `DecompressionStream` is in the browser and in Node; bundling an inflate
 * implementation to do what the runtime already does would be weight for
 * nothing.
 */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzipped(bytes)) return bytes;
  if (typeof DecompressionStream === "undefined") {
    throw new NiftiError(
      "This file is gzipped and this browser cannot decompress it. Save it as "
      + "an uncompressed .nii and try again.");
  }
  const stream = new Blob([bytes as BlobPart]).stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a NIfTI-1 volume.
 *
 * Endianness is decided by the header's own size field rather than assumed:
 * the file records 348, so reading it as something else means the other byte
 * order. Files written on a big-endian machine are still in circulation and
 * fail silently — as noise — if this is skipped.
 */
export function readNifti(buffer: ArrayBuffer, label: string): ReadResult {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new NiftiError(
      `This file is ${buffer.byteLength} bytes; a NIfTI header alone is `
      + `${HEADER_BYTES}. It is not a NIfTI.`);
  }
  const view = new DataView(buffer);

  let little = true;
  if (view.getInt32(0, true) !== HEADER_BYTES) {
    little = false;
    if (view.getInt32(0, false) !== HEADER_BYTES) {
      throw new NiftiError(
        "This file does not begin with a NIfTI header. If it is a DICOM "
        + "series, it needs the imaging viewer pack rather than this reader.");
    }
  }

  const dim = (i: number) => view.getInt16(40 + i * 2, little);
  const pixdim = (i: number) => view.getFloat32(76 + i * 4, little);

  const rank = dim(0);
  if (rank < 3) {
    throw new NiftiError(
      `This NIfTI has ${rank} dimension${rank === 1 ? "" : "s"}; a volume needs `
      + "three. A single slice cannot be compared as a volume.");
  }
  const nx = dim(1), ny = dim(2), nz = dim(3);
  if (!(nx > 0 && ny > 0 && nz > 0)) {
    throw new NiftiError("This NIfTI reports a dimension of zero.");
  }

  const datatype = view.getInt16(70, little);
  const scale = view.getFloat32(112, little);
  const offsetValue = view.getFloat32(116, little);
  const start = Math.max(HEADER_BYTES, Math.round(view.getFloat32(108, little)));

  const total = nx * ny * nz;
  const values = readVoxels(buffer, view, start, total, datatype, little);

  /*
   * `scl_slope` and `scl_inter` convert stored integers to the real
   * measurement, and a slope of zero means "not used" rather than "multiply by
   * nothing". Skipping this leaves a CT in raw stored units, where the window
   * a radiologist knows in Hounsfield units lands somewhere meaningless.
   */
  if (scale !== 0 && (scale !== 1 || offsetValue !== 0)) {
    for (let i = 0; i < values.length; i += 1) {
      values[i] = values[i] * scale + offsetValue;
    }
  }

  const grid: Grid = { nx, ny, nz, values, units: unitsOf(view, little) };

  /*
   * Only geometry comes from the header, because only geometry is in it.
   * Modality, weighting, contrast phase and field strength are recorded in the
   * DICOM this was converted from and do not survive the conversion — so they
   * are left unknown rather than guessed from the filename.
   */
  const study: Study = {
    ...blankStudy(label, label),
    sliceThickness: fromHeader(Math.abs(pixdim(3))),
    pixelSpacing: fromHeader(Math.abs(pixdim(1))),
  };
  const orientation = orientationFrom(view, little);
  if (orientation) study.orientation = fromHeader(orientation);

  return {
    grid,
    study,
    absent: [
      "modality", "sequence weighting", "contrast phase", "field strength",
      ...(orientation ? [] : ["orientation"]),
    ],
  };
}

/** The voxels, in whichever of the common types the file used. */
function readVoxels(buffer: ArrayBuffer, view: DataView, start: number,
                    total: number, datatype: number,
                    little: boolean): Float32Array {
  const out = new Float32Array(total);
  const bytes = BYTES_PER[datatype];
  if (!bytes) {
    throw new NiftiError(
      `This NIfTI stores its voxels in a format this reader does not handle `
      + `(datatype ${datatype}). Convert it to float32 or int16.`);
  }
  if (start + total * bytes > buffer.byteLength) {
    /*
     * A truncated file read to the end yields zeros, and zeros are a real
     * value — 0 HU is water. A volume that quietly ends in water looks like a
     * scan rather than like a broken download.
     */
    throw new NiftiError(
      "This NIfTI is shorter than its header says it should be — it is "
      + "truncated or still downloading.");
  }

  for (let i = 0; i < total; i += 1) {
    const at = start + i * bytes;
    switch (datatype) {
      case 2: out[i] = view.getUint8(at); break;
      case 256: out[i] = view.getInt8(at); break;
      case 4: out[i] = view.getInt16(at, little); break;
      case 512: out[i] = view.getUint16(at, little); break;
      case 8: out[i] = view.getInt32(at, little); break;
      case 768: out[i] = view.getUint32(at, little); break;
      case 16: out[i] = view.getFloat32(at, little); break;
      case 64: out[i] = view.getFloat64(at, little); break;
    }
  }
  return out;
}

const BYTES_PER: Record<number, number> = {
  2: 1, 256: 1, 4: 2, 512: 2, 8: 4, 768: 4, 16: 4, 64: 8,
};

/** The measurement's units, where the header names them. */
function unitsOf(view: DataView, little: boolean): string | undefined {
  // `intent_name` is 16 bytes at 328 and is often where a converter puts
  // something readable. Empty is the common case and means nothing is claimed.
  let text = "";
  for (let i = 0; i < 16; i += 1) {
    const code = view.getUint8(328 + i);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  void little;
  return text.trim() || undefined;
}

/**
 * Which plane the slices run in, from the affine.
 *
 * Read from `sform` when it is set, because that is the transform that says
 * where the voxels are in the scanner. The third column is the direction the
 * slice index advances in, and whichever anatomical axis it lies closest to
 * names the plane. Returns null when the file records no affine at all rather
 * than defaulting to axial — most volumes are axial, which is exactly what
 * makes a default dangerous.
 */
function orientationFrom(view: DataView, little: boolean):
    "axial" | "coronal" | "sagittal" | null {
  const sformCode = view.getInt16(254, little);
  if (sformCode <= 0) return null;

  // srow_x, srow_y, srow_z each hold four floats from offset 280.
  const k = [
    view.getFloat32(280 + 2 * 4, little),
    view.getFloat32(296 + 2 * 4, little),
    view.getFloat32(312 + 2 * 4, little),
  ].map(Math.abs);

  if (!k.some((v) => v > 0)) return null;
  const largest = k.indexOf(Math.max(...k));
  // x is left-right, y anterior-posterior, z inferior-superior.
  return largest === 0 ? "sagittal" : largest === 1 ? "coronal" : "axial";
}

/**
 * Read a file the researcher chose, without it leaving the machine.
 *
 * Takes the bytes directly: no upload, no fetch, no worker that could be
 * pointed at a network. The file never becomes a request.
 */
export async function openNifti(file: File): Promise<ReadResult> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const bytes = await gunzip(raw);
  // A fresh buffer, because a Uint8Array view may sit at a non-zero offset
  // inside a larger one and DataView would then read from the wrong place.
  const copy = bytes.buffer.slice(
    bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return readNifti(copy, file.name.replace(/\.nii(\.gz)?$/i, ""));
}
