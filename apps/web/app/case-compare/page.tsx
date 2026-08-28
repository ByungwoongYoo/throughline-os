"use client";

/**
 * A received case, held beside what the researcher already has.
 *
 * Synthetic throughout, and deliberately so: judging whether this screen is
 * useful should not require anybody to load a patient scan. The five studies
 * below are chosen to produce all five verdicts, because the refusals are the
 * part of the design that is hardest to evaluate from a description.
 *
 * **This is research tooling, not decision support.** There is no ranking, no
 * "closest match" and no likelihood anywhere on this page, and that is a
 * product decision rather than an omission — an ordered list of similar cases
 * is a differential diagnosis whatever it is labelled, and it would be ordered
 * by acquisition rather than by pathology in any case.
 */

import { useMemo } from "react";
import Link from "next/link";
import { CaseWorkspace, OpenScan } from "@/components/imaging/CaseWorkspace";
import { Grid, gridFromFunction } from "@/lib/charts3d/voxels";
import {
  Study, blankStudy, declared, fromHeader,
} from "@/lib/imaging/study";
import { describeReview, review } from "@/lib/imaging/phi";

/**
 * A volume with a blob in it, at a given size and offset.
 *
 * Not meant to look like anatomy — meant to give the window control and the
 * comparability panel something real to act on, and to differ between studies
 * in a way a reader can see.
 */
function blob(n: number, radius: number, shift: number): Grid {
  return gridFromFunction((x, y, z) => {
    const r = Math.sqrt((x - shift) ** 2 + y * y + z * z);
    const lesion = 90 * Math.exp(-(r * r) / (radius * radius));
    const background = 30 * Math.exp(-(x * x + y * y + z * z) / 1.2);
    return lesion + background;
  }, n, { min: -1, max: 1 }, "HU");
}

const ct = (id: string, label: string, over: Partial<Study> = {}): Study => ({
  ...blankStudy(id, label),
  modality: fromHeader("CT"),
  contrast: fromHeader("portal-venous"),
  sliceThickness: fromHeader(1),
  pixelSpacing: fromHeader(0.7),
  orientation: fromHeader("axial"),
  manufacturer: fromHeader("Siemens"),
  ...over,
});

/** A DICOM header of the shape a real one has, used only to be classified. */
const HEADER = {
  PatientName: "SYNTHETIC^CASE",
  PatientID: "SYNTHETIC-0001",
  PatientBirthDate: "19700101",
  AccessionNumber: "SYN-1",
  StudyDate: "20260826",
  InstitutionName: "Synthetic Imaging",
  Modality: "CT",
  SliceThickness: 1,
  PixelSpacing: [0.7, 0.7],
  ConvolutionKernel: "B31f",
  VendorPrivateBlock: "unclassified",
};

export default function CaseComparePage() {
  const received: OpenScan = useMemo(() => ({
    study: ct("received", "Received case — CT, portal-venous, 1 mm"),
    grid: blob(20, 0.34, 0.18),
  }), []);

  const library: OpenScan[] = useMemo(() => [
    { study: ct("same", "Prior CT, same protocol"),
      grid: blob(20, 0.30, 0.16) },
    { study: ct("thick", "Outside CT, 5 mm slices",
                { sliceThickness: fromHeader(5) }),
      grid: blob(16, 0.32, 0.2) },
    { study: ct("plain", "CT without contrast",
                { contrast: fromHeader("non-contrast") }),
      grid: blob(20, 0.26, 0.1) },
    { study: { ...blankStudy("mr", "MR, T2"),
               modality: fromHeader("MR"),
               weighting: fromHeader("T2"),
               contrast: fromHeader("non-contrast"),
               sliceThickness: fromHeader(3),
               pixelSpacing: fromHeader(0.5),
               fieldStrength: fromHeader(3),
               orientation: fromHeader("axial") },
      grid: blob(20, 0.4, -0.1) },
    { study: { ...blankStudy("unlabelled", "Scan with no header"),
               // What a researcher can offer when the file says nothing: a
               // claim, marked as a claim.
               modality: declared("CT") },
      grid: blob(18, 0.3, 0) },
  ], []);

  const phi = useMemo(() => review(HEADER), []);

  return (
    <main className="case-page">
      <header>
        <h1>Compare a case</h1>
        <p>
          A received scan, held beside what you already have. Every scan is
          sorted by whether it <em>may</em> be compared with the case — not by
          how much it resembles it. Appearance in medical imaging is dominated
          by acquisition rather than by pathology, so a list ordered by
          resemblance would mostly be a list of scans taken on the same machine,
          and it would look convincing while being about the scanner.
        </p>
        <p className="case-warning">
          Research tooling. Nothing here ranks, scores or suggests a diagnosis,
          and nothing here has looked at the pixels. Everything on this page is
          synthetic.
        </p>
        <p>
          <Link href="/">Back</Link> · <Link href="/charts-3d">Spatial charts</Link>
        </p>
      </header>

      <section className="case-privacy">
        <h2>What the file says about the patient</h2>
        <p className="case-note">{describeReview(phi)}</p>
        <p className="case-note">
          The scan is read in this browser. It is not uploaded, and the
          identifying fields are never written into the project — only the
          acquisition fields the comparison is decided on.
        </p>
      </section>

      <CaseWorkspace received={received} library={library} />
    </main>
  );
}
