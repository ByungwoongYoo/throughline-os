"use client";

/**
 * A measurement, drawn where it was measured.
 *
 * The profiler has recognised a geography column since ingestion was written —
 * `country`, `iso3`, `region` and the rest are typed `geography` — and the only
 * thing that ever read it was the code choosing between a t-test and a
 * correlation. A dataset that knows where its rows are could be drawn as a
 * scatter, a box or a bar, and never on a map.
 *
 * **The mean, and what it rests on.** Eight rows and eight hundred shade
 * identically, so every place carries its own `n` and the table beneath shows
 * it.
 *
 * **Places that could not be recognised are named.** A country missing from a
 * choropleth reads as *nothing was measured there*, which is a different claim
 * from *we did not recognise the name in your file*. The server returns both
 * halves and this says the second one.
 */

import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import { Geographic, Place } from "@/components/charts/Geographic";
import { DatasetColumn } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "./primitives";

type ByPlace = {
  place_column: string;
  value_column: string;
  value_label: string;
  places: Array<{ id: string; label: string; as_written: string; value: number; n: number }>;
  unmatched: string[];
  note: string;
};

/** The column a map needs, and the ones it can draw. */
export function mappable(columns: DatasetColumn[]): {
  place: DatasetColumn | null; values: DatasetColumn[];
} {
  return {
    place: columns.find((c) => c.semantic_type === "geography") ?? null,
    // Continuous only. Averaging a category code produces a number and no
    // meaning, and a map of it would look exactly as convincing as a real one.
    values: columns.filter((c) => c.semantic_type === "continuous"),
  };
}

export function MapView({ versionId, columns }: {
  versionId: string | null;
  columns: DatasetColumn[];
}) {
  const { place, values } = useMemo(() => mappable(columns), [columns]);
  const [value, setValue] = useState<string>("");
  const chosen = value || values[0]?.name || "";

  const [world, setWorld] = useState<
    FeatureCollection<Geometry, { name?: string }> | null>(null);
  const [worldFailed, setWorldFailed] = useState(false);

  // Bundled rather than fetched, but 105KB, so it loads when a map is asked
  // for instead of sitting in the workspace's main bundle.
  useEffect(() => {
    if (!place) return;
    let live = true;
    Promise.all([
      import("world-atlas/countries-110m.json"),
      import("topojson-client"),
    ]).then(([atlas, topojson]) => {
      if (!live) return;
      const topology = (atlas.default ?? atlas) as never;
      setWorld(topojson.feature(
        topology,
        (topology as { objects: { countries: unknown } }).objects.countries as never,
      ) as never);
    }).catch(() => { if (live) setWorldFailed(true); });
    return () => { live = false; };
  }, [place]);

  const data = useApi<ByPlace>(
    versionId && place && chosen
      ? `/api/dataset-versions/${versionId}/by-place`
        + `?place=${encodeURIComponent(place.name)}&value=${encodeURIComponent(chosen)}`
      : null,
    [versionId, place?.name, chosen]);

  if (!place) {
    return (
      <Empty
        title="No column of places"
        hint={"A map needs a column the profiler recognised as geography — a "
              + "country, an ISO code, a region. This dataset has none, so "
              + "there is nowhere to draw."}
      />
    );
  }

  return (
    <>
      <label className="row" style={{ gap: 8, alignItems: "center" }}>
        Draw
        <select value={chosen} onChange={(e) => setValue(e.target.value)}
                style={{ width: "auto", minWidth: 200 }}>
          {values.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        by {place.name}
      </label>

      {worldFailed && (
        <Failure error={new Error(
          "The world topology could not be loaded, so there is no map to draw "
          + "on. The numbers are unaffected.")} />
      )}
      {data.error && <Failure error={data.error} retry={data.reload} />}
      {(data.loading || (!world && !worldFailed)) && (
        <Loading rows={4} label="Reading the measurements by place" />
      )}

      {world && data.data && (
        <>
          <Geographic
            places={data.data.places.map((p): Place => ({
              id: p.id, label: p.label, value: p.value,
            }))}
            world={world}
            /*
             * Intensive, not a rate and not a count: this is a mean of a
             * per-unit measurement. Shading it is honest; dividing it by a
             * population again would describe nothing, and circle area would
             * read as a total.
             */
            measure="intensive"
            valueLabel={data.data.value_label}
            title={`${data.data.value_label} by ${place.name}`}
            caption={data.data.note}
          />

          {data.data.unmatched.length > 0 && (
            <p className="notice" role="status">
              {data.data.unmatched.length} place
              {data.data.unmatched.length === 1 ? "" : "s"} in {place.name} could
              not be recognised, so {data.data.unmatched.length === 1 ? "it is" : "they are"}{" "}
              not on the map: {data.data.unmatched.slice(0, 8).join(", ")}. A gap
              on a map reads as nothing measured there, which is not what this is.
            </p>
          )}
        </>
      )}
    </>
  );
}
