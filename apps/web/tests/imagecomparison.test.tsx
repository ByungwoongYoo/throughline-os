/**
 * What "nothing was flagged" is allowed to mean.
 *
 * The domain reports which comparisons were actually available, so that
 * "absence is never silent" (§123): with OpenCV missing it says shared-region
 * detection did not run, and that "a panel spliced into part of another figure
 * would not be found."
 *
 * The screen printed that note and then, directly beneath it, the headline
 * "Nothing to look at — no pair was found to share pixels beyond ordinary
 * resemblance." The note is the evidence; the headline was a conclusion the
 * run could not support. In integrity work the direction of that error is the
 * one that matters — a reader takes "nothing to look at" as *these figures are
 * clean*, which is exactly what a missing check cannot establish.
 *
 * `ImageComparison` had no test file.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NothingFlagged } from "@/components/multicompare";

type ChecksRun = { shared_region: boolean; note: string | null };

const ALL_RAN: ChecksRun = { shared_region: true, note: null };
const SOME_SKIPPED: ChecksRun = {
  shared_region: false,
  note: "OpenCV is not installed, so shared-region detection did not run. "
      + "A panel spliced into part of another figure would not be found.",
};

describe("when nothing was flagged", () => {
  it("reports a clean result only when every check ran", () => {
    render(<NothingFlagged checksRun={ALL_RAN} comparisons={6} />);

    expect(screen.getByText(/Nothing to look at/)).toBeTruthy();
    expect(screen.getByText(/beyond ordinary resemblance/)).toBeTruthy();
  });

  it("does not read as clean when a check did not run", () => {
    /*
     * The defect. The check that did not run is the one that finds a panel
     * reused inside a larger figure, which is the case a reader most needs
     * this screen for.
     */
    render(<NothingFlagged checksRun={SOME_SKIPPED} comparisons={6} />);

    expect(screen.queryByText(/Nothing to look at/)).toBeNull();
    expect(screen.getByText(/checks that ran/)).toBeTruthy();
  });

  it("says plainly that absence here is not evidence of absence", () => {
    render(<NothingFlagged checksRun={SOME_SKIPPED} comparisons={6} />);
    expect(screen.getByText(/Not the same as nothing being there/)).toBeTruthy();
  });

  it("does not claim a clean result when no pair was compared at all", () => {
    // Nothing was checked, so nothing here says anything about the images.
    render(<NothingFlagged checksRun={ALL_RAN} comparisons={0} />);

    expect(screen.queryByText(/Nothing to look at/)).toBeNull();
    expect(screen.getByText(/No pair was compared/)).toBeTruthy();
  });

  it("prefers the emptier statement when nothing ran and nothing compared", () => {
    // Both limits at once: having compared nothing is the stronger of the two,
    // because it means the skipped check is not even the reason.
    render(<NothingFlagged checksRun={SOME_SKIPPED} comparisons={0} />);
    expect(screen.getByText(/No pair was compared/)).toBeTruthy();
  });

  it("distinguishes the three cases rather than describing them alike", () => {
    const said = (checksRun: ChecksRun, comparisons: number) => {
      const { container } = render(
        <NothingFlagged checksRun={checksRun} comparisons={comparisons} />);
      return container.textContent;
    };
    expect(new Set([
      said(ALL_RAN, 6), said(SOME_SKIPPED, 6), said(ALL_RAN, 0),
    ]).size).toBe(3);
  });
});
