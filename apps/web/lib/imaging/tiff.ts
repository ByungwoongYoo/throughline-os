/**
 * Reading a TIFF, because it is what microscopes actually write.
 *
 * The comparison screen declined TIFF by name rather than accepting one and
 * showing nothing, which was the honest position while no decoder existed —
 * but it is the wrong one to settle on. TIFF is the working format of light
 * microscopy, and OME-TIFF is where the acquisition metadata lives. Without it
 * a microscopist could open a PNG export of their image and be told, correctly,
 * that nothing about the acquisition was recorded: the file that *does* record
 * it was the one being refused.
 *
 * **No browser decodes TIFF, so this does.** It is a baseline reader rather
 * than a complete one, and the line is drawn where the guessing would start:
 * layouts and compressions that are well specified and verifiable are read, and
 * everything else is refused *by name*. A reader that silently produced the
 * wrong pixels would be far worse than one that declines — a micrograph that is
 * subtly wrong still looks like a micrograph, and nothing downstream could
 * detect it.
 *
 * **The metadata is the point as much as the pixels.** A plain TIFF states its
 * geometry and, often, its resolution. An OME-TIFF states the objective, the
 * numerical aperture, the channel, the acquisition mode and the exposure — the
 * axes the microscopy profile decides comparability on. Reading those is what
 * turns "cannot be judged" into an actual verdict.
 */

import { Fact, fromHeader, unknown } from "./study";

export class TiffError extends Error {}

/* ---------------------------------------------------------------- tags ---- */

const TAG = {
  imageWidth: 256, imageLength: 257, bitsPerSample: 258, compression: 259,
  photometric: 262, description: 270, stripOffsets: 273, samplesPerPixel: 277,
  rowsPerStrip: 278, stripByteCounts: 279, xResolution: 282, yResolution: 283,
  planarConfig: 284, resolutionUnit: 296, predictor: 317,
  tileWidth: 322, tileOffsets: 324,
  sampleFormat: 339,
} as const;

/** Bytes per value, by TIFF type code. Index 0 is unused. */
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

/** Compressions this reader can actually produce correct pixels for. */
const COMPRESSION_NAME: Record<number, string> = {
  1: "uncompressed", 5: "LZW", 8: "Deflate", 32946: "Deflate",
  32773: "PackBits",
  // Named so a refusal can say what the file is rather than a number.
  2: "CCITT Group 3 (1-D)", 3: "CCITT Group 3", 4: "CCITT Group 4",
  6: "old-style JPEG", 7: "JPEG", 34712: "JPEG 2000",
  33003: "JPEG 2000", 33005: "JPEG 2000", 34925: "LZMA", 50000: "Zstandard",
  50001: "WebP", 34887: "LERC",
};

/* --------------------------------------------------------------- values --- */

type Entry = { type: number; count: number; at: number };

function entryValues(view: DataView, entry: Entry, little: boolean): number[] {
  const size = TYPE_SIZE[entry.type] ?? 0;
  if (size === 0) return [];
  const total = size * entry.count;
  // Four bytes or fewer live in the entry itself rather than at an offset.
  const start = total <= 4 ? entry.at : readLong(view, entry.at, little);
  const out: number[] = [];
  for (let i = 0; i < entry.count; i++) {
    const at = start + i * size;
    if (at + size > view.byteLength) break;
    switch (entry.type) {
      case 1: case 2: case 7: out.push(view.getUint8(at)); break;
      case 3: out.push(view.getUint16(at, little)); break;
      case 4: out.push(view.getUint32(at, little)); break;
      case 5: {
        const n = view.getUint32(at, little);
        const d = view.getUint32(at + 4, little);
        out.push(d === 0 ? 0 : n / d);
        break;
      }
      case 6: out.push(view.getInt8(at)); break;
      case 8: out.push(view.getInt16(at, little)); break;
      case 9: out.push(view.getInt32(at, little)); break;
      case 10: {
        const n = view.getInt32(at, little);
        const d = view.getInt32(at + 4, little);
        out.push(d === 0 ? 0 : n / d);
        break;
      }
      case 11: out.push(view.getFloat32(at, little)); break;
      case 12: out.push(view.getFloat64(at, little)); break;
      default: break;
    }
  }
  return out;
}

const readLong = (view: DataView, at: number, little: boolean) =>
  view.getUint32(at, little);

