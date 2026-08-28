/**
 * What in a scan identifies a person, and what may be written down.
 *
 * The tests here are about a distinction that is easy to state and easy to lose
 * in code: a file staying on the machine does not help once an identifier has
 * been transcribed *out* of it and into the research record, from where it
 * reaches every export, backup and figure the project produces.
 */

import { describe, expect, it } from "vitest";
import {
  KNOWN_FIELDS, describeReview, mayLeaveTheMachine, recordable, review,
  sensitivityOf,
} from "@/lib/imaging/phi";

const header = {
  PatientName: "DOE^JANE",
  PatientID: "MRN-4471902",
  PatientBirthDate: "19540211",
  AccessionNumber: "ACC-88213",
  StudyDate: "20260812",
  InstitutionName: "St Elsewhere",
  Modality: "CT",
  SliceThickness: 1.0,
  PixelSpacing: [0.7, 0.7],
  ConvolutionKernel: "B31f",
  PrivateVendorTag: "unclassified thing",
};

describe("what may be written into the research record", () => {
  it("keeps only the acquisition fields", () => {
    const safe = recordable(header);
    expect(Object.keys(safe).sort()).toEqual(
      ["ConvolutionKernel", "Modality", "PixelSpacing", "SliceThickness"]);
  });

  it("drops the patient's name and record number", () => {
    /*
     * The whole point. These decide nothing about comparability, so keeping
     * them buys nothing and costs the identifier appearing in every artefact
     * downstream.
     */
    const safe = recordable(header);
    expect(safe.PatientName).toBeUndefined();
    expect(safe.PatientID).toBeUndefined();
    expect(safe.AccessionNumber).toBeUndefined();
  });

  it("drops the study date and the institution", () => {
    // Neither identifies alone; together with an age and a diagnosis they
    // routinely do.
    const safe = recordable(header);
    expect(safe.StudyDate).toBeUndefined();
    expect(safe.InstitutionName).toBeUndefined();
  });

  it("copies the values rather than handing back the header", () => {
    // Returning a view into the original would let a caller keep a pointer to
    // everything it was supposed to have filtered out.
    const safe = recordable(header);
    expect(safe).not.toBe(header);
    (safe as Record<string, unknown>).Modality = "MR";
    expect(header.Modality).toBe("CT");
  });
});

describe("an unrecognised field is treated as risky", () => {
  it("classifies anything unknown as quasi-identifying", () => {
    /*
     * The direction of the default is the entire safety property. DICOM has
     * thousands of standard tags plus unbounded private vendor blocks, so
     * "unrecognised" is the *common* case — and a default of safe would wave
     * through the one private tag holding a hospital's internal patient number.
     */
    expect(sensitivityOf("PrivateVendorTag")).toBe("quasi");
    expect(sensitivityOf("0009,1001")).toBe("quasi");
    expect(sensitivityOf("")).toBe("quasi");
  });

  it("does not record an unrecognised field", () => {
    expect(recordable(header).PrivateVendorTag).toBeUndefined();
  });

  it("classifies the fields comparability needs as acquisition", () => {
    // If these were not safe the engine would have nothing to decide on.
    for (const field of ["Modality", "SliceThickness", "PixelSpacing",
                         "MagneticFieldStrength", "ContrastBolusAgent"]) {
      expect(sensitivityOf(field)).toBe("acquisition");
    }
  });

  it("keeps the safe list small enough to have been thought about", () => {
    // A list that grew to hundreds would mean somebody was adding fields to
    // make a screen work rather than deciding each one is harmless.
    const acquisition = Object.values(KNOWN_FIELDS)
      .filter((s) => s === "acquisition");
    expect(acquisition.length).toBeLessThan(40);
  });
});

describe("what the reader is told", () => {
  it("counts the identifiers without repeating their values", () => {
    /*
     * A warning that quotes the name it is warning about has copied the name
     * into the warning, and the warning is displayed, logged and screenshotted.
     */
    const text = describeReview(review(header));
    expect(text).not.toContain("DOE^JANE");
    expect(text).not.toContain("MRN-4471902");
    expect(text).toContain("identify the patient directly");
  });

  it("reports burned-in text when the header declares it", () => {
    const text = describeReview(review({ ...header, BurnedInAnnotation: "YES" }));
    expect(text).toContain("burned into the pixels");
    expect(text).toContain("cannot be shared as it stands");
  });

  it("refuses to call a silent header a clearance", () => {
    /*
     * The tag is frequently absent or simply unset, and ultrasound and screen
     * captures carry identifiers in the pixels routinely. Reading silence as
     * "no burned-in text" is how an identifiable image gets shared.
     */
    const text = describeReview(review(header));
    expect(text).toContain("not the same as there being none");
    expect(text).toContain("has looked at the pixels");
  });

  it("never claims a scan is anonymous", () => {
    // Nothing that has not inspected the pixels is entitled to that word.
    for (const h of [header, { Modality: "CT" }, {}]) {
      const text = describeReview(review(h)).toLowerCase();
      expect(text).not.toContain("anonymous");
      expect(text).not.toContain("de-identified");
    }
  });

  it("says something useful about a header with nothing in it", () => {
    expect(describeReview(review({}))).toContain("not declare burned-in text");
  });
});

describe("the case does not leave the machine", () => {
  it("answers no, so the answer is asked rather than assumed", () => {
    /*
     * A hosted model, a crash reporter, an analytics call or a share button
     * reaches for image data by writing the call, not by intending harm. This
     * exists so that reaching for it has to go through a function that says no.
     */
    expect(mayLeaveTheMachine()).toBe(false);
  });
});

describe("sorting a header", () => {
  it("puts every field in exactly one bucket", () => {
    const r = review(header);
    const total = r.direct.length + r.quasi.length + r.acquisition.length;
    expect(total).toBe(Object.keys(header).length);
  });

  it("finds the direct identifiers", () => {
    const r = review(header);
    expect(r.direct).toContain("PatientName");
    expect(r.direct).toContain("PatientID");
    expect(r.acquisition).toContain("Modality");
  });

  it("does not treat a BurnedInAnnotation of NO as a declaration", () => {
    expect(review({ BurnedInAnnotation: "NO" }).burnedInDeclared).toBe(false);
    expect(review({ BurnedInAnnotation: "YES" }).burnedInDeclared).toBe(true);
    expect(review({ BurnedInAnnotation: " yes " }).burnedInDeclared).toBe(true);
  });
});
