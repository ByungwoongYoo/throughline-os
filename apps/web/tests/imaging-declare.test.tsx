/**
 * Stating what the file did not record (§ a third of the model was unreachable).
 *
 * The engine has always had three kinds of evidence — read, stated, unknown —
 * and `evidenceStrength` has always counted a stated fact for half a read one.
 * None of it was reachable: the only call to `declared()` in the whole
 * application was a hard-coded synthetic scan, so a researcher could not state
 * anything, and every real comparison stopped at "cannot be judged" the moment
 * an axis was silent.
 *
 * It bit hardest outside radiology, which is how it survived. A DICOM header
 * states nearly everything; OME-TIFF states most of it but has no field for
 * preparation, and preparation decides what is present to be imaged at all.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Declare, withDeclared } from "@/components/imaging/Declare";
import { assess } from "@/lib/imaging/comparability";
import { DOMAINS, MICROSCOPY, RADIOLOGY } from "@/lib/imaging/domain";
import {
  Acquisition, evidenceStrength, fromHeader,
} from "@/lib/imaging/study";

const micrograph = (over: Record<string, unknown> = {}): Acquisition => ({
  id: "m", label: "section.ome.tif", domain: "microscopy",
  technique: fromHeader("confocal"),
  channel: fromHeader("DAPI"),
  pixelSize: fromHeader(0.2),
  numericalAperture: fromHeader(1.4),
  exposure: fromHeader(200),
  ...over,
});

describe("what it offers to be stated", () => {
  it("offers only the axes the file did not record", () => {
    // Preparation is the one OME cannot supply, and it is exactly the one that
    // keeps two otherwise identical images from being judged.
    render(<Declare acquisition={micrograph()} domain={MICROSCOPY}
                    onDeclare={vi.fn()} />);
    expect(screen.getByLabelText("preparation")).toBeTruthy();
    expect(screen.queryByLabelText("channel or stain")).toBeNull();
    expect(screen.queryByLabelText("imaging technique")).toBeNull();
  });

  it("says why each silent axis matters, next to the field", () => {
    render(<Declare acquisition={micrograph()} domain={MICROSCOPY}
                    onDeclare={vi.fn()} />);
    expect(screen.getByText(/change what is present to be imaged/i)).toBeTruthy();
  });

  it("offers a list where the axis has one, and a field where it does not", () => {
    render(<Declare acquisition={{ id: "a", label: "a", domain: "microscopy" }}
                    domain={MICROSCOPY} onDeclare={vi.fn()} />);
    // A closed vocabulary is a list: an open field lets "confocal" and
    // "Confocal" compare as two techniques.
    expect((screen.getByLabelText("imaging technique") as HTMLElement).tagName)
      .toBe("SELECT");
    // A fluorophore has no closed list, so it stays a field.
    expect((screen.getByLabelText("channel or stain") as HTMLElement).tagName)
      .toBe("INPUT");
  });

  it("says so plainly when there is nothing left to state", () => {
    const complete = micrograph({ preparation: fromHeader("fixed") });
    render(<Declare acquisition={complete} domain={MICROSCOPY}
                    onDeclare={vi.fn()} />);
    expect(screen.getByText(/Nothing to state/i)).toBeTruthy();
  });

  it("reports a statement when one is made", () => {
    const onDeclare = vi.fn();
    render(<Declare acquisition={micrograph()} domain={MICROSCOPY}
                    onDeclare={onDeclare} />);
    fireEvent.change(screen.getByLabelText("preparation"),
                     { target: { value: "fixed" } });
    expect(onDeclare).toHaveBeenCalledWith("preparation", "fixed");
  });

  it("withdraws a statement rather than storing an empty one", () => {
    const onDeclare = vi.fn();
    render(<Declare acquisition={micrograph({ preparation: { value: "live", origin: "declared" } })}
                    domain={MICROSCOPY} onDeclare={onDeclare} />);
    fireEvent.change(screen.getByLabelText("preparation"), { target: { value: "" } });
    expect(onDeclare).toHaveBeenCalledWith("preparation", null);
  });
});

describe("what a statement is worth", () => {
  it("is carried as stated, never as read", () => {
    const stated = withDeclared(micrograph(), "preparation", "fixed");
    expect(stated.preparation).toEqual({ value: "fixed", origin: "declared" });
  });

  it("counts for half of a fact read from the file", () => {
    // Five of six read is 0.833; adding a sixth as stated adds only half a
    // point, so it lands at 0.916 rather than 1.
    const before = evidenceStrength(micrograph());
    const after = evidenceStrength(withDeclared(micrograph(), "preparation", "fixed"));
    expect(before).toBeCloseTo(5 / 6, 5);
    expect(after).toBeCloseTo(5.5 / 6, 5);
  });

  it("will not overwrite something the file recorded", () => {
    /*
     * The refusal is the point rather than a guard against a slip. A header
     * fact and a person's recollection are different evidence, and letting the
     * second replace the first would leave no way to tell afterwards which
     * verdicts rested on which.
     */
    const unchanged = withDeclared(micrograph(), "channel", "GFP");
    expect(unchanged.channel).toEqual({ value: "DAPI", origin: "header" });
  });

  it("says on the verdict that a statement was involved", () => {
    const a = withDeclared(micrograph(), "preparation", "fixed");
    const b = withDeclared({ ...micrograph(), id: "n" }, "preparation", "fixed");
    const finding = assess(a, b).findings.find((f) => f.axis === "preparation");
    expect(finding?.left).toContain("stated, not read from the file");
  });
});

