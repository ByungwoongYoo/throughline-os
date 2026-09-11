/**
 * The key to a colour scale, as text rather than as pixels.
 *
 * Every canvas chart here paints its ramp and none of them said what the ramp
 * meant. A picture whose colour varies smoothly looks quantitative whether or
 * not it is readable, so a reader takes "greener" for "more" and has no way to
 * find out how much more — or, on a diverging scale, which way round it goes.
 *
 * **Not drawn on the canvas, deliberately.** A legend rendered into the 2D
 * context would be an image of some numbers: unselectable, invisible to a
 * screen reader, absent from a page search, and re-rasterised at every
 * rotation for a thing that never changes while the camera moves. It is
 * ordinary markup beside the chart instead, so the numbers are numbers.
 *
 * **It is not drawn at all when the colour repeats the height.** `Surface`
 * builds a legend only when `colourBy` supplies a genuine fourth variable, and
 * that distinction is the component's contract as much as its props are: a
 * surface shaded by its own z has three dimensions of data in it, the z axis
 * is already the key, and a second key beside it would invite a reader to
 * treat one quantity as two. Give this component the fourth variable's label,
 * or do not mount it.
 */

import type { JSX } from "react";
import { formatTick, formatTicks, niceTicks } from "@/lib/charts/scene3d";

/**
 * How tall the bar is, in pixels.
 *
 * Fixed rather than stretched to the chart, and shorter than one. A gradient
 * is read by comparing a patch against the ends, which does not get easier as
 * the bar gets longer, while the labels get further from what they label.
 */
const BAR_HEIGHT = 176;

/** Sampling points along the ramp, enough that no band is visible. */
const STOPS = 16;

export function Colourbar({
  ramp, min, max, label, unit, ticks = 5,
}: {
  /** The chart's own ramp, sampled in 0..1. Never a second copy of it. */
  ramp: (t: number) => string;
  min: number;
  max: number;
  /** What the colour measures. "Dispersion", never "value". */
  label: string;
  /** Drawn in parentheses after the label, the way an axis title carries it. */
  unit?: string;
  /** How many labelled steps to aim for. Four to six is what fits. */
  ticks?: number;
}): JSX.Element {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const span = hi - lo;
  /*
   * A fourth variable that turned out to be the same everywhere.
   *
   * The chart draws one colour in that case — `Surface` paints the middle of
   * its ramp rather than dividing by a zero range — so a key showing a full
   * gradient would offer the reader a scale the picture does not contain, and
   * invite them to read variation into a flat field. One swatch, one number.
   */
  const flat = span === 0 || !Number.isFinite(span);
  const named = unit ? `${label} (${unit})` : label;

  const values = niceTicks(lo, hi, ticks);
  const texts = formatTicks(values);
  const marks = values.map((value, i) => ({
    value,
    text: texts[i],
    // Distance up the bar, as a percentage. A constant range has no up, so
    // its one label sits against the middle.
    fromBottom: flat ? 50 : ((value - lo) / span) * 100,
  }));

  // Bottom to top, so the larger value is higher — the direction every axis on
  // the page already reads, and the direction a reader assumes without asking.
  const gradient = flat ? "" : Array.from({ length: STOPS }, (_, i) => {
    const t = i / (STOPS - 1);
    return `${ramp(t)} ${(t * 100).toFixed(1)}%`;
  }).join(", ");

  return (
    <figure style={{
      margin: 0, display: "inline-flex", flexDirection: "column", gap: 7,
    }}>
      <figcaption style={{
        fontSize: 11.5, fontWeight: 560, color: "var(--ink-soft)",
        letterSpacing: "0.01em", whiteSpace: "nowrap",
      }}>
        {named}
      </figcaption>
      <div style={{ display: "flex", gap: 7, height: BAR_HEIGHT }}>
        {/*
          * The role sits on the bar and not on the whole legend, and the
          * reason is that `role="img"` hides everything inside it from a
          * screen reader. Wrapping the numbers in it would trade the readable
          * ticks for one summary sentence. The gradient is the part with no
          * text in it, so it is the part that needs describing; the labels
          * beside it stay ordinary text, selectable and searchable.
          */}
        <div
          role="img"
          aria-label={flat
            ? `${named}, one colour for the single value ${formatTick(lo)}`
            : `${named}, colour scale from ${formatTick(lo)} `
              + `to ${formatTick(hi)}`}
          style={{
            width: 12, borderRadius: 2, flex: "none",
            // Longhand. A `border` shorthand carrying a custom property is
            // parsed back wrong by more than one style engine, and the value
            // that survives is a border width of `var(--line)`.
            borderWidth: 1, borderStyle: "solid", borderColor: "var(--line)",
            background: flat ? ramp(0.5) : undefined,
            backgroundImage: flat
              ? undefined : `linear-gradient(to top, ${gradient})`,
          }}
        />
        <div style={{ position: "relative", minWidth: 34 }}>
          {marks.map((mark) => (
            <span
              key={mark.value}
              style={{
                position: "absolute", left: 0,
                bottom: `${mark.fromBottom}%`,
                transform: "translateY(50%)",
                fontSize: 10.5, lineHeight: 1,
                color: "var(--ink-faint)", whiteSpace: "nowrap",
              }}
            >
              {mark.text}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