function entryAscii(view: DataView, entry: Entry, little: boolean): string {
  const total = entry.count;
  const start = total <= 4 ? entry.at : readLong(view, entry.at, little);
  if (start + total > view.byteLength) return "";
  const bytes = new Uint8Array(view.buffer, view.byteOffset + start, total);
  return new TextDecoder().decode(bytes).replace(/\0+$/, "");
}

export type Ifd = {
  entries: Map<number, Entry>;
  view: DataView;
  little: boolean;
};

const nums = (ifd: Ifd, tag: number): number[] => {
  const entry = ifd.entries.get(tag);
  return entry === undefined ? [] : entryValues(ifd.view, entry, ifd.little);
};
const one = (ifd: Ifd, tag: number, fallback: number): number => {
  const values = nums(ifd, tag);
  return values.length > 0 ? values[0] : fallback;
};
const text = (ifd: Ifd, tag: number): string => {
  const entry = ifd.entries.get(tag);
  return entry === undefined ? "" : entryAscii(ifd.view, entry, ifd.little);
};

/** Parse the header and the first image file directory. */
export function openTiff(bytes: ArrayBuffer): Ifd {
  if (bytes.byteLength < 8) throw new TiffError("That file is too short to be a TIFF.");
  const view = new DataView(bytes);
  const order = view.getUint16(0, false);
  if (order !== 0x4949 && order !== 0x4d4d) {
    throw new TiffError("That is not a TIFF: it does not begin with a byte-order mark.");
  }
  const little = order === 0x4949;
  const magic = view.getUint16(2, little);
  if (magic === 43) {
    /*
     * BigTIFF has 64-bit offsets and a different directory layout. Refused by
     * name rather than misread: its header is close enough to a classic TIFF
     * that a reader which ignored the version would produce plausible garbage.
     */
    throw new TiffError(
      "That is a BigTIFF. This reader handles classic TIFF only — most tools "
      + "can save a classic TIFF, or an OME-TIFF, instead.");
  }
  if (magic !== 42) throw new TiffError("That is not a TIFF.");

  const first = view.getUint32(4, little);
  if (first + 2 > view.byteLength) throw new TiffError("This TIFF's directory is truncated.");
  const count = view.getUint16(first, little);
  const entries = new Map<number, Entry>();
  for (let i = 0; i < count; i++) {
    const at = first + 2 + i * 12;
    if (at + 12 > view.byteLength) break;
    entries.set(view.getUint16(at, little), {
      type: view.getUint16(at + 2, little),
      count: view.getUint32(at + 4, little),
      at: at + 8,
    });
  }
  return { entries, view, little };
}

/* ---------------------------------------------------------- decompression -- */

/** PackBits: a run-length scheme, and the simplest thing TIFF compresses with. */
function packBits(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let read = 0, wrote = 0;
  while (read < input.length && wrote < expected) {
    const n = (input[read++] << 24) >> 24; // to signed
    if (n >= 0) {
      for (let i = 0; i <= n && wrote < expected && read < input.length; i++) {
        out[wrote++] = input[read++];
      }
    } else if (n !== -128) {
      const byte = input[read++];
      for (let i = 0; i < 1 - n && wrote < expected; i++) out[wrote++] = byte;
    }
    // -128 is a no-op by specification.
  }
  return out;
}

/**
 * TIFF's LZW, which is not quite GIF's.
 *
 * Codes are packed most-significant-bit first, and the width grows one code
 * *early* — at 510 rather than 511. Getting that single-code offset wrong does
 * not fail loudly; it produces an image that is subtly, plausibly wrong, which
 * is the failure mode this whole file is arranged against.
 */
function lzw(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let wrote = 0;

  let dictionary: Uint8Array[] = [];
  const reset = () => {
    dictionary = new Array(256);
    for (let i = 0; i < 256; i++) dictionary[i] = Uint8Array.of(i);
    dictionary.length = 258; // 256 clear, 257 end-of-information
  };
  reset();

  let width = 9;
  let bitPosition = 0;
  let previous: Uint8Array | null = null;

  const next = (): number => {
    let code = 0;
    for (let i = 0; i < width; i++) {
      const byte = bitPosition >> 3;
      if (byte >= input.length) return 257;
      const bit = (input[byte] >> (7 - (bitPosition & 7))) & 1;
      code = (code << 1) | bit;
      bitPosition++;
    }
    return code;
  };

  const emit = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length && wrote < expected; i++) {
      out[wrote++] = bytes[i];
    }
  };

  for (;;) {
    const code = next();
    if (code === 257) break;
    if (code === 256) {
      reset();
      width = 9;
      previous = null;
      continue;
    }
    let entry: Uint8Array;
    if (code < dictionary.length && dictionary[code] !== undefined) {
      entry = dictionary[code];
    } else if (previous !== null) {
      // The KwKwK case: a code for a string that is being defined right now.
      entry = Uint8Array.from([...previous, previous[0]]);
    } else {
      throw new TiffError("This TIFF's LZW data is not readable.");
    }
    emit(entry);
    if (previous !== null) {
      dictionary.push(Uint8Array.from([...previous, entry[0]]));
    }
    previous = entry;
    // Early change: one code before the width would otherwise overflow.
    const size = dictionary.length;
    if (size + 1 >= 1 << width && width < 12) width++;
    if (wrote >= expected) break;
  }
  return out;
}

