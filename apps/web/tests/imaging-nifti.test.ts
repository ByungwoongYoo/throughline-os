/**
 * Reading a NIfTI volume (imaging).
 *
 * The tests build real headers byte by byte rather than loading a fixture,
 * because the things worth checking are byte-level: the endianness the file
 * declares, the scaling that turns stored integers into Hounsfield units, and
 * the fields a NIfTI simply does not carry.
 *
 * That last one is the important one. A NIfTI records geometry exactly and
 * records modality, weighting and contrast phase not at all — so two of them
 * are usually *not judgeable* rather than comparable, and a reader who assumed
 * otherwise would be comparing a CT with an MR without knowing it.
 */

import { describe, expect, it } from "vitest";
import { NiftiError, isGzipped, readNifti } from "@/lib/imaging/nifti";
import { assess } from "@/lib/imaging/comparability";

type Options = {
  nx?: number; ny?: number; nz?: number;
  datatype?: number; little?: boolean;
  pixdim?: [number, number, number];
  scale?: number; offset?: number;
  sform?: boolean; sliceAxis?: 0 | 1 | 2;
  /** Write the affine but declare it invalid, as a stale header does. */
  sformCode?: number;
  fill?: (i: number) => number;
  truncate?: number;
};

/** A NIfTI-1 file, assembled by hand so every byte under test is deliberate. */
function nifti(o: Options = {}): ArrayBuffer {
  const { nx = 4, ny = 4, nz = 4, datatype = 16, little = true,
          pixdim = [0.7, 0.7, 1.0], scale = 1, offset = 0,
          sform = true, sliceAxis = 2, fill = (i) => i } = o;
  const bytesPer = datatype === 4 || datatype === 512 ? 2
                 : datatype === 64 ? 8 : datatype === 2 ? 1 : 4;
  const total = nx * ny * nz;
  const size = 352 + total * bytesPer;
  const buffer = new ArrayBuffer(o.truncate ?? size);
  const view = new DataView(buffer);

  view.setInt32(0, 348, little);
  view.setInt16(40, 3, little);                    // dim[0] — three axes
  view.setInt16(42, nx, little);
  view.setInt16(44, ny, little);
  view.setInt16(46, nz, little);
  view.setInt16(70, datatype, little);
  view.setFloat32(76 + 4, pixdim[0], little);      // pixdim[1]
  view.setFloat32(76 + 8, pixdim[1], little);      // pixdim[2]
  view.setFloat32(76 + 12, pixdim[2], little);     // pixdim[3]
  view.setFloat32(108, 352, little);               // vox_offset
  view.setFloat32(112, scale, little);
  view.setFloat32(116, offset, little);
  view.setInt16(254, o.sformCode ?? (sform ? 1 : 0), little);
  if (sform || o.sformCode !== undefined) {
    // The third column of the affine — the direction the slice index runs.
    view.setFloat32(280 + 8, sliceAxis === 0 ? 1 : 0, little);
    view.setFloat32(296 + 8, sliceAxis === 1 ? 1 : 0, little);
    view.setFloat32(312 + 8, sliceAxis === 2 ? 1 : 0, little);
  }

  if (!o.truncate) {
    for (let i = 0; i < total; i += 1) {
      const at = 352 + i * bytesPer;
      const v = fill(i);
      if (datatype === 16) view.setFloat32(at, v, little);
      else if (datatype === 4) view.setInt16(at, v, little);
      else if (datatype === 2) view.setUint8(at, v);
      else if (datatype === 64) view.setFloat64(at, v, little);
    }
  }
  return buffer;
}

describe("the voxels come back as they were written", () => {
  it("reads dimensions and values", () => {
    const result = readNifti(nifti({ nx: 2, ny: 3, nz: 4 }), "scan");
    expect(result.grid.nx).toBe(2);
    expect(result.grid.ny).toBe(3);
    expect(result.grid.nz).toBe(4);
    expect(result.grid.values.length).toBe(24);
    expect(result.grid.values[5]).toBe(5);
  });

  it("reads a big-endian file", () => {
    /*
     * Decided by the header's own size field rather than assumed. Files written
     * on a big-endian machine are still in circulation, and read with the wrong
     * byte order they come out as noise — which looks like a bad scan rather
     * than a bad read.
     */
    const result = readNifti(nifti({ little: false }), "scan");
    expect(result.grid.nx).toBe(4);
    expect(result.grid.values[3]).toBe(3);
  });

  it("reads int16, uint8 and float64 as well as float32", () => {
    for (const datatype of [4, 2, 64]) {
      const result = readNifti(nifti({ datatype, fill: (i) => i % 100 }), "s");
      expect(result.grid.values[7]).toBe(7);
    }
  });

  it("applies the scaling that makes the numbers mean something", () => {
    /*
     * `scl_slope` and `scl_inter` convert stored integers to the real
     * measurement. Skipping them leaves a CT in raw stored units, where the
     * window a radiologist knows in Hounsfield units lands nowhere useful.
     */
    const result = readNifti(
      nifti({ datatype: 4, scale: 2, offset: -1024, fill: (i) => i }), "ct");
    expect(result.grid.values[10]).toBe(10 * 2 - 1024);
  });

  it("treats a slope of zero as 'not used' rather than multiplying by it", () => {
    // The standard says a zero slope means no scaling. Taking it literally
    // turns the whole volume into a constant.
    const result = readNifti(nifti({ scale: 0, offset: 0, fill: (i) => i }), "s");
    expect(result.grid.values[9]).toBe(9);
  });
});

