/**
 * Whether two scans may be held beside each other (§ refusal, imaging).
 *
 * The tests that matter here are the refusals. An engine that finds a way to
 * compare any two images would be persuasive and wrong, and the specific way it
 * would be wrong is that image appearance is dominated by acquisition rather
 * than by pathology — so the failures below are all cases where something about
 * *how the scan was taken* would be read as something about the patient.
 */

import { describe, expect, it } from "vitest";
import {
  THICKNESS_TOLERANCE, assess, describePartition, partition,
  permitsComparison,
} from "@/lib/imaging/comparability";
import {
  Study, blankStudy, declared, evidenceStrength, fromHeader,
} from "@/lib/imaging/study";

/** A fully-specified CT, as a starting point to vary one axis at a time. */
const ct = (id: string, over: Partial<Study> = {}): Study => ({
  ...blankStudy(id, id),
  modality: fromHeader("CT"),
  contrast: fromHeader("portal-venous"),
  sliceThickness: fromHeader(1),
  pixelSpacing: fromHeader(0.7),
  orientation: fromHeader("axial"),
  manufacturer: fromHeader("Siemens"),
  ...over,
});

const mr = (id: string, over: Partial<Study> = {}): Study => ({
  ...blankStudy(id, id),
  modality: fromHeader("MR"),
  weighting: fromHeader("T2"),
  contrast: fromHeader("non-contrast"),
  sliceThickness: fromHeader(3),
  pixelSpacing: fromHeader(0.5),
  fieldStrength: fromHeader(3),
  orientation: fromHeader("axial"),
  ...over,
});

describe("what cannot be compared at all", () => {
  it("refuses a CT against an MR", () => {
    /*
     * Different physical quantities — attenuation against proton behaviour —
     * so an intensity in one has no counterpart in the other. This is the one
     * axis with no harmonisation available.
     */
    const a = assess(ct("case"), mr("other"));
    expect(a.verdict).toBe("NOT_MEANINGFULLY_COMPARABLE");
    expect(a.blocking).toContain("modality");
    expect(a.reasoning).toContain("different physical quantities");
    expect(permitsComparison(a.verdict)).toBe(false);
  });

  it("refuses two MRs with different weighting", () => {
    /*
     * The subtler refusal, and the more important one: a T1 and a T2 of the
     * same slice are the same machine, the same patient and the same session,
     * and show different tissue. A lesion bright on T2 can be invisible on T1 —
     * absent, not fainter — so a difference between the images is a difference
     * in the sequence.
     */
    const a = assess(mr("case"), mr("other", { weighting: fromHeader("T1") }));
    expect(a.verdict).toBe("RELATED_BUT_NOT_COMPARABLE");
    expect(a.blocking).toContain("weighting");
    expect(a.reasoning).toContain("visible");
  });

  it("refuses two CTs in different contrast phases", () => {
    // A lesion that enhances only in the portal-venous phase is genuinely
    // absent from a non-contrast scan.
    const a = assess(ct("case"),
                     ct("other", { contrast: fromHeader("non-contrast") }));
    expect(a.verdict).toBe("RELATED_BUT_NOT_COMPARABLE");
    expect(a.blocking).toContain("contrast");
  });

  it("agrees in number with how many axes blocked it", () => {
    /*
     * "The contrast phase differ" was on screen before this test existed. A
     * refusal is the output this product is least able to afford looking
     * careless in: a reader deciding whether to trust a system that says no is
     * reading the sentence closely.
     */
    const one = assess(ct("case"),
                       ct("other", { contrast: fromHeader("arterial") }));
    expect(one.reasoning).toContain("contrast phase differs");

    const two = assess(mr("case"), mr("other", {
      weighting: fromHeader("T1"), contrast: fromHeader("arterial") }));
    expect(two.reasoning).toContain("differ.");
    expect(two.reasoning).not.toContain("differs");
  });

  it("says which axis blocked it, not merely that something did", () => {
    // A refusal a researcher cannot act on is only an obstacle.
    const a = assess(ct("case"),
                     ct("other", { contrast: fromHeader("arterial") }));
    const finding = a.findings.find((f) => f.axis === "contrast")!;
    expect(finding.agreement).toBe("differ");
    expect(finding.left).toBe("portal-venous");
    expect(finding.right).toBe("arterial");
    expect(finding.note).toContain("phase");
  });
});

