/**
 * Opening a paper, locally (§204, §205).
 *
 * Three constraints shape this file, and none of them are about PDF rendering.
 *
 * **The worker is bundled, never fetched from a CDN.** PDF.js needs a worker
 * script, and every tutorial points `workerSrc` at unpkg or cdnjs. That would
 * mean a researcher opening a paper announces to a third party that they opened
 * one — and if the network is down, or the CDN is, the reader silently stops
 * working. Hand tracking was vendored for exactly this reason and papers do not
 * get an exception, so the worker is copied into `public/pdfjs/` on install and
 * served from this origin — the same arrangement as `/mediapipe/`.
 *
 * **PDF.js is imported lazily.** It is around a megabyte, and a researcher who
 * never opens a paper should never download it. The dynamic import keeps it out
 * of the shared bundle entirely; the cost is paid on the first paper and not
 * before.
 *
 * **The document is untrusted.** A PDF is a program — it can carry JavaScript,
 * embedded files and external references — and papers arrive from the internet.
 * External fetching and system font access are turned off explicitly rather
 * than left at their defaults, so a change in PDF.js's defaults cannot quietly
 * turn them on.
 */

import {
  PageGeometry, PageRotation, normaliseRotation,
} from "./coordinates";
import type { PaperSource } from "./excerpt";

/** The parts of a PDF.js page this product uses. */
export type LoadedPage = {
  number: number;
  /** The page's own size in PDF units, before rotation or zoom. */
  width: number;
  height: number;
  rotation: PageRotation;
  /** Draw the page onto a canvas at a given zoom. */
  render: (canvas: HTMLCanvasElement, scale: number) => Promise<void>;
  /** The page's words, for §205's "original context". Null for a scan. */
  text: () => Promise<string | null>;
};

export type LoadedPaper = {
  source: PaperSource;
  pageCount: number;
  page: (number: number) => Promise<LoadedPage>;
  /** Release the document. Not optional — see `close`. */
  close: () => Promise<void>;
};

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/** Same origin, like `/mediapipe/`. Vendored by the postinstall script. */
export const WORKER_PATH = "/pdfjs/pdf.worker.min.mjs";

let workerSrc: string = WORKER_PATH;

/**
 * Point PDF.js at a worker somewhere other than this application's `public/`.
 *
 * Exists for one reason: `/pdfjs/pdf.worker.min.mjs` is a *URL*, meaningful
 * only where something is serving it. Under the test runner there is no server,
 * so that path is a missing file and every document fails to parse — which is
 * the correct outcome for a wrong path and a useless one for a test suite.
 *
 * Deliberately not a general configuration knob, and deliberately not read from
 * the environment: the production value is a constant that should be hard to
 * change by accident, because changing it to a CDN is the one edit that would
 * quietly undo the privacy guarantee this whole file is arranged around. Must
 * be called before the first `loadPdfjs`, since the module is cached after that.
 */
export function setWorkerSource(source: string): void {
  workerSrc = source;
}

let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * PDF.js, loaded once, on first use.
 *
 * The promise is cached rather than the module, so two papers opened at the
 * same moment share one load instead of racing and fetching it twice.
 */
export async function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      /*
       * Served by this application, from `public/pdfjs/`. Never a CDN — see the
       * file comment — and deliberately a plain same-origin path rather than
       * `new URL("pdfjs-dist/...", import.meta.url)`, which is what the
       * documentation suggests. That form asks the bundler to resolve a *bare
       * package specifier* as though it were a relative URL; whether it works
       * depends on the bundler, and when it does not it produces a runtime
       * fetch of a path that does not exist, which surfaces as every PDF
       * failing to parse rather than as a missing worker.
       *
       * `scripts/vendor-pdf-worker.mjs` copies it on install, so it cannot
       * drift away from the library version that loads it.
       */
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * The geometry a page is rendered with, at a given zoom.
 *
 * The single place page size, rotation and scale are combined, so the canvas
 * and the annotation transform cannot be computed from different numbers. When
 * they were computed separately — a very easy thing to do — annotations sat a
 * few pixels off on rotated pages only, which reads as imprecise hand tracking.
 */
export function geometryOf(page: LoadedPage, scale: number): PageGeometry {
  return {
    width: page.width, height: page.height,
    rotation: page.rotation, scale,
  };
}

/**
 * Open a paper from bytes already in the browser.
 *
 * Bytes rather than a URL: the file came from the researcher's disk, and there
 * is no step where it is uploaded anywhere. `title` is taken from the PDF's own
 * metadata when it has any and falls back to the filename, because §205 will
 * refuse to make an excerpt from a paper with no title and the filename is
 * nearly always the better of the two available answers.
 */
