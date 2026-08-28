/**
 * Reading a DICOM header, in the browser, without sending it anywhere.
 *
 * The case a hospital actually receives is a DICOM series, and DICOM is the
 * only format here that records what comparability is decided on: modality,
 * sequence weighting, contrast phase, field strength. A NIfTI records geometry
 * and nothing else, which is why two of them come back as *cannot be judged*.
 * So this is what turns the verdict from a shrug into an answer.
 *
 * **Headers always; pixels only when they are not compressed.** Decoding
 * JPEG-2000 or JPEG-LS is a codec, and a wrong one produces an image that
 * looks like a scan — which is the failure mode this project spends its time
 * refusing. Uncompressed little-endian is what most CT and MR comes off PACS
 * as, and anything else is named by its transfer syntax and declined rather
 * than half-read.
 *
 * That split is not a compromise. The header alone is enough for the
 * comparability engine and the privacy review, and both of those are the parts
 * nobody else does — a series whose pixels cannot be shown here can still be
 * *judged* here, and told apart from one that can.
 *
 * **Nothing in this file writes an identifier anywhere.** It returns the header
 * so `phi.ts` can classify it, and `phi.recordable` decides what may be kept.
 */

import { Grid } from "@/lib/charts3d/voxels";
import {
  ContrastPhase, Modality, Study, Weighting, blankStudy, fromHeader,
} from "./study";

export class DicomError extends Error {}

/** A parsed element, keyed by the name a reader would recognise. */
export type Header = Record<string, unknown>;

export type SliceRead = {
  header: Header;
  /** Present only when the pixels were stored uncompressed. */
  pixels: Float32Array | null;
  rows: number;
  columns: number;
  /** Where this slice sits along the stack, for ordering a series. */
  position: number | null;
  instance: number | null;
  /** The transfer syntax, so a refusal can name it. */
  transferSyntax: string;
};

/*
 * The tags this reads, by group and element.
 *
 * A listing rather than a parser of the whole dictionary: DICOM has thousands
 * of tags, and reading only what is used keeps the code answerable to a person.
 * Everything else is still *reported* — see `header` — so `phi.ts` can classify
 * fields this does not otherwise care about.
 */
const TAGS: Record<string, string> = {
  "0002,0010": "TransferSyntaxUID",
  "0008,0060": "Modality",
  "0008,0080": "InstitutionName",
  "0008,0020": "StudyDate",
  "0008,0030": "StudyTime",
  "0008,0090": "ReferringPhysicianName",
  "0008,1030": "StudyDescription",
  "0008,103e": "SeriesDescription",
  "0008,0008": "ImageType",
  "0010,0010": "PatientName",
  "0010,0020": "PatientID",
  "0010,0030": "PatientBirthDate",
  "0010,0040": "PatientSex",
  "0010,1010": "PatientAge",
  "0008,0050": "AccessionNumber",
  "0018,0015": "BodyPartExamined",
  "0018,0020": "ScanningSequence",
  "0018,0021": "SequenceVariant",
  "0018,0050": "SliceThickness",
  "0018,0060": "KVP",
  "0018,0080": "RepetitionTime",
  "0018,0081": "EchoTime",
  "0018,0087": "MagneticFieldStrength",
  "0018,0088": "SpacingBetweenSlices",
  "0018,1030": "ProtocolName",
  "0018,1210": "ConvolutionKernel",
  "0018,0010": "ContrastBolusAgent",
  "0018,1040": "ContrastBolusRoute",
  "0008,0070": "Manufacturer",
  "0008,1090": "ManufacturerModelName",
  "0018,1000": "DeviceSerialNumber",
  "0020,0013": "InstanceNumber",
  "0020,0032": "ImagePositionPatient",
  "0020,0037": "ImageOrientationPatient",
  "0028,0002": "SamplesPerPixel",
  "0028,0004": "PhotometricInterpretation",
  "0028,0010": "Rows",
  "0028,0011": "Columns",
  "0028,0030": "PixelSpacing",
  "0028,0100": "BitsAllocated",
  "0028,0101": "BitsStored",
  "0028,0103": "PixelRepresentation",
  "0028,1052": "RescaleIntercept",
  "0028,1053": "RescaleSlope",
  "0028,0301": "BurnedInAnnotation",
};

/** Transfer syntaxes whose pixel data is plain, uncompressed samples. */
const UNCOMPRESSED = new Set([
  "1.2.840.10008.1.2",      // Implicit VR little endian
  "1.2.840.10008.1.2.1",    // Explicit VR little endian
]);