async function inflate(input: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new TiffError(
      "This browser cannot read a Deflate-compressed TIFF. Saving the file "
      + "uncompressed, or as LZW, will open here.");
  }
  const stream = new Blob([input as BlobPart]).stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const whole = new Uint8Array(await new Response(stream).arrayBuffer());
  return whole.length >= expected ? whole.subarray(0, expected) : whole;
}

async function decompress(kind: number, input: Uint8Array,
                          expected: number): Promise<Uint8Array> {
  if (kind === 1) return input;
  if (kind === 5) return lzw(input, expected);
  if (kind === 32773) return packBits(input, expected);
  if (kind === 8 || kind === 32946) return inflate(input, expected);
  const name = COMPRESSION_NAME[kind] ?? `compression ${kind}`;
  throw new TiffError(
    `This TIFF is ${name} compressed, which is not read here. Re-saving it `
    + "uncompressed or as LZW will open — a reader that guessed at the pixels "
    + "would produce an image that looks right and is not.");
}

/* -------------------------------------------------------------- decoding -- */

/**
 * Undo horizontal differencing.
 *
 * Applied per row and per channel, on the samples rather than on the bytes —
 * a sixteen-bit image differenced as bytes comes back as noise.
 */
function unpredict(samples: Float32Array, width: number, height: number,
                   channels: number): void {
  for (let y = 0; y < height; y++) {
    const row = y * width * channels;
    for (let x = 1; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        samples[row + x * channels + c] += samples[row + (x - 1) * channels + c];
      }
    }
  }
}

export type TiffImage = {
  width: number;
  height: number;
  /** One value per pixel per channel, interleaved. */
  samples: Float32Array;
  channels: number;
  /** What the file says the values mean, before any window is applied. */
  min: number;
  max: number;
  bitDepth: number;
  /** Photometric interpretation 0 means the scale runs the other way. */
  inverted: boolean;
};

