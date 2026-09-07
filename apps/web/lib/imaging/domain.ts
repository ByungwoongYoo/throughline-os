/**
 * What field of research a comparison belongs to, and what it turns on.
 *
 * This file exists because the comparison engine was written for one
 * discipline and read as though it were the platform's only one. The reasoning
 * underneath was never medical: record where each fact came from, refuse when
 * the acquisitions do not share a measurement, and say why. What *was* medical
 * was the list of things to compare, the tolerances, and the words — modality,
 * sequence weighting, contrast phase, Tesla. A microscopist with two images of
 * the same section had nowhere to put an objective or a fluorophore, and no
 * verdict that spoke about them.
 *
 * **The generalisation is not a rename.** Calling a scan a "sample" would have
 * made the screen look general while it still only understood radiology, which
 * is the exact failure this project is arranged against: a claim the data does
 * not support. So the axes, the rules that compare them, and the prose each
 * verdict is written in all move into the profile, and every discipline brings
 * its own.
 *
 * **The thesis survives the move, because it was never about medicine.** Image
 * appearance is dominated by *how the image was acquired* rather than by what
 * was in front of the instrument. That is true of a CT, and it is more true of
 * a micrograph: exposure, objective, illumination and stain move a field of
 * cells further than the biology usually does. It is true of a plotted figure
 * too, where a log axis and a linear one make different claims out of one
 * dataset. Ranking images by how alike they look would retrieve *the same
 * instrument*, convincingly, in every one of these fields.
 *
 * Adding a discipline means adding a profile here. Nothing else should need to
 * know that it exists — if something outside this file starts switching on a
 * domain id, that is the hard-coding coming back.
 */

import type { Fact } from "./study";

/** The disciplines this screen can decide a comparison for. */
export type DomainId = "radiology" | "microscopy" | "image" | "figure";

/**
 * What a difference on one axis does to the verdict.
 *
 * Three tiers, in descending severity, and the ordering is the whole argument:
 *
 * - `foundational` — the two acquisitions do not measure the same quantity, so
 *   a value in one has no counterpart in the other. Nothing survives this and
 *   no correction reaches it.
 * - `visibility` — they measure the same quantity, but the setting decides
 *   *what is present in the image at all*. A structure can be genuinely absent
 *   rather than fainter, so a difference between the images cannot be read as a
 *   difference in the subject.
 * - `harmonizable` — a real obstacle that a researcher can correct for. This is
 *   the tier that separates "not comparable" from "not comparable yet".
 */
export type Tier = "foundational" | "visibility" | "harmonizable";

/** How two values on one axis are decided to agree. */
export type Match =
  /** Equal, on a closed vocabulary. */
  | { kind: "exact" }
  /**
   * Within a ratio of each other. A ratio rather than a difference because
   * 1 against 2 matters and 4 against 5 much less, and no absolute threshold
   * expresses both.
   */
  | { kind: "ratio"; tolerance: number }
  /** Within an absolute distance, for values that are nominal rather than measured. */
  | { kind: "near"; epsilon: number }
  /**
   * Free text, compared case-insensitively after trimming.
   *
   * For the axes with no closed vocabulary to offer — a fluorophore, a plotted
   * quantity. `===` on what a person typed would let "DAPI" and "dapi" compare
   * as two channels, which is the spell-checker failure the closed lists exist
   * to avoid; folding case is the least this can do about it.
   */
  | { kind: "text" };

