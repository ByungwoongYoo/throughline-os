/**
 * Which files the "Add sources" picker offers, asked of the server.
 *
 * It used to be a literal: `.pdf,.docx,.txt,.md,.csv,.tsv,.xlsx,.json`. The
 * server reads fifteen dataset formats, and eleven of them were missing from
 * that list — including `.dta`, `.sav`, `.por`, `.sas7bdat` and `.xpt`, which
 * is to say Stata, SPSS and SAS. A social scientist, an epidemiologist or an
 * economist opening the file dialog found their own data greyed out by a
 * product that could read it perfectly well.
 *
 * **A wrong filter is worse than no filter.** `accept` hides files rather than
 * rejecting them, so a researcher gets no error to read and no reason to doubt
 * the screen — they conclude the format is unsupported and go elsewhere. That
 * is why `uploadAccept` returns `undefined` when it has not been told what the
 * server reads: offering everything and letting ingestion answer is a worse
 * experience than a correct list and a far better one than a confident wrong
 * list.
 */

/**
 * Documents, which are not datasets and are not in the server's list.
 *
 * `formats.readable` describes tabular data — what a dataset version can be
 * built from. Papers travel a different path through ingestion, so they are
 * named here rather than expected from a field that has never contained them.
 */
export const DOCUMENT_FORMATS = [".pdf", ".docx", ".txt", ".md"] as const;

export type DatasetFormats = {
  readable: string[];
  available_with_an_extra?: Record<string, { describes: string; install: string }>;
  note?: string;
};

/**
 * The `accept` attribute, or `undefined` to offer everything.
 *
 * Undefined rather than a fallback list on purpose — see the note above. The
 * only thing worse than not knowing which formats are readable is being
 * confidently wrong about it in a dialog that silently hides the answer.
 */
export function uploadAccept(formats: DatasetFormats | null | undefined):
    string | undefined {
  if (formats === null || formats === undefined) return undefined;
  const readable = formats.readable ?? [];
  if (readable.length === 0) return undefined;
  // Deduplicated and ordered: documents first, because that is the order the
  // sentence beside the button names them in.
  return [...new Set([...DOCUMENT_FORMATS, ...readable])].join(",");
}

/**
 * What to say beneath the button about formats that need an extra.
 *
 * Named rather than offered. A format that cannot be read until a package is
 * installed does not belong in `accept`: selecting it would produce a failed
 * ingestion and no explanation. Saying it exists, and what turns it on, is the
 * honest middle.
 */
export function extrasNote(formats: DatasetFormats | null | undefined):
    string | null {
  const extras = Object.keys(formats?.available_with_an_extra ?? {});
  if (extras.length === 0) return null;
  const shown = extras.slice(0, 6).join(", ");
  return `${extras.length} more (${shown}${extras.length > 6 ? ", …" : ""}) `
       + "become readable once the matching extra is installed.";
}
