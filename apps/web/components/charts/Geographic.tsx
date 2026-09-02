"use client";

/**
 * P12 — geographic surfaces (Part F).
 *
 * Choropleths and proportional-symbol maps over countries.
 *
 * Three decisions, each of which is a correctness rule rather than a style
 * preference.
 *
 * **1. Counts are not shaded — they are drawn as symbols.**
 * Shading a country by a raw count produces a map of where people live. India
 * has more of nearly everything than Iceland, so a choropleth of counts is a
 * population map wearing your variable's name. Passing `measure="count"`
 * therefore switches to proportional circles, whose area is the count and whose
 * position is the country, and which make no claim about the territory's
 * interior. To shade, give a denominator and the primitive computes the rate.
 *
 * **2. The projection is equal-area, not Mercator.**
 * A choropleth&apos;s visual weight *is* area, so a projection that distorts area
 * distorts the data. Mercator inflates Greenland to roughly the size of Africa,
 * which is fourteen times too large. Equal Earth keeps areas true.
 *
 * **3. Missing is drawn differently from zero.**
 * A country with no data and a country measured at zero look identical on every
 * default colour ramp, and they mean opposite things. Missing is hatched and
 * counted in the caption.
 *
 * The topology is bundled (`world-atlas`, 110m) and read from disk — nothing is
 * fetched, which the local-first premise requires.
 */

import { useId, useMemo, useState } from "react";
import { extent } from "d3-array";
import { scaleLinear, scaleSqrt } from "d3-scale";
import { geoEqualEarth, geoPath, geoGraticule10 } from "d3-geo";
import { interpolateYlGnBu } from "d3-scale-chromatic";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import { ChartTable } from "./ChartTable";
import { ChartTooltip, readable, useChartHover } from "./interaction";

export type Place = {
  /** ISO 3166-1 numeric id, matching the bundled topology. */
  id: string;
  /** Display name (Part C). */
  label: string;
  value: number;
  /** Population, or whatever the rate should be per. Required to shade. */
  denominator?: number;
};

const M = { top: 4, right: 4, bottom: 4, left: 4 };

/**
 * Stable identity for a country, which is not always its id.
 *
 * `world-atlas` carries the ISO numeric code as `feature.id`, and **three of
 * its 177 features have none**: N. Cyprus, Somaliland and Kosovo. That is not a
 * defect in the data — Natural Earth assigns no ISO numeric code to a territory
 * whose sovereignty is disputed, so the gap is the map telling the truth about
 * the world.
 *
 * Keying on `String(feature.id)` turned all three into the literal string
 * "undefined", so React saw three children sharing one key and warned that
 * children may be "duplicated and/or omitted". On a map, an omitted child is a
 * country silently missing from the picture.
 *
 * The name is prefixed rather than used bare, so a fallback can never collide
 * with a real numeric id.
 *
 * Exported because `Globe3D` joins the same places to the same topology and
 * must agree about what a country *is*. A second copy of this would put those
 * three territories on one chart and not the other, and the reasoning above is
 * exactly the kind that does not survive being written twice.
 */
export function identity(feature: Feature<Geometry, { name?: string }>): string {
  return feature.id !== undefined
    ? String(feature.id)
    : `name:${feature.properties?.name ?? "unnamed"}`;
}


