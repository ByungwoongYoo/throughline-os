"use client";

/**
 * A received case, held beside what the researcher already has.
 *
 * One component rendered in two places: the Compare screen's "Scan ↔ scan"
 * tab, which is where a researcher already goes to compare two things, and
 * its own route for opening straight into a case. Written once rather than
 * twice, because the second copy is the one that stops being maintained.
 *
 * **Inside Compare it is deliberately not like the other tabs.** Every other
 * verb compares objects that live in the project database. These scans are
 * read in the browser and never persisted — that is the whole privacy
 * position — so the tab says so rather than letting the familiar surround
 * imply the files have been taken in.
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

import { useCallback, useMemo, useState } from "react";
import { CaseWorkspace, OpenScan } from "@/components/imaging/CaseWorkspace";
import { Grid, gridFromFunction } from "@/lib/charts3d/voxels";
import {
  Study, blankStudy, declared, fromHeader,
} from "@/lib/imaging/study";
import { describeReview, review } from "@/lib/imaging/phi";
import { NiftiError, openNifti } from "@/lib/imaging/nifti";
import { DicomError, openDicomSeries, readDicom } from "@/lib/imaging/dicom";

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

export function CaseCompare({ standalone = false }: { standalone?: boolean }) {
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

  /*
   * Files opened by the researcher, replacing the synthetic set once any are
   * loaded. Held in state rather than uploaded: `openNifti` reads the bytes
   * here and the file never becomes a request.
   */
  const [opened, setOpened] = useState<OpenScan[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [author, setAuthor] = useState("");

  const open = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files);
    const loaded: OpenScan[] = [];
    const failed: string[] = [];

    /*
     * A NIfTI is one file and a DICOM *series* is many, so they cannot be
     * treated the same way. Selecting three hundred slices and getting three
     * hundred one-slice "scans" would be useless; grouping them by series is
     * the whole difference between opening a case and opening a directory.
     */
    const nifti = chosen.filter((f) => /\.nii(\.gz)?$/i.test(f.name));
    const rest = chosen.filter((f) => !/\.nii(\.gz)?$/i.test(f.name));

    for (const file of nifti) {
      try {
        const { grid, study } = await openNifti(file);
        loaded.push({ grid, study });
      } catch (error) {
        /*
         * Named per file rather than as one failure. A batch where three of
         * twenty are unreadable should say which three — a single "some files
         * failed" leaves the researcher opening them one at a time to find out.
         */
        failed.push(`${file.name}: ${
          error instanceof NiftiError ? error.message : "could not be read."}`);
      }
    }

    if (rest.length > 0) {
      /*
       * Grouped by SeriesInstanceUID would be exact; grouped by what the header
       * says the series is, plus its geometry, is what these files carry
       * reliably. Slices that disagree about their size are refused downstream
       * rather than padded, so a wrong grouping fails loudly instead of
       * producing a volume with somebody else's slices in it.
       */
      const bySeries = new Map<string, File[]>();
      for (const file of rest) {
        try {
          const slice = readDicom(await file.arrayBuffer());
          const key = [slice.header.SeriesDescription ?? "",
                       slice.header.Modality ?? "",
                       slice.rows, slice.columns].join("|");
          bySeries.set(key, [...(bySeries.get(key) ?? []), file]);
        } catch (error) {
          failed.push(`${file.name}: ${
            error instanceof DicomError ? error.message : "could not be read."}`);
        }
      }
      for (const [key, group] of bySeries) {
        const label = key.split("|")[0] || `${group.length} slices`;
        try {
          const { grid, study } = await openDicomSeries(group, label);
          loaded.push({ grid, study });
        } catch (error) {
          failed.push(`${label}: ${
            error instanceof DicomError ? error.message : "could not be read."}`);
        }
      }
    }

    setOpened((held) => [...held, ...loaded]);
    setProblems(failed);
  }, []);

  // The first file opened becomes the case; the rest are what it is compared
  // against. Explicit, because guessing which of twenty scans is "the case"
  // would get it wrong silently.
  const [caseScan, ...rest] = opened;

  return (
    <div className="case-page">
      <header>
        {standalone && <h1>Compare a case</h1>}
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
          and nothing here has looked at the pixels. The scans below are
          synthetic until you open your own.
        </p>
        {!standalone && (
          <p className="case-note">
            Unlike the other comparisons here, these scans are not objects in
            the project. They are read in this browser, compared, and forgotten
            when the tab closes — nothing about them is written down except the
            acquisition facts a verdict rests on.
          </p>
        )}
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

      <section className="case-open">
        <h2>Open your own scans</h2>
        <p className="case-note">
          NIfTI (<code>.nii</code>, <code>.nii.gz</code>) or a DICOM series —
          select every slice and they are grouped into one volume. Read in this
          browser, not uploaded. The first scan opened becomes the case and the
          rest are compared against it, so open the new case first and your
          research images after.
        </p>
        <p className="case-note">
          DICOM headers are read whatever the file; pixels only when they are
          stored uncompressed. A compressed series is still <em>judged</em> for
          comparability — the header is all that takes — and declined for
          display, naming its transfer syntax, because a wrong codec produces an
          image that looks like a scan.
        </p>
        <input
          type="file"
          aria-label="Open NIfTI scans"
          multiple
          accept=".nii,.nii.gz,.dcm,.dicom,.ima,application/gzip,application/dicom"
          onChange={(event) => { void open(event.target.files); }}
        />
        <label className="case-noteinput">
          Your name, for the marks
          <input
            type="text"
            aria-label="Your name"
            value={author}
            placeholder="shown beside every mark you make"
            onChange={(event) => setAuthor(event.target.value)}
          />
        </label>
        {problems.length > 0 && (
          <ul className="case-problems">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {opened.length > 0 && (
          <p className="case-note">
            {opened.length} opened. A NIfTI records geometry but not modality,
            sequence or contrast phase — those are in the DICOM it was converted
            from — so pairs of NIfTIs come back as <em>cannot be judged</em>.
            That is the file being honest, not the comparison failing. DICOM
            carries all four, so a series gets an actual verdict.
          </p>
        )}
      </section>

      <CaseWorkspace
        received={caseScan ?? received}
        library={caseScan ? rest : library}
        author={author.trim() || "unattributed"}
      />
    </div>
  );
}
