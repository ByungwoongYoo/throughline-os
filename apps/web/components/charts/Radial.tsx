"use client";

/**
 * P8 — radial (Part F).
 *
 * Polar bars, radial lines, cyclical heat rings. Hour of day, day of week,
 * month of year, compass bearing, phase.
 *
 * **This primitive refuses non-cyclical data, and that is its main feature.**
 *
 * A radial layout says one thing that a Cartesian layout cannot: *the end wraps
 * around to the beginning*. 23:00 is adjacent to 00:00; December is adjacent to
 * January. When that is true, a ring shows a pattern a bar chart cuts in half.
 * When it is false, the ring asserts an adjacency that does not exist — and it
 * costs you two further things at the same time:
 *
 *   - **Angle is read worse than length.** Every study of graphical perception
 *     puts position-along-a-common-scale first and angle far below it.
 *   - **Area grows with the square of the radius.** In a polar *bar* chart the
 *     outer half of a bar sweeps far more ink than the inner half, so a value
 *     of 10 looks more than twice a value of 5.
 *
 * So a radial chart is worth those costs only when the wrap-around is real.
 * Passing `cyclical={false}` renders the Cartesian equivalent instead of a ring
 * and says why — this component will not draw a decorative donut.
 *
 * The second cost is paid down where it can be: bars are drawn **area-true** by
 * default, so the radius encodes √value and equal areas mean equal values.
 * `radiusEncodes="value"` opts back into the naive mapping and the caption then
 * warns that outer values are exaggerated.
 */