export function Geographic({
  places, world, measure, valueLabel, perLabel = "100,000 people",
  title, caption, width = 820, height = 420,
}: {
  places: Place[];
  /** Countries as GeoJSON. Converted from the bundled topology by the caller. */
  world: FeatureCollection<Geometry, { name?: string }>;
  /**
   * How the number relates to the place, which decides how it may be drawn.
   *
   * - `"rate"` shades by value ÷ denominator: a count made comparable.
   * - `"count"` draws proportional circles — shading a count maps population,
   *   not the variable.
   * - `"intensive"` shades the value directly. A mean, a percentage or a
   *   concentration is *already* per-something, so dividing it again would be
   *   wrong and drawing it as circle area would read as a total. This is what
   *   a summarised measurement per place actually is, and without it such a
   *   value had to borrow one of the other two and misdescribe itself.
   */
  measure: "rate" | "count" | "intensive";
  valueLabel: string;
  perLabel?: string;
  title?: string;
  caption?: string;
  width?: number;
  height?: number;
}) {
  const hoverUI = useChartHover();
  const hit = places.find((p) => p.id === hoverUI.hovered) ?? null;
  const clipId = useId();
  const [hover, setHover] = useState<string | null>(null);
  const inner = { w: width - M.left - M.right, h: height - M.top - M.bottom };

  const byId = useMemo(() => new Map(places.map((p) => [String(p.id), p])), [places]);

  // Shading a count would draw a population map, so a count without a
  // denominator is rendered as symbols instead of being silently shaded.
  const missingDenominators = useMemo(
    () => (measure === "rate" ? places.filter((p) => !p.denominator) : []),
    [places, measure]);

  const rateOf = (p: Place) =>
    p.denominator ? (p.value / p.denominator) * 100_000 : null;

  const { path } = useMemo(() => {
    // Equal Earth: a choropleth&apos;s visual weight is area, so the projection has
    // to keep area true or it distorts the data itself.
    const proj = geoEqualEarth().fitExtent(
      [[M.left, M.top], [inner.w, inner.h]], world);
    return { path: geoPath(proj) };
  }, [world, inner.w, inner.h]);

  const values = useMemo(() => places
    .map((p) => (measure === "rate" ? rateOf(p) : p.value))
    .filter((v): v is number => v !== null && Number.isFinite(v)),
    [places, measure]);
  const [lo, hi] = extent(values) as [number, number];

  const colour = scaleLinear<number>().domain([lo ?? 0, hi ?? 1]).range([0, 1]);
  const radius = scaleSqrt().domain([0, hi ?? 1]).range([0, 26]);

  const withData = places.filter((p) =>
    measure === "rate" ? rateOf(p) !== null : Number.isFinite(p.value));
  const drawn = new Set(withData.map((p) => String(p.id)));
  const undrawn = world.features.filter(
    (f) => !drawn.has(identity(f))).length;

  const label = (f: Feature<Geometry, { name?: string }>) =>
    byId.get(identity(f))?.label ?? f.properties?.name ?? identity(f);

  const hasDenominator = places.some((p) => p.denominator !== undefined);
  const tableColumns = [
    { key: "label", header: "Place" },
    { key: "value", header: valueLabel, numeric: true },
    ...(hasDenominator ? [{ key: "denominator", header: "Denominator", numeric: true }] : []),
  ];
  const tableRows = places.map((p) => ({
    label: p.label, value: p.value, denominator: p.denominator,
  }));

  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}

      <svg
        className="chart-svg map" width="100%" viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={
          `${title ?? "Map"}. ${valueLabel} for ${withData.length} countries, `
          + (measure === "rate"
             ? `shaded as a rate per ${perLabel}. `
             : measure === "intensive"
             ? `shaded directly, because ${valueLabel} is already a per-unit `
               + `quantity. `
             : `drawn as circles whose area is the count. `)
          + `${undrawn} countries have no data and are hatched.`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={width} height={height} />
          </clipPath>
          {/* Missing must not look like zero — they mean opposite things. */}
          <pattern id={`${clipId}-none`} width={5} height={5}
                   patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={5} height={5} className="map-missing-bg" />
            <line x1={0} y1={0} x2={0} y2={5} className="map-missing-line" />
          </pattern>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          <path d={path(geoGraticule10()) ?? undefined} className="map-graticule"
                fill="none" />

          {world.features.map((feature) => {
            const place = byId.get(identity(feature));
            const value = place
              ? (measure === "rate" ? rateOf(place) : place.value)
              : null;
            const has = value !== null && Number.isFinite(value);
            return (
              // Keyed by identity, so a country is the same DOM node across a
              // filter and its fill transitions rather than being redrawn.
              <path
                key={identity(feature)}
                className="map-country"
                d={path(feature) ?? undefined}
                fill={
                  !has || measure === "count"
                    ? `url(#${clipId}-none)`
                    : interpolateYlGnBu(colour(value as number))
                }
                fillOpacity={has || measure === "count" ? 1 : 0.5}
                onMouseEnter={() => setHover(identity(feature))}
                onMouseLeave={() => setHover(null)}
              >
                <title>
                  {label(feature)}
                  {has
                    ? measure === "rate"
                      ? ` — ${(value as number).toFixed(1)} per ${perLabel}`
                        + ` (${place?.value.toLocaleString()} of `
                        + `${place?.denominator?.toLocaleString()})`
                      : ` — ${(value as number).toLocaleString()} ${valueLabel}`
                    : " — no data"}
                </title>
              </path>
            );
          })}

          {/* Counts as area, positioned at the country's centroid: a circle
              claims a quantity is located there, not spread over the whole
              territory, which is the honest claim for a count. */}
          {measure === "count" && withData.map((place) => {
            const feature = world.features.find(
              (f) => String(f.id) === String(place.id));
            if (!feature) return null;
            const centre = path.centroid(feature);
            if (!Number.isFinite(centre[0])) return null;
            return (
              <circle
                key={place.id}
                {...hoverUI.markProps(place.id)}
                style={{ opacity: hoverUI.emphasis(place.id) }}
                className="map-symbol"
                cx={centre[0]} cy={centre[1]} r={radius(place.value)}
                onMouseEnter={() => setHover(String(place.id))}
                onMouseLeave={() => setHover(null)}
              >
                <title>{place.label} — {place.value.toLocaleString()} {valueLabel}</title>
              </circle>
            );
          })}
        </g>

        {/* Legend. A choropleth without one is a picture. */}
        <g transform={`translate(${width - 190},${height - 34})`}>
          {measure !== "count" ? (
            <>
              {Array.from({ length: 20 }, (_, i) => (
                <rect key={i} x={i * 8} y={0} width={8} height={9}
                      fill={interpolateYlGnBu(i / 19)} />
              ))}
              <text x={0} y={22} className="chart-tick numeric">
                {(lo ?? 0).toFixed(1)}
              </text>
              <text x={160} y={22} textAnchor="end" className="chart-tick numeric">
                {(hi ?? 0).toFixed(1)}
              </text>
              <text x={0} y={-5} className="chart-tick">
                {measure === "rate" ? `per ${perLabel}` : valueLabel}
              </text>
            </>
          ) : (
            [0.25, 1].map((f, i) => (
              <g key={f} transform={`translate(${i * 70},0)`}>
                <circle className="map-symbol" cx={26} cy={4}
                        r={radius((hi ?? 1) * f)} />
                <text x={26} y={26} textAnchor="middle" className="chart-tick numeric">
                  {Math.round((hi ?? 1) * f).toLocaleString()}
                </text>
              </g>
            ))
          )}
        </g>
      </svg>

      <figcaption className="chart-caption">
        {caption ? `${caption} ` : ""}
        {measure === "rate" ? (
          <>
            {valueLabel} per {perLabel}, shaded. A rate rather than a count,
            because shading a count shades population: a larger or more
            populous country has more of nearly everything.
          </>
        ) : measure === "intensive" ? (
          <>
            {valueLabel}, shaded directly. It is already a per-unit quantity —
            a mean, a share or a concentration — so it is comparable between
            places without a denominator, and dividing it by one again would
            describe nothing. Shading is honest here for the same reason it is
            dishonest for a count.
          </>
        ) : (
          <>
            {valueLabel} as circle area, not as shading. Shading a raw count
            would produce a map of where people live rather than of this
            variable — to shade, supply a denominator and this becomes a rate.
          </>
        )}{" "}
        Drawn on an Equal Earth projection, which keeps areas true; Mercator
        would render Greenland about fourteen times too large and a choropleth&apos;s
        visual weight is its area.{" "}
        {undrawn > 0 && (
          <>
            <b>{undrawn} countries have no data</b> and are hatched rather than
            shaded — a country measured at zero and a country never measured
            look identical on a colour ramp and mean opposite things.{" "}
          </>
        )}
        {missingDenominators.length > 0 && (
          <>
            {missingDenominators.length} countries have a value but no
            denominator and cannot be shown as a rate:{" "}
            {missingDenominators.slice(0, 4).map((p) => p.label).join(", ")}
            {missingDenominators.length > 4 && ", …"}.{" "}
          </>
        )}
        Area is territory, not importance — a large sparsely-populated country
        occupies more of this map than a small dense one at the same rate.
        {hover && byId.get(hover) && (
          <> Showing <b>{byId.get(hover)!.label}</b>.</>
        )}
      </figcaption>

      <ChartTooltip pointer={hoverUI.pointer} title={hit?.label} rows={hit ? [{ label: valueLabel, value: readable(hit.value) }] : []} />

      <ChartTable
        highlightId={hoverUI.hovered}
        onHighlight={hoverUI.setHovered}
        columns={tableColumns}
        rows={tableRows}
        label={title ?? `${valueLabel} by country`}
      />
    </figure>
  );
}
