"use client";

/**
 * P1 — Cartesian marks (Part F).
 *
 * One primitive, four marks (point · line · area · rect), and roughly forty
 * named chart types fall out of it: scatter, bubble, bar, column, grouped,
 * stacked, histogram, line, multi-line, step, area, strip, beeswarm, ECDF,
 * Q–Q, residual, slope, sparkline. Building a renderer per name would give
 * forty motion languages and forty sets of bugs; the brief is right that
 * coherence is what reads as premium.
 *
 * **SVG, not canvas.** At the sizes a figure occupies, SVG holds the frame
 * budget easily, and it means export is not a second implementation — the
 * element on screen *is* the vector file. A canvas chart has to be re-drawn
 * into an exporter, and the two drift.
 *
 * **Object constancy is structural.** Marks are keyed by datum id, so React
 * moves an element rather than removing and re-adding it. A point that
 * represents the same observation across a filter change is the same DOM node,
 * and CSS transitions carry it. This is the single rule that makes data feel
 * physical rather than redrawn.
 */

import { useCallback, useId, useMemo, useState } from "react";
import { extent, max } from "d3-array";
import { scaleBand, scaleLinear } from "d3-scale";
import { line as d3line, area as d3area, curveMonotoneX } from "d3-shape";
import { categorical } from "@/lib/tokens";
import { densityNote, densityOf } from "@/lib/charts/density";
import { sequential } from "@/lib/charts/sequential";
import { ChartTooltip, readable, useChartHover } from "./interaction";
import { ChartTable } from "./ChartTable";

export type Datum = {
  /** Stable identity. Object constancy depends on it. */
  id: string;
  x: number | string;
  y: number;
  group?: string;
  /** Interval, when the mark carries uncertainty (P2 territory, layered here). */
  lo?: number;
  hi?: number;
};

export type CartesianMark = "point" | "line" | "area" | "rect";

export type CartesianProps = {
  data: Datum[];
  mark: CartesianMark;
  /** Display names, never raw column names (Part C). */
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  title?: string;
  caption?: string;
  width?: number;
  height?: number;
  /** A fitted line is drawn only when a model was actually fitted. */
  fit?: { slope: number; intercept: number } | null;
  /** Bar baselines are never truncated — the critic forbids it. */
  zeroBaseline?: boolean;
  /**
   * Colour a scatter by how many points share a cell of the plot.
   *
   * Off unless asked for, and never with `group`: colour cannot carry a
   * category and a count at once, and a chart that tried would be encoding
   * two things on one channel — which is the failure this whole component
   * takes care to avoid elsewhere.
   */
  densityColour?: boolean;
  /**
   * How many observations the figure has, when more than are drawn.
   *
   * A reader looking at twenty thousand marks from a hundred thousand rows is
   * looking at a real distribution and is owed the fact that it is a sample.
   */
  totalPoints?: number;
};

const M = { top: 12, right: 16, bottom: 44, left: 56 };