import { useId, useMemo } from "react";
import { max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { lineRadial, curveLinearClosed } from "d3-shape";
import { categorical } from "@/lib/tokens";
import { ChartTable } from "./ChartTable";
import { ChartTooltip, readable, useChartHover } from "./interaction";

export type Spoke = {
  /** Stable identity. Object constancy depends on it. */
  id: string;
  /** Display name for the position on the cycle ("03:00", "Mar"). */
  label: string;
  value: number;
  group?: string;
};

const TAU = Math.PI * 2;

export function Radial({
  spokes, valueLabel, cycleLabel, cyclical = true, mark = "bar",
  radiusEncodes = "area", title, caption, size = 460,
}: {
  spokes: Spoke[];
  /** What the magnitude means, in the reader's words. */
  valueLabel: string;
  /** The cycle itself — "hour of day", "month of year". */
  cycleLabel: string;
  /**
   * Whether the last position genuinely wraps to the first. False renders a
   * Cartesian chart instead: a ring would assert an adjacency that is not real.
   */
  cyclical?: boolean;
  mark?: "bar" | "line";
  /**
   * "area" makes radius ∝ √value, so equal areas mean equal values.
   * "value" is the naive mapping and exaggerates the outer end.
   */
  radiusEncodes?: "area" | "value";
  title?: string;
  caption?: string;
  size?: number;
}) {
  const hoverUI = useChartHover();
  const hit = spokes.find((s) => s.id === hoverUI.hovered) ?? null;
  const clipId = useId();

  const peak = max(spokes, (s) => s.value) ?? 0;
  const outer = size / 2 - 46;
  const inner = 34; // A hole: near the centre every bar is a sliver of the same width.

  const hasGroup = spokes.some((s) => s.group !== undefined);
  const tableColumns = [
    { key: "label", header: cycleLabel },
    { key: "value", header: valueLabel, numeric: true },
    ...(hasGroup ? [{ key: "group", header: "Group" }] : []),
  ];
  const tableRows = spokes.map((s) => ({
    id: s.id, label: s.label, value: s.value, group: s.group,
  }));
  const tableLabel = title ?? `${valueLabel} across ${cycleLabel}`;

  const radius = useMemo(() => {
    const scale = scaleLinear().domain([0, peak || 1]).range([0, 1]);
    return (value: number) => {
      const t = scale(Math.max(0, value));
      // Area-true: the swept area of an annular sector is ∝ r² − inner², so
      // radius must go as the square root for equal areas to mean equal values.
      const eased = radiusEncodes === "area" ? Math.sqrt(t) : t;
      return inner + eased * (outer - inner);
    };
  }, [peak, outer, radiusEncodes]);

  // A ring is only honest when the end wraps to the beginning. It does not
  // here, so the Cartesian equivalent is drawn instead of a decorative donut.
  if (!cyclical) {
    const scale = scaleLinear().domain([0, peak || 1]).range([0, size - 160]);
    return (
      <figure className="chart">
        {title && <figcaption className="chart-title">{title}</figcaption>}
        <svg className="chart-svg" style={{ maxWidth: size }} width="100%"
             viewBox={`0 0 ${size} ${spokes.length * 24 + 24}`} role="img"
             aria-label={`${title ?? "Chart"}. ${spokes.length} categories by `
               + `${valueLabel}, drawn as bars because ${cycleLabel} is not cyclical.`}>
          {spokes.map((s, i) => (
            <g key={s.id}
                  {...hoverUI.markProps(s.id)}
                  style={{ opacity: hoverUI.emphasis(s.id) }} transform={`translate(0,${i * 24 + 16})`}>
              <text x={150} y={0} dy="0.32em" textAnchor="end"
                    className="chart-axis-label">{s.label}</text>
              <rect x={158} y={-7} width={Math.max(0, scale(s.value))} height={14}
                    fill={categorical[0]} rx={1} />
              <text x={164 + scale(s.value)} y={0} dy="0.32em"
                    className="tile-value numeric">{s.value.toLocaleString()}</text>
            </g>
          ))}
        </svg>
        <figcaption className="chart-caption">
          {caption ? `${caption} ` : ""}
          Drawn as bars rather than as a ring. A radial layout claims the last
          position is adjacent to the first, and {cycleLabel} does not wrap —
          so a ring would assert a neighbour that is not there, and would trade
          length for angle, which is read less accurately.
        </figcaption>

        <ChartTooltip pointer={hoverUI.pointer} title={hit?.label} rows={hit ? [{ label: valueLabel, value: readable(hit.value) }] : []} />

        <ChartTable
        highlightId={hoverUI.hovered}
        onHighlight={hoverUI.setHovered} columns={tableColumns} rows={tableRows} label={tableLabel} />
      </figure>
    );
  }

  const step = TAU / Math.max(1, spokes.length);
  const centre = size / 2;
  const rings = [0.25, 0.5, 0.75, 1].map((f) => ({ f, r: radius(peak * (radiusEncodes === "area" ? f : f)) }));

  const radialLine = lineRadial<Spoke>()
    .angle((_, i) => i * step)
    .radius((s) => radius(s.value))
    .curve(curveLinearClosed);

  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}

      <svg
        className="chart-svg" style={{ maxWidth: size }} width="100%" viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={
          `${title ?? "Radial chart"}. ${valueLabel} across ${cycleLabel}, `
          + `${spokes.length} positions around a full cycle. Peak ${peak.toLocaleString()} `
          + `at ${spokes.find((s) => s.value === peak)?.label ?? "unknown"}.`}
      >
        <defs><clipPath id={clipId}><circle cx={centre} cy={centre} r={outer + 2} /></clipPath></defs>

        <g transform={`translate(${centre},${centre})`}>
          {/* Gridlines carry the scale. Labelled, because an unlabelled ring
              is the reason radial charts get read as decoration. */}
          {rings.map(({ f, r }) => (
            <g key={f}>
              <circle r={r} className="radial-grid" fill="none" />
              <text x={2} y={-r - 3} className="chart-tick numeric">
                {Math.round(peak * f).toLocaleString()}
              </text>
            </g>
          ))}

          {mark === "line" ? (
            <path d={radialLine(spokes) ?? undefined} className="radial-path"
                  fill={categorical[0]} fillOpacity={0.18}
                  stroke={categorical[0]} strokeWidth={2} />
          ) : (
            spokes.map((s, i) => {
              const a0 = i * step - Math.PI / 2;
              const a1 = a0 + step * 0.86;
              const r = radius(s.value);
              const arc = (rr: number, from: number, to: number) =>
                `${rr * Math.cos(from)},${rr * Math.sin(from)} `
                + `A${rr},${rr} 0 0 1 ${rr * Math.cos(to)},${rr * Math.sin(to)}`;
              return (
                // Keyed by id, so the same position on the cycle stays the same
                // DOM node across a filter and moves rather than being redrawn.
                <path
                  key={s.id}
                  className="radial-bar"
                  d={`M${arc(inner, a0, a1)} L${r * Math.cos(a1)},${r * Math.sin(a1)} `
                     + `A${r},${r} 0 0 0 ${r * Math.cos(a0)},${r * Math.sin(a0)} Z`}
                  fill={categorical[0]}
                  fillOpacity={1}
                />
              );
            })
          )}

          {spokes.map((s, i) => {
            const a = i * step - Math.PI / 2 + step * 0.43;
            const r = outer + 14;
            return (
              <text key={s.id} className="chart-axis-label"
                    x={r * Math.cos(a)} y={r * Math.sin(a)}
                    textAnchor="middle" dy="0.32em">{s.label}</text>
            );
          })}
        </g>
      </svg>

      <figcaption className="chart-caption">
        {caption ? `${caption} ` : ""}
        {valueLabel} across {cycleLabel}; the ring closes because {cycleLabel} does.{" "}
        {radiusEncodes === "area"
          ? "Radius is drawn as the square root of the value, so equal areas "
            + "mean equal values — a bar twice as far out is four times the ink "
            + "otherwise."
          : "Radius is proportional to value, which exaggerates the outer end: "
            + "the same difference sweeps more area further from the centre."}{" "}
        Angle is read less precisely than length, so use this to find *when*
        something peaks, not to compare two positions closely.
      </figcaption>

      <ChartTable columns={tableColumns} rows={tableRows} label={tableLabel} />
    </figure>
  );
}
