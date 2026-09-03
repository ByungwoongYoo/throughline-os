/**
 * The profiler's warnings appear on the screen that shows the columns.
 *
 * `columnNotices` is well tested on its own. So was `RecordFinding` when its
 * caller computed the wrong flag — a helper that is right and never called is
 * the failure this codebase keeps finding, so the caller is tested here.
 *
 * `possible_sentinel_values` is the case that had been recorded on every
 * profile since the profiler was written and displayed nowhere: a column where
 * -999 means "missing" goes into an average as minus nine hundred and
 * ninety-nine, and nothing in the product said so.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceDetail } from "@/components/views";
import { api } from "@/lib/api";

const SOURCE = {
  id: "src_1", title: "Resistance panel", ingestion_status: "ready",
  paper: null,
  dataset: { dataset_version_id: "dsv_1", row_count: 120, column_count: 3 },
};

function column(over: Record<string, unknown> = {}) {
  return {
    ordinal: 0, name: "resistance_pct", original_name: "resistance_pct",
    physical_type: "number", semantic_type: "outcome", unit: "%",
    missing_count: 0, unique_count: 118, sensitivity: "none",
    statistics: {}, ...over,
  };
}

function serve(columns: unknown[]) {
  return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.includes("/columns")) return columns as never;
    if (path.includes("/sources/")) return SOURCE as never;
    return [] as never;
  });
}

function view() {
  return render(
    <SourceDetail projectId="prj_1" sourceId="src_1" onDiscover={() => {}} />,
  );
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("what the researcher is told about a column", () => {
  it("shows the column at all, so a blank screen cannot pass this file", async () => {
    serve([column()]);
    view();
    expect(await screen.findByText("resistance_pct")).toBeTruthy();
  });

  it("says when a sentinel code is sitting in the numbers", async () => {
    serve([column({ statistics: { possible_sentinel_values: [-999] } })]);
    view();
    await waitFor(() =>
      expect(screen.getByText(/-999/)).toBeTruthy());
    // Not /missing/i — the table's own "Missing" column header matches that.
    expect(screen.getByText(/often mean .missing./)).toBeTruthy();
  });

  it("says when a column of numbers was read as text", async () => {
    serve([column({
      physical_type: "string",
      statistics: {
        reads_as_number_with_decimal_comma: {
          confidence: "certain", min: 25.1, max: 31,
          note: "These values are stored as text because the numbers are "
            + "written with a decimal comma.",
        },
      },
    })]);
    view();
    await waitFor(() =>
      expect(screen.getByText(/written with a decimal comma/)).toBeTruthy());
  });

  it("adds nothing to a column the profiler had no comment on", async () => {
    serve([column()]);
    view();
    await screen.findByText("resistance_pct");
    expect(screen.queryByText(/decimal comma/)).toBeNull();
    expect(screen.queryByText(/often mean/)).toBeNull();
  });
});
