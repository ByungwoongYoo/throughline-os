/**
 * Reading a TIFF (§ the format microscopes actually write).
 *
 * The screen used to decline TIFF by name, which was honest while no decoder
 * existed and still wrong to settle on: TIFF is the working format of light
 * microscopy and OME-TIFF is where the acquisition metadata lives, so the file
 * being refused was the only one that could have answered the questions the
 * microscopy profile asks.
 *
 * **Every fixture here was written by Pillow, not by this repository.** A
 * decoder tested against its own encoder proves that the two agree, which is
 * not the same as being right — a shared misreading of, say, LZW's early code
 * width would cancel out perfectly and pass. Pillow is an independent
 * implementation, so a round-trip through it is evidence.
 *
 * Regenerate `fixtures/tiff.ts` with Pillow ≥ 12:
 *
 *     grey8  = (np.arange(48, dtype=np.uint8).reshape(6, 8) * 4)
 *     grey16 = (np.arange(48, dtype=np.uint16).reshape(6, 8) * 1000)
 *     Image.fromarray(grey8).save(buf, format="TIFF", compression="tiff_lzw",
 *                                 tiffinfo={317: 2})
 *
 * with the OME-XML string passed as `description=`, and the multi-strip cases
 * forced with `tiffinfo={278: 8}`.
 */

import { describe, expect, it } from "vitest";
import { TiffError, decodeTiff, tiffFacts } from "@/lib/imaging/tiff";
import { rasterFromTiff, tiffAcquisition } from "@/lib/imaging/raster";
import { evidenceStrength } from "@/lib/imaging/study";
import { assess } from "@/lib/imaging/comparability";
import { BIG, GREY16, GREY8, RGB8, TIFFS } from "./fixtures/tiff";

const bytesOf = (name: string): ArrayBuffer => {
  const binary = atob(TIFFS[name]);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
};

const pixels = async (name: string) => decodeTiff(bytesOf(name));

describe("the pixels come back as they were written", () => {
  it("reads an uncompressed eight-bit image", async () => {
    const image = await pixels("grey8");
    expect([image.width, image.height, image.channels]).toEqual([8, 6, 1]);
    expect(Array.from(image.samples)).toEqual(GREY8);
  });

  it("reads sixteen bits without halving them", async () => {
    // The whole reason for not going through a canvas: a scientific camera
    // writes sixteen bits and a canvas hands back eight.
    const image = await pixels("grey16");
    expect(image.bitDepth).toBe(16);
    expect(Array.from(image.samples)).toEqual(GREY16);
    expect(image.max).toBe(47000);
  });

  it("reads three channels interleaved", async () => {
    const image = await pixels("rgb8");
    expect(image.channels).toBe(3);
    expect(Array.from(image.samples)).toEqual(RGB8);
  });
});

describe("the compressions a microscope writes", () => {
  it("reads LZW", async () => {
    expect(Array.from((await pixels("lzw")).samples)).toEqual(GREY8);
  });

  it("reads LZW with horizontal differencing", async () => {
    // The predictor runs on samples, per row, per channel. Undoing it on bytes
    // instead returns noise that still looks like an image.
    expect(Array.from((await pixels("lzwPredictor")).samples)).toEqual(GREY8);
  });

  it("reads PackBits", async () => {
    expect(Array.from((await pixels("packbits")).samples)).toEqual(GREY8);
  });

  it("reads Deflate", async () => {
    expect(Array.from((await pixels("deflate")).samples)).toEqual(GREY8);
  });
});

describe("images written in more than one strip", () => {
  it("reassembles an uncompressed image from its strips", async () => {
    // A single-strip file exercises none of the offset arithmetic, and every
    // small fixture is single-strip, so this one is written with eight rows to
    // a strip on purpose.
    const image = await pixels("multiStrip");
    expect([image.width, image.height]).toEqual([64, 40]);
    expect(Array.from(image.samples)).toEqual(BIG);
  });

  it("reassembles a compressed one, decompressing each strip alone", async () => {
    expect(Array.from((await pixels("multiStripLzw")).samples)).toEqual(BIG);
  });
});

