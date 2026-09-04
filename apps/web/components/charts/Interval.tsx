"use client";

/**
 * P2 — estimate + interval (Part F).
 *
 * Forest plot, coefficient plot, error bars, Bland–Altman, fan chart. One
 * primitive: a point estimate with a range around it, laid against a reference
 * line at the null.
 *
 * This is the primitive that makes uncertainty visible, which is why it is
 * second in the build order rather than tenth. A scatter shows a relationship;
 * a forest plot shows how much of what you are looking at could be noise. For
 * a discovery run in particular it is the honest summary — twenty-one intervals
 * side by side, most of them crossing zero, is a truer picture of the run than
 * the one row that survived.
 *
 * **The null line is not decoration.** An interval that crosses it is
 * consistent with no relationship, and the chart marks that difference in
 * weight and in words rather than leaving the reader to eyeball the crossing.
 *
 * Motion signature: the estimate slides outward from the null while its
 * interval extends at the same time — so the eye reads *how far from nothing*
 * as the animation resolves, rather than seeing a finished bar appear.
 */

import { useId, useMemo } from "react";
import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { semantic } from "@/lib/tokens";
import { ChartTable } from "./ChartTable";
import { ChartTooltip, readable, useChartHover } from "./interaction";

export type Estimate = {
  id: string;
  /** Display label. A raw column name here is a defect (Part C). */
  label: string;
  estimate: number;
  lo: number;
  hi: number;
  /** Used only to mark which rows survived correction, never to rank them. */
  significant?: boolean;
  n?: number;
};

const M = { top: 16, right: 20, bottom: 44, left: 220 };
const ROW = 26;

