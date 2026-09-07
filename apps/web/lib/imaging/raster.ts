/**
 * Reading a flat image, and the facts its own header will support.
 *
 * The comparison screen could only open a volume: a DICOM series or a NIfTI.
 * That is not a medical restriction so much as a dimensional one, and it is
 * what actually stopped a microscopist, an electrophoresis gel and a figure
 * lifted out of a paper from reaching a screen whose reasoning applies to all
 * three. This file is the other half — a single plane, with the same
 * provenance discipline.
 *
 * **What is read here is read, and what is not is left unknown.** The
 * temptation with a raster is to report the decoder's answer as the file's: a
 * canvas hands back eight bits per channel whatever the file stored, so
 * recording "8-bit" from a canvas would turn a property of the decode into a
 * claim about the image, and a sixteen-bit micrograph would be described as
 * having thrown away half its levels. So the container's own header is parsed
 * for the few things it genuinely states, and everything else stays
 * `unknown()` until a person supplies it — where it is marked as `declared`,
 * and counts for less.
 *
 * **Both a picture and a measurement.** A photograph wants to be seen in
 * colour; a quantitative comparison wants one number per pixel under a shared
 * window. Keeping only the first makes the panel pretty and useless, keeping
 * only the second turns a stained section grey. So both are carried.
 */

import { Acquisition, Fact, fromHeader, unknown } from "./study";
import { DomainId, domainOf } from "./domain";
import type { TiffFacts, TiffImage } from "./tiff";

/** A single plane, decoded, with the numbers a window control can act on. */
export type Raster = {
  width: number;
  height: number;
  /**
   * One value per pixel — the quantity a window and level are applied to.
   *
   * Luminance for a colour source, the stored value for a greyscale one. This
   * is what is compared; `rgba` is what is shown when the source had colour.
   */
  values: Float32Array;
  /** The range actually present, so the first window frames the image. */
  min: number;
  max: number;
  /** Whether the source carried colour, rather than three equal channels. */
  colour: boolean;
  /** The decoded pixels, for drawing a colour source as it was captured. */
  rgba: Uint8ClampedArray;
  /**
   * The native range that was mapped onto `rgba`'s 0–255, when they differ.
   *
   * A sixteen-bit colour image has values in the tens of thousands and eight
   * bits of display per channel, so a window stated in native units cannot be
   * applied to `rgba` directly — do it anyway and a sixteen-bit micrograph
   * renders black at every setting. Absent means the two already share a scale,
   * which is the case for every PNG and JPEG.
   */
  rgbaFrom?: { min: number; max: number };
};

/** What a raster file's own header stated, and nothing more. */
export type RasterHeader = {
  width: Fact<number>;
  height: Fact<number>;
  bitDepth: Fact<number>;
  /** Present only where the container records it. */
  exposure: Fact<number>;
  /** True when the file carries coordinates — see `identityReview`. */
  hasLocation: boolean;
  /** The container, for the reader's own message. */
  container: "png" | "jpeg" | "other";
};

export class RasterError extends Error {}

const u32 = (b: DataView, at: number) => b.getUint32(at, false);

/**
 * PNG's IHDR, which is always the first chunk and always thirteen bytes.
 *
 * Worth parsing rather than trusting the canvas: PNG stores sixteen-bit
 * greyscale, which is what a scientific camera writes and what a canvas
 * silently halves.
 */
function readPng(bytes: ArrayBuffer): RasterHeader | null {
  const view = new DataView(bytes);
  if (bytes.byteLength < 33) return null;
  if (u32(view, 0) !== 0x89504e47 || u32(view, 4) !== 0x0d0a1a0a) return null;
  if (u32(view, 12) !== 0x49484452) return null; // "IHDR"

  const depth = view.getUint8(24);
  const colourType = view.getUint8(25);
  /*
   * PNG's depth is per channel, which is the number that matters for how much
   * of the measurement survived. Colour type 0 and 4 are greyscale; 2, 3 and 6
   * carry colour.
   */
  return {
    width: fromHeader(u32(view, 16)),
    height: fromHeader(u32(view, 20)),
    bitDepth: fromHeader(depth),
    exposure: unknown(),
    hasLocation: false,
    container: "png",
    _greyscale: colourType === 0 || colourType === 4,
  } as RasterHeader & { _greyscale: boolean };
}

/**
 * JPEG: the frame header for precision, and EXIF for exposure and location.
 *
 * Location is read for the same reason a DICOM header is reviewed for a name.
 * A photograph of a collection site, a specimen on a bench or a gel in a lab
 * carries the coordinates it was taken at, and those identify a place — and
 * sometimes a person's home — as surely as a name does. That it is not medical
 * is exactly why it was worth checking for.
 */