describe("what can be compared once corrected", () => {
  it("allows different slice thickness, and says what to do", () => {
    const a = assess(ct("case"), ct("other", { sliceThickness: fromHeader(5) }));
    expect(a.verdict).toBe("COMPARABLE_AFTER_HARMONIZATION");
    expect(a.harmonization.join(" ")).toContain("slice thickness");
    expect(permitsComparison(a.verdict)).toBe(true);
  });

  it("warns that resampling can only go one way", () => {
    /*
     * The thicker acquisition averaged through the plane and may have erased a
     * small finding. Upsampling it does not bring the finding back, and a tool
     * that said "resample to match" without saying which direction would invite
     * exactly that.
     */
    const a = assess(ct("case"), ct("other", { sliceThickness: fromHeader(5) }));
    expect(a.harmonization.join(" ")).toContain("thinner one down to the thicker");
  });

  it("treats a small thickness difference as the same", () => {
    // 1 mm and 1.25 mm are routinely read together; a tool that objected would
    // be ignored within a day.
    const a = assess(ct("case"), ct("other", { sliceThickness: fromHeader(1.25) }));
    expect(a.verdict).toBe("DIRECTLY_COMPARABLE");
  });

  it("measures thickness as a ratio, not a difference", () => {
    /*
     * 1 mm against 2 mm matters; 4 mm against 5 mm much less. One absolute
     * threshold cannot express both, and whichever value it took would be
     * wrong at the other end of the range.
     */
    const near = assess(ct("a", { sliceThickness: fromHeader(4) }),
                        ct("b", { sliceThickness: fromHeader(5) }));
    const far = assess(ct("a", { sliceThickness: fromHeader(1) }),
                       ct("b", { sliceThickness: fromHeader(2) }));
    expect(near.verdict).toBe("DIRECTLY_COMPARABLE");
    expect(far.verdict).toBe("COMPARABLE_AFTER_HARMONIZATION");
  });

  it("flags field strength between two MRs", () => {
    const a = assess(mr("case"), mr("other", { fieldStrength: fromHeader(1.5) }));
    expect(a.verdict).toBe("COMPARABLE_AFTER_HARMONIZATION");
    expect(a.harmonization.join(" ")).toContain("field strength");
  });

  it("allows the same scan to be compared with itself", () => {
    expect(assess(ct("a"), ct("b")).verdict).toBe("DIRECTLY_COMPARABLE");
  });
});

describe("silence is not agreement", () => {
  it("will not call two unlabelled scans comparable", () => {
    /*
     * The inversion this engine exists to prevent. Two scans with unreadable
     * headers show no differences on any axis — and reporting that as
     * "directly comparable" turns absence of evidence into evidence of
     * agreement.
     */
    const a = assess(blankStudy("case", "case"), blankStudy("other", "other"));
    expect(a.verdict).toBe("CONCEPTUALLY_COMPARABLE");
    expect(a.reasoning).toContain("silence is not agreement");
    expect(permitsComparison(a.verdict)).toBe(false);
  });

  it("names which decisive axis is missing", () => {
    const a = assess(ct("case"), ct("other", { contrast: { value: null, origin: "unknown" } }));
    expect(a.verdict).toBe("CONCEPTUALLY_COMPARABLE");
    expect(a.reasoning).toContain("contrast phase");
  });

  it("still refuses on a difference it can see, even with gaps elsewhere", () => {
    // A known blocking difference outranks an unknown: the refusal is certain
    // even though the description is incomplete.
    const a = assess(ct("case"),
                     ct("other", { modality: fromHeader("MR"),
                                   contrast: { value: null, origin: "unknown" } }));
    expect(a.verdict).toBe("NOT_MEANINGFULLY_COMPARABLE");
  });
});

describe("a typed fact is weaker than a measured one", () => {
  it("marks a declared value as stated rather than read", () => {
    /*
     * A modality read from a DICOM header and one somebody typed are not the
     * same evidence. Showing both the same way would let a verdict rest on a
     * guess while looking as solid as one resting on the file.
     */
    const a = assess(ct("case"), ct("other", { contrast: declared("portal-venous") }));
    const finding = a.findings.find((f) => f.axis === "contrast")!;
    expect(finding.right).toContain("stated, not read from the file");
  });

  it("scores evidence lower when facts were typed", () => {
    const read = evidenceStrength(ct("a"));
    const typed = evidenceStrength(ct("b", {
      contrast: declared("portal-venous"), sliceThickness: declared(1) }));
    expect(typed).toBeLessThan(read);
  });

  it("reports the weaker of the two scans' evidence", () => {
    // A comparison is only as well-founded as its worse-described side.
    const a = assess(ct("case"), blankStudy("other", "other"));
    expect(a.evidence).toBeLessThan(0.2);
  });

  it("scores a fully-read scan higher than an empty one", () => {
    expect(evidenceStrength(ct("a"))).toBeGreaterThan(
      evidenceStrength(blankStudy("b", "b")));
  });
});

