/**
 * Exported copies that no longer state what the analyses state.
 *
 * The live document cannot be wrong — it stores references and resolves them on
 * every read. The exported file can, and is the one somebody else has. What is
 * tested here is not that a hash mismatch is noticed, which is arithmetic, but
 * the two ways showing it could still mislead: letting an ordinary edit sit
 * beside real drift until neither is legible, and letting "we could not check"
 * read as "we checked and it is fine".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExportedDocuments } from "@/components/exports";
import * as useApiModule from "@/lib/useApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function serve(data: unknown, extra: Record<string, unknown> = {}) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue({
    data, error: null, loading: false, reload: vi.fn(), ...extra,
  } as never);
}

const DRIFTED = {
  artifact_id: "art_1",
  title: "Antimicrobial resistance in nine countries",
  note: "one export is behind",
  renders: [
    { id: "ren_1", fmt: "docx", state: "values_changed", created_at: "2026-01-01",
      detail: "The values in this export no longer match what the analyses say." },
  ],
  drifted: [
    { id: "ren_1", fmt: "docx", state: "values_changed", created_at: "2026-01-01",
      detail: "The values in this export no longer match what the analyses say." },
  ],
};

const REPORT = {
  artifacts: [DRIFTED],
  drifted: [DRIFTED],
  unchecked: [],
  note: "1 of 1 exported document states values the analyses no longer produce.",
};

describe("what a researcher has already sent out", () => {
  it("names the document rather than counting it", () => {
    /** A count is skimmed; a title is a file somebody opens before submitting. */
    serve(REPORT);
    render(<ExportedDocuments projectId="prj_1" />);

    expect(screen.getByText(/Antimicrobial resistance in nine countries/))
      .toBeInTheDocument();
  });

  it("names which format is behind", () => {
    /** Re-exporting the .docx does not fix the .html somebody was sent. */
    serve(REPORT);
    render(<ExportedDocuments projectId="prj_1" />);

    expect(screen.getByText("docx")).toBeInTheDocument();
  });

  it("says re-exporting does not reach a copy already sent", () => {
    /**
     * The instruction without its limit is worse than no instruction: it lets
     * somebody believe they have finished when the wrong numbers are already
     * in a co-author's inbox.
     */
    serve(REPORT);
    render(<ExportedDocuments projectId="prj_1" />);

    expect(screen.getByText(/still states the old values/)).toBeInTheDocument();
  });

  it("never says the document itself is wrong", () => {
    /**
     * It is not. It resolves correctly every time it is opened — the copy is
     * what is wrong, and sending a researcher to fix a correct document wastes
     * the one action they have.
     */
    serve(REPORT);
    const { container } = render(<ExportedDocuments projectId="prj_1" />);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/document is wrong|document is incorrect/i);
  });

  it("lets a reader open the document", () => {
    const open = vi.fn();
    serve(REPORT);
    render(<ExportedDocuments projectId="prj_1" onOpen={open} />);

    fireEvent.click(screen.getByRole("button", {
      name: /Antimicrobial resistance/,
    }));
    expect(open).toHaveBeenCalledWith("art_1");
  });
});

describe("an edit is not drift", () => {
  it("shows nothing alarming for a draft that is merely ahead of its export", () => {
    /**
     * Most drafts are ahead of their last export at any moment. Listing that
     * beside numbers that moved while nobody was looking would bury the second
     * case under the first, which is the common one.
     */
    const edited = {
      ...DRIFTED,
      drifted: [],
      renders: [{ id: "ren_2", fmt: "docx", state: "document_edited",
                  created_at: "2026-01-01", detail: "edited since this export" }],
    };
    serve({ artifacts: [edited], drifted: [], unchecked: [],
            note: "All 1 exported document matches what the analyses say." });
    render(<ExportedDocuments projectId="prj_1" />);

    expect(screen.queryByText(/still states the old values/)).not.toBeInTheDocument();
    expect(screen.getByText(/Exports match the analyses/)).toBeInTheDocument();
  });
});

describe("not knowing is not the same as being fine", () => {
  it("reports an unchecked export as unverified rather than as correct", () => {
    /**
     * The comparison being unavailable is the weakest possible evidence about
     * an export, and the one most easily read as a pass.
     */
    const unchecked = {
      ...DRIFTED, title: "Poster draft", drifted: [],
      renders: [{ id: "ren_3", fmt: "html", state: "not_checkable",
                  created_at: "2026-01-01", detail: "no hash recorded" }],
    };
    serve({ artifacts: [unchecked], drifted: [], unchecked: [unchecked],
            note: "1 could not be checked at all." });
    render(<ExportedDocuments projectId="prj_1" />);

    expect(screen.getByText(/not a pass/)).toBeInTheDocument();
    expect(screen.getByText(/Poster draft/)).toBeInTheDocument();
  });

  it("does not present an unchecked export under a heading that says it matches", () => {
    const unchecked = {
      ...DRIFTED, title: "Poster draft", drifted: [],
      renders: [{ id: "ren_3", fmt: "html", state: "not_checkable",
                  created_at: "2026-01-01", detail: "no hash recorded" }],
    };
    serve({ artifacts: [unchecked], drifted: [], unchecked: [unchecked],
            note: "1 could not be checked at all." });
    render(<ExportedDocuments projectId="prj_1" />);

    expect(screen.queryByText(/Exports match the analyses/)).not.toBeInTheDocument();
  });
});

describe("restraint", () => {
  it("renders nothing when the project has never exported anything", () => {
    /**
     * No copy exists that could be out of date. A panel reassuring somebody
     * about a risk they have not taken is noise on every new project.
     */
    serve({ artifacts: [], drifted: [], unchecked: [],
            note: "Nothing has been exported from this project." });
    const { container } = render(<ExportedDocuments projectId="prj_1" />);

    expect(container.firstChild).toBeNull();
  });
});

describe("loading and failure", () => {
  it("says what it is checking", () => {
    serve(null, { loading: true });
    render(<ExportedDocuments projectId="prj_1" />);
    expect(screen.getByText(/Checking exported documents/)).toBeInTheDocument();
  });

  it("reports a failure rather than an empty all-clear", () => {
    /**
     * An empty report reads as "nothing is wrong". The truth is that nobody
     * could look, and those are opposite messages.
     */
    serve(null, { error: new Error("unreachable"), loading: false });
    render(<ExportedDocuments projectId="prj_1" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Exports match the analyses/)).not.toBeInTheDocument();
  });
});