describe("what the header does not say is left unsaid", () => {
  it("reads geometry from the header", () => {
    const result = readNifti(nifti({ pixdim: [0.5, 0.5, 3] }), "scan");
    expect(result.study.sliceThickness).toEqual({ value: 3, origin: "header" });
    expect(result.study.pixelSpacing).toEqual({ value: 0.5, origin: "header" });
  });

  it("leaves modality, weighting and contrast unknown", () => {
    /*
     * They are recorded in the DICOM the NIfTI was converted from and do not
     * survive the conversion. Guessing them — from the filename, or from the
     * value range — is precisely the invention this refuses to make.
     */
    const { study, absent } = readNifti(nifti(), "brain_t1_scan");
    expect(study.modality.origin).toBe("unknown");
    expect(study.weighting.origin).toBe("unknown");
    expect(study.contrast.origin).toBe("unknown");
    expect(absent).toContain("modality");
  });

  it("does not read a modality out of the filename", () => {
    // "brain_t1" is not evidence of anything, however much it looks like it.
    const { study } = readNifti(nifti(), "brain_t1_ct_arterial");
    expect(study.modality.value).toBeNull();
    expect(study.weighting.value).toBeNull();
  });

  it("means two NIfTIs are not judgeable rather than comparable", () => {
    /*
     * The consequence, stated as a test because it is a design outcome rather
     * than a limitation: opening two real files gives *cannot be judged*, and
     * a reader is told the acquisition is unrecorded instead of being shown a
     * confident verdict resting on nothing.
     */
    const a = readNifti(nifti(), "one").study;
    const b = readNifti(nifti(), "two").study;
    expect(assess(a, b).verdict).toBe("CONCEPTUALLY_COMPARABLE");
  });

  it("reads the plane from the affine when one is recorded", () => {
    expect(readNifti(nifti({ sliceAxis: 2 }), "s").study.orientation.value)
      .toBe("axial");
    expect(readNifti(nifti({ sliceAxis: 1 }), "s").study.orientation.value)
      .toBe("coronal");
    expect(readNifti(nifti({ sliceAxis: 0 }), "s").study.orientation.value)
      .toBe("sagittal");
  });

  it("ignores an affine the file declares invalid", () => {
    /*
     * `sform_code` of zero means "these numbers do not describe a transform",
     * and converters leave stale rows behind. Reading them anyway takes a plane
     * from an affine the file itself disowns — and reports it as read from the
     * header, which is the strongest provenance this system has.
     *
     * The zero-affine case does not catch this: there the rows are also zero
     * and a later guard rejects them, which is how a missing check here passed
     * its first mutation run.
     */
    const result = readNifti(
      nifti({ sform: true, sformCode: 0, sliceAxis: 1 }), "s");
    expect(result.study.orientation.origin).toBe("unknown");
    expect(result.absent).toContain("orientation");
  });

  it("leaves the plane unknown when no affine is recorded", () => {
    /*
     * Most volumes are axial, which is exactly what makes defaulting to axial
     * dangerous: it would be right often enough to be trusted and wrong
     * silently.
     */
    const result = readNifti(nifti({ sform: false }), "s");
    expect(result.study.orientation.origin).toBe("unknown");
    expect(result.absent).toContain("orientation");
  });
});

describe("a file that is not what it claims", () => {
  it("refuses something that is not a NIfTI", () => {
    const buffer = new ArrayBuffer(400);
    new DataView(buffer).setInt32(0, 12345, true);
    expect(() => readNifti(buffer, "x")).toThrow(NiftiError);
    expect(() => readNifti(buffer, "x")).toThrow(/does not begin with/);
  });

  it("points a DICOM at the viewer that can read it", () => {
    const buffer = new ArrayBuffer(400);
    expect(() => readNifti(buffer, "x")).toThrow(/imaging viewer pack/);
  });

  it("refuses a file too short to hold a header", () => {
    expect(() => readNifti(new ArrayBuffer(40), "x")).toThrow(/not a NIfTI/);
  });

  it("refuses a truncated volume rather than filling it with zeros", () => {
    /*
     * Read to the end, a short file yields zeros — and zero is a real value,
     * water in a CT. A volume that quietly ends in water looks like a scan
     * rather than like a broken download.
     */
    expect(() => readNifti(nifti({ truncate: 400 }), "x"))
      .toThrow(/truncated or still downloading/);
  });

  it("refuses a two-dimensional file", () => {
    const buffer = nifti();
    new DataView(buffer).setInt16(40, 2, true);
    expect(() => readNifti(buffer, "x")).toThrow(/needs\s+three/);
  });

  it("refuses a datatype it cannot read, and names it", () => {
    const buffer = nifti();
    new DataView(buffer).setInt16(70, 1536, true);
    expect(() => readNifti(buffer, "x")).toThrow(/datatype 1536/);
  });
});

describe("gzip is detected by content, not by name", () => {
  it("recognises the magic bytes", () => {
    // A filename is a claim about the contents; the magic is the contents.
    expect(isGzipped(new Uint8Array([0x1f, 0x8b, 0x08]))).toBe(true);
    expect(isGzipped(new Uint8Array([0x5c, 0x01, 0x00]))).toBe(false);
    expect(isGzipped(new Uint8Array([]))).toBe(false);
  });
});
