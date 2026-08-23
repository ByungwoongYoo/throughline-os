/**
 * Put PDF.js's worker where the application can serve it itself.
 *
 * PDF.js does its parsing in a worker, and it has to be told where that script
 * is. Every example on the internet points `workerSrc` at unpkg or cdnjs, and
 * doing that here would mean a researcher opening a paper announces to a third
 * party that they opened one — and that the reader stops working when the CDN
 * does, or when they are offline on a train with a paper they meant to read.
 *
 * Unlike the hand model, nothing is downloaded: the worker is already on disk
 * inside `pdfjs-dist`. This copies it into `public/` so it is served from the
 * same origin as the page, and re-copies it on install so it can never drift out
 * of step with the library version that has to load it — a worker from a
 * different PDF.js than the main script fails in ways that look like a corrupt
 * document rather than a version mismatch.
 *
 * The same reasoning, and the same shape, as `vendor-hand-model.mjs`.
 */

import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(WEB, "public", "pdfjs");
const WORKER = "pdf.worker.min.mjs";

const require = createRequire(import.meta.url);

function sourcePath() {
  // Resolved through the package rather than by guessing at a path, so a change
  // in pdfjs-dist's layout is an error here instead of a missing file at
  // runtime.
  const entry = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  return join(dirname(entry), WORKER);
}

const from = sourcePath();
if (!existsSync(from)) {
  console.error(`pdf.js worker not found at ${from}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
copyFileSync(from, join(OUT, WORKER));
console.log(`vendored ${WORKER} -> public/pdfjs/`);
