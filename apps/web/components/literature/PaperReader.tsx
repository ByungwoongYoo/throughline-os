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
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from "react";
import {
  LoadedPage, LoadedPaper, geometryOf, openPaper,
} from "@/lib/literature/document";
import {
  PageGeometry, PagePoint, onPage, renderedSize, toPage, toViewport,
} from "@/lib/literature/coordinates";
import {
  Excerpt, Mark, MarkKind, PaperSource, excerptFrom, excerptOnScreen, marksOnPage,
} from "@/lib/literature/excerpt";
import { api } from "@/lib/api";
import {
  canvasMapping, markFromStroke, markUnder,
} from "@/lib/literature/handMarks";
import type { SpatialStroke } from "@/lib/ink/stroke";
import { SpatialControl } from "@/components/spatial/SpatialControl";
import { InkLayer, InkSurface } from "@/components/spatial/InkLayer";
import type { HandFrame } from "@/lib/spatial/types";
import type { VisualizationController } from "@/lib/spatial/commands";

const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 3];

/** The §204 vocabulary, with the words a researcher would use. */
const TOOLS: Array<{ kind: MarkKind | "erase"; label: string }> = [
  { kind: "underline", label: "Underline" },
  { kind: "circle", label: "Circle" },
  { kind: "highlight", label: "Highlight" },
  { kind: "arrow", label: "Arrow" },
  { kind: "note", label: "Note" },
  { kind: "erase", label: "Rub out" },
];

const INK: Record<MarkKind, string> = {
  underline: "rgba(20,67,184,0.9)",
  circle: "rgba(20,67,184,0.9)",
  highlight: "rgba(240,190,40,0.35)",
  arrow: "rgba(27,122,62,0.9)",
  note: "rgba(90,105,135,0.9)",
};

export type PaperReaderProps = {
  /**
   * A paper the search already found, opened without asking for a file.
   *
   * `source` is carried separately from the PDF because it is *better*. It has
   * been reconciled across OpenAlex, Crossref, arXiv and PubMed, with the
   * disagreements kept — whereas a PDF's own Info dictionary is whatever the
   * exporter happened to write, frequently empty and frequently wrong. This is
   * also where the publication year comes from at all: `document.ts` refuses to
   * infer one from `CreationDate`, because that is when the *file* was made, so
   * a paper opened from disk usually has no year and one opened from a search
   * always does.
   */
  opening?: { source: PaperSource; pdfUrl: string } | null;
  /** Where an excerpt goes. Without this the board is local to the reader. */
  onExcerpt?: (excerpt: Excerpt) => void;
  /**
   * Where marks are kept, and where they come back from.
   *
   * Optional, and its absence is meaningful rather than a missing feature: a
   * PDF opened from the researcher's own disk has no source in this project to
   * attach ink to, so the reader keeps those marks in memory and says nothing
   * about saving them. Inventing a source to hang them on would put a document
   * in the workspace that nobody added.
   */
  marks?: {
    sourceId: string;
    projectId: string;
  };
};

export type PaperReaderHandle = {
  /**
   * A stroke drawn in the air over this page (§143).
   *
   * Exposed as a handle as well as wired internally, so a host that already
   * runs a tracking session can feed this one rather than starting a second
   * camera. Nothing here turns a camera on by itself: `SpatialControl` renders
   * an offer and asks only when the researcher presses the button that says so.
   *
   * Screen-space strokes only, which is what §143 calls marking a document.
   * Everything about *where* the mark goes is in `handMarks`, tested without a
   * camera.
   */
  markFromHand: (stroke: SpatialStroke) => void;
};

/*
 * There is deliberately no `onClose`. One was added and never wired, which is
 * the defect this codebase keeps producing — a prop computed, exported and
 * read by nobody — and the caller already renders its own way back. Two
 * controls that close the same thing is worse than one.
 */

