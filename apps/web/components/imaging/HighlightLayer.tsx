"use client";

/**
 * Drawing on a scan, and showing what was drawn elsewhere.
 *
 * Sits over a volume and does two jobs: it takes a stroke, and it renders the
 * marks that belong on this scan right now. Which marks those are is decided by
 * `highlight.ts` — this file draws what it is told and never decides for
 * itself, because the interesting rule (a region is not echoed onto a scan the
 * case cannot be compared with) is a claim about the data rather than about
 * pixels.
 *
 * **Points come from anywhere.** A pointer, a stylus, or a hand: the layer
 * takes screen coordinates and does not ask where they came from. That is what
 * makes the gesture path a wiring change — `SpatialControl` already produces a
 * cursor in the same coordinates the pointer does — rather than a second
 * drawing implementation that would drift from this one.
 *
 * **A withheld mark leaves a visible trace.** Not the region — drawing that
 * would be the very assertion being refused — but a note saying a mark exists
 * and is deliberately not shown here, and why. Silence would read as "nothing
 * was marked", which is a different and false statement.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ViewState } from "@/lib/spatial/commands";
import { Verdict } from "@/lib/imaging/comparability";
import {
  Highlight, Point, Standing, boundsOf, explain, newHighlightId, standing,
  thin,
} from "@/lib/imaging/highlight";

export type HighlightLayerProps = {
  /** Which scan this layer sits over. */
  scanId: string;
  /** That scan's comparability against the case. Null for the case itself. */
  verdict: Verdict | null;
  /** The view every scan in the workspace is currently held at. */
  view: ViewState | null;
  marks: Highlight[];
  width: number;
  height: number;
  /**
   * Whether a stroke started here becomes a mark.
   *
   * Only the case is drawable. Marking a comparison scan directly would make
   * two sets of marks that look alike and mean different things — one the
   * researcher's reading of the case, one an annotation of something being
   * compared with it.
   */
  drawable?: boolean;
  onDrawn?: (points: Point[]) => void;
};

/** The colour a mark is drawn in, by how it comes to be on this scan. */
const TONE: Record<Exclude<Standing, "withheld">, string> = {
  drawn: "rgba(255,138,76,0.95)",
  echoed: "rgba(255,138,76,0.55)",
  stale: "rgba(150,150,150,0.35)",
};

export function HighlightLayer({
  scanId, verdict, view, marks, width, height, drawable = false, onDrawn,
}: HighlightLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stroke, setStroke] = useState<Point[]>([]);
  const drawing = useRef(false);

  const visible = marks
    .map((mark) => ({ mark, how: standing(mark, scanId, verdict, view) }))
    .filter(({ how }) => how !== "withheld");

  const withheld = marks.length - visible.length;

  useEffect(() => {
    paintMarks(canvasRef.current, visible, stroke, { width, height });
  });

  const finish = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    const points = thin(stroke);
    setStroke([]);
    // Two points are a tap, not a region. Emitting one would put a mark
    // somewhere the researcher did not mean to leave one.
    if (points.length >= 3) onDrawn?.(points);
  }, [stroke, onDrawn]);

  return (
    <div className="hl-wrap" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="hl-canvas"
        data-testid={`highlight-${scanId}`}
        style={{ pointerEvents: drawable ? "auto" : "none" }}
        onPointerDown={(event) => {
          if (!drawable) return;
          const box = event.currentTarget.getBoundingClientRect();
          drawing.current = true;
          setStroke([{ x: event.clientX - box.left, y: event.clientY - box.top }]);
          (event.target as Element).setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const box = event.currentTarget.getBoundingClientRect();
          setStroke((held) => [...held,
            { x: event.clientX - box.left, y: event.clientY - box.top }]);
        }}
        onPointerUp={finish}
        onPointerLeave={finish}
      />
      {withheld > 0 && (
        /*
          * The mark is not drawn, but its absence is stated. Saying nothing
          * would read as "nothing was marked" — a different claim, and a false
          * one.
          */
        <p className="hl-withheld">
          {withheld} mark{withheld === 1 ? "" : "s"} not shown here.{" "}
          {explain("withheld", verdict)}
        </p>
      )}
    </div>
  );
}

/**
 * Draw the marks and the stroke in progress.
 *
 * Exported for the same reason the chart painters are: a draw loop reachable
 * only through a render is one no test exercises directly, and the difference
 * between a drawn mark and an echoed one is the thing worth checking.
 */
export function paintMarks(
  canvas: HTMLCanvasElement | null,
  visible: Array<{ mark: Highlight; how: Standing }>,
  stroke: Point[],
  size: { width: number; height: number },
): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, size.width, size.height);

  for (const { mark, how } of visible) {
    if (how === "withheld") continue;
    const points = mark.points;
    if (points.length < 2) continue;

    context.save();
    context.strokeStyle = TONE[how];
    context.lineWidth = how === "drawn" ? 2.4 : 1.8;
    context.lineJoin = "round";
    context.lineCap = "round";
    /*
     * A stale mark is dashed. It is still on screen because removing it would
     * lose the researcher's work, but it no longer corresponds to anything on
     * this view — and a solid outline in the wrong place is worse than none.
     */
    if (how === "stale") context.setLineDash([4, 4]);

    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) context.lineTo(p.x, p.y);
    context.stroke();

    const box = boundsOf(mark);
    if (box && mark.note) {
      context.setLineDash([]);
      context.fillStyle = TONE[how];
      context.font = "11px system-ui, sans-serif";
      context.textBaseline = "bottom";
      // Above the mark where there is room, inside it where there is not, so a
      // mark near the top edge does not have its label clipped away.
      const y = box.y > 14 ? box.y - 4 : box.y + box.height + 12;
      context.fillText(mark.note, box.x, y);
    }
    context.restore();
  }

  if (stroke.length >= 2) {
    context.save();
    context.strokeStyle = TONE.drawn;
    context.lineWidth = 2.4;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(stroke[0].x, stroke[0].y);
    for (const p of stroke.slice(1)) context.lineTo(p.x, p.y);
    context.stroke();
    context.restore();
  }
}

/** A mark, from a finished stroke. The caller supplies who and what. */
export function markFrom(scanId: string, points: Point[], view: ViewState,
                         by: string, note: string): Highlight {
  return {
    id: newHighlightId(), on: scanId, points, view, by, note,
    at: Date.now(),
  };
}