export type AxisSpec = {
  /** The field this axis reads off an acquisition. */
  key: string;
  /** What to call it, in running prose. Lower case. */
  label: string;
  tier: Tier;
  match: Match;
  /** Why a difference matters. Shown to the researcher verbatim. */
  note: string;
  /**
   * The values this axis accepts, where it has a closed vocabulary.
   *
   * Offered as a list rather than a free field, for the same reason `Modality`
   * is a union rather than a string: an open field lets "MR", "MRI" and "mri"
   * describe one thing and compare as three, which turns a comparability
   * engine into a spell-checker. An axis with no list here is genuinely open,
   * and compares as folded text instead.
   */
  options?: readonly string[];
  /**
   * The unit a quantity is stated in, where it has one.
   *
   * Carried so that "at most 1.5 mm" and "at most 1.5 µm" are each written by
   * the discipline that means them, rather than by whichever one the search
   * screen happened to be built for first.
   */
  unit?: string;
  /**
   * What correcting for it would take. Required on `harmonizable` axes and
   * meaningless on the others — a `foundational` difference has no remedy, and
   * offering one would be the lie.
   */
  harmonization?: string;
  /**
   * Whether this axis applies to a given pair at all.
   *
   * Some axes are properties of one technique. Reporting "not recorded" for
   * field strength on a pair of CTs fills the panel with objections that are
   * categories rather than problems, and a panel of irrelevant objections
   * teaches the reader to skim past the real ones.
   */
  appliesTo?: (left: Facts, right: Facts) => boolean;
};

/** An acquisition's facts, read by axis key. */
export type Facts = Record<string, unknown>;

/** The prose each verdict is written in. Per domain, because a microscopy
 *  refusal that talks about sequences and Tesla is worse than no refusal. */
export type Prose = {
  /** Both sides of a `foundational` difference, already rendered as words. */
  foundational: (left: string, right: string) => string;
  /** `names` is the differing axes joined; `verb` agrees with their number. */
  visibility: (names: string, verb: string) => string;
  /** Decisive axes that are not recorded on both sides. */
  uncertain: (names: string, verb: string) => string;
  harmonizable: string;
  direct: string;
};

export type Domain = {
  id: DomainId;
  /** The discipline, for the picker. */
  label: string;
  /** One acquisition, in running prose: "scan", "image", "figure". */
  noun: string;
  nounPlural: string;
  /** The group being worked on: "case", "set". */
  collection: string;
  /** One line on what this profile decides comparability from. */
  premise: string;
  /** The axes, in the order they are reported. Severity first. */
  axes: AxisSpec[];
  /**
   * Facts carried and shown but never compared.
   *
   * The instrument is the clearest example: it is exactly what a
   * similarity-based system would retrieve, so it is worth showing and must
   * not be allowed to decide anything.
   */
  carried: { key: string; label: string }[];
  /** File extensions this profile is offered for, lower case, with the dot. */
  extensions: string[];
  /** The words each verdict is written in. */
  prose: Prose;
  /**
   * Whether files in this domain can carry identifiers for a person.
   *
   * True of a DICOM header. Also true of a photograph with GPS in its EXIF,
   * which is why this is a per-domain question rather than a medical one.
   */
  identityReview: boolean;
};

/* -------------------------------------------------------------------------
 * Medical imaging
 *
 * The original profile, unchanged. Its rules and its wording are reproduced
 * exactly, and `tests/imaging-comparability.test.ts` — twenty-five tests
 * written against the hard-coded engine, and left untouched by this change —
 * is what says so.
 * ---------------------------------------------------------------------- */

/** Slice thickness within this ratio counts as the same. */
export const THICKNESS_TOLERANCE = 1.5;
/** In-plane resolution within this ratio counts as the same. */
export const SPACING_TOLERANCE = 1.5;

const bothCT = (left: Facts, right: Facts) =>
  (left.modality as Fact<unknown> | undefined)?.value === "CT"
  && (right.modality as Fact<unknown> | undefined)?.value === "CT";

