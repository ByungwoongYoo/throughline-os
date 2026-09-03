"use client";

/**
 * Saving a spatial chart (§75).
 *
 * Two-dimensional figures could be saved as SVG; no three-dimensional one
 * could be saved at all, so the last step of the work this product exists for
 * — putting the figure in the paper — ended at a screenshot.
 *
 * **One control, offered by every rotatable chart.** Six copies of a download
 * button is six chances for one of them to save the wrong canvas, and the
 * reason a reader trusts a saved figure is that it is the same picture they
 * were looking at.
 *
 * **The video records the rotation.** §10 admits depth only where it carries
 * information, and what a spatial chart has that a flat one does not is motion
 * parallax — the exact thing a still cannot show. A recorded orbit is that
 * argument, in a file that can go in a supplement.
 */

import { useCallback, useState } from "react";
import {
  FORMATS, type ImageFormat, canRecord, imageOf, orbitVideo, recordingFormat,
  save,
} from "@/lib/charts/export";

export type ChartExportProps = {
  /** The chart's canvas. A ref rather than an element so the control can be
   *  rendered before the canvas has mounted. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Used for the filename, so a folder of exports is readable. */
  name: string;
  /** Rotate the chart by this many degrees, for the recording. Charts that
   *  cannot rotate omit it and are offered stills only. */
  rotate?: (degrees: number) => void;
  redraw?: () => void;
};

/** `NVDA valuation surface` becomes `nvda-valuation-surface`. */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    || "chart";
}

export function ChartExport({ canvasRef, name, rotate, redraw }: ChartExportProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const saveImage = useCallback(async (format: ImageFormat) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setProblem(null);
    setBusy(format);
    try {
      save(await imageOf(canvas, format), `${slug(name)}.${format}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message
                 : "That image could not be saved.");
    } finally {
      setBusy(null);
    }
  }, [canvasRef, name]);

  const saveOrbit = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !rotate) return;
    setProblem(null);
    setBusy("video");
    try {
      const format = recordingFormat()!;
      const blob = await orbitVideo(canvas, { rotate, redraw });
      save(blob, `${slug(name)}.${format.extension}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message
                 : "That recording could not be made.");
    } finally {
      setBusy(null);
    }
  }, [canvasRef, name, rotate, redraw]);

  return (
    <div className="chart-export">
      <span className="chart-export-label">Save</span>
      {(Object.keys(FORMATS) as ImageFormat[]).map((format) => (
        <button
          key={format}
          type="button"
          disabled={busy !== null}
          /* The cost of the format, on the control that chooses it, rather
             than in documentation nobody reads before saving. */
          title={FORMATS[format].note}
          onClick={() => void saveImage(format)}
        >
          {busy === format ? "Saving…" : format.toUpperCase()}
        </button>
      ))}

      {/* Offered only where there is something to record and a browser that
          can. A button that produces an unplayable file is worse than none. */}
      {rotate && canRecord() && (
        <button
          type="button"
          disabled={busy !== null}
          title="One full turn, recorded. What a still image cannot show is
                 the parallax that makes a spatial chart readable."
          onClick={() => void saveOrbit()}
        >
          {busy === "video" ? "Recording…" : "Orbit video"}
        </button>
      )}

      {problem && <span className="chart-export-problem">{problem}</span>}
    </div>
  );
}