/** Decode the first image in a TIFF. */
export async function decodeTiff(bytes: ArrayBuffer): Promise<TiffImage> {
  const ifd = openTiff(bytes);

  const width = one(ifd, TAG.imageWidth, 0);
  const height = one(ifd, TAG.imageLength, 0);
  if (width <= 0 || height <= 0) {
    throw new TiffError("This TIFF does not state its size.");
  }
  if (width * height > 80e6) {
    /*
     * A whole-slide image is tens of gigapixels and would exhaust the tab
     * rather than open. Refused with the size, so the researcher knows to
     * export a region instead of retrying.
     */
    throw new TiffError(
      `This image is ${width} by ${height} pixels, which is too large to open `
      + "in a browser tab. Export the region you are comparing and open that.");
  }

  const channels = one(ifd, TAG.samplesPerPixel, 1);
  const bits = nums(ifd, TAG.bitsPerSample);
  const bitDepth = bits.length > 0 ? bits[0] : 8;
  if (bits.some((b) => b !== bitDepth)) {
    throw new TiffError("This TIFF stores its channels at different bit depths, "
                      + "which is not read here.");
  }
  if (![8, 16, 32].includes(bitDepth)) {
    throw new TiffError(
      `This TIFF stores ${bitDepth} bits per sample, which is not read here. `
      + "Eight, sixteen and thirty-two bit images open.");
  }
  if (one(ifd, TAG.planarConfig, 1) !== 1) {
    throw new TiffError(
      "This TIFF stores its channels in separate planes, which is not read "
      + "here. Most tools can save the interleaved form.");
  }

  const format = one(ifd, TAG.sampleFormat, 1);
  const compression = one(ifd, TAG.compression, 1);
  const predictor = one(ifd, TAG.predictor, 1);
  if (predictor === 3) {
    throw new TiffError("This TIFF uses the floating-point predictor, which is "
                      + "not read here.");
  }

  const bytesPerSample = bitDepth / 8;
  const samples = new Float32Array(width * height * channels);

  /*
   * Tiled TIFFs are refused rather than decoded, and the reason is evidence
   * rather than effort. Every other layout and compression here is checked
   * against files written by an independent encoder; nothing available could
   * write a tiled file to check that path against, and an unverified decoder
   * would produce a plausible image rather than an obvious failure — the one
   * outcome this file is arranged to avoid. Tiling is also mostly used by
   * whole-slide images, which the size limit below declines anyway.
   */
  if (one(ifd, TAG.tileWidth, 0) > 0 || ifd.entries.has(TAG.tileOffsets)) {
    throw new TiffError(
      "This TIFF stores its pixels in tiles, which is not read here. Most "
      + "tools can save the strip layout instead, and exporting the region "
      + "you are comparing will also open.");
  }

  const chunkWidth = width;
  const chunkHeight = Math.min(one(ifd, TAG.rowsPerStrip, height), height);
  if (chunkHeight <= 0) throw new TiffError("This TIFF's layout is unreadable.");

  const offsets = nums(ifd, TAG.stripOffsets);
  const counts = nums(ifd, TAG.stripByteCounts);
  if (offsets.length === 0) {
    throw new TiffError("This TIFF does not say where its pixels are.");
  }

  const raw = new Uint8Array(bytes);

  for (let index = 0; index < offsets.length; index++) {
    const start = offsets[index];
    const length = counts[index] ?? 0;
    if (start + length > raw.length) break;

    const expected = chunkWidth * chunkHeight * channels * bytesPerSample;
    const chunk = await decompress(
      compression, raw.subarray(start, start + length), expected);

    const originY = index * chunkHeight;

    const chunkView = new DataView(chunk.buffer, chunk.byteOffset, chunk.length);
    const rows = Math.min(chunkHeight, height - originY);
    const columns = width;

    // Read into a per-chunk buffer first, because the predictor runs across a
    // chunk's own rows rather than the image's.
    const local = new Float32Array(chunkWidth * chunkHeight * channels);
    for (let i = 0; i < local.length; i++) {
      const at = i * bytesPerSample;
      if (at + bytesPerSample > chunk.length) break;
      local[i] = readSample(chunkView, at, bitDepth, format, ifd.little);
    }
    if (predictor === 2) unpredict(local, chunkWidth, chunkHeight, channels);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        for (let c = 0; c < channels; c++) {
          samples[((originY + y) * width + x) * channels + c] =
            local[(y * chunkWidth + x) * channels + c];
        }
      }
    }
    if (originY + rows >= height) break;
  }

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) { min = 0; max = (1 << Math.min(bitDepth, 16)) - 1; }

  return {
    width, height, samples, channels, min, max, bitDepth,
    inverted: one(ifd, TAG.photometric, 1) === 0,
  };
}

function readSample(view: DataView, at: number, bitDepth: number,
                    format: number, little: boolean): number {
  if (bitDepth === 8) return format === 2 ? view.getInt8(at) : view.getUint8(at);
  if (bitDepth === 16) {
    return format === 2 ? view.getInt16(at, little) : view.getUint16(at, little);
  }
  if (format === 3) return view.getFloat32(at, little);
  return format === 2 ? view.getInt32(at, little) : view.getUint32(at, little);
}

/* -------------------------------------------------------------- metadata -- */

export type TiffFacts = {
  width: Fact<number>;
  height: Fact<number>;
  bitDepth: Fact<number>;
  /** Micrometres per pixel, from OME or from the resolution tags. */
  pixelSize: Fact<number>;
  technique: Fact<string>;
  channel: Fact<string>;
  numericalAperture: Fact<number>;
  exposure: Fact<number>;
  instrument: Fact<string>;
  objective: Fact<number>;
  /** True when the description was OME-XML rather than a bare TIFF. */
  ome: boolean;
};

/** OME's acquisition modes, in the microscopy profile's own words. */
const ACQUISITION: Record<string, string> = {
  widefield: "widefield", laserscanningconfocalmicroscopy: "confocal",
  spinningdiskconfocal: "confocal", sweptfieldconfocal: "confocal",
  laserscanningmicroscopy: "confocal", multiphotonmicroscopy: "two-photon",
  totalinternalreflection: "TIRF", brightfield: "brightfield",
  structuredillumination: "structured illumination",
  singlemoleculeimaging: "single-molecule", palm: "super-resolution",
  storm: "super-resolution", sted: "super-resolution",
  fluorescencelifetime: "fluorescence lifetime",
  transmittedlight: "brightfield", differentialinterferencecontrast: "DIC",
  phasecontrast: "phase contrast",
};