export const RADIOLOGY: Domain = {
  id: "radiology",
  label: "Medical imaging",
  noun: "scan",
  nounPlural: "scans",
  collection: "case",
  premise:
    "Appearance in medical imaging is dominated by acquisition rather than by "
    + "pathology: two scans of identical pathology on different protocols look "
    + "less alike than two different pathologies on the same protocol.",
  axes: [
    {
      key: "modality", label: "modality",
      options: ["CT", "MR", "PET", "SPECT", "US", "XR", "other"],
      tier: "foundational",
      match: { kind: "exact" },
      note: "Different physical quantities; no shared intensity scale.",
    },
    {
      key: "weighting", label: "sequence weighting",
      options: ["T1", "T2", "FLAIR", "DWI", "ADC", "SWI", "PD", "other"],
      tier: "visibility",
      match: { kind: "exact" },
      note: "Different sequences show different tissue; a finding may be "
          + "absent rather than fainter.",
      appliesTo: (l, r) => !bothCT(l, r),
    },
    {
      key: "contrast", label: "contrast phase",
      options: ["non-contrast", "arterial", "portal-venous", "delayed"],
      tier: "visibility",
      match: { kind: "exact" },
      note: "Enhancement depends on phase; a lesion can be invisible outside "
          + "its own phase.",
    },
    {
      key: "sliceThickness", unit: "mm", label: "slice thickness", tier: "harmonizable",
      match: { kind: "ratio", tolerance: THICKNESS_TOLERANCE },
      note: "Thicker slices average through the plane and can erase a small "
          + "finding entirely.",
      harmonization:
        "Resample to a common slice thickness — the thicker acquisition may "
        + "have averaged away detail the thinner one resolves, so resampling "
        + "can only bring the thinner one down to the thicker.",
    },
    {
      key: "pixelSpacing", unit: "mm", label: "in-plane resolution", tier: "harmonizable",
      match: { kind: "ratio", tolerance: SPACING_TOLERANCE },
      note: "Different in-plane sampling; fine detail is not equally "
          + "resolvable.",
      harmonization: "Resample to a common in-plane resolution.",
    },
    {
      key: "fieldStrength", unit: "T", label: "field strength", tier: "harmonizable",
      match: { kind: "near", epsilon: 0.2 },
      note: "Contrast and noise differ between field strengths.",
      harmonization:
        "Account for field strength — contrast and signal-to-noise differ "
        + "between field strengths even for one sequence, so intensities are "
        + "not directly comparable.",
      appliesTo: (l, r) => !bothCT(l, r),
    },
    {
      key: "orientation", label: "orientation",
      options: ["axial", "coronal", "sagittal", "oblique"],
      tier: "harmonizable",
      match: { kind: "exact" },
      note: "Different planes; corresponding structures are not in "
          + "corresponding places.",
      harmonization: "Reformat to a common plane.",
    },
  ],
  carried: [{ key: "manufacturer", label: "scanner" }],
  extensions: [".dcm", ".dicom", ".ima", ".nii", ".nii.gz"],
  identityReview: true,
  prose: {
    foundational: (left, right) =>
      `These are ${left} and ${right}. They measure different physical `
      + "quantities, so an intensity in one has no counterpart in the other. "
      + "They can be read side by side as separate evidence, but not compared.",
    visibility: (names, verb) =>
      `The ${names} ${verb}. That decides what is visible rather than how it `
      + "looks: a finding present in one acquisition can be genuinely absent "
      + "from the other, so a difference between these images cannot be read "
      + "as a difference in the subject.",
    uncertain: (names, verb) =>
      `Nothing here says these differ, but the ${names} ${verb} not recorded `
      + "for both scans. They may be comparable; this cannot say so, and "
      + "silence is not agreement.",
    harmonizable:
      "These measure the same quantity under the same sequence and contrast, "
      + "so they can be compared once the differences in geometry or field "
      + "strength are corrected for.",
    direct:
      "Same modality, sequence, contrast phase and geometry, within tolerance. "
      + "Differences between these images can be read as differences in the "
      + "subject.",
  },
};

/* -------------------------------------------------------------------------
 * Microscopy
 *
 * The tiers map onto microscopy more sharply than onto radiology, which is
 * the argument for having written the engine this way rather than around
 * modality. Technique is foundational for the same reason modality is:
 * brightfield measures absorbance, fluorescence measures emission from a
 * label, and an electron micrograph measures scattering — three different
 * physical quantities, and an intensity in one says nothing about an intensity
 * in another.
 *
 * The channel is the clearest `visibility` axis anywhere in this file. A
 * structure that carries no label in the channel imaged is *absent from the
 * image*, not dim. Comparing a DAPI channel with a GFP channel and reading the
 * difference as biology is the microscopy version of the error this whole
 * screen exists to prevent.
 * ---------------------------------------------------------------------- */

