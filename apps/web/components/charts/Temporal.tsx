"use client";

/**
 * P14 — temporal alignment (Part F).
 *
 * Events on a shared timeline, aligned to a common origin: Gantt, swimlane,
 * event raster, and the survival curve.
 *
 * **Censoring is drawn differently from an observed event, and that is the
 * whole primitive.**
 *
 * A participant who left a study at month 8 without the outcome occurring and a
 * participant whose outcome occurred at month 8 are opposite facts. Drawn the
 * same way — a mark at 8 — the chart says the outcome happened when it did not,
 * and the survival curve computed from it overstates what was observed. This is
 * the single most consequential drawing error in clinical work, which is why
 * this primitive was held back rather than shipped partially: a version that
 * could not tell those apart would be worse than no version.
 *
 * So censoring is a distinct mark (a tick, never a dot), it is stated in the
 * caption with a count, and the curve carries the number still at risk at each
 * step. The tail of a Kaplan–Meier estimate computed from a handful of
 * survivors is nearly meaningless, and a reader cannot see that from the line
 * alone.
 *
 * **The estimator is Kaplan–Meier and it is computed here, not approximated.**
 * At each observed event time the survival probability is multiplied by
 * (1 − dₜ/nₜ). Censored observations leave the risk set without causing a step,
 * which is exactly the distinction above expressed as arithmetic.
 */

