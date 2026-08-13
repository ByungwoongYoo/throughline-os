"use client";

/**
 * P5 — binned aggregation (Part F).
 *
 * Hexbin, 2-D histogram, raster density. One primitive: the plane divided into
 * cells, each shaded by how many observations fall inside it.
 *
 * **Why this exists at all.** A scatter plot degrades continuously and never
 * says so. Past a few thousand rows the dense region fills in, and a cell
 * holding fifty observations and one holding five thousand both render as solid
 * ink — so the reader sees the *outline* of the data and cannot see where most
 * of it actually is. Binning replaces "is there ink here" with "how much is
 * here", which is the question a dense scatter was silently failing to answer.
 *
 * **Hexagons, not squares.** A square grid produces horizontal and vertical
 * banding that the eye reads as structure in the data. Hexagons tile without
 * that artefact, and every point in a hexagon sits closer to its centre than in
 * a square of equal area, so a cell's count is a fairer summary of its
 * neighbourhood.
 *
 * **The bin count is stated, always.** Bin width is not a rendering detail:
 * widen it and two modes merge into one, narrow it and sampling noise reads as
 * structure. Both are defensible pictures of the same data and they disagree,
 * and nothing in the image tells them apart — so the number that produced the
 * shape is printed with the figure, exactly as a density plot states its
 * bandwidth. The critic refuses to create a binned figure without one.
 *
 * **Counts are computed server-side** (LAW 2). This component draws the cells it
 * is given and bins nothing itself.
 *
 * Motion signature: cells reveal in a wave from the densest outward, and morph
 * on bin-width change rather than being redrawn — so the reader watches the
 * *resolution* change instead of watching one chart replaced by another.
 */

import { useId, useMemo } from "react";
import { extent, max } from "d3-array";
import { scaleLinear, scaleSequential } from "d3-scale";
import { interpolateViridis } from "d3-scale-chromatic";

export type Cell = {
  /** Cell centre, in data space. */
  x: number;
  y: number;
  /** Observations in this cell. Never zero — empty cells are absent, not shaded. */
  count: number;
};

const M = { top: 14, right: 74, bottom: 46, left: 60 };