/** Value representations that store their length in four bytes, not two. */
const LONG_VR = new Set(["OB", "OW", "OF", "SQ", "UT", "UN"]);

/**
 * Read one DICOM file.
 *
 * Part 10 layout: a 128-byte preamble nobody reads, the letters `DICM`, then a
 * file-meta group that is *always* explicit VR little endian regardless of what
 * the dataset uses — the meta group is where the transfer syntax is recorded,
 * so it cannot itself depend on knowing it.
 */
export function readDicom(buffer: ArrayBuffer): SliceRead {
  const view = new DataView(buffer);
  if (buffer.byteLength < 132) {
    throw new DicomError(
      `This file is ${buffer.byteLength} bytes; a DICOM preamble alone is 132.`);
  }
  const magic = String.fromCharCode(
    view.getUint8(128), view.getUint8(129), view.getUint8(130), view.getUint8(131));
  if (magic !== "DICM") {
    throw new DicomError(
      "This file has no DICM marker. If it is a NIfTI, the other reader takes "
      + "it; some PACS exports omit the preamble, which this does not handle.");
  }

  const header: Header = {};
  // The meta group, always explicit VR little endian by the standard.
  const metaEnd = readElements(view, 132, buffer.byteLength, header, true, true);

  const transferSyntax = String(header.TransferSyntaxUID ?? "").trim()
    || "1.2.840.10008.1.2";
  const explicit = transferSyntax !== "1.2.840.10008.1.2";

  // Where the dataset stopped is not needed — the pixel offset comes back
  // through the callback, and the walk ends at the pixel data either way.
  let pixelOffset: number | null = null;
  readElements(view, metaEnd, buffer.byteLength, header, explicit, false,
               (offset) => { pixelOffset = offset; });

  const rows = Number(header.Rows ?? 0);
  const columns = Number(header.Columns ?? 0);

  let pixels: Float32Array | null = null;
  if (pixelOffset !== null && UNCOMPRESSED.has(transferSyntax)
      && rows > 0 && columns > 0) {
    pixels = readPixels(view, pixelOffset, header, rows * columns);
  }

  return {
    header, pixels, rows, columns, transferSyntax,
    position: positionOf(header),
    instance: header.InstanceNumber !== undefined
      ? Number(header.InstanceNumber) : null,
  };
}

/**
 * Walk data elements until the pixel data or the end.
 *
 * Stops *at* pixel data rather than reading it, so a compressed series is
 * parsed for its header and declined for its image — which is the whole point
 * of separating the two.
 */
function readElements(view: DataView, from: number, end: number,
                      header: Header, explicit: boolean, metaOnly: boolean,
                      onPixelData?: (offset: number) => void): number {
  let at = from;

  while (at + 8 <= end) {
    const group = view.getUint16(at, true);
    const element = view.getUint16(at + 2, true);

    // The meta group ends where group 0002 does; the dataset follows in
    // whatever syntax the meta group just declared.
    if (metaOnly && group !== 0x0002) return at;

    const key = `${hex(group)},${hex(element)}`;
    at += 4;

    let vr = "";
    let length = 0;
    if (explicit) {
      vr = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1));
      at += 2;
      if (LONG_VR.has(vr)) {
        at += 2;                       // two reserved bytes
        length = view.getUint32(at, true);
        at += 4;
      } else {
        length = view.getUint16(at, true);
        at += 2;
      }
    } else {
      length = view.getUint32(at, true);
      at += 4;
    }

    if (group === 0x7fe0 && element === 0x0010) {
      onPixelData?.(at);
      return at;
    }

    /*
     * An undefined length (0xFFFFFFFF) marks a sequence delimited by an item
     * tag rather than by a count. Sequences hold nothing this reads, so the
     * honest move is to stop rather than to guess where they end and resume
     * mid-element — which produces garbage that parses.
     */
    if (length === 0xffffffff) return at;
    if (length < 0 || at + length > end) return at;

    const name = TAGS[key];
    if (name) header[name] = decode(view, at, length, vr);
    at += length;
    // Elements are even-length padded; an odd length would desynchronise
    // every element after it.
    if (length % 2 === 1) at += 1;
  }
  return at;
}

/** A tag component as four lowercase hex digits. */
function hex(value: number): string {
  return value.toString(16).padStart(4, "0");
}

