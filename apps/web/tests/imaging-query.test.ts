/**
 * Finding scans by how they were acquired (imaging).
 *
 * The test that matters most is the consistency one: a query built from a case
 * must return exactly the scans the comparability engine calls directly
 * comparable. Two answers to the same question that disagreed would make both
 * untrustworthy, and nothing in the interface would show which was wrong.
 *
 * After that it is the third bucket. A scan whose header is unreadable is not a
 * match and is not an exclusion, and a query reporting twelve matches while
 * silently discarding forty of those is lying by omission — the forty are
 * usually the ones worth opening.
 */

import { describe, expect, it } from "vitest";
import {
  answer, describeQuery, describeResult, explainRow, fromCase, run,
} from "@/lib/imaging/query";
import { partition } from "@/lib/imaging/comparability";
import { Study, blankStudy, declared, fromHeader } from "@/lib/imaging/study";

const ct = (id: string, over: Partial<Study> = {}): Study => ({
  ...blankStudy(id, id),
  modality: fromHeader("CT"),
  contrast: fromHeader("portal-venous"),
  sliceThickness: fromHeader(1),
  pixelSpacing: fromHeader(0.7),
  orientation: fromHeader("axial"),
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

describe("a query and a verdict answer the same question", () => {
  it("returns exactly what the partition calls directly comparable", () => {
    /*
     * The consistency that makes both trustworthy. If a filter said "these six"
     * and opening them gave a different verdict, a researcher would have no way
     * to tell which of the two had been wrong.
     */
    const subject = ct("case");
    const library = [
      ct("same"),
      ct("thicker", { sliceThickness: fromHeader(1.4) }),
      ct("too-thick", { sliceThickness: fromHeader(5) }),
      ct("plain", { contrast: fromHeader("non-contrast") }),
      mr("an-mr"),
      ct("coronal", { orientation: fromHeader("coronal") }),
    ];

    const queried = run(fromCase(subject), library)
      .matched.map((r) => r.study.id).sort();
    const compared = partition(subject, library)
      .comparable.map((g) => g.study.id).sort();

    expect(queried).toEqual(compared);
    expect(queried).toEqual(["same", "thicker"]);
  });

  it("uses the same thickness tolerance the verdict does", () => {
    // 1.0 against 1.25 is one answer or the other; it must not be both.
    const subject = ct("case");
    const near = [ct("near", { sliceThickness: fromHeader(1.25) })];
    expect(run(fromCase(subject), near).matched).toHaveLength(1);
    expect(partition(subject, near).comparable).toHaveLength(1);
  });

  it("places no constraint on an axis the case is silent about", () => {
    /*
     * Filtering a library by a fact you do not have is filtering by a guess.
     * A case with no recorded contrast phase must not exclude every scan that
     * records one.
     */
    const subject = ct("case", { contrast: { value: null, origin: "unknown" } });
    const query = fromCase(subject);
    expect(query.some((c) => c.axis === "contrast")).toBe(false);

    const library = [ct("a"), ct("b", { contrast: fromHeader("arterial") })];
    expect(run(query, library).matched).toHaveLength(2);
  });
});

describe("silence is neither a match nor an exclusion", () => {
  it("puts an unreadable scan in its own bucket", () => {
    /*
     * The mirror of the comparability engine's rule. There, silence must not be
     * read as agreement; here it must not be read as exclusion — and the scans
     * with unreadable headers are usually the ones worth opening.
     */
    const result = run(fromCase(ct("case")), [
      ct("known"),
      blankStudy("unreadable", "unreadable"),
      mr("an-mr"),
    ]);
    expect(result.matched.map((r) => r.study.id)).toEqual(["known"]);
    expect(result.uncertain.map((r) => r.study.id)).toEqual(["unreadable"]);
    expect(result.excluded.map((r) => r.study.id)).toEqual(["an-mr"]);
  });

  it("counts the unjudgeable in words rather than swallowing them", () => {
    /*
     * "12 of 400" is read as "the other 388 were considered and rejected".
     * "12 matched, 41 could not be judged" tells a researcher where to look.
     */
    const text = describeResult(run(fromCase(ct("case")), [
      ct("a"), blankStudy("b", "b"), blankStudy("c", "c"), mr("d")]));
    expect(text).toContain("cannot be judged");
    expect(text).toContain("neither included nor ruled out");
  });

  it("excludes on a recorded difference even when something else is missing", () => {
    /*
     * Knowing one thing for certain is enough to answer. Putting a scan that is
     * definitely an MR into "uncertain" because its thickness is missing would
     * ask the researcher to open a file whose answer is already known.
     */
    const definitelyOther = mr("mr", {
      sliceThickness: { value: null, origin: "unknown" } });
    const result = run(fromCase(ct("case")), [definitelyOther]);
    expect(result.excluded).toHaveLength(1);
    expect(result.uncertain).toHaveLength(0);
  });

  it("says which axis a scan could not answer", () => {
    const result = run(fromCase(ct("case")),
                       [ct("x", { contrast: { value: null, origin: "unknown" } })]);
    expect(explainRow(result.uncertain[0])).toContain("contrast phase");
    expect(explainRow(result.uncertain[0])).toContain("may well match");
  });

  it("lists several failures as a person would say them", () => {
    /*
     * "modality and contrast phase and slice thickness" reads as carelessness,
     * and this is the sentence a sceptical reader looks at hardest — it is the
     * screen's account of what it decided not to show them.
     */
    const result = run(fromCase(ct("case")), [mr("m")]);
    const text = explainRow(result.excluded[0]);
    expect(text).toContain("modality, contrast phase and slice thickness");
    expect(text).not.toContain("and contrast phase and");

    const one = run(fromCase(ct("case")),
                    [ct("x", { contrast: fromHeader("arterial") })]);
    expect(explainRow(one.excluded[0])).toBe("Differs on contrast phase.");
  });

  it("says which axis a scan failed on", () => {
    const result = run(fromCase(ct("case")), [mr("m")]);
    expect(explainRow(result.excluded[0])).toContain("modality");
  });
});

describe("a match on a typed value is a weaker match", () => {
  it("marks a row that matched on something stated rather than read", () => {
    const result = run(fromCase(ct("case")),
                       [ct("typed", { contrast: declared("portal-venous") })]);
    expect(result.matched[0].onDeclared).toBe(true);
    expect(explainRow(result.matched[0])).toContain("stated rather than read");
  });

  it("does not mark a row whose facts all came from the file", () => {
    const result = run(fromCase(ct("case")), [ct("read")]);
    expect(result.matched[0].onDeclared).toBe(false);
    expect(explainRow(result.matched[0])).toContain("read from the file");
  });

  it("counts the weaker matches in the summary", () => {
    const text = describeResult(run(fromCase(ct("case")),
      [ct("a"), ct("b", { contrast: declared("portal-venous") })]));
    expect(text).toContain("typed rather than read");
  });
});

describe("asking a question by hand", () => {
  it("answers one criterion at a time", () => {
    const scan = ct("s", { sliceThickness: fromHeader(2) });
    expect(answer(scan, { axis: "modality", oneOf: ["CT"] })).toBe("yes");
    expect(answer(scan, { axis: "modality", oneOf: ["MR"] })).toBe("no");
    expect(answer(scan, { axis: "sliceThickness", atMost: 3 })).toBe("yes");
    expect(answer(scan, { axis: "sliceThickness", atMost: 1 })).toBe("no");
    expect(answer(scan, { axis: "fieldStrength", equals: 3 })).toBe("unknown");
  });

  it("accepts several values on one axis", () => {
    const scan = ct("s", { contrast: fromHeader("arterial") });
    expect(answer(scan, {
      axis: "contrast", oneOf: ["arterial", "portal-venous"] })).toBe("yes");
  });

  it("treats nominal field strengths as equal when they are near", () => {
    // 1.5 T is written as 1.494 by some scanners, and it is still 1.5 T.
    const scan = mr("s", { fieldStrength: fromHeader(1.494) });
    expect(answer(scan, { axis: "fieldStrength", equals: 1.5 })).toBe("yes");
    expect(answer(scan, { axis: "fieldStrength", equals: 3 })).toBe("no");
  });

  it("keeps the caller's order rather than sorting by closeness", () => {
    /*
     * The only sort available would be by how near a scan is to the case, and
     * an ordered list of scans near a case is a differential diagnosis whatever
     * it is labelled.
     */
    const library = [ct("z"), ct("a"), ct("m")];
    expect(run([], library).matched.map((r) => r.study.id))
      .toEqual(["z", "a", "m"]);
  });

  it("says plainly that an empty query constrains nothing", () => {
    expect(describeQuery([])).toContain("nothing was asked");
    expect(run([], [ct("a"), mr("b")]).matched).toHaveLength(2);
  });

  it("says nothing to search when the library is empty", () => {
    expect(describeResult(run(fromCase(ct("case")), [])))
      .toBe("Nothing in the library to search.");
  });
});

describe("the query in words", () => {
  it("reads back what was asked", () => {
    const text = describeQuery(fromCase(ct("case")));
    expect(text).toContain("modality is CT");
    expect(text).toContain("contrast phase is portal-venous");
    expect(text).toContain("slice thickness is at most 1.5 mm");
  });

  it("names several accepted values on one axis", () => {
    expect(describeQuery([{ axis: "contrast",
                            oneOf: ["arterial", "delayed"] }]))
      .toContain("one of arterial, delayed");
  });

  it("puts every scan in exactly one bucket", () => {
    // A scan that fell through would vanish from a library search, which is the
    // worst outcome for a tool whose job is to account for what it excluded.
    const library = [ct("a"), mr("b"), blankStudy("c", "c"),
                     ct("d", { sliceThickness: fromHeader(9) }),
                     ct("e", { contrast: declared("portal-venous") })];
    const result = run(fromCase(ct("case")), library);
    const seen = [...result.matched, ...result.excluded, ...result.uncertain]
      .map((r) => r.study.id).sort();
    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
  });
});