export const PaperReader = forwardRef<PaperReaderHandle, PaperReaderProps>(
    function PaperReader({ opening, onExcerpt, marks: keeping }, ref) {
  const [paper, setPaper] = useState<LoadedPaper | null>(null);
  const [page, setPage] = useState<LoadedPage | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  /**
   * What a press does. A mark kind, or the eraser.
   *
   * Widened past `MarkKind` because rubbing out is not a kind of mark — it is
   * the absence of one. Modelling it as a sixth kind would put "eraser" in the
   * vocabulary of things that can be drawn on a paper and stored, which is the
   * confusion that once had a wipe recorded as something drawn.
   */
  const [tool, setTool] = useState<MarkKind | "erase">("underline");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [excerpts, setExcerpts] = useState<Excerpt[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * A margin note being written, anchored in page coordinates.
   *
   * The anchor is a `PagePoint` and not a screen position for the same reason
   * every other mark is: the note has to stay beside the sentence it is about
   * when the zoom changes, and a pixel anchor only means anything at the zoom
   * it was taken at.
   */
  const [noteAt, setNoteAt] = useState<PagePoint | null>(null);
  /** Whether hand marking is being offered on this paper. */
  const [handOffered, setHandOffered] = useState(false);
  const inkRef = useRef<InkSurface | null>(null);
  /*
   * The reader has no figures to grab, so nothing here is controlled by the
   * hand except the ink. `SpatialControl` requires a controller, and a null one
   * is the honest answer rather than inventing a target: §186 says a document
   * should not rotate into arbitrary perspective while somebody is reading it.
   */
  const nothingToGrab = useRef<VisualizationController | null>(null);
  const [noteText, setNoteText] = useState("");

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
      rubbing.current.clear();
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

  /*
   * Open a paper the search found.
   *
   * The bytes come through this application's own API rather than a direct
   * browser fetch, because arXiv and the rest send no CORS headers — and that
   * server-side hop is checked against SSRF on every redirect, which is why it
   * is an endpoint rather than a `fetch`.
   *
   * The search's metadata replaces whatever the PDF says about itself, for the
   * reasons in `PaperReaderProps`.
   */
  useEffect(() => {
    if (!opening) return;
    let current = true;
    setProblem(null);
    setBusy(true);
    void (async () => {
      try {
        const bytes = await api.postForBytes("/api/literature/pdf",
                                             { url: opening.pdfUrl });
        const loaded = await openPaper(bytes, {
          id: opening.source.id, filename: `${opening.source.title}.pdf`,
        });
        if (!current) { void loaded.close(); return; }
        // The reconciled record wins over the file's own Info dictionary.
        setPaper((previous) => {
          void previous?.close();
          return { ...loaded, source: opening.source };
        });
        setPageNumber(1); setMarks([]); setExcerpts([]);
        rubbing.current.clear();
      } catch (error) {
        if (current) {
          setProblem(error instanceof Error ? error.message
            : "That paper could not be opened.");
        }
      } finally {
        if (current) setBusy(false);
      }
    })();
    return () => { current = false; };
  }, [opening]);

  /*
   * What is already written on this paper.
   *
   * Loaded rather than starting blank, which is the whole point: §204's
   * guarantee about zoom was already met and the annotations still vanished
   * when the paper was closed, so what existed was a demonstration of an
   * annotation rather than one.
   */
  useEffect(() => {
    if (!keeping) return;
    let current = true;
    api.get<{ marks: Array<{ id: string; page: number; kind: MarkKind;
                             points: PagePoint[]; body: string | null }> }>(
      `/api/sources/${keeping.sourceId}/marks`)
      .then((r) => {
        if (!current) return;
        setMarks(r.marks.map((m) => ({
          id: m.id, kind: m.kind, page: m.page, points: m.points,
          text: m.body ?? undefined, at: 0,
        })));
      })
      // Ink that could not be fetched is not worth an error over the paper —
      // the researcher can still read and still draw, and a failed load says
      // less than a page that refuses to open.
      .catch(() => { if (current) setMarks([]); });
    return () => { current = false; };
  }, [keeping]);

  /**
   * Keep a mark, and show it whether or not keeping succeeds.
   *
   * Drawn first and stored after: ink that waited for a round trip before
   * appearing would feel like the pen skipping, and §142's rule that a
   * researcher must never wonder whether they are drawing applies to the
   * moment after the stroke as much as during it.
   */
  const keepMark = useCallback((mark: Mark) => {
    setMarks((existing) => [...existing, mark]);
    if (!keeping) return;
    void api.post(`/api/projects/${keeping.projectId}/marks`, {
      source_id: keeping.sourceId, page: mark.page, kind: mark.kind,
      points: mark.points.map((p) => ({ x: p.x, y: p.y })),
      body: mark.text ?? null,
    }).catch(() => {
      // Said plainly rather than silently: a mark the researcher believes is
      // saved and is not is the worst of the three possible outcomes.
      setProblem("That mark was drawn but could not be saved.");
    });
  }, [keeping]);

  /**
   * Rub out the mark under a point (§176).
   *
   * Radius in PDF units, not pixels, so the eraser is the same size relative to
   * the words at every zoom. In screen pixels it would take a whole sentence
   * when zoomed out and be hard to aim when zoomed in.
   *
   * Removed from the page first and from the store after, for the same reason
   * ink appears before it is saved: an eraser that waited for a round trip
   * would feel stuck. If the removal fails the mark comes back, because a mark
   * that vanished and returned on reload is worse than one that never left.
   */
  const RUB_RADIUS = 14;

  /*
   * Marks already being rubbed out, so one is not deleted twice.
   *
   * A drag calls this once per sample — a hand stroke, dozens of times — and
   * every call reads the same `marks` snapshot from its closure. Without this
   * set, one mark under a long drag produced a DELETE per sample: the first
   * succeeded and the rest answered 404, and each 404 put the mark back. The
   * researcher would rub something out and watch it reappear.
   */
  const rubbing = useRef<Set<string>>(new Set());

  const rubOut = useCallback((at: PagePoint) => {
    const target = markUnder(at, marks, { page: pageNumber, within: RUB_RADIUS });
    if (!target || rubbing.current.has(target.id)) return;
    rubbing.current.add(target.id);

    setMarks((existing) => existing.filter((m) => m.id !== target.id));
    // Kept in the set on success, deliberately: a mark that is gone should not
    // be rubbed a second time, and it is no longer in `marks` to be found
    // anyway. The set is emptied when the paper changes.
    if (!keeping) { rubbing.current.delete(target.id); return; }
    void api.del(`/api/projects/${keeping.projectId}/marks/${target.id}`)
      .catch(() => {
        // Put back, because a mark that vanished and returned on reload is
        // worse than one that never left.
        setMarks((existing) => [...existing, target]);
        rubbing.current.delete(target.id);
        setProblem("That mark could not be rubbed out.");
      });
  }, [marks, pageNumber, keeping]);

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

    for (const mark of marksOnPage(marks, pageNumber)) {
      if (mark.kind === "note") { drawNoteMarker(context, mark, geometry); continue; }
      draw(mark.points, mark.kind);
    }
    // Nothing is being drawn while rubbing out, so there is no live stroke to
    // show — and drawing one would suggest the eraser leaves a mark.
    if (drawingRef.current && tool !== "erase") draw(strokeRef.current, tool);

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

  /**
   * Keep the note being written, or discard it.
   *
   * An empty note is discarded rather than stored. A marker in the margin with
   * nothing behind it is worse than no marker: it looks like something was
   * recorded, and a researcher would click it expecting to find out what.
   */
  const commitNote = useCallback(() => {
    const anchor = noteAt;
    const text = noteText.trim();
    setNoteAt(null);
    setNoteText("");
    if (!anchor || !text) return;
    keepMark({
      id: `mark-${Date.now()}`, kind: "note", page: pageNumber,
      points: [anchor], text, at: Date.now(),
    });
  // `keepMark` is a dependency and not an oversight: the source arrives
  // asynchronously, after the paper is imported, so a stale closure would still
  // be the one that saves nothing — and the marks made in the first seconds of
  // reading would vanish without ever reporting a failure.
  }, [noteAt, noteText, pageNumber, keepMark]);

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

    /*
     * A note is placed, not drawn.
     *
     * §204 lists it beside underline and circle, but it is a different gesture
     * — the researcher indicates *where* and then writes. Dragging out a note
     * would produce a stroke nobody wanted and no text.
     */
    if (tool === "erase") {
      rubOut(point);
      // Marked as drawing so dragging keeps rubbing, the way an eraser behaves
      // on paper — a press that removed only one mark would need a press per
      // stroke to clear a page.
      drawingRef.current = true;
      return;
    }

    if (tool === "note") {
      setNoteAt(point);
      setNoteText("");
      return;
    }

    drawingRef.current = true;
    strokeRef.current = [point];
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const move = (event: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const point = pointFrom(event);
    if (!point) return;
    // Dragging the eraser keeps rubbing, the way one behaves on paper. A press
    // that took only the mark under it would need a press per stroke.
    if (tool === "erase") { rubOut(point); return; }
    strokeRef.current.push(point);
    paintInk();
  };

  const finish = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = strokeRef.current;
    strokeRef.current = [];
    // An eraser drag has already done its work on the way through, and leaves
    // nothing behind by definition.
    if (tool === "erase") { paintInk(); return; }
    // A tap is not a mark. Without this, every click that misses a control
    // leaves a dot on the paper.
    if (points.length < 2) { paintInk(); return; }
    keepMark({
      id: `mark-${Date.now()}`, kind: tool, page: pageNumber,
      points, at: Date.now(),
    });
  };

  /*
   * A stroke the hand finished, becoming a mark on this page (§143 → §204).
   *
   * The conversion is in `handMarks` and provable without a camera; what is
   * here is only the part that needs the DOM — where the canvas currently sits,
   * and how large its backing store is relative to its laid-out size.
   */
  const markFromHand = useCallback((stroke: SpatialStroke) => {
    {
      const canvas = inkCanvas.current;
      if (!canvas || !geometry) return;
      const rect = canvas.getBoundingClientRect();

      /*
       * A hand stroke made while the eraser is in hand rubs out along its
       * path rather than leaving a mark. Without this the tool would mean one
       * thing to the pointer and another to the hand — the researcher would
       * select "Rub out", wave at the page, and watch it draw.
       */
      if (tool === "erase") {
        const map = canvasMapping({
          rect: { left: rect.left, top: rect.top,
                  width: rect.width, height: rect.height },
          width: canvas.width, height: canvas.height,
        });
        for (const point of stroke.points) {
          rubOut(toPage(map({ x: point.x, y: point.y }), geometry));
        }
        return;
      }

      const mark = markFromStroke(stroke, {
        geometry, page: pageNumber, kind: tool,
        toCanvas: canvasMapping({
          rect: { left: rect.left, top: rect.top,
                  width: rect.width, height: rect.height },
          width: canvas.width, height: canvas.height,
        }),
      });
      // Null when the stroke was an eraser pass, a lasso, or simply missed the
      // paper — none of which is a mark, and none of which is an error worth
      // interrupting the researcher about.
      if (mark) keepMark(mark);
    }
  }, [geometry, pageNumber, tool, keepMark, rubOut]);

  useImperativeHandle(ref, (): PaperReaderHandle => ({ markFromHand }),
                      [markFromHand]);

  /** Tracker frames drive the ink recorder, exactly as on the Air Ink page. */
  const handleFrame = useCallback((frame: HandFrame) => {
    inkRef.current?.step(frame);
  }, []);

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
    // Outward as well as local: a board that only exists inside the reader is
    // the thing §205 is not asking for.
    onExcerpt?.(result.excerpt);
  }, [marks, pageNumber, paper, page, onExcerpt]);

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
            <button type="button" aria-pressed={handOffered}
                    onClick={() => setHandOffered((on) => !on)}>
              {handOffered ? "Hide hand marking" : "Mark with your hand"}
            </button>
          </>
        )}
      </div>

      {/*
        * Offered rather than started. `SpatialControl` shows what it would do
        * and asks only when the researcher presses the button that says so, so
        * opening a paper never turns a camera on.
        */}
      {handOffered && paper && (
        <SpatialControl controllerRef={nothingToGrab}
                        label="marking this paper by hand"
                        onFrame={handleFrame}
                        intentOf={() => "draw"} />
      )}

      {/*
        * The ink surface the tracker draws into. Full viewport and not
        * interactive: it shows the stroke as it is made, and the finished
        * stroke becomes a page mark through `markFromHand`.
        */}
      {handOffered && paper && (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none",
                      zIndex: 5 }}>
          <InkLayer ref={inkRef} armed fullViewport
                    onStroke={(stroke) => markFromHand(stroke)} />
        </div>
      )}

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
          {/*
            * The note being written, positioned from its page anchor through
            * the same transform everything else uses — so it sits where the
            * marker will, at whatever zoom is in force.
            */}
          {noteAt && geometry && (
            <input
              className="reader-note-input"
              autoFocus
              aria-label="Note text"
              value={noteText}
              placeholder="Write a note, then press Enter"
              style={{
                position: "absolute",
                left: toViewport(noteAt, geometry).x + 10,
                top: toViewport(noteAt, geometry).y - 14,
              }}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNote();
                // Escape abandons it. Without this the only way out of a note
                // opened by accident is to type something and then erase it.
                if (e.key === "Escape") { setNoteAt(null); setNoteText(""); }
              }}
              onBlur={commitNote}
            />
          )}
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
});

