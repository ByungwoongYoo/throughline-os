/**
 * What this project has already worked out about its datasets.
 *
 * Every compatibility assessment is stored — verdict, reasoning, what blocked
 * it — and `GET /projects/{id}/compatibility` returned them to nobody. A
 * researcher with six datasets asked the same question about the same pair as
 * often as they happened to select it, and never saw that they had asked
 * before.
 *
 * The care these tests are about is that an old verdict is not presented as a
 * current one. A version id is immutable, so the datasets have not moved — but
 * the answer depends on harmonisation too, and approving a variable label
 * since then can turn a blocking difference into a shared dimension.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Compare } from "@/components/compare";
import type { Source } from "@/lib/api";
import { api } from "@/lib/api";

const SOURCES = [
  { id: "src_1", title: "Nine countries, 2019",
    dataset: { dataset_version_id: "dsv_1", row_count: 120, column_count: 6 } },
  { id: "src_2", title: "Hospital panel",
    dataset: { dataset_version_id: "dsv_2", row_count: 400, column_count: 9 } },
] as unknown as Source[];

const STORED = [
  {
    id: "cmp_1",
    left_id: "dsv_1",
    right_id: "dsv_2",
    verdict: "NOT_MEANINGFULLY_COMPARABLE",
    label: "Not meaningfully comparable",
    reasoning: "One counts patients, the other counts hospitals.",
    shared_dimensions: [],
    blocking_differences: ["unit of observation"],
    harmonization_required: [],
    created_at: "2026-08-20T10:00:00Z",
  },
];

function serve(assessments: unknown = STORED) {
  return vi.spyOn(api, "get").mockResolvedValue(assessments as never);
}

const sourcesState = {
  data: SOURCES, error: null, loading: false, reload: vi.fn(), setData: vi.fn(),
};

const show = () =>
  render(<Compare projectId="prj_1" sources={sourcesState as never} />);

beforeEach(() => { vi.restoreAllMocks(); });

describe("what has already been checked", () => {
  it("names the pair the way the researcher names it", async () => {
    // A version id is what the row stores and not what anybody calls it.
    serve();
    show();
    expect(await screen.findByText(/Nine countries, 2019 ↔ Hospital panel/))
      .toBeTruthy();
  });

  it("falls back to the id when either dataset is gone", async () => {
    /*
     * The assessment outlives the dataset, and an empty cell where a name
     * belongs reads as a bug rather than as a removed source. Both sides,
     * because they are separate expressions — asserting one leaves the other
     * free to render nothing.
     */
    serve([{ ...STORED[0], left_id: "dsv_left_gone",
             right_id: "dsv_right_gone" }]);
    show();
    expect(await screen.findByText(/dsv_left_gone ↔ dsv_right_gone/))
      .toBeTruthy();
  });

  it("shows the verdict in the server's own words", async () => {
    /*
     * The label travels with the verdict rather than being mapped again here.
     * A second copy of that vocabulary in this file is a second thing to keep
     * in step, and the one place this repository did copy such a map needed a
     * test to stop the two drifting.
     */
    serve();
    show();
    expect(await screen.findByText(/not meaningfully comparable/)).toBeTruthy();
  });

  it("says the answer was true when it was made, not that it is true now", async () => {
    // Approving a variable label since then can change it, and presenting an
    // old verdict as current would be the screen asserting something nobody
    // rechecked.
    serve();
    show();
    expect(await screen.findByText(/was the answer when it was made/)).toBeTruthy();
  });

  it("names what would have to be harmonised, rather than counting it", async () => {
    // "2 things" is a number to scroll past; the columns are what somebody has
    // to go and do.
    serve([{ ...STORED[0], harmonization_required: ["age_band", "site_code"] }]);
    show();
    expect(await screen.findByText(/age_band, site_code/)).toBeTruthy();
  });

  it("shows nothing at all when the project has checked nothing", async () => {
    // A panel saying "no assessments yet" is a heading over an absence on a
    // screen whose whole job is the thing that has not happened.
    const get = serve([]);
    show();
    /*
     * Flushed rather than waited for. `waitFor` on an absence passes on its
     * first evaluation — before the fetch has resolved — so it would report
     * success against a screen that had not yet had the chance to render the
     * thing it is checking is not there.
     */
    await waitFor(() => expect(get).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/Already checked/)).toBeNull();
  });
});