/** One element's value, as text or as a number where the VR says so. */
function decode(view: DataView, at: number, length: number, vr: string): unknown {
  if (length === 0) return "";
  if (vr === "US") return view.getUint16(at, true);
  if (vr === "UL") return view.getUint32(at, true);
  if (vr === "SS") return view.getInt16(at, true);
  if (vr === "SL") return view.getInt32(at, true);
  if (vr === "FL") return view.getFloat32(at, true);
  if (vr === "FD") return view.getFloat64(at, true);

  let text = "";
  for (let i = 0; i < length; i += 1) {
    const code = view.getUint8(at + i);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text.trim();
}

/** Where this slice sits along the stack, from its patient position. */
function positionOf(header: Header): number | null {
  const raw = header.ImagePositionPatient;
  if (typeof raw !== "string") return null;
  const parts = raw.split("\\").map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  // The z component. Enough to order an axial stack, which is the common case;
  // an oblique series would want the projection onto the slice normal.
  return parts[2];
}

/**
 * The pixels of one uncompressed slice, rescaled to the real measurement.
 *
 * `RescaleSlope` and `RescaleIntercept` are what turn stored values into
 * Hounsfield units. Without them a CT is in arbitrary numbers and the window a
 * radiologist knows means nothing.
 */
function readPixels(view: DataView, at: number, header: Header,
                    count: number): Float32Array | null {
  const bits = Number(header.BitsAllocated ?? 16);
  const signed = Number(header.PixelRepresentation ?? 0) === 1;
  const slope = Number(header.RescaleSlope ?? 1) || 1;
  const intercept = Number(header.RescaleIntercept ?? 0) || 0;
  const samples = Number(header.SamplesPerPixel ?? 1);

  // Colour ultrasound and screen captures store three samples per pixel and are
  // not a scalar field; refusing is better than averaging them into one.
  if (samples !== 1) return null;
  if (bits !== 8 && bits !== 16) return null;
  const bytes = bits / 8;
  if (at + count * bytes > view.byteLength) return null;

  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const offset = at + i * bytes;
    const raw = bits === 8
      ? (signed ? view.getInt8(offset) : view.getUint8(offset))
      : (signed ? view.getInt16(offset, true) : view.getUint16(offset, true));
    out[i] = raw * slope + intercept;
  }
  return out;
}

/**
 * What the header says about the acquisition, as facts with provenance.
 *
 * Everything here is `header` origin, because it was read from the file — which
 * is the distinction the comparability verdict rests on. Absent fields stay
 * unknown; nothing is inferred from a description or a filename.
 */
export function studyFrom(header: Header, id: string, label: string): Study {
  const study = blankStudy(id, label);

  const modality = String(header.Modality ?? "").toUpperCase();
  if (modality) {
    const known: Modality[] = ["CT", "MR", "PET", "SPECT", "US", "XR"];
    const match = known.find((m) => m === modality)
      ?? (modality === "PT" ? "PET" : modality === "CR" || modality === "DX"
          ? "XR" : null);
    study.modality = fromHeader(match ?? "other");
  }

  const weighting = weightingFrom(header);
  if (weighting) study.weighting = fromHeader(weighting);

  const contrast = contrastFrom(header);
  if (contrast) study.contrast = fromHeader(contrast);

  const thickness = Number(header.SliceThickness);
  if (Number.isFinite(thickness) && thickness > 0) {
    study.sliceThickness = fromHeader(thickness);
  }

  const spacing = String(header.PixelSpacing ?? "").split("\\").map(Number);
  if (spacing.length >= 1 && Number.isFinite(spacing[0]) && spacing[0] > 0) {
    study.pixelSpacing = fromHeader(spacing[0]);
  }

  const field = Number(header.MagneticFieldStrength);
  if (Number.isFinite(field) && field > 0) study.fieldStrength = fromHeader(field);

  const maker = String(header.Manufacturer ?? "").trim();
  if (maker) study.manufacturer = fromHeader(maker);

  const orientation = orientationFrom(header);
  if (orientation) study.orientation = fromHeader(orientation);

  return study;
}

/**
 * MR weighting, from the sequence parameters rather than the description.
 *
 * `SeriesDescription` is free text a technologist typed and routinely says
 * "AX T2 FLAIR" on a diffusion series. TR and TE are what the scanner did, and
 * the conventional thresholds below are stated rather than hidden because they
 * are conventions and not laws — a caller who disagrees can override the fact.
 */
function weightingFrom(header: Header): Weighting | null {
  if (String(header.Modality ?? "").toUpperCase() !== "MR") return null;

  const sequence = String(header.ScanningSequence ?? "").toUpperCase();
  const variant = String(header.SequenceVariant ?? "").toUpperCase();
  if (sequence.includes("EP") && !variant.includes("MTC")) return "DWI";

  const tr = Number(header.RepetitionTime);
  const te = Number(header.EchoTime);
  if (!Number.isFinite(tr) || !Number.isFinite(te)) return null;

  // The usual clinical bands. Short TR and short TE is T1-weighted; long both
  // is T2; long TR with short TE is proton density.
  if (tr < 800 && te < 30) return "T1";
  if (tr > 2000 && te > 60) return "T2";
  if (tr > 2000 && te < 30) return "PD";
  return "other";
}

