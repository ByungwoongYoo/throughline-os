"use client";

/**
 * Hover, emphasis and a real tooltip — shared by every primitive.
 *
 * Until now the only affordance a chart had was a native SVG `<title>`. That is
 * a browser tooltip: it appears after about a second, cannot be styled or
 * positioned, shows nothing on touch, and is announced inconsistently. It is
 * enough to say a mark exists and not enough to read a value off it.
 *
 * Two rules, both taken from `KnowledgeGraph.tsx`, which is the one surface in
 * this product that already feels alive:
 *
 * - **Neighbourhood reaction, not global reaction.** Hovering emphasises one
 *   mark and drops the rest to a low opacity. Everything moving at once reads
 *   as noise.
 * - **Object constancy.** Emphasis is a class and an opacity, never a remount.
 *   The mark under the cursor is the same DOM node it was before.
 *
 * The hovered id is deliberately owned by the chart rather than by a global
 * store, so a figure and its data table share one highlight and two figures on
 * the same screen do not fight over it.
 */

import { useCallback, useMemo, useState } from "react";

export type Pointer = { x: number; y: number };

export type HoverState = {
  /** Datum id under the cursor, or null. */
  hovered: string | null;
  setHovered: (id: string | null) => void;
  pointer: Pointer | null;
  /** Attach to the mark: tracks both which datum and where the cursor is. */
  markProps: (id: string) => {
    onMouseEnter: (event: React.MouseEvent) => void;
    onMouseMove: (event: React.MouseEvent) => void;
    onMouseLeave: () => void;
    onFocus: (event: React.FocusEvent) => void;
    onBlur: () => void;
  };
  /** Opacity for a mark, given what is hovered. 1 when nothing is. */
  emphasis: (id: string) => number;
};

/** Non-hovered marks drop to this rather than disappearing — context survives. */
const MUTED = 0.22;

export function useChartHover(): HoverState {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);

  const track = useCallback((event: { clientX: number; clientY: number }) => {
    setPointer({ x: event.clientX, y: event.clientY });
  }, []);

  const markProps = useCallback((id: string) => ({
    onMouseEnter: (event: React.MouseEvent) => { setHovered(id); track(event); },
    onMouseMove: (event: React.MouseEvent) => track(event),
    onMouseLeave: () => { setHovered(null); setPointer(null); },
    // Keyboard parity: a mark that can be focused must show the same tooltip a
    // mouse gets, positioned over the mark rather than over a cursor that is
    // not there.
    onFocus: (event: React.FocusEvent) => {
      const box = (event.target as Element).getBoundingClientRect();
      setHovered(id);
      setPointer({ x: box.left + box.width / 2, y: box.top });
    },
    onBlur: () => { setHovered(null); setPointer(null); },
  }), [track]);

  const emphasis = useCallback(
    (id: string) => (hovered === null || hovered === id ? 1 : MUTED),
    [hovered]);

  return useMemo(
    () => ({ hovered, setHovered, pointer, markProps, emphasis }),
    [hovered, pointer, markProps, emphasis]);
}

export type TooltipRow = { label: string; value: string };

/**
 * The values under the cursor, as text.
 *
 * Fixed-position and pointer-events:none, so it never sits between the cursor
 * and the mark it describes — a tooltip that steals the pointer flickers and
 * makes a chart feel broken. It flips to the other side of the cursor near the
 * viewport edge instead of being clipped.
 */
export function ChartTooltip({ pointer, title, rows }: {
  pointer: Pointer | null;
  title?: string;
  rows: TooltipRow[];
}) {
  if (!pointer || !rows.length) return null;

  const nearRight = typeof window !== "undefined"
    && pointer.x > window.innerWidth - 220;
  const nearBottom = typeof window !== "undefined"
    && pointer.y > window.innerHeight - 140;

  return (
    <div
      className="chart-tip"
      // `role="status"` rather than "tooltip": this is announced when it
      // appears, which is what a keyboard user moving between marks needs.
      role="status"
      aria-live="polite"
      style={{
        left: nearRight ? pointer.x - 16 : pointer.x + 16,
        top: nearBottom ? pointer.y - 16 : pointer.y + 16,
        transform: `translate(${nearRight ? "-100%" : "0"}, ${nearBottom ? "-100%" : "0"})`,
      }}
    >
      {title && <b>{title}</b>}
      {rows.map((row) => (
        <span key={row.label}>
          {row.label}
          <em>{row.value}</em>
        </span>
      ))}
    </div>
  );
}

/** Numbers in a tooltip are read, not estimated — so they are exact-ish. */
export function readable(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return value.toLocaleString();
  return Number(value.toPrecision(4)).toLocaleString();
}
