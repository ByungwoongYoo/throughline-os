/**
 * What a flat image file actually states (§ opening more than a volume).
 *
 * The screen could previously open only a DICOM series or a NIfTI, which is a
 * dimensional restriction rather than a medical one — and it is what stopped a
 * micrograph, a gel and a figure from reaching reasoning that applies to all
 * three.
 *
 * These tests are mostly about *not* claiming things. A canvas hands back eight
 * bits per channel whatever the file stored, so the interesting property is
 * that a sixteen-bit PNG is recorded as sixteen-bit and an unknown container is
 * recorded as unknown rather than as eight.
 */

import { describe, expect, it } from "vitest";
import { flatAcquisition, readRasterHeader } from "@/lib/imaging/raster";
import { evidenceStrength } from "@/lib/imaging/study";

function png(width: number, height: number, depth: number, colourType: number) {
  const bytes = new Uint8Array(40);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  view.setUint8(24, depth);
  view.setUint8(25, colourType);
  return bytes.buffer;
}

/** A JPEG with a frame header, and optionally an EXIF block. */
function jpeg({ precision = 8, width = 4, height = 3, exif = false } = {}) {
  const parts: number[] = [0xff, 0xd8];
  // SOF0
  /* Length 11 counts itself plus precision, height, width, the component
     count, and the three bytes that one component costs. Writing fewer would
     leave the walk to resume inside the next segment. */
  parts.push(0xff, 0xc0, 0x00, 0x0b, precision,
             (height >> 8) & 0xff, height & 0xff,
             (width >> 8) & 0xff, width & 0xff,
             0x01, 0x00, 0x11, 0x00);
  if (exif) {
    const block = new Uint8Array(60);
    const view = new DataView(block.buffer);
    block.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
    const tiff = 6;
    block.set([0x49, 0x49], tiff);                       // little-endian
    view.setUint16(tiff + 2, 42, true);
    view.setUint32(tiff + 4, 8, true);                   // first IFD at +8
    view.setUint16(tiff + 8, 2, true);                   // two entries
    // ExposureTime, RATIONAL, data at +38
    view.setUint16(tiff + 10, 0x829a, true);
    view.setUint16(tiff + 12, 5, true);
    view.setUint32(tiff + 14, 1, true);
    view.setUint32(tiff + 18, 38, true);
    // GPS sub-IFD: presence is all this needs to notice
    view.setUint16(tiff + 22, 0x8825, true);
    view.setUint16(tiff + 24, 4, true);
    view.setUint32(tiff + 26, 1, true);
    view.setUint32(tiff + 30, 0, true);
    view.setUint32(tiff + 34, 0, true);                  // no next IFD
    view.setUint32(tiff + 38, 1, true);                  // 1/100 s
    view.setUint32(tiff + 42, 100, true);
    const length = block.length + 2;
    parts.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...block);
  }
  parts.push(0xff, 0xda); // start of scan: nothing readable past here
  return new Uint8Array(parts).buffer;
}

describe("what a PNG states about itself", () => {
  it("reads the stored bit depth, not the decoder's", () => {
    // The point of parsing IHDR at all: a scientific camera writes sixteen-bit
    // greyscale and a canvas would report eight.
    expect(readRasterHeader(png(1024, 768, 16, 0)).bitDepth)
      .toEqual({ value: 16, origin: "header" });
  });

  it("reads the dimensions as header facts", () => {
    const header = readRasterHeader(png(1024, 768, 8, 6));
    expect(header.width).toEqual({ value: 1024, origin: "header" });
    expect(header.height).toEqual({ value: 768, origin: "header" });
    expect(header.container).toBe("png");
  });

  it("records no exposure, because PNG does not carry one", () => {
    // Not zero, and not a default. Absent.
    expect(readRasterHeader(png(8, 8, 8, 2)).exposure.value).toBeNull();
    expect(readRasterHeader(png(8, 8, 8, 2)).exposure.origin).toBe("unknown");
  });
});

describe("what a JPEG states about itself", () => {
  it("reads precision and size from the frame header", () => {
    const header = readRasterHeader(jpeg({ precision: 12, width: 640, height: 480 }));
    expect(header.bitDepth).toEqual({ value: 12, origin: "header" });
    expect(header.width.value).toBe(640);
    expect(header.height.value).toBe(480);
  });

  it("reads exposure out of EXIF, in milliseconds", () => {
    // 1/100 s, recorded the way every other exposure on this screen is.
    expect(readRasterHeader(jpeg({ exif: true })).exposure)
      .toEqual({ value: 10, origin: "header" });
  });

  it("notices that a photograph carries coordinates", () => {
    /*
     * The reason this is checked outside medicine at all: a field photograph
     * identifies a collection site, and sometimes a home, as surely as a DICOM
     * header identifies a person.
     */
    expect(readRasterHeader(jpeg({ exif: true })).hasLocation).toBe(true);
    expect(readRasterHeader(jpeg({ exif: false })).hasLocation).toBe(false);
  });
});

describe("a container it does not know", () => {
  it("states nothing rather than guessing", () => {
    const header = readRasterHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer);
    expect(header.container).toBe("other");
    for (const fact of [header.width, header.height, header.bitDepth,
                        header.exposure]) {
      expect(fact.origin).toBe("unknown");
      expect(fact.value).toBeNull();
    }
  });

  it("does not read a truncated PNG as a valid one", () => {
    expect(readRasterHeader(png(8, 8, 8, 0).slice(0, 20)).container).toBe("other");
  });
});

describe("which discipline a flat image is judged under", () => {
  /*
   * The bug this guards was found only in a browser, and it made the picker
   * inert: the extension was consulted first, every `.png` is claimed by the
   * general-image profile, and a microscopist choosing "Microscopy" was shown
   * an evidence score against axes nobody had asked them about.
   */
  it("takes the researcher's answer, not the file extension", () => {
    const header = readRasterHeader(png(64, 64, 8, 0));
    expect(flatAcquisition("section-dapi.png", header, "microscopy").domain)
      .toBe("microscopy");
    expect(flatAcquisition("section-dapi.png", header, "figure").domain)
      .toBe("figure");
  });

  it("scores the evidence against the chosen discipline's axes", () => {
    // A PNG states its bit depth and nothing else. Bit depth is one of the
    // general-image axes and none of microscopy's, so the same file is 1/5
    // there and 0/6 here — and reporting the wrong one is how a researcher is
    // told their metadata is better than it is.
    const header = readRasterHeader(png(64, 64, 8, 0));
    expect(evidenceStrength(flatAcquisition("a.png", header, "image")))
      .toBeCloseTo(0.2, 5);
    expect(evidenceStrength(flatAcquisition("a.png", header, "microscopy")))
      .toBe(0);
  });
});
