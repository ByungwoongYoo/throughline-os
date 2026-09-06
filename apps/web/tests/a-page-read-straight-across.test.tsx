/**
 * A paper whose columns could not be told apart, said on the source's page.
 *
 * `_page_blocks_in_reading_order` reads a PDF column by column for one reason,
 * stated in its own docstring: PyMuPDF's whole-page ordering interleaves a
 * two-column layout and splices unrelated sentences together, "which destroys
 * the verbatim text every citation depends on".
 *
 * When the block extraction raises there is nothing to detect a split with, so
 * the fallback is that whole-page read. Losing the page would be worse, so the
 * fallback stays — but it happened in silence, under metadata that claimed
 * `"columns": "detected"` either way, and a spliced sentence is
 * indistinguishable from a real one. This product quotes passages verbatim for
 * citation, so the one fact bearing on whether a quotation is real stopped at
 * the database: the parser recorded it, `papers.metadata` stored it, and the
 * source route selected every column except that one.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceDetail } from "@/components/views";
import { api } from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function source(metadata: unknown) {
  return {
    id: "src_1", title: "A two-column paper", trust_level: "unknown",
    ingestion_status: "ready", ingestion_detail: "",
    dataset: null, metadata: null, passage_count: 40,
    withdrawn_at: null, withdrawn_reason: null,
    paper: { id: "pap_1", title: "A two-column paper", page_count: 12, metadata },
  };
}

function serve(metadata: unknown) {
  return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.includes("/columns")) return [] as never;
    return source(metadata) as never;
  });
}

const render1 = () => render(
  <SourceDetail projectId="prj_1" sourceId="src_1" onDiscover={() => {}} />);

describe("a paper with pages read straight across", () => {
  it("says so, and names the pages", async () => {
    serve({ parser: "pymupdf", columns: "spliced", spliced_pages: [4, 9] });

    render1();

    // By role: the phrase is deliberately in the heading and again in the
    // sentence that explains it, so a plain text query finds two.
    await waitFor(() => expect(
      screen.getByRole("heading", { name: /read straight across/ })).toBeTruthy());
    // Named, because "somewhere in this paper" is not something anybody can
    // act on.
    expect(screen.getByText(/4, 9/)).toBeTruthy();
    expect(screen.getByText(/before citing it/)).toBeTruthy();
  });

  it("says nothing of the sort when the columns were found", async () => {
    /*
     * The half that keeps the notice worth reading. A warning on every paper
     * is one nobody reads, and this must appear only where a quotation really
     * could be two halves of two sentences.
     */
    serve({ parser: "pymupdf", columns: "detected" });

    render1();

    await waitFor(() => expect(screen.getByText(/A two-column paper/)).toBeTruthy());
    expect(screen.queryByRole("heading", { name: /read straight across/ }))
      .toBeNull();
  });

  it("says nothing when the parser recorded nothing", async () => {
    // A paper ingested before the parser recorded this, or one read by a
    // parser that does not: absence of the fact is not the fact.
    serve(null);

    render1();

    await waitFor(() => expect(screen.getByText(/A two-column paper/)).toBeTruthy());
    expect(screen.queryByRole("heading", { name: /read straight across/ }))
      .toBeNull();
  });

  it("uses the singular for one page", async () => {
    serve({ parser: "pymupdf", columns: "spliced", spliced_pages: [7] });

    render1();

    await waitFor(() => expect(screen.getByText(/On page 7/)).toBeTruthy());
    expect(screen.getByText(/that page/)).toBeTruthy();
  });
});
