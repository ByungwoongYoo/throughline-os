/**
 * Whether two scans may be held beside each other, and why not.
 *
 * The image analogue of `CompatibilityAssessment` in the model schemas, and
 * deliberately the same five verdicts: a refusal is a legitimate answer, and an
 * engine that always finds a way to compare two things is worse than none,
 * because it manufactures relationships between objects that do not share a
 * measurement.
 *
 * **This is arithmetic, not a model.** Every verdict here is decided by
 * comparing recorded acquisition facts, so it is identical on every machine,
 * reproducible, and explainable line by line. Nothing about a comparability
 * judgement needs prose, and prose is exactly where a plausible-sounding wrong
 * answer would come from.
 *
 * **It runs in the browser and reads no pixels.** The case never leaves the
 * researcher's machine. It also never needs to: comparability is a property of
 * how two scans were acquired, not of what they show.
 *
 * **What this deliberately does not do: rank.** No "most similar case", no
 * ordered differential, no likelihood. Those turn a comparability tool into
 * decision support, which is a different product with a different regulatory
 * standing. What the researcher gets is a partition — comparable, comparable
 * after harmonisation, or not — and the reasons.
 */

import {
  AXES, AXIS_LABEL, Axis, Fact, Study, evidenceStrength,
} from "./study";

/** The same five the data-comparison engine uses. */
export type Verdict =
  | "DIRECTLY_COMPARABLE"
  | "COMPARABLE_AFTER_HARMONIZATION"
  | "CONCEPTUALLY_COMPARABLE"
  | "RELATED_BUT_NOT_COMPARABLE"
  | "NOT_MEANINGFULLY_COMPARABLE";

export type AxisFinding = {
  axis: Axis;
  /** How the two sides stand on this axis. */
  agreement: "agree" | "differ" | "not_stated";
  left: string;
  right: string;
  /** Why this difference matters, when it does. */
  note: string;
};

export type Assessment = {
  verdict: Verdict;
  reasoning: string;
  findings: AxisFinding[];
  /** Axes that agree, named for the panel. */
  shared: Axis[];
  /** Differences that prevent comparison outright. */
  blocking: Axis[];
  /** Differences a researcher could correct for, and what would be needed. */
  harmonization: string[];
  /**
   * How much of the decision rested on facts actually read from the files.
   *
   * Not folded into the verdict: "comparable" and "we cannot tell" are
   * different answers, and one number would blur them.
   */
  evidence: number;
};

/**
 * Slice thickness within this ratio counts as the same.
 *
 * A 1 mm and a 1.25 mm acquisition are routinely read together; 1 mm against
 * 5 mm are not, because partial-volume averaging at 5 mm can erase a lesion
 * that 1 mm resolves — the difference is not resolution but whether the finding
 * is present at all.
 */
export const THICKNESS_TOLERANCE = 1.5;

/** In-plane resolution within this ratio counts as the same. */
export const SPACING_TOLERANCE = 1.5;

/**
 * Decide whether two scans may be compared.
 *
 * The order of the checks is the argument: modality first, because nothing
 * survives its mismatch; then the axes that change what is visible; then the
 * ones that change how it looks.
 */
