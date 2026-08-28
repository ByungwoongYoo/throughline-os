/**
 * Reading a DICOM header (imaging).
 *
 * DICOM is the only format here that records what comparability is decided on,
 * so these tests are mostly about *not inventing* the fields it does not record
 * — and about the ordering of a series, where the wrong answer produces a
 * volume with its slices shuffled that renders as plausible noise.
 *
 * Files are built byte by byte. A fixture would be a real patient's scan, which
 * is precisely the thing this subsystem exists to keep out of the repository.
 */

import { describe, expect, it } from "vitest";
import {
  DicomError, openDicomSeries, readDicom, stack, studyFrom,
} from "@/lib/imaging/dicom";
import { assess } from "@/lib/imaging/comparability";
import { recordable, review } from "@/lib/imaging/phi";

type El = [number, number, string, string | number | number[]];

/** One DICOM file, explicit VR little endian unless told otherwise. */
function dicom(elements: El[], o: {
  syntax?: string; pixels?: number[]; bits?: number; implicit?: boolean;
  noMagic?: boolean;
} = {}): ArrayBuffer {
  const { syntax = "1.2.840.10008.1.2.1", pixels, bits = 16,
          implicit = false } = o;

  const parts: number[] = [];
  const push16 = (v: number) => { parts.push(v & 0xff, (v >> 8) & 0xff); };
  const push32 = (v: number) => {
    parts.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  };
  const pushText = (t: string) => {
    const padded = t.length % 2 === 1 ? `${t} ` : t;
    for (const c of padded) parts.push(c.charCodeAt(0));
    return padded.length;
  };

  const element = ([group, el, vr, value]: El, useExplicit: boolean) => {
    push16(group); push16(el);
    const body: number[] = [];
    if (vr === "US") { body.push(Number(value) & 0xff, (Number(value) >> 8) & 0xff); }
    else if (vr === "UL") {
      const n = Number(value);
      body.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
    } else {
      const t = String(value);
      const padded = t.length % 2 === 1 ? `${t} ` : t;
      for (const c of padded) body.push(c.charCodeAt(0));
    }
    if (useExplicit) {
      parts.push(vr.charCodeAt(0), vr.charCodeAt(1));
      push16(body.length);
    } else {
      push32(body.length);
    }
    parts.push(...body);
  };

  // Preamble and marker.
  for (let i = 0; i < 128; i += 1) parts.push(0);
  if (!o.noMagic) { pushText("DICM"); } else { pushText("XXXX"); }

  // The meta group is always explicit VR little endian.
  element([0x0002, 0x0010, "UI", syntax], true);

  for (const e of elements) element(e, !implicit);

  if (pixels) {
    push16(0x7fe0); push16(0x0010);
    if (!implicit) { parts.push(79, 87); push16(0); push32(pixels.length * (bits / 8)); }
    else { push32(pixels.length * (bits / 8)); }
    for (const v of pixels) {
      if (bits === 8) parts.push(v & 0xff);
      else { parts.push(v & 0xff, (v >> 8) & 0xff); }
    }
  }

  return new Uint8Array(parts).buffer;
}

const ctElements = (over: Partial<Record<string, El>> = {}): El[] => Object.values({
  modality: [0x0008, 0x0060, "CS", "CT"] as El,
  maker: [0x0008, 0x0070, "LO", "SIEMENS"] as El,
  desc: [0x0008, 0x103e, "LO", "AX portal venous"] as El,
  name: [0x0010, 0x0010, "PN", "DOE^JANE"] as El,
  mrn: [0x0010, 0x0020, "LO", "MRN-99123"] as El,
  thickness: [0x0018, 0x0050, "DS", "1.0"] as El,
  orient: [0x0020, 0x0037, "DS", "1\\0\\0\\0\\1\\0"] as El,
  rows: [0x0028, 0x0010, "US", 2] as El,
  cols: [0x0028, 0x0011, "US", 2] as El,
  spacing: [0x0028, 0x0030, "DS", "0.7\\0.7"] as El,
  bits: [0x0028, 0x0100, "US", 16] as El,
  slope: [0x0028, 0x1053, "DS", "1"] as El,
  intercept: [0x0028, 0x1052, "DS", "-1024"] as El,
  ...over,
});

