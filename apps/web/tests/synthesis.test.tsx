/**
 * What a set of papers says taken together.
 *
 * `POST /projects/{id}/synthesis/key-points` had no caller, so the screen
 * built the comparison table and stopped there — leaving the reading across it
 * to the researcher, which is the part the route exists to do without writing
 * a sentence about the findings.
 *
 * Its own summary is why it is shaped the way it is: *"a generated synthesis
 * of five papers is precisely the artifact nobody can check"*. Every point is
 * a count over verified quotations. So the tests here are mostly about the
 * screen not quietly turning an absence into a claim.
 *
 * The screen had no tests at all.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Synthesis } from "@/components/synthesis";
import { ApiError, api } from "@/lib/api";

const PAPERS = [
  { id: "src_1", title: "Karim 2019", dataset: null },
  { id: "src_2", title: "Osei 2020", dataset: null },
];

const MATRIX = {
  cannot_be_compared: [],
  needs_review: [],
  non_independent_clusters: [],
  papers: [
    { source_id: "src_1", title: "Karim 2019", rejected: 0 },
    { source_id: "src_2", title: "Osei 2020", rejected: 0 },
  ],
  rows: [],
  pairs: [],
  missing_extraction: [],
  multiplicity: { papers: 2, pairwise_comparisons: 1, note: "One pair." },
  accuracy: "verified",
};

const POINTS = {
  points: [
    { kind: "partially_stated", field: "design",
      headline: "1 of 2 state their design",
      reading: "The papers that do not are not necessarily worse — but they "
             + "cannot be compared on this row, and a gap is not a null." },
  ],
  method: "deterministic",
  note: "These are counts over verified quotations. Nothing here is a written "
      + "synthesis.",
};

function serve(over: { points?: unknown; pointsFails?: boolean } = {}) {
  return vi.spyOn(api, "post").mockImplementation(async (path: string) => {
    if (String(path).endsWith("/key-points")) {
      if (over.pointsFails) throw new ApiError(400, "Not enough papers read.");
      return (over.points ?? POINTS) as never;
    }
    return MATRIX as never;
  });
}

/** Pick both papers and build the comparison. */
async function compare() {
  render(<Synthesis projectId="prj_1" sources={PAPERS as never} />);
  for (const title of ["Karim 2019", "Osei 2020"]) {
    await userEvent.click(await screen.findByText(title));
  }
  const build = await screen.findByRole("button", { name: /Compare|Build/i });
  await userEvent.click(build);
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("the reading across the set", () => {
  it("asks for it with the same papers as the table", async () => {
    const post = serve();
    await compare();

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [matrixCall, pointsCall] = post.mock.calls;
    expect(matrixCall[0]).toBe("/api/projects/prj_1/synthesis");
    expect(pointsCall[0]).toBe("/api/projects/prj_1/synthesis/key-points");
    expect(pointsCall[1]).toEqual(matrixCall[1]);
  });

  it("shows each point with what it means, not only the count", async () => {
    // "1 of 2 state their design" is a number; the reading is what stops it
    // being taken as a verdict on the paper that did not.
    serve();
    await compare();

    expect(await screen.findByText(/1 of 2 state their design/)).toBeTruthy();
    expect(screen.getByText(/a gap is not a null/)).toBeTruthy();
  });

  it("carries the server's statement of what these are not", async () => {
    /*
     * That nothing here is a written synthesis is the reason it can be
     * trusted, and it belongs on the screen rather than in a docstring.
     */
    serve();
    await compare();
    expect(await screen.findByText(/Nothing here is a written synthesis/))
      .toBeTruthy();
  });
});

describe("an absence is not a claim", () => {
  it("says plainly when nothing stands out", async () => {
    // An empty section under a heading reads as "these papers have nothing in
    // common", which is a finding nobody made.
    serve({ points: { ...POINTS, points: [] } });
    await compare();

    expect(await screen.findByText(/Nothing stands out across this set/))
      .toBeTruthy();
  });

  it("keeps the table when the reading cannot be worked out", async () => {
    /*
     * Two requests, and a failure of the second must not take the first away:
     * a researcher who has the comparison should keep it.
     */
    serve({ pointsFails: true });
    await compare();

    expect(await screen.findByText(/could not be worked out/)).toBeTruthy();
    // And says so, rather than leaving a blank space above a full table.
    expect(screen.getByText(/not the same as it saying nothing/)).toBeTruthy();
  });

  it("does not ask for a reading when the table itself failed", async () => {
    // There is nothing to read across, and a second error would bury the
    // first.
    const post = vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(400, "Only one paper has been read."));
    await compare();

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });
});