export function assess(left: Study, right: Study): Assessment {
  const findings: AxisFinding[] = [];
  const shared: Axis[] = [];
  const blocking: Axis[] = [];
  const harmonization: string[] = [];

  for (const axis of AXES) {
    const finding = compareAxis(axis, left, right);
    if (!finding) continue;
    findings.push(finding);
    if (finding.agreement === "agree") shared.push(axis);
  }

  const differs = (axis: Axis) =>
    findings.some((f) => f.axis === axis && f.agreement === "differ");
  const unstated = (axis: Axis) =>
    findings.some((f) => f.axis === axis && f.agreement === "not_stated");

  /*
   * Modality is the one axis with no harmonisation. A CT and an MR of the same
   * region measure different physical quantities — attenuation against proton
   * behaviour — so an intensity in one has no counterpart in the other. Anything
   * else this function might say is beside the point once these differ.
   */
  if (differs("modality")) {
    blocking.push("modality");
    return {
      verdict: "NOT_MEANINGFULLY_COMPARABLE",
      reasoning:
        `These are ${text(left.modality)} and ${text(right.modality)}. They `
        + "measure different physical quantities, so an intensity in one has no "
        + "counterpart in the other. They can be read side by side as separate "
        + "evidence, but not compared.",
      findings, shared, blocking, harmonization,
      evidence: Math.min(evidenceStrength(left), evidenceStrength(right)),
    };
  }

  /*
   * Weighting and contrast phase decide *what is visible at all*, which is a
   * stronger objection than any difference of degree. A lesion that enhances
   * only in the portal-venous phase is absent from a non-contrast scan — not
   * fainter, absent — so comparing the two would read an acquisition choice as
   * a finding.
   */
  for (const axis of ["weighting", "contrast"] as const) {
    if (differs(axis)) blocking.push(axis);
  }

  if (blocking.length > 0) {
    const names = blocking.map((a) => AXIS_LABEL[a]).join(" and ");
    const verb = blocking.length === 1 ? "differs" : "differ";
    return {
      verdict: "RELATED_BUT_NOT_COMPARABLE",
      reasoning:
        `The ${names} ${verb}. That decides what is visible rather than how it `
        + "looks: a finding present in one acquisition can be genuinely absent "
        + "from the other, so a difference between these images cannot be read "
        + "as a difference in the subject.",
      findings, shared, blocking, harmonization,
      evidence: Math.min(evidenceStrength(left), evidenceStrength(right)),
    };
  }

  /*
   * Geometry and field strength change how the same thing looks. They are real
   * obstacles and they are correctable, which is what separates this verdict
   * from the one above.
   */
  if (differs("sliceThickness")) {
    harmonization.push(
      "Resample to a common slice thickness — the thicker acquisition may have "
      + "averaged away detail the thinner one resolves, so resampling can only "
      + "bring the thinner one down to the thicker.");
  }
  if (differs("pixelSpacing")) {
    harmonization.push("Resample to a common in-plane resolution.");
  }
  if (differs("fieldStrength")) {
    harmonization.push(
      "Account for field strength — contrast and signal-to-noise differ "
      + "between field strengths even for one sequence, so intensities are not "
      + "directly comparable.");
  }
  if (differs("orientation")) {
    harmonization.push("Reformat to a common plane.");
  }

  /*
   * Nothing known is not the same as nothing wrong. A pair of scans whose
   * headers were unreadable will show no differences, and reporting that as
   * "directly comparable" would turn absence of evidence into evidence of
   * agreement — the exact inversion this system exists to prevent.
   */
  const decisive = ["modality", "weighting", "contrast"] as const;
  const unknownDecisive = decisive.filter((a) => unstated(a));
  if (unknownDecisive.length > 0) {
    return {
      verdict: "CONCEPTUALLY_COMPARABLE",
      reasoning:
        `Nothing here says these differ, but the ${unknownDecisive
          .map((a) => AXIS_LABEL[a]).join(" and ")} `
        + `${unknownDecisive.length === 1 ? "is" : "are"} not recorded for both `
        + "scans. They may be comparable; this cannot say so, and silence is "
        + "not agreement.",
      findings, shared, blocking, harmonization,
      evidence: Math.min(evidenceStrength(left), evidenceStrength(right)),
    };
  }

  if (harmonization.length > 0) {
    return {
      verdict: "COMPARABLE_AFTER_HARMONIZATION",
      reasoning:
        "These measure the same quantity under the same sequence and contrast, "
        + "so they can be compared once the differences in geometry or field "
        + "strength are corrected for.",
      findings, shared, blocking, harmonization,
      evidence: Math.min(evidenceStrength(left), evidenceStrength(right)),
    };
  }

  return {
    verdict: "DIRECTLY_COMPARABLE",
    reasoning:
      "Same modality, sequence, contrast phase and geometry, within tolerance. "
      + "Differences between these images can be read as differences in the "
      + "subject.",
    findings, shared, blocking, harmonization,
    evidence: Math.min(evidenceStrength(left), evidenceStrength(right)),
  };
}

/** One axis, compared. Returns null for an axis that does not apply. */
function compareAxis(axis: Axis, left: Study, right: Study): AxisFinding | null {
  const a = left[axis] as Fact<unknown>;
  const b = right[axis] as Fact<unknown>;

  /*
   * Weighting and field strength are properties of MR. Reporting "not stated"
   * for a pair of CTs would fill the panel with objections that are categories
   * rather than problems, and a panel of irrelevant objections teaches the
   * reader to skim past the real ones.
   */
  if ((axis === "weighting" || axis === "fieldStrength")
      && left.modality.value === "CT" && right.modality.value === "CT") {
    return null;
  }

  if (a.value === null || b.value === null) {
    return { axis, agreement: "not_stated", left: text(a), right: text(b),
             note: "Not recorded on both scans." };
  }

  const same = agrees(axis, a.value, b.value);
  return {
    axis,
    agreement: same ? "agree" : "differ",
    left: text(a),
    right: text(b),
    note: same ? "" : noteFor(axis),
  };
}

