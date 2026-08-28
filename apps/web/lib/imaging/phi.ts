/**
 * What in a scan identifies a person, and what may be written down.
 *
 * Local-first is not the same as safe. A case that never leaves the machine can
 * still have a patient's name copied out of a DICOM header and into the
 * research record — and from there into every export, every backup archive and
 * every figure caption the project ever produces. The file staying put does not
 * help once the identifier has been transcribed out of it.
 *
 * So this file draws one line: **acquisition facts may be recorded, identifiers
 * may not.** Modality, sequence, slice thickness and contrast phase are what
 * comparability is decided on and none of them identifies anybody. Names,
 * medical record numbers, accession numbers and dates of birth decide nothing
 * about comparability and are therefore never worth the risk of storing.
 *
 * **What this is not.** It is not de-identification. It does not rewrite files,
 * it does not touch pixels, and it cannot certify that anything is anonymous —
 * a claim no code that has not inspected the pixels is entitled to make. It
 * reports what it can see and refuses to record what it should not, which is a
 * smaller promise honestly kept rather than a large one that is not.
 */

/** How dangerous a field is to keep. */
export type Sensitivity =
  /** Names a person outright. Never recorded. */
  | "direct"
  /** Re-identifies in combination — a date, a site, an age over 89. */
  | "quasi"
  /** Describes the acquisition. Safe, and the only kind comparability needs. */
  | "acquisition";

/**
 * The DICOM fields this understands, by the name a reader would recognise.
 *
 * Deliberately a *listing of what is safe*, not a listing of what is dangerous.
 * A denylist is wrong for this job in a way that matters: DICOM has thousands
 * of tags plus private vendor blocks, and anything the list has not met would
 * default to safe. Here anything unrecognised defaults to `quasi` — assumed
 * risky until someone has thought about it.
 */
export const KNOWN_FIELDS: Record<string, Sensitivity> = {
  // Identifiers.
  PatientName: "direct",
  PatientID: "direct",
  PatientBirthDate: "direct",
  OtherPatientIDs: "direct",
  PatientAddress: "direct",
  PatientTelephoneNumbers: "direct",
  AccessionNumber: "direct",
  ReferringPhysicianName: "direct",
  PerformingPhysicianName: "direct",
  OperatorsName: "direct",
  StudyID: "direct",
  // Re-identifying in combination.
  StudyDate: "quasi",
  SeriesDate: "quasi",
  AcquisitionDate: "quasi",
  StudyTime: "quasi",
  InstitutionName: "quasi",
  InstitutionAddress: "quasi",
  StationName: "quasi",
  DeviceSerialNumber: "quasi",
  PatientAge: "quasi",
  PatientSex: "quasi",
  PatientWeight: "quasi",
  StudyDescription: "quasi",
  SeriesDescription: "quasi",
  // Acquisition — what comparability is actually decided on.
  Modality: "acquisition",
  SequenceName: "acquisition",
  ScanningSequence: "acquisition",
  SequenceVariant: "acquisition",
  ContrastBolusAgent: "acquisition",
  SliceThickness: "acquisition",
  PixelSpacing: "acquisition",
  SpacingBetweenSlices: "acquisition",
  MagneticFieldStrength: "acquisition",
  Manufacturer: "acquisition",
  ManufacturerModelName: "acquisition",
  ImageOrientationPatient: "acquisition",
  RepetitionTime: "acquisition",
  EchoTime: "acquisition",
  ConvolutionKernel: "acquisition",
  KVP: "acquisition",
  Rows: "acquisition",
  Columns: "acquisition",
  BurnedInAnnotation: "acquisition",
};

/**
 * How to treat a field nobody has classified.
 *
 * `quasi`, never `acquisition`. DICOM has thousands of standard tags and
 * unbounded private vendor blocks, so the unrecognised case is the common case
 * — and a default of "safe" would quietly wave through the one private tag that
 * happens to hold a hospital's internal patient number.
 */
export function sensitivityOf(field: string): Sensitivity {
  return KNOWN_FIELDS[field] ?? "quasi";
}

export type Review = {
  /** Fields naming a person outright. */
  direct: string[];
  /** Fields that re-identify in combination, or that nobody has classified. */
  quasi: string[];
  /** Fields safe to record, because they describe the acquisition. */
  acquisition: string[];
  /**
   * Whether the header itself admits to text burned into the pixels.
   *
   * `true` is a fact. `false` is *not* a clearance — the tag is frequently
   * absent, wrong, or simply not set by the device, and ultrasound and screen
   * captures carry burned-in identifiers routinely.
   */
  burnedInDeclared: boolean;
};

/** Sort a header's fields by what they are, without keeping their values. */
export function review(headers: Record<string, unknown>): Review {
  const out: Review = {
    direct: [], quasi: [], acquisition: [], burnedInDeclared: false,
  };
  for (const field of Object.keys(headers)) {
    const where = sensitivityOf(field);
    if (where === "direct") out.direct.push(field);
    else if (where === "quasi") out.quasi.push(field);
    else out.acquisition.push(field);
  }
  const burned = headers.BurnedInAnnotation;
  out.burnedInDeclared =
    typeof burned === "string" && burned.trim().toUpperCase() === "YES";
  return out;
}

/**
 * The subset of a header that may be written into the research record.
 *
 * Acquisition fields only, and the values are copied rather than referenced so
 * a caller cannot hand the whole header onward by keeping a pointer into it.
 */
export function recordable(headers: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(headers)) {
    if (sensitivityOf(field) !== "acquisition") continue;
    safe[field] = value;
  }
  return safe;
}

/**
 * What a reader must be told before working with this case.
 *
 * Written to be read by someone who is about to put a scan on screen beside
 * others, and phrased so the limits are as visible as the findings. In
 * particular it never says a scan is anonymous.
 */
export function describeReview(review: Review): string {
  const parts: string[] = [];

  if (review.direct.length > 0) {
    parts.push(
      `${review.direct.length} field${review.direct.length === 1 ? "" : "s"} `
      + `identify the patient directly (${review.direct.slice(0, 3).join(", ")}`
      + `${review.direct.length > 3 ? ", …" : ""}). These are read for display `
      + "and never written into the project.");
  }
  if (review.quasi.length > 0) {
    parts.push(
      `${review.quasi.length} could re-identify in combination — dates, site, `
      + "device, or fields this does not recognise. Also not written down.");
  }
  if (review.acquisition.length > 0) {
    parts.push(
      `${review.acquisition.length} describe the acquisition and are what `
      + "comparability is decided on. Only these are recorded.");
  }

  parts.push(review.burnedInDeclared
    ? "**The header says text is burned into the pixels.** Nothing here can "
      + "remove it, and the image cannot be shared as it stands."
    : "The header does not declare burned-in text, which is not the same as "
      + "there being none — the tag is often unset, and ultrasound and screen "
      + "captures carry identifiers in the pixels routinely. Nothing here has "
      + "looked at the pixels.");

  return parts.join(" ");
}

/**
 * Whether this case may be sent anywhere off the machine.
 *
 * The answer is always no, and the function exists so that the answer is
 * something code has to ask rather than something a reviewer has to notice.
 * A hosted model, a crash reporter, an analytics call or a "share" button
 * reaches for image data by writing the call, not by intending harm.
 */
export function mayLeaveTheMachine(): false {
  return false;
}