/**
 * Contrast phase, only where the file actually says.
 *
 * A contrast agent recorded means contrast was given; it does not say which
 * phase, and the phase is what decides whether a lesion is visible. So an agent
 * with no phase in the description yields `unknown-phase` rather than a guess —
 * which the comparability engine treats as unrecorded rather than as agreement.
 */
function contrastFrom(header: Header): ContrastPhase | null {
  const agent = String(header.ContrastBolusAgent ?? "").trim();
  const text = `${header.SeriesDescription ?? ""} ${header.ProtocolName ?? ""}`
    .toLowerCase();

  if (/\b(arterial|late arterial|hap)\b/.test(text)) return "arterial";
  if (/\b(portal|portal.?venous|pvp)\b/.test(text)) return "portal-venous";
  if (/\b(delayed|equilibrium)\b/.test(text)) return "delayed";
  if (/\b(non.?contrast|unenhanced|pre.?contrast|plain)\b/.test(text)) {
    return "non-contrast";
  }
  if (agent) return "unknown-phase";
  return null;
}

/** The plane, from the direction cosines the file records. */
function orientationFrom(header: Header):
    "axial" | "coronal" | "sagittal" | "oblique" | null {
  const raw = String(header.ImageOrientationPatient ?? "");
  const v = raw.split("\\").map(Number);
  if (v.length < 6 || v.some((n) => !Number.isFinite(n))) return null;

  // The slice normal is the cross product of the two row cosines.
  const n = [
    v[1] * v[5] - v[2] * v[4],
    v[2] * v[3] - v[0] * v[5],
    v[0] * v[4] - v[1] * v[3],
  ].map(Math.abs);

  const largest = n.indexOf(Math.max(...n));
  // Well off an axis in every direction is oblique, and saying so matters:
  // an oblique series compared with an axial one is not the same plane.
  if (n[largest] < 0.8) return "oblique";
  return largest === 0 ? "sagittal" : largest === 1 ? "coronal" : "axial";
}

/**
 * Stack a series of slices into one volume.
 *
 * Ordered by patient position where it is recorded, and by instance number
 * where it is not. Sorting by filename is what a naive reader does and it is
 * wrong often enough to matter — `IM-0002` sorts before `IM-0010` only by luck
 * of zero padding, and a mis-ordered stack is a volume with its slices
 * shuffled, which renders as plausible noise.
 */
export function stack(slices: SliceRead[], label: string):
    { grid: Grid; study: Study; header: Header } {
  if (slices.length === 0) throw new DicomError("No slices to stack.");

  const usable = slices.filter((s) => s.pixels !== null);
  if (usable.length === 0) {
    const syntax = slices[0].transferSyntax;
    throw new DicomError(
      `The pixel data is stored as ${syntax}, which this reader does not `
      + "decode — the header was read, so this series can still be judged for "
      + "comparability, but it cannot be shown here.");
  }

  const first = usable[0];
  const ordered = [...usable].sort((a, b) => {
    if (a.position !== null && b.position !== null) return a.position - b.position;
    return (a.instance ?? 0) - (b.instance ?? 0);
  });

  const nx = first.columns, ny = first.rows, nz = ordered.length;
  const values = new Float32Array(nx * ny * nz);
  ordered.forEach((slice, k) => {
    // A series whose slices disagree about their size is not one volume, and
    // padding the short ones would invent tissue at the edges.
    if (slice.columns !== nx || slice.rows !== ny) {
      throw new DicomError(
        "The slices in this series are not all the same size, so they are not "
        + "one volume.");
    }
    values.set(slice.pixels!, k * nx * ny);
  });

  return {
    grid: { nx, ny, nz, values, units: unitsFor(first.header) },
    study: studyFrom(first.header, label, label),
    header: first.header,
  };
}

function unitsFor(header: Header): string | undefined {
  return String(header.Modality ?? "").toUpperCase() === "CT" ? "HU" : undefined;
}

/** Read the files a researcher chose. They are never uploaded. */
export async function openDicomSeries(files: File[], label: string) {
  const slices: SliceRead[] = [];
  for (const file of files) {
    slices.push(readDicom(await file.arrayBuffer()));
  }
  return stack(slices, label);
}