export function Cartesian({
  data, mark, xLabel, yLabel, xUnit, yUnit, title, caption,
  width = 620, height = 360, fit = null, zeroBaseline,
  densityColour = false, totalPoints,
}: CartesianProps) {
  const clipId = useId();
  const hover = useChartHover();
  // Brush: an x-range the reader drags out. null until they do.
  const [brush, setBrush] = useState<{ from: number; to: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const inner = { w: width - M.left - M.right, h: height - M.top - M.bottom };

  const categorical_x = typeof data[0]?.x === "string";

  /*
   * Colour by local density, when asked and when it can mean anything.
   *
   * Refused where any point carries a `group`, because colour would then be
   * saying both what a point is and how crowded it is, and neither would be
   * readable. Refused on a categorical x for the same reason the binning
   * would be meaningless there.
   */
  const grouped = data.some((d) => d.group);
  const shadeByDensity = densityColour && !grouped && !categorical_x;
  const density = useMemo(
    () => (shadeByDensity
      ? densityOf(data.map((d) => ({ x: Number(d.x), y: d.y })))
      : null),
    [shadeByDensity, data]);

  const xScale = useMemo(() => {
    if (categorical_x) {
      return scaleBand<string>()
        .domain(data.map((d) => String(d.x)))
        .range([0, inner.w])
        .padding(0.18);
    }
    const values = data.map((d) => Number(d.x));
    const [lo, hi] = extent(values) as [number, number];
    const pad = (hi - lo) * 0.04 || 1;
    return scaleLinear().domain([lo - pad, hi + pad]).range([0, inner.w]).nice();
  }, [data, inner.w, categorical_x]);

  const yScale = useMemo(() => {
    const values = data.flatMap((d) => [d.y, d.lo, d.hi].filter(
      (v): v is number => typeof v === "number"));
    const hi = max(values) ?? 1;
    const [lo] = extent(values) as [number, number];
    // A bar whose baseline is not zero exaggerates every difference, so rect
    // marks always start at zero regardless of what the data would suggest.
    const bottom = mark === "rect" || zeroBaseline ? 0 : lo - (hi - lo) * 0.06;
    return scaleLinear().domain([bottom, hi + (hi - lo) * 0.06 || hi * 1.06])
      .range([inner.h, 0]).nice();
  }, [data, inner.h, mark, zeroBaseline]);

  const groups = useMemo(
    () => Array.from(new Set(data.map((d) => d.group).filter(Boolean))) as string[],
    [data]);
  const colourOf = (group?: string) =>
    group ? categorical[groups.indexOf(group) % categorical.length] : categorical[0];

  const px = useCallback((d: Datum) => categorical_x
    ? (xScale as ReturnType<typeof scaleBand<string>>)(String(d.x))!
      + (xScale as ReturnType<typeof scaleBand<string>>).bandwidth() / 2
    : (xScale as ReturnType<typeof scaleLinear<number, number>>)(Number(d.x)),
  [xScale, categorical_x]);

  const path = useMemo(() => {
    if (mark === "line") {
      return d3line<Datum>().x(px).y((d) => yScale(d.y)).curve(curveMonotoneX)(data);
    }
    if (mark === "area") {
      return d3area<Datum>().x(px).y0(yScale(yScale.domain()[0]))
        .y1((d) => yScale(d.y)).curve(curveMonotoneX)(data);
    }
    return null;
  }, [data, mark, px, yScale]);

  const hovered = useMemo(
    () => data.find((d) => d.id === hover.hovered) ?? null,
    [data, hover.hovered]);

  // The brush in data units, not pixels — a selection nobody can read is
  // decoration.
  const brushed = useMemo(() => {
    if (!brush || categorical_x) return null;
    const scale = xScale as ReturnType<typeof scaleLinear<number, number>>;
    const from = scale.invert(brush.from);
    const to = scale.invert(brush.to);
    const count = data.filter((d) => Number(d.x) >= from && Number(d.x) <= to).length;
    return { from, to, count };
  }, [brush, categorical_x, xScale, data]);

  const xTicks = categorical_x
    ? (xScale as ReturnType<typeof scaleBand<string>>).domain()
    : (xScale as ReturnType<typeof scaleLinear<number, number>>).ticks(6);
  const yTicks = yScale.ticks(5);

  const axisTitle = (label: string, unit?: string) =>
    unit ? `${label} (${unit})` : label;

  // Group / interval columns only appear when the data actually carries them —
  // an all-empty column would be noise the reader has to rule out by hand.
  const hasGroup = data.some((d) => d.group !== undefined);
  const hasInterval = data.some((d) => d.lo !== undefined && d.hi !== undefined);
  const tableColumns = [
    { key: "x", header: xLabel, numeric: !categorical_x },
    { key: "y", header: yLabel, numeric: true },
    ...(hasGroup ? [{ key: "group", header: "Group" }] : []),
    ...(hasInterval
      ? [{ key: "lo", header: "Low", numeric: true },
         { key: "hi", header: "High", numeric: true }]
      : []),
  ];
  const tableRows = data.map((d) => ({
    id: d.id, x: d.x, y: d.y, group: d.group, lo: d.lo, hi: d.hi,
  }));

  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}

      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        // §118 / Part P — the figure describes itself, and a table follows.
        role="img"
        aria-label={`${title ?? "Figure"}. ${xLabel} against ${yLabel}. `
          + `${data.length} observations.`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={inner.w} height={inner.h} />
          </clipPath>
        </defs>

        <g transform={`translate(${M.left},${M.top})`}>
          {/* Gridlines first, at low contrast: they orient without competing. */}
          {yTicks.map((t) => (
            <line key={t} x1={0} x2={inner.w} y1={yScale(t)} y2={yScale(t)}
                  className="chart-grid" />
          ))}

          <g clipPath={`url(#${clipId})`}>
            {/* A fit line only when a model was fitted — never a decorative
                trend drawn because a scatter looked bare (Law 2). */}
            {fit && !categorical_x && (
              <line
                className="chart-fit"
                x1={0}
                x2={inner.w}
                y1={yScale(fit.intercept + fit.slope
                  * (xScale as ReturnType<typeof scaleLinear<number, number>>)
                    .invert(0))}
                y2={yScale(fit.intercept + fit.slope
                  * (xScale as ReturnType<typeof scaleLinear<number, number>>)
                    .invert(inner.w))}
              />
            )}

            {path && (
              <path
                d={path}
                className={mark === "area" ? "chart-area" : "chart-line"}
                style={{ stroke: colourOf(), fill: mark === "area" ? colourOf() : "none" }}
              />
            )}

            {/* Intervals below the estimate, so the point stays readable. */}
            {data.map((d) => d.lo !== undefined && d.hi !== undefined && (
              <line key={`ci-${d.id}`} className="chart-interval"
                    x1={px(d)} x2={px(d)} y1={yScale(d.lo)} y2={yScale(d.hi)}
                    style={{ stroke: colourOf(d.group) }} />
            ))}

            {mark === "rect" && data.map((d) => {
              const band = xScale as ReturnType<typeof scaleBand<string>>;
              const zero = yScale(yScale.domain()[0]);
              return (
                // Keyed by datum id: React moves the rect on reorder rather than
                // destroying and recreating it, so the bar travels.
                <rect
                  key={d.id}
                  className="chart-rect"
                  x={categorical_x ? band(String(d.x))! : px(d) - 4}
                  width={categorical_x ? band.bandwidth() : 8}
                  y={Math.min(yScale(d.y), zero)}
                  height={Math.abs(zero - yScale(d.y))}
                  style={{ fill: colourOf(d.group), opacity: hover.emphasis(d.id) }}
                  {...hover.markProps(d.id)}
                />
              );
            })}

            {mark === "point" && data.map((d, index) => (
              <circle
                key={d.id}
                className="chart-point"
                cx={px(d)}
                cy={yScale(d.y)}
                // The hovered mark grows a little as well as staying opaque:
                // opacity alone is hard to see on a sparse scatter.
                r={hover.hovered === d.id ? 5 : 3.2}
                style={{
                  // Density where it was asked for; the group's colour
                  // otherwise. Never both — see `densityColour`.
                  fill: density
                    ? sequential(density.levels[index])
                    : colourOf(d.group),
                  opacity: hover.emphasis(d.id),
                }}
                {...hover.markProps(d.id)}
              />
            ))}
          </g>

          {/* Brush: drag across the plot to select an x-range.
              `recommend.py` has declared `interaction: ["hover", "brush",
              "underlying_table"]` on every scatter since the spec was written,
              and until now the React side implemented none of the first two. */}
          {!categorical_x && (
            <rect
              className="chart-brush-surface"
              x={0} y={0} width={inner.w} height={inner.h}
              fill="transparent"
              onMouseDown={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const at = event.clientX - box.left;
                setDragging(at);
                setBrush(null);
              }}
              onMouseMove={(event) => {
                if (dragging === null) return;
                const box = event.currentTarget.getBoundingClientRect();
                const at = event.clientX - box.left;
                setBrush({ from: Math.min(dragging, at), to: Math.max(dragging, at) });
              }}
              onMouseUp={() => setDragging(null)}
              onMouseLeave={() => setDragging(null)}
            />
          )}
          {brush && (
            <rect className="chart-brush" x={brush.from} y={0}
                  width={Math.max(1, brush.to - brush.from)} height={inner.h}
                  pointerEvents="none" />
          )}

          {/* Axes last, so marks never paint over them. */}
          <line className="chart-axis" x1={0} x2={inner.w} y1={inner.h} y2={inner.h} />
          <line className="chart-axis" x1={0} x2={0} y1={0} y2={inner.h} />

          {xTicks.map((t) => (
            <text key={String(t)} className="chart-tick"
                  x={categorical_x
                    ? (xScale as ReturnType<typeof scaleBand<string>>)(String(t))!
                      + (xScale as ReturnType<typeof scaleBand<string>>).bandwidth() / 2
                    : (xScale as ReturnType<typeof scaleLinear<number, number>>)(Number(t))}
                  y={inner.h + 16} textAnchor="middle">
              {String(t)}
            </text>
          ))}
          {yTicks.map((t) => (
            <text key={t} className="chart-tick" x={-8} y={yScale(t) + 3}
                  textAnchor="end">{t}</text>
          ))}

          <text className="chart-axis-label" x={inner.w / 2} y={inner.h + 36}
                textAnchor="middle">{axisTitle(xLabel, xUnit)}</text>
          <text className="chart-axis-label"
                transform={`translate(${-M.left + 14},${inner.h / 2}) rotate(-90)`}
                textAnchor="middle">{axisTitle(yLabel, yUnit)}</text>
        </g>
      </svg>

      {groups.length > 1 && (
        <div className="chart-legend">
          {groups.map((g) => (
            <span key={g}>
              {/* Never colour alone: a swatch and its word (Part A). */}
              <i style={{ background: colourOf(g) }} aria-hidden />{g}
            </span>
          ))}
        </div>
      )}

      {brushed !== null && (
        // What a selection is *for*: the count, and where it starts and ends in
        // the reader's own units rather than in pixels.
        <p className="chart-selection" role="status">
          {brushed.count.toLocaleString()} of {data.length.toLocaleString()} selected
          {" · "}{xLabel} {readable(brushed.from)} to {readable(brushed.to)}
          <button type="button" onClick={() => setBrush(null)}>clear</button>
        </p>
      )}

      {/*
        What the colour means, beside the figure rather than in a tooltip.
        The scale is local to this plot, so the same colour in two panels is
        two different counts — a reader who compares them without being told
        reads a difference that is an artefact of scaling.
      */}
      {density && (
        <figcaption className="chart-caption chart-density-note">
          {densityNote(density, data.length, totalPoints ?? data.length)}
        </figcaption>
      )}
      {caption && <figcaption className="chart-caption">{caption}</figcaption>}

      <ChartTable
        columns={tableColumns}
        rows={tableRows}
        label={title ?? `${xLabel} against ${yLabel}`}
        highlightId={hover.hovered}
        onHighlight={hover.setHovered}
      />

      <ChartTooltip
        pointer={hover.pointer}
        title={hovered?.group}
        rows={hovered ? [
          { label: xLabel, value: readable(hovered.x) },
          { label: yLabel, value: readable(hovered.y) },
          ...(hovered.lo !== undefined && hovered.hi !== undefined
            ? [{ label: "interval",
                 value: `${readable(hovered.lo)} to ${readable(hovered.hi)}` }]
            : []),
        ] : []}
      />
    </figure>
  );
}