export async function openPaper(
  bytes: Uint8Array,
  options: { id: string; filename: string },
): Promise<LoadedPaper> {
  const pdfjs = await loadPdfjs();

  /*
   * The loading task is kept, not just its promise: `destroy()` lives on the
   * task and is what actually terminates the worker. `PDFDocumentProxy` only
   * offers `cleanup()`, which frees decoded pages and leaves the worker
   * running — so a reader that used it would look like it was releasing papers
   * while accumulating a worker per paper opened.
   */
  const task = pdfjs.getDocument({
    data: bytes,
    // No system font access and no external fetching: a paper is untrusted
    // content and opening one should not reach outside this tab. PDF.js 6
    // removed `isEvalSupported` from the options altogether, so there is no
    // longer a switch here that could turn scripting on.
    useSystemFonts: false,
    useWorkerFetch: false,
  });
  const document = await task.promise;

  const metadata = await document.getMetadata().catch(() => null);
  const info = (metadata?.info ?? {}) as Record<string, unknown>;

  const title = typeof info.Title === "string" && info.Title.trim()
    ? info.Title.trim()
    : options.filename.replace(/\.pdf$/i, "");

  const author = typeof info.Author === "string" ? info.Author.trim() : "";
  const source: PaperSource = {
    id: options.id,
    title,
    // Split on the separators PDF metadata actually uses. A single field
    // holding "Okafor, Lindqvist" is one string to the format and two authors
    // to a reader.
    authors: author ? author.split(/\s*(?:,|;| and )\s*/).filter(Boolean) : [],
    year: yearFrom(info, metadata?.metadata ?? null),
  };

  return {
    source,
    pageCount: document.numPages,

    async page(number: number): Promise<LoadedPage> {
      const page = await document.getPage(number);
      const view = page.view as number[];
      return {
        number,
        // From the page's own box rather than from a viewport, so this is the
        // unscaled, unrotated size the annotation transform expects.
        width: view[2] - view[0],
        height: view[3] - view[1],
        rotation: normaliseRotation(page.rotate ?? 0),

        async render(canvas: HTMLCanvasElement, scale: number): Promise<void> {
          const viewport = page.getViewport({ scale });
          const context = canvas.getContext("2d");
          if (!context) throw new Error("This canvas cannot be drawn on.");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({
            canvas,
            canvasContext: context,
            viewport,
          }).promise;
        },

        async text(): Promise<string | null> {
          const content = await page.getTextContent().catch(() => null);
          if (!content) return null;
          const words = content.items
            .map((item) => (item as { str?: unknown }).str)
            .filter((str): str is string => typeof str === "string")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          // A scanned paper has no text layer at all, and that is a different
          // fact from a page that is genuinely blank.
          return words ? words : null;
        },
      };
    },

    async close(): Promise<void> {
      // Not optional and not left to the garbage collector: each open document
      // holds a worker and its decoded pages, and a reader that opens papers
      // all afternoon without closing them grows until the tab dies.
      await task.destroy();
    },
  };
}

/**
 * The publication year, when the document actually states one.
 *
 * **`CreationDate` is deliberately not used, and this is the whole point of the
 * function.** It is when the *file* was made, not when the work was published,
 * and the two differ constantly: a 1999 paper re-exported from a publisher's
 * site last year carries last year's CreationDate, and a scan carries the date
 * of the scan. Deriving a year from it produces citations that state a year
 * confidently and wrongly — and since the only job of the citation is to lead
 * someone back to the paper, a wrong year is worse than no year, because it
 * sends them looking in the wrong volume.
 *
 * A first attempt did use it, bounded to "plausible" years, and a test caught
 * the disagreement between that guard and its own comment. The bound was never
 * the problem: the field means something else.
 *
 * So the year comes only from a field that is *about the work* — XMP's
 * `dc:date`, which publishers set and exporters do not invent — and is absent
 * otherwise. `citationFor` already renders a citation without a year cleanly,
 * because plenty of documents genuinely have none.
 */
function yearFrom(info: Record<string, unknown>,
                  metadata: { get?: (key: string) => unknown } | null): number | undefined {
  const stated = metadata?.get?.("dc:date");
  const raw = typeof stated === "string" ? stated
            : typeof info.Year === "string" ? info.Year
            : null;
  if (!raw) return undefined;

  const match = /(\d{4})/.exec(raw);
  if (!match) return undefined;
  const year = Number(match[1]);
  const thisYear = new Date().getFullYear();
  // Still bounded, because a stated date can also be malformed — but this now
  // rejects nonsense rather than standing in for the wrong field entirely.
  return year >= 1400 && year <= thisYear + 1 ? year : undefined;
}
