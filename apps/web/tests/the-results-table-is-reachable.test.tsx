/**
 * The results table has a control, not just a route.
 *
 * §74 was a defect twice over for want of exactly this: `authoring` and
 * `render_artifact` were built and tested, and the screen called five routes
 * that did not exist. A capability with no control is a capability nobody has,
 * and the CSV export is the same shape.
 *
 * It sits with the bibliography rather than on the Connections screen because
 * that is where a researcher comes to take things away — and because rendering
 * the whole workspace to find a link means building a dozen fixtures, each a
 * second copy of a contract, which is the failure `tests/setup.ts` documents
 * at length.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultsTable } from "@/components/bibliography";

afterEach(cleanup);

describe("taking the results away", () => {
  it("offers a download rather than a page to copy out of", () => {
    render(<ResultsTable projectId="prj_1" />);
    const link = screen.getByRole("link", { name: /download the results/i });

    // `download`, so the browser saves it. A CSV rendered into a tab is
    // something somebody has to copy by hand into a file, which is how a
    // transcription error gets into their own results.
    expect(link.hasAttribute("download")).toBe(true);
    expect(link.getAttribute("href")).toBe("/api/projects/prj_1/results.csv");
  });

  it("says what is in it, including the rows that did not survive", () => {
    /**
     * A results table containing only the significant rows is the shape of
     * publication bias. The screen says so before the file is opened.
     */
    render(<ResultsTable projectId="prj_1" />);
    expect(screen.getByText(/not only what\s+survived/i)).toBeTruthy();
    expect(screen.getByText(/q-value after correction/i)).toBeTruthy();
  });

  it("points at the project it was given", () => {
    render(<ResultsTable projectId="prj_other" />);
    expect(screen.getByRole("link", { name: /download the results/i })
      .getAttribute("href")).toContain("prj_other");
  });
});