/** Micrometres per pixel within this ratio counts as the same sampling. */
export const PIXEL_SIZE_TOLERANCE = 1.5;

export const MICROSCOPY: Domain = {
  id: "microscopy",
  label: "Microscopy",
  noun: "image",
  nounPlural: "images",
  collection: "set",
  premise:
    "Appearance down a microscope is dominated by preparation and optics "
    + "rather than by the specimen: exposure, objective, illumination and "
    + "stain move a field of cells further than the biology usually does.",
  axes: [
    {
      key: "technique", label: "imaging technique", tier: "foundational",
      options: ["brightfield", "phase contrast", "DIC", "widefield",
                "confocal", "two-photon", "TIRF", "structured illumination",
                "super-resolution", "SEM", "TEM", "AFM"],
      match: { kind: "exact" },
      note: "Different physical quantities — absorbance, emission and electron "
          + "scattering share no intensity scale.",
    },
    {
      key: "channel", label: "channel or stain", tier: "visibility",
      match: { kind: "text" },
      note: "A structure carrying no label in this channel is absent from the "
          + "image rather than faint.",
    },
    {
      key: "preparation", label: "preparation",
      options: ["live", "fixed", "fixed and permeabilised", "cleared",
                "sectioned", "whole-mount"],
      tier: "visibility",
      match: { kind: "exact" },
      note: "Fixation, clearing and sectioning change what is present to be "
          + "imaged, not merely how it looks.",
    },
    {
      key: "pixelSize", unit: "µm", label: "pixel size", tier: "harmonizable",
      match: { kind: "ratio", tolerance: PIXEL_SIZE_TOLERANCE },
      note: "Different sampling in micrometres per pixel; fine structure is "
          + "not equally resolvable.",
      harmonization:
        "Resample to a common pixel size — the coarser image cannot be given "
        + "detail it never sampled, so resampling can only bring the finer one "
        + "down to the coarser.",
    },
    {
      key: "numericalAperture", label: "numerical aperture",
      tier: "harmonizable", match: { kind: "near", epsilon: 0.05 },
      note: "Numerical aperture sets the resolution actually achieved, whatever "
          + "the magnification says.",
      harmonization:
        "Account for numerical aperture — matching magnification does not "
        + "match resolving power, and the lower-NA image is the limit.",
    },
    {
      key: "exposure", unit: "ms", label: "exposure", tier: "harmonizable",
      match: { kind: "ratio", tolerance: 1.25 },
      note: "Intensities scale with exposure and gain, so brightness cannot be "
          + "read as abundance across these.",
      harmonization:
        "Normalise for exposure and gain before comparing intensities, or "
        + "compare only within one image.",
    },
  ],
  carried: [
    { key: "instrument", label: "microscope" },
    { key: "objective", label: "objective" },
  ],
  extensions: [".tif", ".tiff", ".ome.tif", ".ome.tiff"],
  identityReview: false,
  prose: {
    foundational: (left, right) =>
      `These are ${left} and ${right}. They measure different physical `
      + "quantities, so an intensity in one has no counterpart in the other. "
      + "They can be read side by side as separate evidence, but not compared.",
    visibility: (names, verb) =>
      `The ${names} ${verb}. That decides what is present in the image rather `
      + "than how it looks: a structure can be genuinely unlabelled in one and "
      + "labelled in the other, so a difference between these images cannot be "
      + "read as a difference in the specimen.",
    uncertain: (names, verb) =>
      `Nothing here says these differ, but the ${names} ${verb} not recorded `
      + "for both images. They may be comparable; this cannot say so, and "
      + "silence is not agreement.",
    harmonizable:
      "These image the same quantity in the same channel and preparation, so "
      + "they can be compared once the differences in sampling, aperture or "
      + "exposure are corrected for.",
    direct:
      "Same technique, channel, preparation and optics, within tolerance. "
      + "Differences between these images can be read as differences in the "
      + "specimen.",
  },
};

