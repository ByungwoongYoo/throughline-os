/**
 * Provenance the product already stores, on the screen that lists sources
 * (D211).
 *
 * Find data brings a dataset in from a repository and the import records which
 * repository, the record's own URL and the licence it was published under. The
 * list showed none of it — so the one screen where a researcher decides which
 * rows to trust could not tell a file somebody dropped on the window from a
 * deposit made by a stranger, and the licence that governs reuse was two clicks
 * away on a screen nobody revisits.
 *
 * Two things are pinned here, because both decay quietly. The provenance is a
 * *link*: "from Zenodo" is only a checkable claim if the record it names can be
 * opened. And a source with no repository gets no line at all — a "from —"
 * would be a sentence about nothing, and this codebase has been bitten before
 * by empty slots that read as statements.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sources } from "@/components/views";
import type { Source } from "@/lib/api";

afterEach(cleanup);

const IMPORTED: Source = {
  id: "src_zen", title: "amr-rates-2019.csv", source_type: "connector",
  ingestion_status: "ready", ingestion_detail: "", trust_level: "trusted",
  created_at: "2026-01-01", paper: null,
  dataset: {
    dataset_id: "ds_1", dataset_version_id: "dsv_1", version: 1,
    row_count: 40, column_count: 3, quality_report: {},
  },
  connector_id: "zenodo", repository: "Zenodo", licence: "CC-BY-4.0",
  original_uri: "https://zenodo.org/records/1234567",
};

/** A file somebody dropped on the window: all four fields are null. */
const UPLOADED: Source = {
  id: "src_up", title: "field-notes.pdf", source_type: "upload",
  ingestion_status: "ready", ingestion_detail: "", trust_level: "trusted",
  created_at: "2026-01-01", dataset: null,
  paper: { id: "pap_1", title: "Field notes", page_count: 12 },
  connector_id: null, repository: null, licence: null, original_uri: null,
};

function list(sources: Source[], onSelect: (id: string) => void = () => {}) {
  return render(
    <Sources
      sources={{ data: sources, error: null, loading: false, reload: () => {} }}
      onSelect={onSelect} upload={() => {}} uploading={false} uploadError={null} />);
}

const rowFor = (title: string) => screen.getByText(title).closest("tr")!;

describe("the sources list says where an imported dataset came from", () => {
  it("names the repository and the licence it was published under", () => {
    /*
     * The whole of D211: the import records this and the list selected none of
     * it, so provenance the product holds was invisible where it is used.
     */
    list([IMPORTED]);
    expect(rowFor(IMPORTED.title).textContent)
      .toContain("from Zenodo · CC-BY-4.0");
  });

  it("makes the repository a link to the record at its origin", () => {
    /*
     * A link because that is what it is. "From Zenodo" is a claim about
     * somewhere else, and a claim the reader cannot go and check is one they
     * have to take on trust — which is the opposite of why provenance is shown.
     */
    list([IMPORTED]);
    const link = screen.getByRole("link", { name: "Zenodo" });
    expect(link.getAttribute("href")).toBe(IMPORTED.original_uri);
    expect(link.getAttribute("target")).toBe("_blank");
    // A new tab that can reach back into this one is a hole, not a nicety.
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("goes to the repository without also opening the source", () => {
    /*
     * §123 — a control does one thing. The whole row opens the source, so a
     * click on the link inside it would otherwise fire both: the researcher
     * asked for the record at its origin and would find themselves moved to
     * another screen as well.
     */
    const onSelect = vi.fn();
    list([IMPORTED], onSelect);
    fireEvent.click(screen.getByRole("link", { name: "Zenodo" }));
    expect(onSelect).not.toHaveBeenCalled();

    // …and the rest of the row still opens it, which is what the stopped
    // click must not have cost.
    fireEvent.click(screen.getByRole("button", { name: IMPORTED.title }));
    expect(onSelect).toHaveBeenCalledWith("src_zen");
  });

  it("says nothing at all about a file somebody uploaded", () => {
    /*
     * An uploaded file has no repository, and "from —" would be a line that
     * says nothing while looking like it says something. No line, no link.
     */
    list([UPLOADED]);
    expect(rowFor(UPLOADED.title).textContent).not.toContain("from");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("drops the licence rather than printing a separator with nothing after it", () => {
    /*
     * A repository that stated no licence is ordinary — `datasearch.tsx` says
     * so in as many words, and "not stated" is not the same as permissive. The
     * row must not end in a dangling "·" that reads as a value failing to load.
     */
    list([{ ...IMPORTED, licence: null }]);
    const said = rowFor(IMPORTED.title).textContent ?? "";
    expect(said).toContain("from Zenodo");
    expect(said).not.toContain("Zenodo ·");
  });

  it("prints the repository as words where there is no record to open", () => {
    /** §123 again: no URL means nowhere to go, so it is not a link. */
    list([{ ...IMPORTED, original_uri: null }]);
    expect(rowFor(IMPORTED.title).textContent).toContain("from Zenodo · CC-BY-4.0");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