function agrees(axis: Axis, a: unknown, b: unknown): boolean {
  if (axis === "sliceThickness" || axis === "pixelSpacing") {
    const x = Number(a), y = Number(b);
    if (!(x > 0) || !(y > 0)) return false;
    const tolerance = axis === "sliceThickness"
      ? THICKNESS_TOLERANCE : SPACING_TOLERANCE;
    // A ratio, not a difference: 1 mm against 2 mm matters, 4 mm against 5 mm
    // much less, and an absolute threshold cannot express both.
    return Math.max(x, y) / Math.min(x, y) <= tolerance;
  }
  if (axis === "fieldStrength") {
    // Field strengths are nominal — 1.5 and 3 — so near equality is equality.
    return Math.abs(Number(a) - Number(b)) < 0.2;
  }
  return a === b;
}

function noteFor(axis: Axis): string {
  switch (axis) {
    case "modality":
      return "Different physical quantities; no shared intensity scale.";
    case "weighting":
      return "Different sequences show different tissue; a finding may be "
           + "absent rather than fainter.";
    case "contrast":
      return "Enhancement depends on phase; a lesion can be invisible outside "
           + "its own phase.";
    case "sliceThickness":
      return "Thicker slices average through the plane and can erase a small "
           + "finding entirely.";
    case "pixelSpacing":
      return "Different in-plane sampling; fine detail is not equally "
           + "resolvable.";
    case "fieldStrength":
      return "Contrast and noise differ between field strengths.";
    case "orientation":
      return "Different planes; corresponding structures are not in "
           + "corresponding places.";
  }
}

/** A fact as words, marking anything that was typed rather than measured. */
export function text(fact: Fact<unknown>): string {
  if (fact.value === null) return "not recorded";
  return fact.origin === "declared"
    ? `${String(fact.value)} (stated, not read from the file)`
    : String(fact.value);
}

/** Whether a verdict permits the researcher to read differences as findings. */
export function permitsComparison(verdict: Verdict): boolean {
  return verdict === "DIRECTLY_COMPARABLE"
      || verdict === "COMPARABLE_AFTER_HARMONIZATION";
}

/**
 * Partition a set of scans against one case.
 *
 * A partition, never an ordering. Ranking by closeness is what turns this into
 * a differential diagnosis, which is a different product with a different
 * standing — and the ordering would be dominated by acquisition anyway, so the
 * top of the list would be the scans taken on the same machine.
 */
export function partition(caseStudy: Study, others: Study[]) {
  const groups = {
    comparable: [] as Array<{ study: Study; assessment: Assessment }>,
    afterHarmonization: [] as Array<{ study: Study; assessment: Assessment }>,
    uncertain: [] as Array<{ study: Study; assessment: Assessment }>,
    refused: [] as Array<{ study: Study; assessment: Assessment }>,
  };

  for (const study of others) {
    const assessment = assess(caseStudy, study);
    const entry = { study, assessment };
    switch (assessment.verdict) {
      case "DIRECTLY_COMPARABLE": groups.comparable.push(entry); break;
      case "COMPARABLE_AFTER_HARMONIZATION":
        groups.afterHarmonization.push(entry); break;
      case "CONCEPTUALLY_COMPARABLE": groups.uncertain.push(entry); break;
      default: groups.refused.push(entry);
    }
  }
  return groups;
}

/** What the partition says about itself, in words a reader can act on. */
export function describePartition(
  groups: ReturnType<typeof partition>): string {
  const total = groups.comparable.length + groups.afterHarmonization.length
              + groups.uncertain.length + groups.refused.length;
  if (total === 0) return "Nothing to compare against this case yet.";

  const parts: string[] = [];
  if (groups.comparable.length > 0) {
    parts.push(`${groups.comparable.length} can be compared directly`);
  }
  if (groups.afterHarmonization.length > 0) {
    parts.push(`${groups.afterHarmonization.length} after harmonisation`);
  }
  if (groups.uncertain.length > 0) {
    parts.push(`${groups.uncertain.length} cannot be judged, because the `
             + "acquisition is not recorded");
  }
  if (groups.refused.length > 0) {
    parts.push(`${groups.refused.length} cannot be compared with this case`);
  }
  return `${total} scan${total === 1 ? "" : "s"} against this case: `
       + `${parts.join("; ")}.`;
}