/**
 * A note in the margin: a small mark, and the words beside it.
 *
 * Exported so it can be tested. A painter reachable only through an animation
 * frame in happy-dom is one no test ever runs — the same reason `paintCursor`
 * and `InkLayer`'s `paint` are exported.
 *
 * The text is drawn on the canvas rather than laid out as an element, so it
 * scales with the page and cannot drift away from its anchor: an HTML label
 * positioned over the canvas would need its own transform kept in step, which
 * is the second implementation that always diverges.
 */
export function drawNoteMarker(context: CanvasRenderingContext2D,
                               mark: Mark, geometry: PageGeometry): void {
  const anchor = mark.points[0];
  if (!anchor) return;
  const at = toViewport(anchor, geometry);

  context.save();
  context.fillStyle = "rgba(90,105,135,0.95)";
  context.beginPath();
  context.arc(at.x, at.y, 5, 0, Math.PI * 2);
  context.fill();

  const text = (mark.text ?? "").trim();
  if (text) {
    // Scaled with the page so a note stays the same size relative to the text
    // it annotates, rather than shrinking into illegibility when zoomed out.
    const size = Math.max(9, 11 * geometry.scale);
    context.font = `${size}px system-ui, sans-serif`;
    context.textBaseline = "middle";
    // One line, truncated. A margin note that reflowed into a paragraph would
    // cover the page it is annotating.
    const shown = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    const width = context.measureText(shown).width;

    context.fillStyle = "rgba(255,255,250,0.92)";
    context.fillRect(at.x + 9, at.y - size * 0.8, width + 8, size * 1.6);
    context.fillStyle = "rgba(50,58,74,0.98)";
    context.fillText(shown, at.x + 13, at.y);
  }
  context.restore();
}