describe("what stating it changes", () => {
  it("turns 'cannot be judged' into a verdict", () => {
    // The whole reason this component exists. Two OME-TIFFs agree on every
    // axis the format records and are still unjudgeable on the one it does not.
    const before = assess(micrograph(), { ...micrograph(), id: "n" });
    expect(before.verdict).toBe("CONCEPTUALLY_COMPARABLE");

    const a = withDeclared(micrograph(), "preparation", "fixed");
    const b = withDeclared({ ...micrograph(), id: "n" }, "preparation", "fixed");
    expect(assess(a, b).verdict).toBe("DIRECTLY_COMPARABLE");
  });

  it("can also produce a refusal, which is just as much an answer", () => {
    // Stating the truth is not the same as stating agreement. A live specimen
    // against a fixed one is a real difference in what was there to image.
    const a = withDeclared(micrograph(), "preparation", "live");
    const b = withDeclared({ ...micrograph(), id: "n" }, "preparation", "fixed");
    const verdict = assess(a, b);
    expect(verdict.verdict).toBe("RELATED_BUT_NOT_COMPARABLE");
    expect(verdict.blocking).toContain("preparation");
  });
});

describe("it knows no discipline", () => {
  it("renders for every profile without naming any of them", () => {
    // A new profile gets this screen for free, and this component never learns
    // what a channel or a contrast phase is.
    for (const domain of DOMAINS) {
      const empty: Acquisition = { id: "x", label: "x", domain: domain.id };
      const { unmount } = render(
        <Declare acquisition={empty} domain={domain} onDeclare={vi.fn()} />);
      for (const axis of domain.axes) {
        expect(screen.getByLabelText(new RegExp(`^${axis.label}`)),
               `${domain.id}.${axis.key}`).toBeTruthy();
      }
      unmount();
    }
  });

  it("shows a unit on a quantity, in that discipline's own terms", () => {
    const empty: Acquisition = { id: "x", label: "x", domain: "radiology" };
    render(<Declare acquisition={empty} domain={RADIOLOGY} onDeclare={vi.fn()} />);
    expect(screen.getByLabelText(/slice thickness \(mm\)/i)).toBeTruthy();
  });
});