/* -------------------------------------------------------------------------
 * General images
 *
 * The fallback, and deliberately a thin one. A gel, a plate, a specimen
 * photograph and a field image share almost no metadata, so this profile
 * claims very little — which is the point. A profile that invented axes it
 * could not read would produce confident verdicts out of nothing.
 * ---------------------------------------------------------------------- */

export const IMAGE: Domain = {
  id: "image",
  label: "Photographs and general images",
  noun: "image",
  nounPlural: "images",
  collection: "set",
  premise:
    "What a photograph shows is dominated by how it was lit and captured. Two "
    + "images of one specimen under different illumination differ more than two "
    + "specimens under the same illumination.",
  axes: [
    {
      key: "technique", label: "capture method", tier: "foundational",
      options: ["reflected light", "transmitted light", "scanned",
                "radiograph", "thermal", "fluorescence"],
      match: { kind: "exact" },
      note: "Different capture methods record different quantities and share "
          + "no intensity scale.",
    },
    {
      key: "illumination", label: "illumination",
      options: ["white light", "ultraviolet", "blue", "green", "red",
                "infrared", "polarised"],
      tier: "visibility",
      match: { kind: "exact" },
      note: "Illumination and filtering decide what is rendered at all — a band "
          + "not lit is absent rather than dark.",
    },
    {
      key: "scale", unit: "units/px", label: "scale", tier: "harmonizable",
      match: { kind: "ratio", tolerance: 1.5 },
      note: "Different units per pixel; sizes measured off these images are "
          + "not on one scale.",
      harmonization:
        "Establish a common scale from a scale bar or a known reference in "
        + "each image before measuring anything from them.",
    },
    {
      key: "bitDepth", label: "bit depth", tier: "harmonizable",
      match: { kind: "exact" },
      note: "Different quantisation; an eight-bit image has already discarded "
          + "distinctions a sixteen-bit one retains.",
      harmonization:
        "Compare at the lower bit depth — the coarser image cannot recover "
        + "levels it never stored.",
    },
    {
      key: "exposure", unit: "ms", label: "exposure", tier: "harmonizable",
      match: { kind: "ratio", tolerance: 1.25 },
      note: "Intensities scale with exposure, so brightness cannot be read as "
          + "a property of the subject across these.",
      harmonization:
        "Normalise for exposure, or compare only within one image.",
    },
  ],
  carried: [{ key: "instrument", label: "camera" }],
  extensions: [".png", ".jpg", ".jpeg", ".webp", ".bmp"],
  /*
   * True, and not because of medicine: a photograph's EXIF routinely carries
   * the coordinates it was taken at, which identifies a collection site or a
   * home as surely as a name does.
   */
  identityReview: true,
  prose: {
    foundational: (left, right) =>
      `These are ${left} and ${right}. They record different quantities, so a `
      + "value in one has no counterpart in the other. They can be read side by "
      + "side as separate evidence, but not compared.",
    visibility: (names, verb) =>
      `The ${names} ${verb}. That decides what is rendered rather than how it `
      + "looks: a feature can be genuinely absent from one image, so a "
      + "difference between these cannot be read as a difference in the subject.",
    uncertain: (names, verb) =>
      `Nothing here says these differ, but the ${names} ${verb} not recorded `
      + "for both images. They may be comparable; this cannot say so, and "
      + "silence is not agreement.",
    harmonizable:
      "These were captured the same way under the same illumination, so they "
      + "can be compared once the differences in scale, depth or exposure are "
      + "corrected for.",
    direct:
      "Same capture method, illumination and scale, within tolerance. "
      + "Differences between these images can be read as differences in the "
      + "subject.",
  },
};

/* -------------------------------------------------------------------------
 * Plotted figures
 *
 * Comparing two published charts is a real research act — the reader wants to
 * know whether the second paper's effect is the first paper's effect — and it
 * is the one most often done by eye, wrongly. The axes below are the
 * conflations that do the damage: a log axis read against a linear one, a
 * percent-of-control read against a raw value, and standard error read as
 * though it were standard deviation, which understates spread by root n and is
 * conflated constantly.
 * ---------------------------------------------------------------------- */

