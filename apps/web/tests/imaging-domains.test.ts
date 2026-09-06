/**
 * Comparability outside medicine (§ the screen was built for one discipline).
 *
 * `CaseCompare` was written for radiology and read as though radiology were
 * the platform's only field. The reasoning underneath never was medical —
 * record where each fact came from, refuse when two acquisitions do not share
 * a measurement, say why — but the axes, the tolerances and the words all were,
 * so a microscopist with two images of one section had nowhere to put an
 * objective and no verdict that spoke about one.
 *
 * These tests are the evidence that the generalisation is real rather than a
 * rename. The medical tests in `imaging-comparability.test.ts` were not
 * touched by that change and still pass, which says the radiology profile
 * reproduces the old engine; what follows says the other profiles decide
 * anything at all.
 */

import { describe, expect, it } from "vitest";
import { assess, describePartition, partition } from "@/lib/imaging/comparability";
import {
  DOMAINS, FIGURE, MICROSCOPY, acceptedExtensions, domainOf,
} from "@/lib/imaging/domain";
import {
  Acquisition, blankStudy, evidenceStrength, fromHeader,
} from "@/lib/imaging/study";

/** A fully-specified confocal image, to vary one axis at a time. */
const micrograph = (id: string, over: Record<string, unknown> = {}): Acquisition => ({
  id, label: id, domain: "microscopy",
  technique: fromHeader("confocal"),
  channel: fromHeader("DAPI"),
  preparation: fromHeader("fixed"),
  pixelSize: fromHeader(0.2),
  numericalAperture: fromHeader(1.4),
  exposure: fromHeader(200),
  ...over,
});

const figure = (id: string, over: Record<string, unknown> = {}): Acquisition => ({
  id, label: id, domain: "figure",
  quantity: fromHeader("tumour volume"),
  normalization: fromHeader("raw"),
  yScale: fromHeader("linear"),
  units: fromHeader("mm^3"),
  errorBars: fromHeader("SD"),
  binning: fromHeader(1),
  ...over,
});

describe("microscopy decides on its own axes", () => {
  it("refuses brightfield against fluorescence", () => {
    // The microscopy analogue of CT against MR: absorbance and emission are
    // different physical quantities and share no intensity scale.
    const a = assess(micrograph("a", { technique: fromHeader("brightfield") }),
                     micrograph("b", { technique: fromHeader("confocal") }));
    expect(a.verdict).toBe("NOT_MEANINGFULLY_COMPARABLE");
    expect(a.blocking).toContain("technique");
  });

  it("refuses one channel against another", () => {
    // A structure carrying no label in the channel imaged is absent from the
    // image, not dim — so the difference would be read as biology.
    const a = assess(micrograph("a"), micrograph("b", { channel: fromHeader("GFP") }));
    expect(a.verdict).toBe("RELATED_BUT_NOT_COMPARABLE");
    expect(a.blocking).toContain("channel");
  });

  it("asks for resampling when pixel size differs, rather than refusing", () => {
    const a = assess(micrograph("a"), micrograph("b", { pixelSize: fromHeader(0.9) }));
    expect(a.verdict).toBe("COMPARABLE_AFTER_HARMONIZATION");
    expect(a.harmonization.join(" ")).toContain("pixel size");
    // The advice must say which way the resampling can go. The coarser image
    // cannot be given detail it never sampled.
    expect(a.harmonization.join(" ")).toContain("coarser");
  });

  it("treats a small exposure difference as the same and a large one as not", () => {
    const near = assess(micrograph("a"), micrograph("b", { exposure: fromHeader(220) }));
    expect(near.verdict).toBe("DIRECTLY_COMPARABLE");
    const far = assess(micrograph("a"), micrograph("b", { exposure: fromHeader(800) }));
    expect(far.verdict).toBe("COMPARABLE_AFTER_HARMONIZATION");
  });

  it("will not call two unlabelled images comparable", () => {
    const a = assess({ id: "a", label: "a", domain: "microscopy" },
                     { id: "b", label: "b", domain: "microscopy" });
    expect(a.verdict).toBe("CONCEPTUALLY_COMPARABLE");
    expect(a.reasoning).toContain("silence is not agreement");
  });
});

describe("plotted figures", () => {
  it("refuses a log axis against a linear one", () => {
    // One dataset drawn both ways makes two differently-shaped claims, and
    // neither is about the data.
    const a = assess(figure("a"), figure("b", { yScale: fromHeader("log") }));
    expect(a.verdict).toBe("RELATED_BUT_NOT_COMPARABLE");
    expect(a.blocking).toContain("yScale");
  });

  it("refuses a percent-of-control against a raw value", () => {
    const a = assess(figure("a"),
                     figure("b", { normalization: fromHeader("percent-of-control") }));
    expect(a.verdict).toBe("RELATED_BUT_NOT_COMPARABLE");
    expect(a.blocking).toContain("normalization");
  });

  it("says standard error and standard deviation need restating, and why", () => {
    // The conflation this profile exists for: SEM is smaller than SD by root n,
    // so error bars read across the two understate spread.
    const a = assess(figure("a"), figure("b", { errorBars: fromHeader("SEM") }));
    expect(a.verdict).toBe("COMPARABLE_AFTER_HARMONIZATION");
    const advice = a.harmonization.join(" ");
    expect(advice).toContain("sample size");
  });
});

describe("across disciplines", () => {
  it("refuses a micrograph against a scan, without pretending to weigh axes", () => {
    const a = assess(micrograph("m"), blankStudy("s", "s"));
    expect(a.verdict).toBe("NOT_MEANINGFULLY_COMPARABLE");
    // Not "cannot be judged": that would be a statement about missing metadata
    // when the real answer is that they share no axis at all.
    expect(a.findings).toHaveLength(0);
  });
});

