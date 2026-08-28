/**
 * What a scan is, for the purpose of deciding whether two may be compared.
 *
 * A medical researcher who has received a case and wants to hold it beside
 * other images is asking a comparability question, not a similarity one — and
 * those come apart badly in imaging. Appearance is dominated by *acquisition*
 * rather than by pathology: the manufacturer, the field strength, the sequence
 * and its weighting, the contrast phase, the slice thickness, the
 * reconstruction kernel and the window. Two scans of identical pathology on
 * different protocols look less alike than two different pathologies on the
 * same protocol.
 *
 * That is why this file describes acquisitions rather than pixels. A system
 * that ranked images by how alike they look would mostly retrieve *the same
 * scanner*, and would do it convincingly — a grid of visually similar images
 * is extremely persuasive, and being persuasive while wrong is the failure this
 * whole project is arranged against.
 *
 * **Every fact records where it came from.** A modality read out of a DICOM
 * header and a modality somebody typed into a box are not the same evidence,
 * and a comparability verdict resting on the second is weaker than one resting
 * on the first. Carrying the provenance on each field is what lets the verdict
 * say so instead of presenting both with equal confidence.
 */

/** Where a single fact about a scan came from. */
export type Origin =
  /** Read from the file's own header. The strongest case. */
  | "header"
  /** Entered by a person. True as often as people are, which is not always. */
  | "declared"
  /** Not known. Never guessed, and never quietly treated as a match. */
  | "unknown";

/** One fact about an acquisition, with the evidence behind it. */
export type Fact<T> = { value: T | null; origin: Origin };

export const unknown = <T,>(): Fact<T> => ({ value: null, origin: "unknown" });
export const fromHeader = <T,>(value: T): Fact<T> => ({ value, origin: "header" });
export const declared = <T,>(value: T): Fact<T> => ({ value, origin: "declared" });

/**
 * The modality. Deliberately a closed list.
 *
 * An open string would let "MR" and "MRI" and "mri" describe one thing and
 * compare as three, which turns a comparability engine into a spell-checker.
 */
export type Modality = "CT" | "MR" | "PET" | "SPECT" | "US" | "XR" | "other";

/** How an MR sequence is weighted. Meaningless for CT, and absent there. */
export type Weighting =
  | "T1" | "T2" | "FLAIR" | "DWI" | "ADC" | "SWI" | "PD" | "other";

/** Where in the contrast bolus the scan sits. */
export type ContrastPhase =
  | "non-contrast" | "arterial" | "portal-venous" | "delayed" | "unknown-phase";

export type Study = {
  /** A local identifier. Never a patient identifier — see `phi.ts`. */
  id: string;
  /** What to call it on screen. The researcher's own label. */
  label: string;

  modality: Fact<Modality>;
  /** MR weighting, or the tracer for PET. Absent on CT by nature. */
  weighting: Fact<Weighting>;
  contrast: Fact<ContrastPhase>;
  /** Millimetres between slices. The axis most often quietly incomparable. */
  sliceThickness: Fact<number>;
  /** In-plane millimetres per pixel. */
  pixelSpacing: Fact<number>;
  /** Tesla, for MR. A 1.5T and a 3T image of one lesion differ visibly. */
  fieldStrength: Fact<number>;
  /** The scanner. Carried because it is the thing naive similarity retrieves. */
  manufacturer: Fact<string>;
  /** Which way the slices run. */
  orientation: Fact<"axial" | "coronal" | "sagittal" | "oblique">;
};

/** A study with nothing known about it, for a file whose header was unreadable. */
export function blankStudy(id: string, label: string): Study {
  return {
    id, label,
    modality: unknown(), weighting: unknown(), contrast: unknown(),
    sliceThickness: unknown(), pixelSpacing: unknown(),
    fieldStrength: unknown(), manufacturer: unknown(), orientation: unknown(),
  };
}

/** The axes a comparison is decided on, in the order they are reported. */
export const AXES = [
  "modality", "weighting", "contrast", "sliceThickness", "pixelSpacing",
  "fieldStrength", "orientation",
] as const;

export type Axis = typeof AXES[number];

/** A human name for an axis, for the panel and for the refusal text. */
export const AXIS_LABEL: Record<Axis, string> = {
  modality: "modality",
  weighting: "sequence weighting",
  contrast: "contrast phase",
  sliceThickness: "slice thickness",
  pixelSpacing: "in-plane resolution",
  fieldStrength: "field strength",
  orientation: "orientation",
};

/**
 * How much of what matters is actually known, 0..1.
 *
 * Reported rather than folded into the verdict, because "these are comparable"
 * and "we cannot tell whether these are comparable" are different answers and
 * a single number would blur them. Header facts count full; declared facts
 * count less, because a typed value is a claim rather than a measurement.
 */
export function evidenceStrength(study: Study): number {
  let score = 0;
  for (const axis of AXES) {
    const fact = study[axis] as Fact<unknown>;
    if (fact.origin === "header") score += 1;
    else if (fact.origin === "declared") score += 0.5;
  }
  return score / AXES.length;
}
