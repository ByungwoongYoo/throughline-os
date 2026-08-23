"use client";

/**
 * Reading a paper, and marking it (§204, §205).
 *
 * The subsystem underneath this is arranged so that the interesting decisions
 * are already made and already tested: marks live in PDF user space, the
 * transform between that and the canvas is checked against PDF.js's own
 * viewport, and an excerpt refuses to exist without the provenance §205 lists.
 * What is left for this component is to be a competent reader and to not
 * undermine any of it.
 *
 * Three things it is careful about.
 *
 * **The ink canvas and the page canvas are the same size, always.** They are
 * separate elements — the page is expensive to redraw and the ink is redrawn
 * constantly — and the moment their sizes diverge, every mark is offset by the
 * difference. Both are sized from one `geometryOf` call for exactly that
 * reason.
 *
 * **Nothing is stored in screen coordinates, even briefly.** The in-progress
 * stroke is converted to page space as each point arrives rather than at the
 * end, so there is no moment where a mark exists as pixels and no possibility
 * of a zoom landing in the middle of a stroke and stranding half of it.
 *
 * **A rendered page is not re-rendered while another render is in flight.**
 * PDF.js throws if you render the same page twice concurrently, and zooming
 * with the mouse wheel produces exactly that. The guard is a token rather than
 * a boolean so a superseded render's result is discarded instead of drawn over
 * the newer one.
 */

import {
  useCallback, useEffect, useRef, useState,
} from "react";
import {
  LoadedPage, LoadedPaper, geometryOf, openPaper,
} from "@/lib/literature/document";
import {
  PageGeometry, PagePoint, onPage, renderedSize, toPage, toViewport,
} from "@/lib/literature/coordinates";
import {
  Excerpt, Mark, MarkKind, excerptFrom, excerptOnScreen, marksOnPage,
} from "@/lib/literature/excerpt";

const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 3];

/** The §204 vocabulary, with the words a researcher would use. */
const TOOLS: Array<{ kind: MarkKind; label: string }> = [
  { kind: "underline", label: "Underline" },
  { kind: "circle", label: "Circle" },
  { kind: "highlight", label: "Highlight" },
  { kind: "arrow", label: "Arrow" },
];

const INK: Record<MarkKind, string> = {
  underline: "rgba(20,67,184,0.9)",
  circle: "rgba(20,67,184,0.9)",
  highlight: "rgba(240,190,40,0.35)",
  arrow: "rgba(27,122,62,0.9)",
  note: "rgba(90,105,135,0.9)",
};