import { useId, useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
import { categorical } from "@/lib/tokens";
import { ChartTable } from "./ChartTable";
import { ChartTooltip, readable, useChartHover } from "./interaction";

export type TemporalEvent = {
  /** Stable identity. Object constancy depends on it. */
  id: string;
  /** Display name for the row (a participant, a case, a cohort member). */
  label: string;
  /** Time from the common origin, in `unitLabel`. */
  time: number;
  /**
   * False when the subject left observation without the outcome occurring.
   *
   * There is no default. A caller that has not decided cannot be assumed to
   * mean "the outcome happened" — that assumption is the error this whole
   * primitive exists to prevent.
   */
  observed: boolean;
  group?: string;
};

type Step = { time: number; survival: number; atRisk: number; events: number };

const M = { top: 16, right: 20, bottom: 44, left: 56 };
const ROW = 18;

/**
 * Kaplan–Meier, computed from the events.
 *
 * Censored observations reduce the risk set at their time but produce no step.
 * That is the arithmetic form of "this person did not have the outcome" — and
 * treating them as events is precisely how a survival estimate ends up claiming
 * more outcomes than were observed.
 */
function kaplanMeier(events: TemporalEvent[]): Step[] {
  const ordered = [...events].sort((a, b) => a.time - b.time);
  const steps: Step[] = [{ time: 0, survival: 1, atRisk: ordered.length, events: 0 }];

  let survival = 1;
  let atRisk = ordered.length;
  let index = 0;

  while (index < ordered.length) {
    const time = ordered[index].time;
    let died = 0;
    let censored = 0;
    while (index < ordered.length && ordered[index].time === time) {
      if (ordered[index].observed) died += 1;
      else censored += 1;
      index += 1;
    }
    if (died > 0 && atRisk > 0) {
      survival *= 1 - died / atRisk;
      steps.push({ time, survival, atRisk, events: died });
    }
    atRisk -= died + censored;
  }
  return steps;
}

export function Temporal({
  events, unitLabel, originLabel, outcomeLabel, mode = "survival",
  title, caption, width = 720, height = 380,
}: {
  events: TemporalEvent[];
  /** "months", "days" — the units of `time`. */
  unitLabel: string;
  /** What time zero is: "randomisation", "first prescription". */
  originLabel: string;
  /** The event being waited for: "resistance detected". */
  outcomeLabel: string;
  /** "survival" draws the curve; "raster" draws one row per subject. */
  mode?: "survival" | "raster";
  title?: string;
  caption?: string;
  width?: number;
  height?: number;
}) {
  const hoverUI = useChartHover();
  const hit = events.find((e) => e.id === hoverUI.hovered) ?? null;
  const clipId = useId();
  const [hover, setHover] = useState<Step | null>(null);

  const observed = events.filter((e) => e.observed);
  const censored = events.filter((e) => !e.observed);
  const steps = useMemo(() => kaplanMeier(events), [events]);

  const maxTime = Math.max(1, ...events.map((e) => e.time));
  const rasterHeight = M.top + M.bottom + events.length * ROW;
  const chartHeight = mode === "raster" ? rasterHeight : height;
  const inner = {
    w: width - M.left - M.right,
    h: chartHeight - M.top - M.bottom,
  };

  const x = scaleLinear().domain([0, maxTime]).range([0, inner.w]).nice();
  const y = scaleLinear().domain([0, 1]).range([inner.h, 0]);

  /** Where the curve drops below half, if it ever does. */
  const median = steps.find((s) => s.survival <= 0.5);

  const hasGroup = events.some((e) => e.group !== undefined);
  const tableColumns = [
    { key: "label", header: "Label" },
    { key: "time", header: unitLabel, numeric: true },
    { key: "observed", header: "Status" },
    ...(hasGroup ? [{ key: "group", header: "Group" }] : []),
  ];
  const tableRows = events.map((e) => ({
    id: e.id,
    label: e.label,
    time: e.time,
    observed: e.observed ? "event" : "censored",
    group: e.group,
  }));

  const path = steps.map((step, i) => {
    const px = x(step.time);
    const py = y(step.survival);
    // Stepped, never interpolated: survival does not decline smoothly between
    // observed events, it holds and then drops. A smooth line would claim
    // outcomes at times nothing was recorded.
    return i === 0 ? `M${px},${py}` : `H${px}V${py}`;
  }).join(" ") + ` H${x(maxTime)}`;

  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}

      <svg
        className="chart-svg" style={{ maxWidth: width }} width="100%"
        viewBox={`0 0 ${width} ${chartHeight}`} role="img"
        aria-label={
          `${title ?? "Time to event"}. ${events.length} subjects followed from `
          + `${originLabel}. ${observed.length} had ${outcomeLabel}; `
          + `${censored.length} left observation without it and are censored.`}
      >
        <defs><clipPath id={clipId}>
          <rect x={0} y={-6} width={inner.w} height={inner.h + 12} />
        </clipPath></defs>

        <g transform={`translate(${M.left},${M.top})`}>
          {mode === "survival" ? (
            <>
              {y.ticks(5).map((tick) => (
                <g key={tick} transform={`translate(0,${y(tick)})`}>
                  <line x1={0} x2={inner.w} className="chart-grid" />
                  <text x={-8} dy="0.32em" textAnchor="end" className="chart-tick">
                    {Math.round(tick * 100)}%
                  </text>
                </g>
              ))}

              <g clipPath={`url(#${clipId})`}>
                <path d={path} className="km-curve" fill="none"
                      stroke={categorical[0]} strokeWidth={2} />

                {/* Censoring ticks. A different mark, never a dot: a dot here
                    would read as an outcome at that time, which is the exact
                    opposite of what censoring means. */}
                {censored.map((event) => {
                  const step = [...steps].reverse()
                    .find((s) => s.time <= event.time) ?? steps[0];
                  return (
                    <line
                      key={event.id}
                {...hoverUI.markProps(event.id)}
                style={{ opacity: hoverUI.emphasis(event.id) }}
                      className="km-censor"
                      x1={x(event.time)} x2={x(event.time)}
                      y1={y(step.survival) - 5} y2={y(step.survival) + 5}
                    >
                      <title>
                        {event.label} — left observation at {event.time}{" "}
                        {unitLabel} without {outcomeLabel}
                      </title>
                    </line>
                  );
                })}

                {steps.slice(1).map((step) => (
                  <circle
                    key={step.time}
                    className="km-event"
                    cx={x(step.time)} cy={y(step.survival)} r={3.5}
                    fill={categorical[0]}
                    onMouseEnter={() => setHover(step)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>
                      {step.time} {unitLabel}: {(step.survival * 100).toFixed(1)}%
                      {" "}remaining, {step.atRisk} still at risk
                    </title>
                  </circle>
                ))}
              </g>
            </>
          ) : (
            // Raster: one row per subject, so the reader can see the actual
            // follow-up rather than only its summary.
            events.map((event, i) => (
              <g key={event.id} transform={`translate(0,${i * ROW + ROW / 2})`}>
                <line x1={0} x2={x(event.time)} className="raster-line" />
                {event.observed ? (
                  <circle cx={x(event.time)} cy={0} r={3.5}
                          fill={categorical[0]} className="km-event" />
                ) : (
                  <line className="km-censor"
                        x1={x(event.time)} x2={x(event.time)} y1={-5} y2={5} />
                )}
                <text x={-8} dy="0.32em" textAnchor="end" className="chart-tick">
                  {event.label}
                </text>
              </g>
            ))
          )}

          <line x1={0} x2={inner.w} y1={inner.h} y2={inner.h} className="chart-axis" />
          {x.ticks(6).map((tick) => (
            <text key={tick} x={x(tick)} y={inner.h + 18} textAnchor="middle"
                  className="chart-tick">{tick}</text>
          ))}
          <text x={inner.w / 2} y={inner.h + 36} textAnchor="middle"
                className="chart-axis-label">
            {unitLabel} since {originLabel}
          </text>
        </g>
      </svg>

      {/* Numbers at risk. Without this the tail of a curve computed from three
          survivors looks exactly like one computed from three hundred. */}
      {mode === "survival" && (
        <p className="km-atrisk numeric">
          At risk:{" "}
          {steps.filter((_, i) => i % Math.max(1, Math.floor(steps.length / 5)) === 0)
            .map((s) => `${s.time}${unitLabel[0]}: ${s.atRisk}`).join("  ·  ")}
        </p>
      )}

      <figcaption className="chart-caption">
        {caption ? `${caption} ` : ""}
        {events.length} subjects followed from {originLabel}.{" "}
        <b>{observed.length} had {outcomeLabel}</b>; {censored.length} left
        observation without it and are drawn as ticks rather than points —
        a censored subject is not an outcome, and drawing them alike would make
        this curve claim more events than were observed.{" "}
        {median
          ? `Half had ${outcomeLabel} by ${median.time} ${unitLabel}.`
          : `Fewer than half had ${outcomeLabel} within ${maxTime} ${unitLabel}, so there is no median to report.`}{" "}
        {steps.length > 1 && steps[steps.length - 1].atRisk < 10 && (
          <>
            The right-hand tail rests on {steps[steps.length - 1].atRisk} subjects
            still at risk and should not be read as a precise estimate.
          </>
        )}
        {hover && (
          <> Showing {hover.time} {unitLabel}: {(hover.survival * 100).toFixed(1)}%
            remaining of {hover.atRisk} at risk.</>
        )}
      </figcaption>

      <ChartTooltip pointer={hoverUI.pointer} title={hit?.label} rows={hit ? [{ label: unitLabel, value: readable(hit.time) }, { label: "outcome", value: hit.observed ? outcomeLabel : "censored" }] : []} />

      <ChartTable
        highlightId={hoverUI.hovered}
        onHighlight={hoverUI.setHovered}
        columns={tableColumns}
        rows={tableRows}
        label={title ?? `Time to ${outcomeLabel} since ${originLabel}`}
      />
    </figure>
  );
}