function readJpeg(bytes: ArrayBuffer): RasterHeader | null {
  const view = new DataView(bytes);
  if (bytes.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null;

  const header: RasterHeader = {
    width: unknown(), height: unknown(), bitDepth: unknown(),
    exposure: unknown(), hasLocation: false, container: "jpeg",
  };

  let at = 2;
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) break;
    const marker = view.getUint8(at + 1);
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // scan data; nothing more to read
    const length = view.getUint16(at + 2, false);
    if (length < 2 || at + 2 + length > view.byteLength) break;
    const payload = at + 4;

    // SOF0..SOF15, excluding the two that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8
        && marker !== 0xcc) {
      header.bitDepth = fromHeader(view.getUint8(payload));
      header.height = fromHeader(view.getUint16(payload + 1, false));
      header.width = fromHeader(view.getUint16(payload + 3, false));
    }

    if (marker === 0xe1 && length > 8 && u32(view, payload) === 0x45786966) {
      readExif(view, payload + 6, header);
    }
    at += 2 + length;
  }
  return header;
}

/** EXIF is a TIFF file in a box, so this is a small IFD walk. */
function readExif(view: DataView, start: number, header: RasterHeader): void {
  if (start + 8 > view.byteLength) return;
  const little = view.getUint16(start, false) === 0x4949;
  const firstIfd = view.getUint32(start + 4, little);
  if (firstIfd < 8) return;

  const walk = (offset: number, depth: number) => {
    if (depth > 2 || start + offset + 2 > view.byteLength) return;
    const count = view.getUint16(start + offset, little);
    for (let i = 0; i < count; i++) {
      const entry = start + offset + 2 + i * 12;
      if (entry + 12 > view.byteLength) return;
      const tag = view.getUint16(entry, little);
      const value = view.getUint32(entry + 8, little);

      if (tag === 0x8769) walk(value, depth + 1);        // Exif sub-IFD
      if (tag === 0x8825) header.hasLocation = true;      // GPS sub-IFD
      if (tag === 0x829a && start + value + 8 <= view.byteLength) {
        // ExposureTime, a rational: numerator then denominator.
        const numerator = view.getUint32(start + value, little);
        const denominator = view.getUint32(start + value + 4, little);
        if (denominator > 0) {
          // Milliseconds, to match how every other exposure here is recorded.
          header.exposure = fromHeader((numerator / denominator) * 1000);
        }
      }
    }
  };
  walk(firstIfd, 0);
}

/** The header a container states, or an empty one where it states nothing. */
export function readRasterHeader(bytes: ArrayBuffer): RasterHeader {
  return readPng(bytes) ?? readJpeg(bytes) ?? {
    width: unknown(), height: unknown(), bitDepth: unknown(),
    exposure: unknown(), hasLocation: false, container: "other",
  };
}

/**
 * Decode one image file to pixels.
 *
 * `createImageBitmap` rather than an `<img>` element: it is the only path that
 * decodes off the main thread and the only one that reports failure as a
 * rejection rather than as an event nobody is listening for. A file the
 * browser cannot decode is an error the researcher is told about, not a blank
 * panel they are left to interpret.
 */
export async function decodeRaster(file: Blob): Promise<Raster> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new RasterError(
      "This browser could not decode that image. PNG, JPEG and WebP are read "
      + "here, and TIFF is read by this application's own reader.");
  }

  const { width, height } = bitmap;
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
  const context = (canvas as OffscreenCanvas).getContext("2d", {
    willReadFrequently: true,
  }) as OffscreenCanvasRenderingContext2D | null;
  if (context === null) throw new RasterError("No 2D context to decode into.");

  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data;

  const values = new Float32Array(width * height);
  let min = Infinity, max = -Infinity, colour = false;
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    if (r !== g || g !== b) colour = true;
    // Rec. 709 luminance: the weighting the eye actually applies, so a green
    // channel does not read as brighter than the red it matches in intensity.
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    values[p] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  if (!(max > min)) { min = 0; max = 255; }

  return { width, height, values, min, max, colour, rgba };
}

/**
 * A decoded TIFF as this screen's raster.
 *
 * The samples stay in the units the file stored them in — a sixteen-bit
 * channel keeps its sixteen bits, and the window control acts on those — while
 * `rgba` is the eight-bit rendering the screen can actually paint. `rgbaFrom`
 * records the mapping between them so the two never drift apart.
 */