export function PaperReader() {
  const [paper, setPaper] = useState<LoadedPaper | null>(null);
  const [page, setPage] = useState<LoadedPage | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [tool, setTool] = useState<MarkKind>("underline");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [excerpts, setExcerpts] = useState<Excerpt[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pageCanvas = useRef<HTMLCanvasElement | null>(null);
  const inkCanvas = useRef<HTMLCanvasElement | null>(null);
  /** The stroke in progress, in page coordinates. Never in pixels. */
  const strokeRef = useRef<PagePoint[]>([]);
  const drawingRef = useRef(false);
  /** Identifies the newest render, so superseded ones can be discarded. */
  const renderToken = useRef(0);

  const geometry: PageGeometry | null = page ? geometryOf(page, scale) : null;

  /* ---- opening ---- */

  const open = useCallback(async (file: File) => {
    setProblem(null);
    setBusy(true);
    try {
      // Read here, in the browser. There is no step where the file is uploaded.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const opened = await openPaper(bytes, {
        id: `paper-${Date.now()}`, filename: file.name,
      });
      setPaper((previous) => { void previous?.close(); return opened; });
      setPageNumber(1);
      setMarks([]);
      setExcerpts([]);
    } catch (error) {
      // A damaged or encrypted PDF is a normal thing to be handed, and the
      // reader saying nothing at all is what makes it feel broken.
      setProblem(error instanceof Error
        ? `That file could not be opened: ${error.message}`
        : "That file could not be opened.");
    } finally {
      setBusy(false);
    }
  }, []);

  // Release the document when the reader goes away. Each open paper holds a
  // worker; a session that opens papers all afternoon would otherwise grow
  // until the tab dies.
  useEffect(() => () => { void paper?.close(); }, [paper]);

  useEffect(() => {
    if (!paper) { setPage(null); return; }
    let current = true;
    void paper.page(pageNumber).then((loaded) => {
      if (current) setPage(loaded);
    }).catch(() => {
      if (current) setProblem("That page could not be read.");
    });
    return () => { current = false; };
  }, [paper, pageNumber]);

  /* ---- rendering the page ---- */

  useEffect(() => {
    const canvas = pageCanvas.current;
    if (!canvas || !page) return;
    const token = ++renderToken.current;
    void page.render(canvas, scale).then(() => {
      // Superseded by a newer zoom while this was drawing: its output is stale
      // and drawing it now would put the previous zoom back on screen.
      if (token !== renderToken.current) return;
      paintInk();
    }).catch(() => {
      if (token === renderToken.current) {
        setProblem("That page could not be drawn.");
      }
    });
    // paintInk is stable enough for this effect's purpose and depending on it
    // would re-render the PDF on every stroke, which is the expensive half.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, scale]);

  /* ---- ink ---- */

  const paintInk = useCallback(() => {
    const canvas = inkCanvas.current;
    if (!canvas || !geometry) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);

    const draw = (points: PagePoint[], kind: MarkKind) => {
      if (points.length === 0) return;
      context.strokeStyle = INK[kind];
      context.lineWidth = kind === "highlight" ? 14 : 2.2;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      points.forEach((point, i) => {
        // Every point converted through the same transform the tests check, so
        // what is drawn cannot disagree with what is stored.
        const at = toViewport(point, geometry);
        if (i === 0) context.moveTo(at.x, at.y);
        else context.lineTo(at.x, at.y);
      });
      if (kind === "circle") context.closePath();
      context.stroke();
    };

    for (const mark of marksOnPage(marks, pageNumber)) draw(mark.points, mark.kind);
    if (drawingRef.current) draw(strokeRef.current, tool);

    // Anything already taken to the board, so it is visible that it was taken.
    context.setLineDash([5, 5]);
    context.strokeStyle = "rgba(27,122,62,0.85)";
    context.lineWidth = 1.5;
    for (const excerpt of excerpts) {
      if (excerpt.page !== pageNumber) continue;
      const box = excerptOnScreen(excerpt, geometry);
      context.strokeRect(box.x, box.y, box.width, box.height);
    }
    context.setLineDash([]);
  }, [geometry, marks, excerpts, pageNumber, tool]);

  useEffect(() => { paintInk(); }, [paintInk]);

  /* ---- drawing ---- */

  const pointFrom = useCallback((event: React.PointerEvent): PagePoint | null => {
    const canvas = inkCanvas.current;
    if (!canvas || !geometry) return null;
    const box = canvas.getBoundingClientRect();
    // Through the CSS size, not the backing-store size: the canvas may be laid
    // out smaller than its pixel dimensions, and using the wrong one puts every
    // mark at a constant fraction of where it belongs.
    const at = {
      x: (event.clientX - box.left) * (canvas.width / box.width),
      y: (event.clientY - box.top) * (canvas.height / box.height),
    };
    const point = toPage(at, geometry);
    // A mark in the grey around the paper has no document coordinates.
    return onPage(point, geometry, 2) ? point : null;
  }, [geometry]);

  const start = (event: React.PointerEvent) => {
    const point = pointFrom(event);
    if (!point) return;
    drawingRef.current = true;
    strokeRef.current = [point];
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const move = (event: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const point = pointFrom(event);
    if (!point) return;
    strokeRef.current.push(point);
    paintInk();
  };

  const finish = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = strokeRef.current;
    strokeRef.current = [];
    // A tap is not a mark. Without this, every click that misses a control
    // leaves a dot on the paper.
    if (points.length < 2) { paintInk(); return; }
    setMarks((existing) => [...existing, {
      id: `mark-${Date.now()}`, kind: tool, page: pageNumber,
      points, at: Date.now(),
    }]);
  };

  /* ---- to the board (§205) ---- */

  const takeToBoard = useCallback(async () => {
    const last = marksOnPage(marks, pageNumber).at(-1);
    if (!paper || !last) {
      setProblem("Circle the part of the page to take first.");
      return;
    }
    const context = page ? await page.text() : null;
    const result = excerptFrom({
      source: paper.source, page: pageNumber, points: last.points,
      context, id: `excerpt-${Date.now()}`, at: Date.now(),
    });
    if (!result.ok) { setProblem(result.reason); return; }
    setProblem(null);
    setExcerpts((existing) => [...existing, result.excerpt]);
  }, [marks, pageNumber, paper, page]);

  /*
   * One source for the canvas size, and it is the same function the transform
   * tests check. A second implementation here — the obvious `turned ? h : w`
   * two-liner — is exactly how the ink canvas and the page canvas drift apart,
   * and a one-pixel disagreement offsets every mark on the page.
   */
  const size = geometry
    ? { width: Math.ceil(renderedSize(geometry).width),
        height: Math.ceil(renderedSize(geometry).height) }
    : { width: 0, height: 0 };

  return (
    <div className="reader">
      <div className="reader-bar">
        <label className="reader-open">
          Open a paper
          <input type="file" accept="application/pdf" hidden
                 onChange={(e) => {
                   const file = e.target.files?.[0];
                   if (file) void open(file);
                 }} />
        </label>

        {paper && (
          <>
            <span className="reader-title">{paper.source.title}</span>
            <span className="reader-pages">
              <button type="button" disabled={pageNumber <= 1}
                      onClick={() => setPageNumber((n) => n - 1)}>Back</button>
              <span>Page {pageNumber} of {paper.pageCount}</span>
              <button type="button" disabled={pageNumber >= paper.pageCount}
                      onClick={() => setPageNumber((n) => n + 1)}>Next</button>
            </span>
            <label>
              Zoom
              <select value={scale}
                      onChange={(e) => setScale(Number(e.target.value))}>
                {ZOOMS.map((z) => (
                  <option key={z} value={z}>{Math.round(z * 100)}%</option>
                ))}
              </select>
            </label>
            <span className="reader-tools">
              {TOOLS.map((option) => (
                <button key={option.kind} type="button"
                        aria-pressed={tool === option.kind}
                        onClick={() => setTool(option.kind)}>{option.label}</button>
              ))}
            </span>
            <button type="button" onClick={() => void takeToBoard()}>
              Put this on the board
            </button>
          </>
        )}
      </div>

      {busy && <p className="reader-note">Opening…</p>}
      {problem && <p className="reader-problem" role="status">{problem}</p>}

      {!paper && !busy && (
        <p className="reader-note">
          Open a PDF to read and mark it. The file stays on this machine — it is
          read in the browser and never uploaded.
        </p>
      )}

      {paper && (
        <div className="reader-page" style={{ width: size.width, height: size.height }}>
          <canvas ref={pageCanvas} className="reader-canvas" />
          <canvas ref={inkCanvas} className="reader-canvas reader-ink"
                  data-testid="paper-ink"
                  width={size.width} height={size.height}
                  onPointerDown={start} onPointerMove={move}
                  onPointerUp={finish} onPointerCancel={finish} />
        </div>
      )}

      {excerpts.length > 0 && (
        <section className="reader-board">
          <h2>On the board</h2>
          <ul>
            {excerpts.map((excerpt) => (
              <li key={excerpt.id}>
                <strong>{excerpt.citation}</strong>
                {excerpt.context && <span> — {excerpt.context.slice(0, 140)}…</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