describe("the file is what it claims", () => {
  it("reads an explicit-VR little-endian file", () => {
    const { header, transferSyntax } = readDicom(dicom(ctElements()));
    expect(transferSyntax).toBe("1.2.840.10008.1.2.1");
    expect(header.Modality).toBe("CT");
    expect(header.Manufacturer).toBe("SIEMENS");
    expect(header.Rows).toBe(2);
  });

  it("reads an implicit-VR file, whose syntax the meta group declares", () => {
    /*
     * The meta group is always explicit even when the dataset is not — it is
     * where the transfer syntax is recorded, so it cannot depend on knowing it.
     * Reading the dataset with the wrong assumption yields elements that parse
     * and mean nothing.
     */
    const { header } = readDicom(
      dicom(ctElements(), { syntax: "1.2.840.10008.1.2", implicit: true }));
    expect(header.Modality).toBe("CT");
    expect(header.SliceThickness).toBe("1.0");
  });

  it("refuses a file with no DICM marker, and says where to take it", () => {
    expect(() => readDicom(dicom(ctElements(), { noMagic: true })))
      .toThrow(/no DICM marker/);
  });

  it("refuses something far too short", () => {
    expect(() => readDicom(new ArrayBuffer(40))).toThrow(DicomError);
  });
});

describe("what the header says about the acquisition", () => {
  it("reads modality, geometry and manufacturer as header facts", () => {
    const { header } = readDicom(dicom(ctElements()));
    const study = studyFrom(header, "s", "s");
    expect(study.modality).toEqual({ value: "CT", origin: "header" });
    expect(study.sliceThickness).toEqual({ value: 1, origin: "header" });
    expect(study.pixelSpacing).toEqual({ value: 0.7, origin: "header" });
    expect(study.orientation).toEqual({ value: "axial", origin: "header" });
  });

  it("maps the modality codes that are not what they look like", () => {
    // PT is positron emission tomography; CR and DX are both radiography.
    for (const [code, expected] of
         [["PT", "PET"], ["CR", "XR"], ["DX", "XR"], ["MR", "MR"]]) {
      const { header } = readDicom(
        dicom(ctElements({ modality: [0x0008, 0x0060, "CS", code] })));
      expect(studyFrom(header, "s", "s").modality.value).toBe(expected);
    }
  });

  it("reads the plane from the direction cosines", () => {
    const plane = (cosines: string) => {
      const { header } = readDicom(dicom(ctElements({
        orient: [0x0020, 0x0037, "DS", cosines] })));
      return studyFrom(header, "s", "s").orientation.value;
    };
    expect(plane("1\\0\\0\\0\\1\\0")).toBe("axial");
    expect(plane("1\\0\\0\\0\\0\\-1")).toBe("coronal");
    expect(plane("0\\1\\0\\0\\0\\-1")).toBe("sagittal");
  });

  it("calls a genuinely oblique series oblique", () => {
    /*
     * Not a nicety: an oblique series compared with an axial one is not the
     * same plane, and rounding it to the nearest axis would report agreement
     * where there is none.
     */
    const { header } = readDicom(dicom(ctElements({
      orient: [0x0020, 0x0037, "DS", "0.7\\0.7\\0\\-0.5\\0.5\\0.7"] })));
    expect(studyFrom(header, "s", "s").orientation.value).toBe("oblique");
  });

  it("derives MR weighting from TR and TE, not from the description", () => {
    /*
     * `SeriesDescription` is free text a technologist typed, and it routinely
     * says "AX T2 FLAIR" on a diffusion series. TR and TE are what the scanner
     * actually did.
     */
    const mr = (tr: string, te: string, desc = "AX T1 misleading") => {
      const { header } = readDicom(dicom(ctElements({
        modality: [0x0008, 0x0060, "CS", "MR"],
        desc: [0x0008, 0x103e, "LO", desc],
        tr: [0x0018, 0x0080, "DS", tr],
        te: [0x0018, 0x0081, "DS", te],
      })));
      return studyFrom(header, "s", "s").weighting.value;
    };
    expect(mr("500", "12")).toBe("T1");
    expect(mr("4000", "90")).toBe("T2");
    expect(mr("4000", "12")).toBe("PD");
  });

  it("leaves weighting unknown on a CT, where it has no meaning", () => {
    const { header } = readDicom(dicom(ctElements()));
    expect(studyFrom(header, "s", "s").weighting.origin).toBe("unknown");
  });

  it("reads the contrast phase where the file names it", () => {
    const phase = (desc: string) => {
      const { header } = readDicom(dicom(ctElements({
        desc: [0x0008, 0x103e, "LO", desc] })));
      return studyFrom(header, "s", "s").contrast.value;
    };
    expect(phase("AX portal venous")).toBe("portal-venous");
    expect(phase("late arterial phase")).toBe("arterial");
    expect(phase("delayed 5min")).toBe("delayed");
    expect(phase("non-contrast head")).toBe("non-contrast");
  });

  it("says the phase is unknown when only an agent is recorded", () => {
    /*
     * An agent means contrast was given; it does not say which phase, and the
     * phase is what decides whether a lesion is visible. `unknown-phase` is
     * treated as unrecorded by the comparability engine rather than as
     * agreement — a guess here would be read as a finding.
     */
    const { header } = readDicom(dicom(ctElements({
      desc: [0x0008, 0x103e, "LO", "abdomen"],
      agent: [0x0018, 0x0010, "LO", "OMNIPAQUE"] })));
    expect(studyFrom(header, "s", "s").contrast.value).toBe("unknown-phase");
  });

  it("leaves contrast unknown when the file says nothing", () => {
    const { header } = readDicom(dicom(ctElements({
      desc: [0x0008, 0x103e, "LO", "abdomen"] })));
    expect(studyFrom(header, "s", "s").contrast.origin).toBe("unknown");
  });

  it("makes two real series judgeable, which NIfTI could not", () => {
    /*
     * The reason this reader exists. Two NIfTIs come back as *cannot be judged*
     * because the format records no modality; two DICOM series come back with
     * an actual verdict.
     */
    const a = studyFrom(readDicom(dicom(ctElements())).header, "a", "a");
    const b = studyFrom(readDicom(dicom(ctElements())).header, "b", "b");
    expect(assess(a, b).verdict).toBe("DIRECTLY_COMPARABLE");

    const other = studyFrom(readDicom(dicom(ctElements({
      desc: [0x0008, 0x103e, "LO", "non-contrast"] }))).header, "c", "c");
    expect(assess(a, other).verdict).toBe("RELATED_BUT_NOT_COMPARABLE");
  });
});

