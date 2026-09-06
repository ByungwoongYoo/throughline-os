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
  Acquisition, Axis, Fact, evidenceStrength,
} from "./study";
import { AxisSpec, Domain, Match, domainOf } from "./domain";

/*
 * Re-exported from their profile so a caller asking "what counts as the same
 * thickness" has one place to import from, and so the profile stays the only
 * definition.
 */
export { SPACING_TOLERANCE, THICKNESS_TOLERANCE } from "./domain";

/** The same five the data-comparison engine uses. */
export type Verdict =
  | "DIRECTLY_COMPARABLE"
  | "COMPARABLE_AFTER_HARMONIZATION"
  | "CONCEPTUALLY_COMPARABLE"
  | "RELATED_BUT_NOT_COMPARABLE"
  | "NOT_MEANINGFULLY_COMPARABLE";

export type AxisFinding = {
  axis: Axis;
  /**
   * The discipline's word for the axis, carried with the finding.
   *
   * Here rather than looked up by whoever renders it: the panel showed the raw
   * key for months, so a researcher read "sliceThickness" and
   * "numericalAperture" off a table that had proper names for both a function
   * call away. A finding that travels without its label will be displayed
   * without one.
   */
  label: string;
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
  /**
   * Axes that agree.
   *
   * Not what the panel reads — it renders `findings`, which carries the
   * agreeing axes along with the differing ones, because a table listing only
   * problems leaves a reader unable to tell "checked and fine" from "never
   * looked at". This is the same set, named, and it is convenient for a test
   * asserting which axes agreed without walking the findings.
   *
   * The comment used to say "named for the panel", which was true of an
   * earlier panel and had quietly stopped being true of this one.
   */
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

/** A fact that was never supplied at all, so an absent key reads as unknown. */
const NOT_GIVEN: Fact<unknown> = { value: null, origin: "unknown" };

const factOf = (a: Acquisition, key: string): Fact<unknown> =>
  (a[key] as Fact<unknown> | undefined) ?? NOT_GIVEN;

/**
 * Decide whether two acquisitions may be compared.
 *
 * The order of the checks is the argument, and it is the profile's tiers that
 * state it: what measures a different quantity, then what changes which
 * features are present at all, then what changes how the same feature looks.
 * Nothing here knows which discipline it is deciding for.
 */
export function assess(left: Acquisition, right: Acquisition): Assessment {
  const domain = domainOf(left.domain);
  const findings: AxisFinding[] = [];
  const shared: Axis[] = [];
  const blocking: Axis[] = [];
  const harmonization: string[] = [];
  const evidence = Math.min(evidenceStrength(left), evidenceStrength(right));

  /*
   * Two disciplines is a refusal before any axis is read, and the honest one:
   * their profiles do not share a single axis, so there is nothing to compare
   * even in principle. Falling through would compare a micrograph against a CT
   * on the CT's axes, find both silent, and report "cannot be judged" — which
   * would be a statement about missing metadata rather than about the pair.
   */
  if (left.domain !== right.domain) {
    const other = domainOf(right.domain);
    return {
      verdict: "NOT_MEANINGFULLY_COMPARABLE",
      reasoning:
        `These are a ${domain.label.toLowerCase()} ${domain.noun} and a `
        + `${other.label.toLowerCase()} ${other.noun}. They are not two `
        + "records of one kind of measurement, and nothing they have in common "
        + "is decided by the same evidence. They can be read side by side as "
        + "separate evidence, but not compared.",
      findings, shared, blocking, harmonization, evidence,
    };
  }

  for (const axis of domain.axes) {
    const finding = compareAxis(axis, left, right, domain);
    if (finding === null) continue;
    findings.push(finding);
    if (finding.agreement === "agree") shared.push(axis.key);
  }

  const differs = (key: Axis) =>
    findings.some((f) => f.axis === key && f.agreement === "differ");
  const unstated = (key: Axis) =>
    findings.some((f) => f.axis === key && f.agreement === "not_stated");

  /*
   * A foundational difference is the one with no harmonisation. The two sides
   * measure different physical quantities, so a value in one has no counterpart
   * in the other, and anything else this function might say is beside the point.
   */
  for (const axis of domain.axes.filter((a) => a.tier === "foundational")) {
    if (!differs(axis.key)) continue;
    blocking.push(axis.key);
    return {
      verdict: "NOT_MEANINGFULLY_COMPARABLE",
      reasoning: domain.prose.foundational(
        text(factOf(left, axis.key)), text(factOf(right, axis.key))),
      findings, shared, blocking, harmonization, evidence,
    };
  }

  /*
   * Visibility axes decide *what is present in the image at all*, which is a
   * stronger objection than any difference of degree: a feature can be
   * genuinely absent rather than fainter, so the difference between the two
   * images would be read as a finding when it is an acquisition choice.
   */
  for (const axis of domain.axes.filter((a) => a.tier === "visibility")) {
    if (differs(axis.key)) blocking.push(axis.key);
  }

  if (blocking.length > 0) {
    const names = blocking.map((k) => labelOf(domain, k)).join(" and ");
    const verb = blocking.length === 1 ? "differs" : "differ";
    return {
      verdict: "RELATED_BUT_NOT_COMPARABLE",
      reasoning: domain.prose.visibility(names, verb),
      findings, shared, blocking, harmonization, evidence,
    };
  }

  /*
   * Real obstacles that a researcher can correct for. This tier is what
   * separates "not comparable" from "not comparable yet", and the advice is
   * the profile's, because what it takes to harmonise is a fact about the
   * discipline rather than about this code.
   */
  for (const axis of domain.axes.filter((a) => a.tier === "harmonizable")) {
    if (differs(axis.key) && axis.harmonization !== undefined) {
      harmonization.push(axis.harmonization);
    }
  }

  /*
   * Nothing known is not the same as nothing wrong. A pair whose headers were
   * unreadable will show no differences, and reporting that as "directly
   * comparable" would turn absence of evidence into evidence of agreement —
   * the exact inversion this system exists to prevent.
   */
  const decisive = domain.axes.filter((a) => a.tier !== "harmonizable");
  const unknownDecisive = decisive.filter((a) => unstated(a.key));
  if (unknownDecisive.length > 0) {
    return {
      verdict: "CONCEPTUALLY_COMPARABLE",
      reasoning: domain.prose.uncertain(
        unknownDecisive.map((a) => a.label).join(" and "),
        unknownDecisive.length === 1 ? "is" : "are"),
      findings, shared, blocking, harmonization, evidence,
    };
  }

  if (harmonization.length > 0) {
    return {
      verdict: "COMPARABLE_AFTER_HARMONIZATION",
      reasoning: domain.prose.harmonizable,
      findings, shared, blocking, harmonization, evidence,
    };
  }

  return {
    verdict: "DIRECTLY_COMPARABLE",
    reasoning: domain.prose.direct,
    findings, shared, blocking, harmonization, evidence,
  };
}

function labelOf(domain: Domain, key: Axis): string {
  return domain.axes.find((a) => a.key === key)?.label ?? key;
}

/** One axis, compared. Returns null for an axis that does not apply. */
function compareAxis(axis: AxisSpec, left: Acquisition, right: Acquisition,
                     domain: Domain): AxisFinding | null {
  if (axis.appliesTo !== undefined && !axis.appliesTo(left, right)) return null;

  const a = factOf(left, axis.key);
  const b = factOf(right, axis.key);

  if (a.value === null || b.value === null) {
    /*
     * Which of them is missing, because the row shows both values and the
     * note used to contradict them.
     *
     * "Not recorded on both scans" was written for every case where *either*
     * side was silent, so a row reading `not recorded | T2` carried a
     * sentence saying neither had it — with the value that does exist printed
     * beside it. That is worse than vague: a reader who trusts the note
     * concludes the sequence is unknown on a scan where it is recorded, and
     * the disagreement between the row and its own note is the kind a person
     * resolves by deciding the panel is unreliable.
     *
     * One side missing is also a different fact from neither side having it.
     * A value present on one scan can be sought on the other; a value absent
     * from both is a question about the files, not about this pair.
     */
    const neither = a.value === null && b.value === null;
    return { axis: axis.key, label: axis.label, agreement: "not_stated",
             left: text(a), right: text(b),
             note: neither
               ? `Not recorded on either ${domain.noun}.`
               : `Recorded on one ${domain.noun} only, so the two cannot be `
                 + "compared on it." };
  }

  const same = agrees(axis.match, a.value, b.value);
  return {
    axis: axis.key,
    label: axis.label,
    agreement: same ? "agree" : "differ",
    left: text(a),
    right: text(b),
    note: same ? "" : axis.note,
  };
}

function agrees(match: Match, a: unknown, b: unknown): boolean {
  if (match.kind === "ratio") {
    const x = Number(a), y = Number(b);
    if (!(x > 0) || !(y > 0)) return false;
    // A ratio, not a difference: 1 against 2 matters, 4 against 5 much less,
    // and an absolute threshold cannot express both.
    return Math.max(x, y) / Math.min(x, y) <= match.tolerance;
  }
  if (match.kind === "text") {
    // Folded and trimmed: a channel somebody typed as "dapi" and one a file
    // recorded as "DAPI" are one channel, and comparing them as two would
    // manufacture a difference out of a keystroke.
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }
  if (match.kind === "near") {
    // For values that are nominal rather than measured — 1.5 T and 3 T — near
    // equality is equality.
    return Math.abs(Number(a) - Number(b)) < match.epsilon;
  }
  return a === b;
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
export function partition(caseStudy: Acquisition, others: Acquisition[]) {
  const groups = {
    /* Carried so the description below can use the discipline's own words
       rather than defaulting to one field's and calling it neutral. */
    domain: domainOf(caseStudy.domain),
    comparable: [] as Array<{ study: Acquisition; assessment: Assessment }>,
    afterHarmonization: [] as Array<{ study: Acquisition; assessment: Assessment }>,
    uncertain: [] as Array<{ study: Acquisition; assessment: Assessment }>,
    refused: [] as Array<{ study: Acquisition; assessment: Assessment }>,
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
  const { domain } = groups;
  if (total === 0) {
    return `Nothing to compare against this ${domain.collection} yet.`;
  }

  const parts: string[] = [];
  if (groups.comparable.length > 0) {
    parts.push(`${groups.comparable.length} can be compared directly`);
  }
  if (groups.afterHarmonization.length > 0) {
    parts.push(`${groups.afterHarmonization.length} after harmonisation`);
  }
  if (groups.uncertain.length > 0) {
    // "Part of": a file can state most of its acquisition and still be
    // unjudgeable on one axis, and "not recorded" would tell that researcher
    // their metadata is worse than it is.
    parts.push(`${groups.uncertain.length} cannot be judged, because part of `
             + "the acquisition is not recorded");
  }
  if (groups.refused.length > 0) {
    parts.push(`${groups.refused.length} cannot be compared with this `
             + `${domain.collection}`);
  }
  return `${total} ${total === 1 ? domain.noun : domain.nounPlural} against `
       + `this ${domain.collection}: ${parts.join("; ")}.`;
}
