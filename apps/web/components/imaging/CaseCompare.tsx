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
import { scanHandle } from "@/lib/imaging/identity";
import { Declare, withDeclared } from "@/components/imaging/Declare";
import {
  DOMAINS, DomainId, acceptedExtensions, domainOf,
} from "@/lib/imaging/domain";
import { figureExample, microscopyExample } from "@/lib/imaging/examples";
import {
  RasterError, decodeRaster, flatAcquisition, rasterFromTiff, readRasterHeader,
  tiffAcquisition,
} from "@/lib/imaging/raster";
import { TiffError, decodeTiff, tiffFacts } from "@/lib/imaging/tiff";

/**
 * A volume with a blob in it, at a given size and offset.
 *
 * Not meant to look like anatomy — meant to give the window control and the
 * comparability panel something real to act on, and to differ between studies
 * in a way a reader can see.
 */
/**
 * What this browser can decode on its own.
 *
 * TIFF is handled separately, by `lib/imaging/tiff.ts`: no browser decodes one,
 * so `createImageBitmap` would reject a file that is perfectly readable.
 */
const FLAT = /\.(png|jpe?g|webp|bmp)$/i;

/** Read by this application's own decoder, because no browser reads one. */
const TIFF = /\.(tiff?|ome\.tiff?)$/i;

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
  /*
   * Which discipline the worked example is drawn from.
   *
   * It used to be medicine and nothing else, while the page told the reader
   * that medicine was one field among several — which a microscopist had to
   * take on trust, because there was nothing else to look at. A profile nobody
   * can see working is indistinguishable from one that was never written.
   */
  const [example, setExample] = useState<DomainId>("radiology");

  const worked = useMemo(() => {
    if (example === "microscopy") return microscopyExample();
    if (example === "figure") return figureExample();
    return null;
  }, [example]);

  const radiology: OpenScan = useMemo(() => ({
    study: ct("received", "Received case — CT, portal-venous, 1 mm"),
    grid: blob(20, 0.34, 0.18),
  }), []);

  const radiologyLibrary: OpenScan[] = useMemo(() => [
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
  /*
   * The case's machine-local handle, computed here because hashing is async and
   * the workspace is not. Only DICOM yields one: a NIfTI carries no series UID,
   * so marks on a NIfTI last as long as the tab and the interface says so.
   */
  /*
   * The worked set actually on screen. The flat-image examples are rasters and
   * the radiology one is a volume, and the workspace already draws either — so
   * switching discipline is a change of data, not of machinery.
   */
  const received: OpenScan = worked === null
    ? radiology
    : { study: worked[0].study, raster: worked[0].raster };
  const library: OpenScan[] = worked === null
    ? radiologyLibrary
    : worked.slice(1).map((e) => ({ study: e.study, raster: e.raster }));

  const [handle, setHandle] = useState<string | null>(null);
  /*
   * Which profile a flat image is judged under. Asked rather than inferred —
   * see the note where it is used — and remembered between files so opening
   * twelve micrographs is one answer rather than twelve.
   */
  const [discipline, setDiscipline] = useState<DomainId>("microscopy");

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
    /*
     * A flat image is neither a volume nor a slice of one, and it is the only
     * one of the three a browser can decode on its own. Taken first so a PNG
     * is never handed to the DICOM reader and reported as a broken scan.
     */
    const flat = chosen.filter((f) => FLAT.test(f.name));
    const tiffs = chosen.filter((f) => TIFF.test(f.name));
    const volumes = chosen.filter(
      (f) => !FLAT.test(f.name) && !TIFF.test(f.name));

    for (const file of tiffs) {
      try {
        const bytes = await file.arrayBuffer();
        /*
         * Facts first, pixels second, and both from the same bytes. An
         * OME-TIFF states the objective, the channel, the acquisition mode and
         * the exposure — the axes the microscopy profile decides on — so this
         * is the path on which a verdict is something other than "cannot be
         * judged".
         */
        const facts = tiffFacts(bytes);
        const image = await decodeTiff(bytes);
        loaded.push({
          study: tiffAcquisition(file.name, facts, discipline),
          raster: rasterFromTiff(image),
        });
      } catch (error) {
        failed.push(`${file.name}: ${
          error instanceof TiffError ? error.message : "could not be read."}`);
      }
    }

    for (const file of flat) {
      try {
        const bytes = await file.arrayBuffer();
        const header = readRasterHeader(bytes);
        const raster = await decodeRaster(file);
        // Judged under the profile the researcher chose — see `flatAcquisition`.
        loaded.push({
          study: flatAcquisition(file.name, header, discipline),
          raster,
        });
        if (header.hasLocation) {
          failed.push(`${file.name}: opened, but it carries the coordinates it `
                    + "was taken at. Nothing here uploads it — worth knowing "
                    + "before you share the file.");
        }
      } catch (error) {
        failed.push(`${file.name}: ${
          error instanceof RasterError ? error.message : "could not be read."}`);
      }
    }

    const nifti = volumes.filter((f) => /\.nii(\.gz)?$/i.test(f.name));
    const rest = volumes.filter((f) => !/\.nii(\.gz)?$/i.test(f.name));

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
          const { grid, study, header } = await openDicomSeries(group, label);
          loaded.push({ grid, study });
          /*
           * The first series ever opened is the case, and the only one marks
           * attach to. Decided inside the setter rather than by reading
           * `opened`, which this callback captured when it was created — a
           * second batch would have seen a stale zero there and taken the
           * handle away from the case the marks belong to.
           */
          if (loaded.length === 1) {
            const computed = await scanHandle(header);
            setHandle((held) => held ?? computed);
          }
        } catch (error) {
          failed.push(`${label}: ${
            error instanceof DicomError ? error.message : "could not be read."}`);
        }
      }
    }

    setOpened((held) => [...held, ...loaded]);
    setProblems(failed);
    /*
     * `discipline` is a real dependency: captured with an empty list, changing
     * the picker and then opening a file would judge it under whichever
     * profile was selected when this component first rendered.
     */
  }, [discipline]);

  /*
   * A statement about one opened file. Replaces the study in place, so the
   * comparability panel below re-decides on the next render rather than
   * needing to be told anything.
   */
  const declare = useCallback(
    (id: string, axis: string, value: string | number | null) => {
      setOpened((held) => held.map((scan): OpenScan => {
        if (scan.study.id !== id) return scan;
        const study = withDeclared(scan.study, axis, value);
        return scan.raster !== undefined
          ? { study, raster: scan.raster }
          : { study, grid: scan.grid };
      }));
    }, []);

  // The first file opened becomes the case; the rest are what it is compared
  // against. Explicit, because guessing which of twenty scans is "the case"
  // would get it wrong silently.
  const [caseScan, ...rest] = opened;

  return (
    <div className="case-page">
      <header>
        {standalone && <h1>Compare images</h1>}
        <p>
          An image, held beside what you already have — a scan, a micrograph, a
          gel, a plate, or a figure lifted out of a paper. Each is sorted by
          whether it <em>may</em> be compared with the first, not by how much it
          resembles it. What an image looks like is dominated by how it was
          acquired rather than by what was in front of the instrument, in every
          one of those fields, so a list ordered by resemblance would mostly be
          a list of images taken on the same instrument — and it would look
          convincing while being about the instrument.
        </p>
        <p className="case-note">
          Which facts decide a comparison depends on the field, so each brings
          its own: a scan is judged on modality, sequence and geometry, a
          micrograph on technique, channel, preparation and optics, a figure on
          what is plotted, how it is normalised and what its error bars mean.
          Nothing is compared across two fields — a micrograph and a scan share
          no axis, and saying so is more useful than a verdict about neither.
        </p>
        <p className="case-warning">
          Research tooling. Nothing here ranks, scores or suggests a
          conclusion, and nothing here has looked at the pixels. Everything
          below is a synthetic worked example until you open your own files,
          which replace it.
        </p>

        {opened.length === 0 && (
          <label className="case-example">
            {/*
              * The example used to be medical and nothing else, while this page
              * claimed medicine was one field among several. Anyone outside it
              * had to take that on trust and load their own files to check —
              * which is exactly what a worked example exists to save them.
              */}
            Show the worked example from{" "}
            <select
              aria-label="Worked example discipline"
              value={example}
              onChange={(event) => setExample(event.target.value as DomainId)}
            >
              <option value="radiology">Medical imaging</option>
              <option value="microscopy">Microscopy</option>
              <option value="figure">Plotted figures</option>
            </select>
          </label>
        )}
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
        <h2>What the file says about who or where</h2>
        <p className="case-note">{describeReview(phi)}</p>
        <p className="case-note">
          The file is read in this browser. It is not uploaded, and the
          identifying fields are never written into the project — only the
          acquisition fields the comparison is decided on. This is not only a
          medical question: a photograph carries the coordinates it was taken
          at, which identifies a collection site, and sometimes a home, as
          surely as a name does. You are told when one does.
        </p>
      </section>

      <section className="case-open">
        <h2>Open your own images</h2>
        <p className="case-note">
          A TIFF or OME-TIFF (<code>.tif</code>, <code>.ome.tif</code>), a flat
          image (<code>.png</code>, <code>.jpg</code>, <code>.webp</code>), a
          NIfTI (<code>.nii</code>, <code>.nii.gz</code>), or a DICOM series —
          select every slice and they are grouped into one volume. Read in this
          browser, not uploaded. The first image opened becomes the one
          everything else is compared against, so open it first and the rest
          after.
        </p>
        <p className="case-note">
          TIFF is read here by this application rather than by the browser, at
          eight, sixteen and thirty-two bits, uncompressed or LZW, PackBits or
          Deflate. An OME-TIFF also states its objective, channel, acquisition
          mode and exposure, and those are read — which is the difference
          between a verdict and &ldquo;cannot be judged&rdquo;. Tiled files and
          the JPEG-in-TIFF compressions are declined by name rather than guessed
          at, because a wrong decode produces an image that still looks like a
          micrograph.
        </p>
        <p className="case-note">
          DICOM headers are read whatever the file; pixels only when they are
          stored uncompressed. A compressed series is still <em>judged</em> for
          comparability — the header is all that takes — and declined for
          display, naming its transfer syntax, because a wrong codec produces an
          image that looks like a scan.
        </p>
        <label className="case-noteinput">
          {/*
            * Asked rather than inferred from the extension. A PNG is equally a
            * micrograph, a gel and a plotted figure, and choosing for the
            * researcher would silently decide which facts their comparison is
            * judged on. Volumes ignore this: a DICOM says what it is.
            */}
          What your flat images are
          <select
            aria-label="What your flat images are"
            value={discipline}
            onChange={(event) => setDiscipline(event.target.value as DomainId)}
          >
            {DOMAINS.filter((d) => d.id !== "radiology").map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>
        <input
          type="file"
          aria-label="Open images"
          multiple
          /* Built from the profiles rather than typed out again: a second
             list is the one that stops being updated when a profile learns a
             new format. The media types are added because some pickers filter
             on those rather than on the extension. */
          accept={[...acceptedExtensions(), "image/tiff", "image/png",
                   "image/jpeg", "image/webp", "application/gzip",
                   "application/dicom"].join(",")}
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

      {opened.length > 0 && (
        <section className="case-declare">
          <h2>What your files did not record</h2>
          <p className="case-note">
            A verdict rests on facts, and a silent axis is not agreement — so a
            comparison stays &ldquo;cannot be judged&rdquo; until the silence is
            filled. Some of it never can be from the file: OME-TIFF records the
            objective and the channel, and has no field for whether a specimen
            was fixed or imaged live, which is one of the things that decides
            whether two images show the same thing at all. State what you know
            and it is carried as stated, never as read.
          </p>
          {opened.map((scan, index) => (
            <details key={scan.study.id} open={index === 0}>
              <summary>{scan.study.label}</summary>
              <Declare
                acquisition={scan.study}
                domain={domainOf(scan.study.domain)}
                onDeclare={(axis, value) => declare(scan.study.id, axis, value)}
              />
            </details>
          ))}
        </section>
      )}

      <CaseWorkspace
        received={caseScan ?? received}
        library={caseScan ? rest : library}
        author={author.trim() || "unattributed"}
        handle={handle}
      />
    </div>
  );
}