describe("pixels, and when they are refused", () => {
  it("rescales stored values into the real measurement", () => {
    // Without slope and intercept a CT is arbitrary numbers and the window a
    // radiologist knows means nothing.
    const { pixels } = readDicom(
      dicom(ctElements(), { pixels: [0, 100, 200, 300] }));
    expect(Array.from(pixels!)).toEqual([-1024, -924, -824, -724]);
  });

  it("reads the header of a compressed series and declines its pixels", () => {
    /*
     * The split this reader is built around. A wrong codec produces an image
     * that looks like a scan, so a compressed series is judged and not shown —
     * and the refusal names the syntax so somebody can act on it.
     */
    const compressed = dicom(ctElements(), {
      syntax: "1.2.840.10008.1.2.4.90", pixels: [1, 2, 3, 4] });
    const slice = readDicom(compressed);
    expect(slice.header.Modality).toBe("CT");
    expect(slice.pixels).toBeNull();
    expect(() => stack([slice], "s")).toThrow(/1\.2\.840\.10008\.1\.2\.4\.90/);
    expect(() => stack([slice], "s")).toThrow(/can still be judged/);
  });

  it("refuses colour pixels rather than averaging them into one channel", () => {
    const slice = readDicom(dicom(ctElements({
      samples: [0x0028, 0x0002, "US", 3] }), { pixels: [1, 2, 3, 4] }));
    expect(slice.pixels).toBeNull();
  });
});