describe("irrelevant axes are not reported as problems", () => {
  it("does not ask two CTs about their MR weighting", () => {
    /*
     * A panel full of objections that are categories rather than problems
     * teaches the reader to skim past the real ones.
     */
    const a = assess(ct("case"), ct("other"));
    expect(a.findings.map((f) => f.axis)).not.toContain("weighting");
    expect(a.findings.map((f) => f.axis)).not.toContain("fieldStrength");
  });

  it("does ask two MRs about weighting", () => {
    const a = assess(mr("case"), mr("other"));
    expect(a.findings.map((f) => f.axis)).toContain("weighting");
  });
});

describe("a partition, never a ranking", () => {
  it("sorts a set into what can and cannot be compared", () => {
    const groups = partition(ct("case"), [
      ct("same"),
      ct("thick", { sliceThickness: fromHeader(5) }),
      mr("an-mr"),
      blankStudy("unlabelled", "unlabelled"),
    ]);
    expect(groups.comparable.map((g) => g.study.id)).toEqual(["same"]);
    expect(groups.afterHarmonization.map((g) => g.study.id)).toEqual(["thick"]);
    expect(groups.refused.map((g) => g.study.id)).toEqual(["an-mr"]);
    expect(groups.uncertain.map((g) => g.study.id)).toEqual(["unlabelled"]);
  });

  it("says in words what the researcher is looking at", () => {
    const groups = partition(ct("case"), [ct("same"), mr("an-mr")]);
    const text = describePartition(groups);
    expect(text).toContain("1 can be compared directly");
    expect(text).toContain("1 cannot be compared with this case");
  });

  it("says plainly when there is nothing to compare", () => {
    expect(describePartition(partition(ct("case"), [])))
      .toBe("Nothing to compare against this case yet.");
  });

  it("keeps every scan in exactly one group", () => {
    // A scan that fell through the partition would silently disappear from the
    // case — the worst outcome for a tool whose job is to account for what it
    // is not showing.
    const studies = [ct("a"), mr("b"), ct("c", { sliceThickness: fromHeader(9) }),
                     blankStudy("d", "d"), ct("e", { contrast: fromHeader("delayed") })];
    const groups = partition(ct("case"), studies);
    const seen = [...groups.comparable, ...groups.afterHarmonization,
                  ...groups.uncertain, ...groups.refused].map((g) => g.study.id);
    expect(seen.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("the tolerances are a decision, not a magic number", () => {
  it("permits a modest thickness ratio and no more", () => {
    expect(THICKNESS_TOLERANCE).toBeGreaterThan(1);
    expect(THICKNESS_TOLERANCE).toBeLessThan(2.5);
  });
});

describe("an axis recorded on only one side", () => {
  /*
   * Found by reading the rendered panel, not by the suite.
   *
   * The row showed `not recorded | T2` and the note beside it read "Not
   * recorded on both scans" — written for every case where *either* side was
   * silent, so it contradicted a value printed in the same row. A reader who
   * trusts the note concludes the sequence is unknown on a scan where it is
   * recorded; a reader who notices the disagreement decides the panel is
   * unreliable. Neither is a good outcome.
   *
   * The two states are also different facts. A value present on one scan can
   * be sought on the other. A value absent from both is a question about the
   * files rather than about this pair.
   */
  it("says one only, and never that neither had it", () => {
    const a = assess(mr("left", { weighting: blankStudy("x", "x").weighting }),
                     mr("right"));
    const finding = a.findings.find((f) => f.axis === "weighting")!;

    expect(finding.agreement).toBe("not_stated");
    expect(finding.note).toMatch(/one scan only/);
    expect(finding.note).not.toMatch(/either|both/);
    // The value that does exist is still shown, which is what made the old
    // wording visibly wrong rather than merely imprecise.
    expect(finding.right).toContain("T2");
  });

  it("says neither when neither had it", () => {
    const blank = blankStudy("x", "x").weighting;
    const a = assess(mr("left", { weighting: blank }),
                     mr("right", { weighting: blank }));
    const finding = a.findings.find((f) => f.axis === "weighting")!;

    expect(finding.note).toMatch(/Not recorded on either scan/);
  });
});