export function rasterFromTiff(image: TiffImage): Raster {
  const { width, height, channels, samples } = image;
  const pixels = width * height;
  const values = new Float32Array(pixels);
  const rgba = new Uint8ClampedArray(pixels * 4);

  const span = image.max - image.min || 1;
  const toByte = (v: number) => {
    const t = (v - image.min) / span;
    // Photometric 0 means the stored scale runs the other way: larger is
    // darker. Inverting here rather than at draw time keeps one convention.
    return ((image.inverted ? 1 - t : t) * 255);
  };

  const colour = channels >= 3;
  for (let p = 0; p < pixels; p++) {
    const at = p * channels;
    if (colour) {
      const r = samples[at], g = samples[at + 1], b = samples[at + 2];
      // Rec. 709 luminance, on the file's own units, so the window control and
      // the caption both speak about what was stored.
      values[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      rgba[p * 4] = toByte(r);
      rgba[p * 4 + 1] = toByte(g);
      rgba[p * 4 + 2] = toByte(b);
    } else {
      const v = samples[at];
      values[p] = image.inverted ? image.max - (v - image.min) : v;
      const byte = toByte(v);
      rgba[p * 4] = byte; rgba[p * 4 + 1] = byte; rgba[p * 4 + 2] = byte;
    }
    rgba[p * 4 + 3] = 255;
  }

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  if (!(max > min)) { min = 0; max = 1; }

  return {
    width, height, values, min, max, colour, rgba,
    rgbaFrom: { min, max },
  };
}

/**
 * The acquisition an OME-TIFF amounts to, under the chosen profile.
 *
 * Only the axes that profile actually names are carried across. An OME
 * objective magnification is genuine and interesting, and it is not something
 * the figure profile decides anything on — writing it onto a figure would put a
 * fact on an acquisition whose verdict can never read it, which is how an
 * evidence score starts counting things nobody is judging.
 */
export function tiffAcquisition(
  name: string, facts: TiffFacts, chosen: DomainId,
): Acquisition {
  const wanted = new Set(domainOf(chosen).axes.map((a) => a.key));
  const carried = new Set(domainOf(chosen).carried.map((c) => c.key));
  const all: Record<string, unknown> = {
    bitDepth: facts.bitDepth, pixelSize: facts.pixelSize,
    technique: facts.technique, channel: facts.channel,
    numericalAperture: facts.numericalAperture, exposure: facts.exposure,
    instrument: facts.instrument, objective: facts.objective,
    scale: facts.pixelSize,
  };
  const kept: Record<string, unknown> = {};
  for (const [key, fact] of Object.entries(all)) {
    if (wanted.has(key) || carried.has(key)) kept[key] = fact;
  }
  return { id: name, label: name, domain: chosen, ...kept };
}

/**
 * The facts an image file supports, as an acquisition's worth of them.
 *
 * `scale`, `technique` and `illumination` are deliberately absent. No general
 * image container records them, and inventing them is how a screen ends up
 * reporting a comparison it never made.
 */
export function factsFromHeader(header: RasterHeader): Record<string, unknown> {
  return {
    bitDepth: header.bitDepth,
    exposure: header.exposure,
  };
}

/**
 * The image under a window, as bytes ready to blit.
 *
 * A pure function, and separated from the panel for two reasons. It is the
 * arithmetic a researcher's judgement rests on — a window applied wrongly makes
 * a faint structure disappear or a flat field look like signal — and it had no
 * test at all while it lived inside a render loop.
 *
 * It also has to run rarely. Nothing here depends on where the image sits on
 * screen: a pan moves the picture and changes no pixel's value. Computing it
 * per frame, which is what the panel used to do, is four million iterations and
 * two allocations per frame on a 2048-square micrograph while somebody drags.
 */
export function windowedBytes(
  raster: Raster, level: number, windowWidth: number,
): Uint8ClampedArray {
  const lo = level - windowWidth / 2;
  const span = windowWidth || 1;

  /*
   * The window is stated in the file's own units; `rgba` is eight bits per
   * channel. Where those differ — a sixteen-bit colour TIFF — the window has to
   * be mapped into the display scale, or every setting renders black. For a PNG
   * the two already agree and this is the identity.
   */
  const from = raster.rgbaFrom;
  const displaySpan = from === undefined ? 1 : 255 / (from.max - from.min || 1);
  const colourLo = from === undefined ? lo : (lo - from.min) * displaySpan;
  const colourSpan = from === undefined ? span : span * displaySpan || 1;

  /*
   * `Uint8ClampedArray`, and the type is doing the work: assigning -500 or 900
   * to one of its elements stores 0 or 255. A hand-written clamp sat here as
   * well and was redundant — a mutation that turned it into the identity
   * changed nothing, which is how it was noticed. Values outside the window
   * must clamp rather than wrap: a wrapped value renders a bright structure
   * dark, and a reader takes that for absence.
   */
  const out = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let p = 0, i = 0; p < raster.values.length; p++, i += 4) {
    if (raster.colour) {
      // The same linear stretch on every channel: brightness moves, hue does not.
      for (let c = 0; c < 3; c++) {
        out[i + c] = ((raster.rgba[i + c] - colourLo) / colourSpan) * 255;
      }
    } else {
      const v = ((raster.values[p] - lo) / span) * 255;
      out[i] = v; out[i + 1] = v; out[i + 2] = v;
    }
    out[i + 3] = 255;
  }
  return out;
}

/**
 * The acquisition a flat image amounts to, under the profile the researcher chose.
 *
 * The discipline is a parameter and never derived from the filename, and that
 * is the whole point of the function existing. A first version asked
 * a filename-to-discipline helper first and used the researcher's choice only
 * as a fallback,
 * which made the picker inert: every `.png` is claimed by the general-image
 * profile, so a microscopist selecting "Microscopy" had their images judged on
 * capture method and bit depth and was shown an evidence score against axes
 * nobody had asked them about. An extension says what a file *is*; it cannot
 * say what it is *of*.
 */
export function flatAcquisition(
  name: string, header: RasterHeader, chosen: DomainId,
): Acquisition {
  return { id: name, label: name, domain: chosen, ...factsFromHeader(header) };
}