describe("what it refuses, and whether it says why", () => {
  it("declines a JPEG-compressed TIFF by name", async () => {
    /*
     * Named rather than reported as a number. A researcher told "compression 7"
     * has to go looking; told "JPEG compressed", they know what to re-save.
     */
    await expect(pixels("jpeg")).rejects.toThrow(TiffError);
    await expect(pixels("jpeg")).rejects.toThrow(/JPEG/);
  });

  it("says what to do instead, not only that it failed", async () => {
    await expect(pixels("jpeg")).rejects.toThrow(/uncompressed or as LZW/);
  });

  it("declines a BigTIFF rather than misreading its offsets", async () => {
    // Its header is close enough to a classic TIFF that ignoring the version
    // would yield plausible garbage.
    const buffer = new Uint8Array(bytesOf("grey8").slice(0));
    new DataView(buffer.buffer).setUint16(2, 43, true);
    await expect(decodeTiff(buffer.buffer)).rejects.toThrow(/BigTIFF/);
  });

  it("declines a tiled TIFF, because that path is not verified", async () => {
    const buffer = new Uint8Array(bytesOf("grey8").slice(0));
    const view = new DataView(buffer.buffer);
    /*
     * PlanarConfiguration is relabelled as TileWidth: a SHORT whose value is
     * 1, so the tile width reads as non-zero, and whose absence leaves the
     * interleaved default this reader already assumes. Overwriting the first
     * entry instead would blank ImageWidth and trip a different error, which is
     * what the first version of this test did.
     */
    const first = view.getUint32(4, true);
    const count = view.getUint16(first, true);
    let rewrote = false;
    for (let i = 0; i < count; i++) {
      const at = first + 2 + i * 12;
      if (view.getUint16(at, true) === 284) {
        view.setUint16(at, 322, true);
        rewrote = true;
        break;
      }
    }
    expect(rewrote).toBe(true);
    await expect(decodeTiff(buffer.buffer)).rejects.toThrow(/tiles/);
  });

  it("refuses something that is not a TIFF at all", async () => {
    await expect(decodeTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer))
      .rejects.toThrow(/not a TIFF/);
  });
});

describe("what an OME-TIFF states about the acquisition", () => {
  it("reads the axes the microscopy profile decides on", async () => {
    const facts = tiffFacts(bytesOf("ome"));
    expect(facts.ome).toBe(true);
    expect(facts.technique).toEqual({ value: "confocal", origin: "header" });
    expect(facts.channel).toEqual({ value: "DAPI", origin: "header" });
    expect(facts.numericalAperture).toEqual({ value: 1.4, origin: "header" });
    expect(facts.pixelSize).toEqual({ value: 0.09, origin: "header" });
    expect(facts.objective).toEqual({ value: 63, origin: "header" });
    expect(facts.instrument.value).toBe("Zeiss LSM 880");
  });

  it("converts the exposure to the milliseconds this screen records", async () => {
    // OME states seconds by default; every other exposure here is in ms, and
    // two exposures on different scales would compare as a real difference.
    expect(tiffFacts(bytesOf("ome")).exposure)
      .toEqual({ value: 200, origin: "header" });
  });

  it("leaves preparation unknown, because OME does not record it", async () => {
    /*
     * Preparation is a `visibility` axis — fixed against live changes what is
     * present to be imaged, not how it looks. Inferring it would be guessing at
     * the fact most likely to make two images incomparable.
     */
    const facts = tiffFacts(bytesOf("ome"));
    expect("preparation" in facts).toBe(false);
  });

  it("states nothing about the acquisition for a plain TIFF", async () => {
    const facts = tiffFacts(bytesOf("grey8"));
    expect(facts.ome).toBe(false);
    for (const fact of [facts.technique, facts.channel, facts.numericalAperture,
                        facts.exposure, facts.objective]) {
      expect(fact.origin).toBe("unknown");
    }
    // The geometry is still read: it is in the directory whatever else is not.
    expect(facts.width).toEqual({ value: 8, origin: "header" });
    expect(facts.bitDepth).toEqual({ value: 8, origin: "header" });
  });

  it("does not invent a scale from a resolution with no unit", async () => {
    // ResolutionUnit 1 means "no absolute unit". Reading it as inches would
    // turn a printing hint into a micrometre-per-pixel claim.
    const facts = tiffFacts(bytesOf("grey8"));
    expect(facts.pixelSize.origin).toBe("unknown");
  });
});