/** Physical-size units OME may state, as a factor to micrometres. */
const TO_MICRON: Record<string, number> = {
  "nm": 1e-3, "µm": 1, "um": 1, "mm": 1e3, "cm": 1e4, "m": 1e6, "Å": 1e-4,
};

const attribute = (xml: string, element: string, name: string): string | null => {
  // Deliberately not a full XML parse: one attribute off one element, and a
  // malformed document should yield nothing rather than throw.
  const open = new RegExp(`<${element}\\b[^>]*>`, "i");
  const tag = open.exec(xml)?.[0];
  if (tag === undefined) return null;
  const found = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return found === null ? null : found[1];
};

const numberOf = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The facts a TIFF states, with OME-XML read where it is present.
 *
 * Everything OME does not say stays `unknown()`. Preparation in particular is
 * never inferred: OME has no field for whether a specimen was fixed, cleared or
 * imaged live, and it is a `visibility` axis — guessing it would be guessing at
 * the one thing most likely to make two images incomparable.
 */
export function tiffFacts(bytes: ArrayBuffer): TiffFacts {
  const ifd = openTiff(bytes);
  const description = text(ifd, TAG.description);
  const ome = description.includes("<OME") || description.includes("OME-XML");

  const facts: TiffFacts = {
    width: fromHeader(one(ifd, TAG.imageWidth, 0)),
    height: fromHeader(one(ifd, TAG.imageLength, 0)),
    bitDepth: fromHeader(nums(ifd, TAG.bitsPerSample)[0] ?? 8),
    pixelSize: unknown(), technique: unknown(), channel: unknown(),
    numericalAperture: unknown(), exposure: unknown(), instrument: unknown(),
    objective: unknown(), ome,
  };

  /*
   * A plain TIFF's resolution is in pixels per inch or per centimetre, which
   * is a printing measurement that microscope software nonetheless uses to
   * record scale. Read only when the unit says which — unit 1 means "no
   * absolute unit", and treating that as inches would invent a scale.
   */
  const unit = one(ifd, TAG.resolutionUnit, 2);
  const xres = nums(ifd, TAG.xResolution)[0];
  if (xres !== undefined && xres > 0 && (unit === 2 || unit === 3)) {
    const micronsPerUnit = unit === 2 ? 25400 : 10000; // inch, centimetre
    facts.pixelSize = fromHeader(micronsPerUnit / xres);
  }

  if (ome) {
    const size = numberOf(attribute(description, "Pixels", "PhysicalSizeX"));
    if (size !== null && size > 0) {
      const stated = attribute(description, "Pixels", "PhysicalSizeXUnit");
      const factor = stated === null ? 1 : TO_MICRON[stated] ?? 1;
      facts.pixelSize = fromHeader(size * factor);
    }
    const mode = attribute(description, "Channel", "AcquisitionMode");
    if (mode !== null) {
      const key = mode.toLowerCase().replace(/[^a-z]/g, "");
      const named = ACQUISITION[key];
      // An unrecognised mode is carried as written rather than dropped: it is
      // still a fact, and two images sharing it still agree.
      facts.technique = fromHeader(named ?? mode);
    }
    const channel = attribute(description, "Channel", "Name")
                 ?? attribute(description, "Channel", "Fluor");
    if (channel !== null && channel !== "") facts.channel = fromHeader(channel);

    const na = numberOf(attribute(description, "Objective", "LensNA"));
    if (na !== null) facts.numericalAperture = fromHeader(na);
    const magnification = numberOf(
      attribute(description, "Objective", "NominalMagnification"));
    if (magnification !== null) facts.objective = fromHeader(magnification);

    const exposure = numberOf(attribute(description, "Plane", "ExposureTime"));
    if (exposure !== null) {
      const stated = attribute(description, "Plane", "ExposureTimeUnit") ?? "s";
      // OME's default is seconds; this screen records exposure in milliseconds.
      const toMs: Record<string, number> = { s: 1000, ms: 1, µs: 1e-3, us: 1e-3 };
      facts.exposure = fromHeader(exposure * (toMs[stated] ?? 1000));
    }

    const microscope = attribute(description, "Microscope", "Model")
                    ?? attribute(description, "Instrument", "Model");
    if (microscope !== null && microscope !== "") {
      facts.instrument = fromHeader(microscope);
    }
  }
  return facts;
}