export function Interval({
  estimates, xLabel, title, caption, nullValue = 0, width = 720,
}: {
  estimates: Estimate[];
  xLabel: string;
  title?: string;
  caption?: string;
  /** Where "no relationship" sits. Zero for correlations, one for ratios. */
  nullValue?: number;
  width?: number;
}) {
  const hover = useChartHover();
  const hoveredEstimate = estimates.find((e) => e.id === hover.hovered) ?? null;
  const clipId = useId();
  const height = M.top + M.bottom + estimates.length * ROW;
  const inner = { w: width - M.left - M.right, h: estimates.length * ROW };

  const xScale = useMemo(() => {
    const values = estimates.flatMap((e) => [e.lo, e.hi, e.estimate]).concat(nullValue);
    const [lo, hi] = extent(values) as [number, number];
    const pad = (hi - lo) * 0.08 || 0.1;
    return scaleLinear().domain([lo - pad, hi + pad]).range([0, inner.w]).nice();
  }, [estimates, inner.w, nullValue]);

  const ticks = xScale.ticks(6);
  const nullX = xScale(nullValue);

  // n / significant only appear when at least one estimate actually carries
  // them — most callers will have both, but neither is required.
  const hasN = estimates.some((e) => e.n !== undefined);
  const hasSignificance = estimates.some((e) => e.significant !== undefined);
  const tableColumns = [
    { key: "label", header: "Label" },
    { key: "estimate", header: xLabel, numeric: true },
    { key: "lo", header: "Low", numeric: true },
    { key: "hi", header: "High", numeric: true },
    ...(hasN ? [{ key: "n", header: "n", numeric: true }] : []),
    ...(hasSignificance ? [{ key: "significant", header: "Significant" }] : []),
  ];
  const tableRows = estimates.map((e) => ({
    id: e.id,
    label: e.label,
    estimate: e.estimate,
    lo: e.lo,
    hi: e.hi,
    n: e.n,
    significant: e.significant === undefined ? undefined : (e.significant ? "yes" : "no"),
  }));

  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}

      <svg
        className="chart-svg" style={{ maxWidth: width }}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={
          `${title ?? "Forest plot"}. ${estimates.length} estimates with confidence `
          + `intervals. ${estimates.filter((e) => e.significant).length} exclude the `
          + `null value; the rest are consistent with no relationship.`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={-8} width={inner.w} height={inner.h + 16} />
          </clipPath>
        </defs>

        <g transform={`translate(${M.left},${M.top})`}>
          {/* The null line, drawn before the data so estimates sit over it. */}
          <line className="chart-null" x1={nullX} x2={nullX} y1={-6} y2={inner.h} />

          <g clipPath={`url(#${clipId})`}>
            {estimates.map((e, i) => {
              const y = i * ROW + ROW / 2;
              const crosses = e.lo <= nullValue && e.hi >= nullValue;
              // Colour is never the only signal: rows that cross the null are
              // also drawn lighter and labelled in the row beneath.
              /*
               * A neutral for an interval that crosses the null, and a
               * *visible* one. `--n-400` measured 2.60:1 against the dark
               * page — under the 3:1 a data mark needs — so an estimate the
               * data does not support was the hardest one to see. `--n-500`
               * is 4.34 and still reads as grey rather than as a verdict.
               */
              const colour = crosses ? "var(--n-500)" : semantic.positive;
              return (
                // Keyed by estimate id, so re-sorting moves a row rather than
                // rebuilding it — the reader can follow one study through a
                // reorder (Part D2, object constancy).
                <g key={e.id} className="chart-row" transform={`translate(0,${y})`}
                   style={{ opacity: hover.emphasis(e.id) }}
                   {...hover.markProps(e.id)}>
                  <line
                    className="chart-ci"
                    x1={xScale(e.lo)} x2={xScale(e.hi)} y1={0} y2={0}
                    style={{ stroke: colour }}
                  />
                  {/* Caps make the interval's extent unambiguous at a glance. */}
                  <line className="chart-cap" x1={xScale(e.lo)} x2={xScale(e.lo)}
                        y1={-4} y2={4} style={{ stroke: colour }} />
                  <line className="chart-cap" x1={xScale(e.hi)} x2={xScale(e.hi)}
                        y1={-4} y2={4} style={{ stroke: colour }} />
                  <rect
                    className="chart-estimate"
                    x={xScale(e.estimate) - 4}
                    y={-4}
                    width={8}
                    height={8}
                    style={{ fill: colour }}
                  >
                    <title>
                      {`${e.label}: ${e.estimate.toFixed(3)} `
                       + `(${e.lo.toFixed(3)} to ${e.hi.toFixed(3)})`}
                    </title>
                  </rect>
                </g>
              );
            })}
          </g>

          {/* Row labels, outside the clip so long names are never cut. */}
          {estimates.map((e, i) => (
            <text key={`l-${e.id}`} className="chart-row-label"
                  x={-12} y={i * ROW + ROW / 2 + 4} textAnchor="end">
              {e.label.length > 34 ? `${e.label.slice(0, 32)}…` : e.label}
            </text>
          ))}

          <line className="chart-axis" x1={0} x2={inner.w} y1={inner.h} y2={inner.h} />
          {ticks.map((t) => (
            <text key={t} className="chart-tick" x={xScale(t)} y={inner.h + 16}
                  textAnchor="middle">{t}</text>
          ))}
          <text className="chart-axis-label" x={inner.w / 2} y={inner.h + 36}
                textAnchor="middle">{xLabel}</text>
          <text className="chart-null-label" x={nullX} y={-10} textAnchor="middle">
            no relationship
          </text>
        </g>
      </svg>

      {caption && <figcaption className="chart-caption">{caption}</figcaption>}

      <ChartTooltip
        pointer={hover.pointer}
        title={hoveredEstimate?.label}
        rows={hoveredEstimate ? [
          { label: xLabel, value: readable(hoveredEstimate.estimate) },
          { label: "interval",
            value: `${readable(hoveredEstimate.lo)} to ${readable(hoveredEstimate.hi)}` },
          ...(hoveredEstimate.n !== undefined
            ? [{ label: "n", value: readable(hoveredEstimate.n) }] : []),
          { label: "after correction",
            value: hoveredEstimate.significant ? "excludes the null" : "consistent with none" },
        ] : []}
      />

      <ChartTable
        highlightId={hover.hovered}
        onHighlight={hover.setHovered}
        columns={tableColumns}
        rows={tableRows}
        label={title ?? `${xLabel} estimates with confidence intervals`}
      />
    </figure>
  );
}