describe("an OME-TIFF as something the engine can judge", () => {
  it("carries only the axes the chosen profile decides on", () => {
    /*
     * An objective magnification is a genuine fact and no concern of the figure
     * profile. Writing every fact onto every acquisition would put values on
     * axes no verdict can read, and the evidence score would then count facts
     * nobody is being judged against.
     */
    const facts = tiffFacts(bytesOf("ome"));
    const micrograph = tiffAcquisition("s.ome.tif", facts, "microscopy");
    expect(micrograph.technique).toBeDefined();
    expect(micrograph.channel).toBeDefined();
    expect(micrograph.numericalAperture).toBeDefined();
    expect(micrograph.bitDepth).toBeUndefined();

    const figure = tiffAcquisition("s.ome.tif", facts, "figure");
    expect(figure.technique).toBeUndefined();
    expect(figure.numericalAperture).toBeUndefined();
  });

  it("makes the axes it does read agree, and still will not overclaim", () => {
    /*
     * Two copies of one OME-TIFF agree on technique, channel, pixel size,
     * aperture and exposure — none of which a PNG export states. The verdict is
     * nonetheless "cannot be judged", and that is correct rather than a
     * shortfall: preparation is a `visibility` axis, OME does not record it,
     * and fixed against live changes what is present to be imaged. Reading more
     * metadata narrows the silence; it does not license filling it in.
     */
    const facts = tiffFacts(bytesOf("ome"));
    const a = tiffAcquisition("one.ome.tif", facts, "microscopy");
    const b = tiffAcquisition("two.ome.tif", facts, "microscopy");
    const verdict = assess(a, b);
    expect(verdict.shared).toContain("channel");
    expect(verdict.shared).toContain("technique");
    expect(verdict.shared).toContain("numericalAperture");
    expect(verdict.verdict).toBe("CONCEPTUALLY_COMPARABLE");
    expect(verdict.reasoning).toContain("preparation");
  });

  it("can now refuse on a channel, which a PNG never could", () => {
    // The point of reading the format at all: a real disagreement on a real
    // axis, decided from what the files say rather than from what nobody typed.
    const facts = tiffFacts(bytesOf("ome"));
    const dapi = tiffAcquisition("dapi.ome.tif", facts, "microscopy");
    const gfp = {
      ...tiffAcquisition("gfp.ome.tif", facts, "microscopy"),
      channel: { value: "GFP", origin: "header" as const },
    };
    const verdict = assess(dapi, gfp);
    expect(verdict.verdict).toBe("RELATED_BUT_NOT_COMPARABLE");
    expect(verdict.blocking).toContain("channel");
  });

  it("still refuses when a decisive axis is unrecorded", () => {
    // Preparation is not in OME, so silence remains silence.
    const facts = tiffFacts(bytesOf("ome"));
    const a = tiffAcquisition("one.ome.tif", facts, "microscopy");
    expect(evidenceStrength(a)).toBeLessThan(1);
    expect(evidenceStrength(a)).toBeGreaterThan(0.5);
  });

  it("scores a plain TIFF far lower than an OME one", () => {
    const plain = tiffAcquisition("p.tif", tiffFacts(bytesOf("grey8")), "microscopy");
    const ome = tiffAcquisition("o.ome.tif", tiffFacts(bytesOf("ome")), "microscopy");
    expect(evidenceStrength(ome)).toBeGreaterThan(evidenceStrength(plain));
  });
});

describe("a TIFF as something the panel can draw", () => {
  it("keeps sixteen-bit values while giving the screen eight bits to paint", async () => {
    const raster = rasterFromTiff(await pixels("grey16"));
    expect(raster.max).toBe(47000);
    expect(raster.colour).toBe(false);
    // The mapping between the two is recorded, so a window stated in native
    // units can be applied to the display without rendering everything black.
    expect(raster.rgbaFrom).toEqual({ min: 0, max: 47000 });
  });

  it("reads a three-channel TIFF as colour", async () => {
    const raster = rasterFromTiff(await pixels("rgb8"));
    expect(raster.colour).toBe(true);
    expect(raster.width * raster.height * 4).toBe(raster.rgba.length);
  });
});
