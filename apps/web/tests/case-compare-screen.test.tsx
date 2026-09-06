/**
 * The comparison screen itself (§ it had no test file).
 *
 * Everything under it was tested — the engine, the profiles, the readers, the
 * panels — and the screen that assembles them was not, which is how a worked
 * example for three of the four disciplines could be written, wired, and still
 * be worth nothing if the picker did not change what is drawn.
 *
 * These assert the things a reader would check by looking, so that they stay
 * checked: that the example can be switched, that switching it changes the
 * discipline the verdicts are decided in, that the instrument is shown and
 * marked as deciding nothing, and that the axes are named rather than keyed.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaseCompare } from "@/components/imaging/CaseCompare";

const pickExample = (value: string) => {
  fireEvent.change(screen.getByLabelText("Worked example discipline"),
                   { target: { value } });
};

describe("the worked example can be seen in more than one field", () => {
  it("offers medicine, microscopy and figures", () => {
    render(<CaseCompare />);
    const options = within(screen.getByLabelText("Worked example discipline"))
      .getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Medical imaging", "Microscopy", "Plotted figures"]);
  });

  it("opens on medicine, and says so in medicine's own words", () => {
    render(<CaseCompare />);
    expect(screen.getByText(/Received case — CT/)).toBeTruthy();
    expect(screen.getByText(/against this case:/)).toBeTruthy();
  });

  it("draws the microscopy set when microscopy is chosen", () => {
    /*
     * The assertion that makes the picker worth having. A control that changed
     * a label and nothing else would look like it worked.
     */
    render(<CaseCompare />);
    pickExample("microscopy");
    expect(screen.getByText(/Section A · DAPI, confocal/)).toBeTruthy();
    expect(screen.queryByText(/Received case — CT/)).toBeNull();
  });

  it("decides the microscopy set on microscopy's axes", () => {
    render(<CaseCompare />);
    pickExample("microscopy");
    const headers = screen.getAllByRole("rowheader").map((h) => h.textContent);
    expect(headers).toContain("channel or stain");
    expect(headers).not.toContain("sequence weighting");
  });

  it("speaks about a set of images, not a case of scans", () => {
    render(<CaseCompare />);
    pickExample("microscopy");
    expect(screen.getByText(/against this set:/)).toBeTruthy();
  });

  it("draws the figure set, and refuses a log axis against a linear one", () => {
    render(<CaseCompare />);
    pickExample("figure");
    expect(screen.getByText(/Figure 2a · raw, linear, SD/)).toBeTruthy();
    const headers = screen.getAllByRole("rowheader").map((h) => h.textContent);
    expect(headers).toContain("value-axis scale");
  });

  it("shows the refusals, not only the agreements", () => {
    // A worked example that only agreed would demonstrate the least
    // interesting thing this engine does.
    render(<CaseCompare />);
    pickExample("microscopy");
    expect(screen.getByText(/Cannot be compared with this set/)).toBeTruthy();
  });
});