export const FIGURE: Domain = {
  id: "figure",
  label: "Plotted figures",
  noun: "figure",
  nounPlural: "figures",
  collection: "set",
  premise:
    "What a chart appears to show is dominated by how it was drawn. One dataset "
    + "on a log axis and on a linear axis makes two different claims, and "
    + "neither is about the data.",
  axes: [
    {
      key: "quantity", label: "plotted quantity", tier: "foundational",
      match: { kind: "text" },
      note: "Different quantities are not two measurements of one thing.",
    },
    {
      key: "normalization", label: "normalisation",
      options: ["raw", "percent of control", "fold change", "z-score",
                "normalised to total"],
      tier: "visibility",
      match: { kind: "exact" },
      note: "A percent-of-control and a raw value are different claims; one "
          + "can rise while the other falls.",
    },
    {
      key: "yScale", label: "value-axis scale",
      options: ["linear", "log", "log2", "log10", "symlog"],
      tier: "visibility",
      match: { kind: "exact" },
      note: "A log axis and a linear axis make differently-shaped claims out of "
          + "one dataset.",
    },
    {
      key: "units", label: "units", tier: "harmonizable",
      match: { kind: "text" },
      note: "Different units; the numbers are not on one scale.",
      harmonization: "Convert to common units before reading the values across.",
    },
    {
      key: "errorBars", label: "error convention",
      options: ["SD", "SEM", "95% CI", "range", "IQR", "none"],
      tier: "harmonizable",
      match: { kind: "exact" },
      note: "Standard error, standard deviation and a confidence interval are "
          + "different widths of the same data — the first is smaller by root n.",
      harmonization:
        "Restate both on one convention. That needs the sample size, so a "
        + "figure that does not report n cannot be converted at all.",
    },
    {
      key: "binning", label: "binning", tier: "harmonizable",
      match: { kind: "ratio", tolerance: 1.5 },
      note: "Bin width decides the shape of a histogram more than the data "
          + "often does.",
      harmonization: "Re-bin to a common width from the underlying values.",
    },
  ],
  carried: [{ key: "source", label: "source" }],
  extensions: [],
  identityReview: false,
  prose: {
    foundational: (left, right) =>
      `These plot ${left} and ${right}. They are not two measurements of one `
      + "quantity, so a value in one has no counterpart in the other. They can "
      + "be read side by side as separate evidence, but not compared.",
    visibility: (names, verb) =>
      `The ${names} ${verb}. That decides what the chart claims rather than how `
      + "it looks: the same data drawn both ways would differ here, so a "
      + "difference between these figures cannot be read as a difference in the "
      + "underlying result.",
    uncertain: (names, verb) =>
      `Nothing here says these differ, but the ${names} ${verb} not recorded `
      + "for both figures. They may be comparable; this cannot say so, and "
      + "silence is not agreement.",
    harmonizable:
      "These plot the same quantity on the same normalisation and axis scale, "
      + "so they can be compared once the units, error convention or binning "
      + "are put on one footing.",
    direct:
      "Same quantity, normalisation, axis scale and units. Differences between "
      + "these figures can be read as differences in the result.",
  },
};

/** Every profile, in the order they are offered. */
export const DOMAINS: Domain[] = [RADIOLOGY, MICROSCOPY, IMAGE, FIGURE];

/** The profile for an id. Falls back to general images rather than to medicine. */
export function domainOf(id: DomainId | undefined): Domain {
  return DOMAINS.find((d) => d.id === id) ?? IMAGE;
}

/**
 * Every extension any profile claims, for a file picker's `accept`.
 *
 * There was a `domainForFile` here that mapped a filename to a discipline. It
 * is gone, and its absence is deliberate: it was dead — nothing called it — and
 * while it existed it invited exactly one mistake, which was duly made. The
 * ingest consulted it before the researcher's own choice, every `.png` is
 * claimed by the general-image profile, and the discipline picker was silently
 * inert. An extension says what a file *is*; it cannot say what it is *of*, and
 * a helper shaped like an answer to the second question will keep being used as
 * one.
 */
export function acceptedExtensions(): string[] {
  return DOMAINS.flatMap((d) => d.extensions);
}
