/**
 * A measurement, drawn where it was measured.
 *
 * The profiler has typed a geography column since ingestion was written —
 * `country`, `iso3`, `region` all get `semantic_type: "geography"` — and the
 * only thing that ever read it was the code choosing between a t-test and a
 * correlation. A dataset that knew where its rows were could be drawn as a
 * scatter, a box or a bar, and never on a map.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapView, mappable } from "@/components/mapview";
import type { DatasetColumn } from "@/lib/api";
import { api } from "@/lib/api";

function column(name: string, semantic: string): DatasetColumn {
  return {
    ordinal: 0, name, original_name: name, physical_type: "string",
    semantic_type: semantic, unit: null, missing_count: 0, unique_count: 8,
    statistics: {}, sensitivity: "none",
  };
}

const COLUMNS = [
  column("country", "geography"),
  column("resistance_pct", "continuous"),
  column("consumption_ddd", "continuous"),
  column("region_code", "identifier"),
];

const BODY = {
  place_column: "country", value_column: "resistance_pct",
  value_label: "resistance_pct",
  places: [
    { id: "356", label: "India", as_written: "IND", value: 40.6, n: 20 },
    { id: "840", label: "United States", as_written: "USA", value: 29.7, n: 20 },
  ],
  unmatched: [] as string[],
  note: "The mean resistance_pct of each place, over 40 rows.",
};

beforeEach(() => { vi.restoreAllMocks(); });

describe("what can be mapped", () => {
  it("finds the column the profiler called geography", () => {
    expect(mappable(COLUMNS).place?.name).toBe("country");
  });

  it("offers only continuous columns to draw", () => {
    /*
     * Averaging a category code produces a number and no meaning, and a map of
     * it looks exactly as convincing as a real one.
     */
    expect(mappable(COLUMNS).values.map((c) => c.name))
      .toEqual(["resistance_pct", "consumption_ddd"]);
  });

  it("says there is nowhere to draw when no column is a place", () => {
    render(<MapView versionId="dsv_1" columns={[column("x", "continuous")]} />);
    expect(screen.getByText(/No column of places/)).toBeTruthy();
    expect(screen.getByText(/recognised as geography/)).toBeTruthy();
  });

  it("asks the server for the place column and the chosen measurement", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(BODY as never);
    render(<MapView versionId="dsv_1" columns={COLUMNS} />);

    await waitFor(() => expect(get).toHaveBeenCalledWith(
      "/api/dataset-versions/dsv_1/by-place?place=country&value=resistance_pct"));
  });
});

describe("what the map is allowed to imply", () => {
  it("names the places it could not recognise", async () => {
    /*
     * The failure a choropleth makes invisible: a country absent from the map
     * reads as nothing measured there, not as a name nobody matched.
     */
    vi.spyOn(api, "get").mockResolvedValue({
      ...BODY, unmatched: ["Freedonia", "Ruritania"],
    } as never);
    render(<MapView versionId="dsv_1" columns={COLUMNS} />);

    expect(await screen.findByText(/Freedonia, Ruritania/)).toBeTruthy();
    expect(screen.getByText(/reads as nothing measured there/)).toBeTruthy();
  });

  it("says nothing about unmatched places when every one was recognised", async () => {
    vi.spyOn(api, "get").mockResolvedValue(BODY as never);
    render(<MapView versionId="dsv_1" columns={COLUMNS} />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByText(/could not be recognised/)).toBeNull();
  });

  it("reports a failure rather than an empty map", async () => {
    // An empty map and a map that could not be built look identical, and one
    // of them is a statement about the data.
    vi.spyOn(api, "get").mockRejectedValue(new Error("no such dataset"));
    render(<MapView versionId="dsv_1" columns={COLUMNS} />);

    expect(await screen.findByText(/That did not work/)).toBeTruthy();
  });
});