describe("no profile speaks another's language", () => {
  /*
   * The regression this whole change exists to prevent. A generalisation that
   * left radiology's prose in place would produce verdicts about sequences and
   * Tesla for a microscopist — general-looking, and wrong in a way that reads
   * as competence.
   */
  const MEDICAL = /\b(scan|scans|sequence|weighting|Tesla|field strength|lesion|pathology|slice)\b/i;

  it("keeps medical vocabulary out of every non-medical verdict", () => {
    const pairs: Array<[Acquisition, Acquisition]> = [
      [micrograph("a", { technique: fromHeader("brightfield") }), micrograph("b")],
      [micrograph("a"), micrograph("b", { channel: fromHeader("GFP") })],
      [micrograph("a"), micrograph("b", { pixelSize: fromHeader(0.9) })],
      [micrograph("a"), micrograph("b")],
      [figure("a"), figure("b", { yScale: fromHeader("log") })],
      [figure("a"), figure("b", { units: fromHeader("cm^3") })],
      [figure("a"), figure("b")],
    ];
    for (const [left, right] of pairs) {
      const a = assess(left, right);
      const words = [a.reasoning, ...a.harmonization,
                     ...a.findings.map((f) => f.note)].join(" ");
      expect(words).not.toMatch(MEDICAL);
    }
  });

  it("keeps them out of every non-medical profile, including ones with no example",
     () => {
    /*
     * The pairs above are written by hand, so a profile only gets checked once
     * somebody adds a pair for it — and `image` never had one. It is the
     * profile that matters most for this: `domainOf(undefined)` returns it, so
     * it is what an acquisition gets when nothing says otherwise, and it is
     * the only one with no worked example anybody can look at.
     *
     * Read from `DOMAINS` rather than listed, so a fifth profile is covered by
     * existing when it is written rather than by somebody remembering. Every
     * string a profile can put on a screen: the premise, each axis label, note
     * and harmonisation, and all five verdict sentences.
     */
    for (const domain of DOMAINS.filter((d) => d.id !== "radiology")) {
      const words = [
        domain.premise,
        ...domain.axes.flatMap((a) => [a.label, a.note, a.harmonization ?? ""]),
        domain.prose.foundational("one value", "another"),
        domain.prose.visibility("an axis", "differs"),
        domain.prose.uncertain("an axis", "is"),
        domain.prose.harmonizable,
        domain.prose.direct,
      ].join(" ");

      const found = words.match(MEDICAL);
      expect(found, `${domain.id} says "${found?.[0]}"`).toBeNull();
    }
  });

  it("describes a partition in the discipline's own nouns", () => {
    const text = describePartition(partition(micrograph("case"), [micrograph("a")]));
    expect(text).toContain("image");
    expect(text).not.toContain("scan");
  });
});

describe("every profile is well formed", () => {
  /*
   * A structural test rather than a behavioural one, and it is here for the
   * profile that has not been written yet: these are the invariants the engine
   * relies on and cannot check at run time.
   */
  it("gives every axis a reason a difference matters", () => {
    for (const domain of DOMAINS) {
      expect(domain.axes.length).toBeGreaterThan(0);
      for (const axis of domain.axes) {
        expect(axis.note.length, `${domain.id}.${axis.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("tells the researcher what to do about every correctable difference", () => {
    // A `harmonizable` axis with no advice is a verdict that says "not yet"
    // and refuses to say what would change it.
    for (const domain of DOMAINS) {
      for (const axis of domain.axes.filter((a) => a.tier === "harmonizable")) {
        expect(axis.harmonization, `${domain.id}.${axis.key}`).toBeTruthy();
      }
    }
  });

  it("offers no remedy for a difference that has none", () => {
    for (const domain of DOMAINS) {
      for (const axis of domain.axes.filter((a) => a.tier !== "harmonizable")) {
        expect(axis.harmonization, `${domain.id}.${axis.key}`).toBeUndefined();
      }
    }
  });

  it("gives every discipline at least one foundational axis", () => {
    // Without one, nothing can ever be refused outright, and an engine that
    // always finds a way to compare is worse than none.
    for (const domain of DOMAINS) {
      expect(domain.axes.some((a) => a.tier === "foundational"),
             domain.id).toBe(true);
    }
  });

  it("claims a file for at most one discipline", () => {
    const seen = new Set<string>();
    for (const domain of DOMAINS) {
      for (const ext of domain.extensions) {
        expect(seen.has(ext), ext).toBe(false);
        seen.add(ext);
      }
    }
  });

  it("offers every claimed extension to the file picker", () => {
    /*
     * This replaced a `domainForFile` that mapped a filename to a discipline.
     * It was dead, and while it existed it caused the one bug it was shaped to
     * cause: the ingest asked it before asking the researcher, every `.png` is
     * claimed by the general-image profile, and the discipline picker was
     * silently inert. Extensions decide which *reader* opens a file; they never
     * decide which discipline judges it.
     */
    const accepted = acceptedExtensions();
    expect(accepted).toContain(".ome.tif");
    expect(accepted).toContain(".dcm");
    expect(accepted).toContain(".png");
    expect(accepted).not.toContain(".txt");
  });

  it("falls back to general images rather than to medicine", () => {
    expect(domainOf(undefined).id).toBe("image");
  });

  it("scores evidence against the acquisition's own axes", () => {
    // Six of six known, not six of radiology's seven.
    expect(evidenceStrength(micrograph("a"))).toBe(1);
    expect(evidenceStrength({ id: "b", label: "b", domain: "microscopy" })).toBe(0);
    expect(MICROSCOPY.axes).toHaveLength(6);
    expect(FIGURE.axes).toHaveLength(6);
  });
});