export function Binned({
  cells, xLabel, yLabel, xUnit, yUnit, binCount, sampleSize,
  title, caption, fit,
  width = 620, height = 340,
}: {
  cells: Cell[];
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  /** Cells across the range. Required: the figure must state how it was binned. */
  binCount: number;
  sampleSize: number;
  title?: string;
  caption?: string;
  /** Optional least-squares line, for orientation only. */
  fit?: { slope: number; intercept: number };
  width?: number;
  height?: number;
}) {
  const clipId = useId();
  const plotWidth = width - M.left - M.right;
  const plotHeight = height - M.top - M.bottom;

  const { x, y, colour, radius, peak } = useMemo(() => {
    const [x0 = 0, x1 = 1] = extent(cells, (c) => c.x) as [number, number];
    const [y0 = 0, y1 = 1] = extent(cells, (c) => c.y) as [number, number];
    // A hair of padding so cells centred on the extremes are not clipped in half.
    const padX = (x1 - x0) / Math.max(binCount, 1) / 2;
    const padY = (y1 - y0) / Math.max(binCount, 1) / 2;

    const peakCount = max(cells, (c) => c.count) ?? 1;
    return {
      x: scaleLinear().domain([x0 - padX, x1 + padX]).nice().range([0, plotWidth]),
      y: scaleLinear().domain([y0 - padY, y1 + padY]).nice().range([plotHeight, 0]),
      // Sequential and perceptually uniform: the encoded quantity is a count —
      // ordered, single-ended, with a real zero. A diverging scale would invent
      // a midpoint that does not exist in the data.
      colour: scaleSequential(interpolateViridis).domain([0, peakCount]),
      radius: plotWidth / Math.max(binCount, 1) / 1.732,
      peak: peakCount,
    };
  }, [cells, binCount, plotWidth, plotHeight]);

  // A flat-topped hexagon of the given radius, centred on the origin.
  const hexagon = useMemo(() => {
    const points: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 3) * i;
      points.push(`${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle)).toFixed(2)}`);
    }
    return points.join(" ");
  }, [radius]);

  const xTicks = x.ticks(6);
  const yTicks = y.ticks(5);

  return (
    <figure className="chart chart-binned">
      {title && <figcaption className="chart-title">{title}</figcaption>}
      <svg
        width={width} height={height} role="img"
        aria-label={
          `Binned density of ${yLabel} against ${xLabel}. `
          + `${sampleSize.toLocaleString()} observations in ${cells.length} `
          + `occupied cells, ${binCount} cells across each axis. `
          + `The densest cell holds ${peak.toLocaleString()} observations.`
        }
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>
        <g transform={`translate(${M.left},${M.top})`}>
          {yTicks.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x2={plotWidth} className="grid" />
              <text x={-8} dy="0.32em" className="tick numeric" textAnchor="end">{t}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={t} transform={`translate(${x(t)},${plotHeight})`}>
              <line y2={6} className="axis" />
              <text y={20} className="tick numeric" textAnchor="middle">{t}</text>
            </g>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {cells.map((cell) => (
              // Keyed on position so a bin-width change morphs the cells that
              // persist rather than fading the whole field out and back in.
              <polygon
                key={`${cell.x}:${cell.y}`}
                points={hexagon}
                transform={`translate(${x(cell.x)},${y(cell.y)})`}
                fill={colour(cell.count)}
                stroke="var(--n-0)"
                strokeWidth={0.4}
              >
                <title>
                  {`${cell.count.toLocaleString()} observations near `
                   + `${xLabel} ${cell.x}, ${yLabel} ${cell.y}`}
                </title>
              </polygon>
            ))}

            {fit && (
              <line
                x1={x(x.domain()[0])}
                y1={y(fit.slope * x.domain()[0] + fit.intercept)}
                x2={x(x.domain()[1])}
                y2={y(fit.slope * x.domain()[1] + fit.intercept)}
                className="chart-fit"
                stroke="var(--negative)" strokeWidth={1.4} strokeDasharray="5 3"
              />
            )}
          </g>

          <text
            transform={`translate(${plotWidth / 2},${plotHeight + 40})`}
            className="axis-label" textAnchor="middle"
          >
            {xLabel}{xUnit ? ` (${xUnit})` : ""}
          </text>
          <text
            transform={`translate(${-M.left + 14},${plotHeight / 2}) rotate(-90)`}
            className="axis-label" textAnchor="middle"
          >
            {yLabel}{yUnit ? ` (${yUnit})` : ""}
          </text>

          <Legend peak={peak} colour={colour} height={plotHeight} x={plotWidth + 16} />
        </g>
      </svg>

      <p className="chart-note">
        {sampleSize.toLocaleString()} observations, binned into {binCount} cells
        per axis. Shade shows observations per cell; empty cells are left blank
        rather than shaded, so no data and a little data stay distinguishable.
      </p>
      {caption && <p className="chart-caption">{caption}</p>}
    </figure>
  );
}

function Legend({ peak, colour, height, x }: {
  peak: number;
  colour: (n: number) => string;
  height: number;
  x: number;
}) {
  const steps = 24;
  const barHeight = Math.min(height, 160);
  const band = barHeight / steps;
  return (
    <g transform={`translate(${x},0)`} aria-hidden>
      {Array.from({ length: steps }, (_, i) => (
        <rect
          key={i}
          x={0}
          y={barHeight - (i + 1) * band}
          width={12}
          height={band + 0.5}
          fill={colour(((i + 1) / steps) * peak)}
        />
      ))}
      <text x={17} y={8} className="tick numeric">{peak.toLocaleString()}</text>
      <text x={17} y={barHeight} className="tick numeric">1</text>
      <text
        transform={`translate(${-4},${barHeight + 22})`}
        className="tick" textAnchor="start"
      >
        per cell
      </text>
    </g>
  );
}