describe("what the panel says about the instrument", () => {
  it("shows it, and says it decided nothing", () => {
    /*
     * The instrument is exactly what a similarity-based system would retrieve,
     * so a reader noticing that two images came off the same machine is the
     * point of carrying it. Carried without being shown, it told nobody
     * anything.
     */
    render(<CaseCompare />);
    pickExample("microscopy");
    expect(screen.getAllByText(/Zeiss LSM 880/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("not compared").length).toBeGreaterThan(0);
  });
});

describe("the axes are named, not keyed", () => {
  it("writes 'slice thickness' rather than 'sliceThickness'", () => {
    // The labels existed the whole time and the table printed the raw key.
    render(<CaseCompare />);
    const headers = screen.getAllByRole("rowheader").map((h) => h.textContent);
    expect(headers).toContain("slice thickness");
    expect(headers).not.toContain("sliceThickness");
  });
});

describe("what a verdict rests on", () => {
  /*
   * `assessment.evidence` is `Math.min` of the two acquisitions' evidence
   * strength — the honest statement of how much of the verdict was read from
   * the files rather than typed by somebody. It was computed, returned in the
   * assessment, asserted in one unit test, and shown to no reader.
   *
   * Each scan's own figure sits on its caption, so the screen showed "100%
   * read from the file" beside "20%" with a verdict between them and left the
   * reader to work out that a comparison is only as good as its weaker side.
   * Working that out is what this screen exists to do for them.
   */
  it("says so, on the verdict rather than only on each scan", () => {
    render(<CaseCompare />);

    const rests = document.querySelectorAll(".case-rests-on");
    expect(rests.length).toBeGreaterThan(0);
    for (const node of rests) {
      expect(node.textContent).toMatch(/read from the file/);
    }
  });

  it("says it even when everything was read, so silence never means anything",
     () => {
    /*
     * A qualification that appears only when things are bad teaches a reader
     * that its absence means nothing — when in fact its absence would mean
     * everything was read. Both wordings are present in the worked examples,
     * so both are exercised here rather than asserted in the abstract.
     */
    render(<CaseCompare />);
    const all = Array.from(document.querySelectorAll(".case-rests-on"))
      .map((n) => n.textContent ?? "");

    expect(all.every((t) => t.trim().length > 0)).toBe(true);
    // Never a bare percentage with nothing saying what it is of.
    for (const text of all) {
      expect(text).toMatch(/read from the file/);
    }
  });
});

describe("the words a verdict uses belong to its discipline", () => {
  /*
   * The platform is discipline-neutral except where a profile says otherwise,
   * and every sentence in this panel takes its noun from the profile —
   * "Recorded on one image only" against "one scan only". The line saying what
   * a verdict rests on hardcoded "scan", so a micrograph was described as a
   * scan on the one screen built not to do that.
   *
   * Invisible in the medical worked example, which reads correctly by
   * coincidence. Found by switching the picker to Microscopy, which is the
   * whole reason that picker exists.
   */
  it("calls a micrograph an image, not a scan", () => {
    render(<CaseCompare />);
    pickExample("microscopy");

    const said = Array.from(document.querySelectorAll(".case-rests-on"))
      .map((n) => n.textContent ?? "");

    expect(said.length).toBeGreaterThan(0);
    expect(said.some((t) => t.includes("image with less recorded"))).toBe(true);
    for (const text of said) expect(text).not.toMatch(/\bscan\b/);
  });

  it("still calls a scan a scan", () => {
    render(<CaseCompare />);
    pickExample("radiology");

    const said = Array.from(document.querySelectorAll(".case-rests-on"))
      .map((n) => n.textContent ?? "");

    expect(said.some((t) => t.includes("scan with less recorded"))).toBe(true);
  });
});

describe("the worked-example picker and the examples it dispatches", () => {
  /*
   * Two lists that must agree, twenty lines apart in one file.
   *
   * The picker hardcodes three `<option>`s. The dispatch beside it maps
   * `microscopy` and `figure` to their examples and falls through to the
   * radiology one for anything else — and `DomainId` has a fourth member,
   * `image`, so adding it to the picker would silently show a chest CT
   * labelled "Photographs and general images".
   *
   * The file-open picker directly below is built from the profiles, with the
   * comment "a second list is the one that stops being updated when a profile
   * learns a…". This is that second list, in the same file as the argument
   * against it. Hardcoding is right *here* — the question is which disciplines
   * have a worked example, not which exist — so the list stays and the
   * agreement is asserted instead.
   */
  const AXIS_OF = {
    radiology: /modality/i,
    microscopy: /technique|channel/i,
    figure: /plotted quantity|normalisation/i,
  } as const;

  it("offers exactly the disciplines that have an example of their own", () => {
    render(<CaseCompare />);
    const options = within(screen.getByLabelText("Worked example discipline"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);

    expect(options).toEqual(Object.keys(AXIS_OF));
  });

  it("shows each discipline's own axes, not the medical fallback", () => {
    for (const [discipline, axis] of Object.entries(AXIS_OF)) {
      cleanup();
      render(<CaseCompare />);
      pickExample(discipline);

      // The axes tables only. The page's own opening paragraph explains that
      // "a scan is judged on modality, sequence and geometry", so searching
      // the whole body finds that sentence and reports every discipline as
      // having fallen through to the medical example — which is what my first
      // version of this test did.
      const table = Array.from(document.querySelectorAll(".case-axes"))
        .map((t) => t.textContent ?? "").join(" ");
      expect(axis.test(table), `${discipline} did not show its own axes`)
        .toBe(true);

      // The fallback is radiology, so every non-medical discipline must be
      // checked for its *absence* as well — a silent fallthrough shows
      // "modality" and looks like a working profile.
      if (discipline !== "radiology") {
        expect(/modality/i.test(table),
          `${discipline} fell through to the medical example`).toBe(false);
      }
    }
  });
});

describe("the screen speaks the discipline's language too", () => {
  /*
   * `imaging-domains.test.ts` already forbids medical words in a non-medical
   * verdict — it is described there as "the regression this whole change
   * exists to prevent" — and it reads `assess()`'s output: the reasoning, the
   * harmonisation steps, the axis notes. All of it from the library.
   *
   * The screen writes prose of its own, and that is outside the guard. D295
   * was exactly there: "This rests on the scan with less recorded", rendered
   * by `CaseWorkspace` and never seen by the library's own check. The word was
   * caught by switching the picker by hand, which is not a guard.
   *
   * Same regex as the library's, so the two move together. Scoped to the
   * panels rather than the page, because the standing prose above them
   * explains the profiles by naming them — "a scan is judged on modality,
   * sequence and geometry" — and a whole-page match reports that sentence as
   * a leak, which is the mistake D300 records.
   */
  const MEDICAL = /\b(scan|scans|sequence|weighting|Tesla|field strength|lesion|pathology|slice)\b/i;

  for (const discipline of ["microscopy", "figure"] as const) {
    it(`keeps medical words out of the ${discipline} panels`, () => {
      cleanup();
      render(<CaseCompare />);
      pickExample(discipline);

      const panels = Array.from(
        // `.case-note` is the group blurb *inside* a group and also the
        // page's standing explanation above them, which names the disciplines
        // on purpose — "a scan is judged on modality, sequence and geometry".
        // Scoping to the group is the difference between a guard and D300.
        document.querySelectorAll(
          ".case-reasoning, .case-label, .case-group .case-note"))
        .map((n) => n.textContent ?? "");

      expect(panels.length).toBeGreaterThan(0);
      for (const text of panels) {
        const found = text.match(MEDICAL);
        expect(found, `${discipline} panel says "${found?.[0]}": ${text.slice(0, 90)}`)
          .toBeNull();
      }
    });
  }
});
