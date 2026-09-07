/**
 * The upload dialog offers what this installation can read (§ a literal that drifted).
 *
 * "Add sources" carried `accept=".pdf,.docx,.txt,.md,.csv,.tsv,.xlsx,.json"`.
 * The server reads fifteen dataset formats and reports them on every
 * capabilities request. Eleven were missing from that list:
 *
 *     .db  .dta  .geojson  .por  .sas7bdat  .sav  .sqlite  .sqlite3
 *     .xls  .xlsm  .xpt
 *
 * which is to say Stata, SPSS, SAS, SQLite and older Excel. A social
 * scientist, an epidemiologist or an economist opening the file dialog found
 * their own data greyed out by a product that reads it perfectly well.
 *
 * **`accept` hides rather than rejects**, so there was no error to read and no
 * reason to doubt the screen. A researcher concludes the format is unsupported
 * and goes elsewhere — the most expensive possible failure for a tool being
 * evaluated, and completely silent.
 *
 * The field was also absent from the `Capabilities` type, which is why the
 * literal survived: a field the client cannot name is a field it cannot use.
 */

import { describe, expect, it } from "vitest";
import { DOCUMENT_FORMATS, extrasNote, uploadAccept } from "@/lib/formats";

/** What this machine actually reported, trimmed. */
const REPORTED = {
  readable: [".csv", ".db", ".dta", ".geojson", ".json", ".por", ".sas7bdat",
             ".sav", ".sqlite", ".sqlite3", ".tsv", ".xls", ".xlsm", ".xlsx",
             ".xpt"],
  available_with_an_extra: {
    ".parquet": { describes: "a columnar table", install: "pip install x[parquet]" },
    ".rds": { describes: "an R object", install: "pip install x[r]" },
  },
  note: "15 formats readable here.",
};

describe("what the picker offers", () => {
  it("offers every dataset format the server says it reads", () => {
    const accept = uploadAccept(REPORTED)!.split(",");
    for (const format of REPORTED.readable) {
      expect(accept, `${format} is readable and was not offered`)
        .toContain(format);
    }
  });

  it("offers the statistical package formats by name", () => {
    /*
     * Called out separately because these are the ones the literal excluded,
     * and they are not exotic — they are the default save formats of the three
     * dominant statistical packages in social science and health research.
     */
    const accept = uploadAccept(REPORTED)!;
    for (const format of [".dta", ".sav", ".por", ".sas7bdat", ".xpt"]) {
      expect(accept, `${format} greyed out`).toContain(format);
    }
  });

  it("still offers documents, which are not datasets", () => {
    // `formats.readable` is tabular data; papers travel a different path and
    // have never been in that field.
    const accept = uploadAccept(REPORTED)!;
    for (const format of DOCUMENT_FORMATS) expect(accept).toContain(format);
  });

  it("names each format once", () => {
    const accept = uploadAccept(REPORTED)!.split(",");
    expect(new Set(accept).size).toBe(accept.length);
  });
});

describe("when the server has not said", () => {
  it("offers everything rather than guessing", () => {
    /*
     * The design decision this file exists to protect. A wrong filter hides a
     * researcher's data with no error; no filter shows everything and lets
     * ingestion give a real answer. Undefined is the honest state.
     */
    expect(uploadAccept(null)).toBeUndefined();
    expect(uploadAccept(undefined)).toBeUndefined();
    expect(uploadAccept({ readable: [] })).toBeUndefined();
  });
});

describe("formats that need an extra installed", () => {
  it("are named but not offered", () => {
    // Offering one would produce a selection that fails at ingestion with
    // nothing for the researcher to read.
    const accept = uploadAccept(REPORTED)!;
    expect(accept).not.toContain(".parquet");
    expect(extrasNote(REPORTED)).toContain(".parquet");
  });

  it("say how many there are, from the server's own list", () => {
    expect(extrasNote(REPORTED)).toMatch(/^2 more/);
  });

  it("say nothing at all when there are none", () => {
    expect(extrasNote({ readable: [".csv"] })).toBeNull();
    expect(extrasNote(null)).toBeNull();
  });
});