describe("stacking a series", () => {
  const sliceAt = (z: number, instance: number, fill: number) =>
    readDicom(dicom(ctElements({
      pos: [0x0020, 0x0032, "DS", `0\\0\\${z}`],
      inst: [0x0020, 0x0013, "IS", String(instance)],
    }), { pixels: [fill, fill, fill, fill] }));

  it("orders by patient position, not by the order files arrived", () => {
    /*
     * Sorting by filename is what a naive reader does, and `IM-0002` sorts
     * before `IM-0010` only by luck of zero padding. A mis-ordered stack is a
     * volume with its slices shuffled, which renders as plausible noise.
     */
    const { grid } = stack([sliceAt(30, 3, 300), sliceAt(10, 1, 100),
                            sliceAt(20, 2, 200)], "series");
    expect(grid.nz).toBe(3);
    expect(grid.values[0]).toBe(100 - 1024);
    expect(grid.values[8]).toBe(300 - 1024);
  });

  it("falls back to instance number when position is absent", () => {
    const noPosition = (instance: number, fill: number) =>
      readDicom(dicom(ctElements({
        inst: [0x0020, 0x0013, "IS", String(instance)] }),
        { pixels: [fill, fill, fill, fill] }));
    const { grid } = stack([noPosition(2, 200), noPosition(1, 100)], "s");
    expect(grid.values[0]).toBe(100 - 1024);
  });

  it("refuses a series whose slices are different sizes", () => {
    // Padding the short ones would invent tissue at the edges.
    const odd = readDicom(dicom(ctElements({
      rows: [0x0028, 0x0010, "US", 3], cols: [0x0028, 0x0011, "US", 3] }),
      { pixels: [1, 2, 3, 4, 5, 6, 7, 8, 9] }));
    expect(() => stack([sliceAt(10, 1, 100), odd], "s"))
      .toThrow(/not one volume/);
  });

  it("marks a CT volume as Hounsfield units", () => {
    expect(stack([sliceAt(10, 1, 100)], "s").grid.units).toBe("HU");
  });

  it("refuses an empty series rather than making an empty volume", () => {
    expect(() => stack([], "s")).toThrow(/No slices/);
  });
});

describe("the identifiers are read and not kept", () => {
  it("hands the header to the privacy review", () => {
    const { header } = readDicom(dicom(ctElements()));
    const seen = review(header);
    expect(seen.direct).toContain("PatientName");
    expect(seen.direct).toContain("PatientID");
    expect(seen.acquisition).toContain("Modality");
  });

  it("keeps nothing identifying in what may be recorded", () => {
    const { header } = readDicom(dicom(ctElements()));
    const safe = recordable(header);
    expect(safe.PatientName).toBeUndefined();
    expect(safe.PatientID).toBeUndefined();
    expect(safe.Modality).toBe("CT");
  });

  it("puts no identifier into the study the verdict rests on", () => {
    /*
     * The study travels into the comparison, the mark list and anything shown
     * on screen. An identifier reaching it would appear beside every verdict.
     */
    const { header } = readDicom(dicom(ctElements()));
    const study = studyFrom(header, "case-1", "Received case");
    const text = JSON.stringify(study);
    expect(text).not.toContain("DOE");
    expect(text).not.toContain("MRN-99123");
  });
});

describe("opening a series the researcher chose", () => {
  it("reads several files into one volume", async () => {
    const file = (z: number, fill: number) => ({
      arrayBuffer: async () => dicom(ctElements({
        pos: [0x0020, 0x0032, "DS", `0\\0\\${z}`] }),
        { pixels: [fill, fill, fill, fill] }),
    }) as unknown as File;

    const { grid, study } = await openDicomSeries(
      [file(20, 200), file(10, 100)], "series");
    expect(grid.nz).toBe(2);
    expect(grid.values[0]).toBe(100 - 1024);
    expect(study.modality.value).toBe("CT");
  });
});
