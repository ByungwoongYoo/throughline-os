/**
 * The header of "Find papers", and the sentence that had gone quietly wrong.
 *
 * It read "Searches OpenAlex, Crossref, arXiv and PubMed at once" — true when
 * it was written, and wrong by six sources by the time anybody looked. bioRxiv,
 * Europe PMC, Semantic Scholar, DOAJ, OpenAIRE and Zotero were all added
 * underneath it, so a researcher reading that sentence would conclude their
 * preprints and their own library were not being searched. They were.
 *
 * The repair is structural rather than a corrected list: the count is taken
 * from the same capabilities the source chips are built from, so adding a
 * connector changes the sentence and the chips together, or neither. These
 * tests pin that, because a hardcoded list is exactly what looks fine in review.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Literature } from "@/components/literature";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const SOURCES = [
  "openalex", "crossref", "arxiv", "pubmed", "semanticscholar",
  "europepmc", "biorxiv", "doaj", "openaire", "zotero",
];

function stubCapabilities(names: string[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      sources: names.map(
        (name) => ({ name, polite: true, ready: true, note: null })),
    }),
  } as Response));
}

describe("the Find papers header", () => {
  it("counts the sources it actually has, rather than naming four", async () => {
    stubCapabilities(SOURCES);
    render(<Literature projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/all 10/)).toBeTruthy());
  });

  it("follows the source list rather than restating it", async () => {
    /** The property that stops it rotting again: fewer sources, smaller count,
     *  with nothing edited in the sentence. */
    stubCapabilities(SOURCES.slice(0, 4));
    render(<Literature projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/all 4/)).toBeTruthy());
  });

  it("never hardcodes a source list in the lede", async () => {
    /** Named sources in the sentence are how it went wrong the first time. */
    stubCapabilities(SOURCES);
    const { container } = render(<Literature projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/all 10/)).toBeTruthy());
    const lede = container.querySelector(".lede");
    expect(lede?.textContent).not.toMatch(/OpenAlex|Crossref|arXiv|PubMed/);
  });

  it("offers a search field, not a plain text box", async () => {
    /** Without type="search" the browser gives it no clear control, the wrong
     *  on-screen keyboard, and none of the semantics that announce it as a
     *  search to assistive technology. */
    stubCapabilities(SOURCES);
    render(<Literature projectId="p1" />);
    const input = await screen.findByLabelText(/Search literature/);
    expect(input.getAttribute("type")).toBe("search");
  });
});

describe("what has been taken from papers", () => {
  /*
   * The board is loaded from the server rather than held in React state,
   * because state emptied on navigation made §205 a demonstration rather than
   * a place to put anything. That load ended `.catch(() => setKept([]))`, so a
   * failed request produced the same empty board the load exists to prevent —
   * and the section is rendered only when it has entries, so it simply
   * vanished. A researcher who had taken excerpts saw no board and no reason,
   * and the obvious next move is to take the same excerpt again.
   */
  const PAPER = {
    title: "Consumption and resistance", authors: ["A. Author"], year: 2024,
    doi: "10.1/x", arxiv_id: null, pmid: null, venue: "Journal",
    abstract: "An abstract.", url: "https://example.org/x",
    pdf_url: "", open_access: true, cited_by: 3, source: "openalex",
    // `disagreements` is read unconditionally by the result row — a fixture
    // that omits it takes the render down before any assertion runs, which is
    // the same trap `connectiondetail`'s fixture records for `assumption_checks`.
    provenance: {}, disagreements: {},
  };

  /** Answers each path in turn; `excerpts` is what the test varies. */
  function serve(excerpts: () => { ok: boolean; status: number; body: unknown }) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(typeof input === "string" ? input : input.toString());
        if (url.includes("/excerpts")) {
          const answer = excerpts();
          return {
            ok: answer.ok, status: answer.status,
            text: async () => JSON.stringify(answer.body),
          } as Response;
        }
        if (url.includes("/literature/sources")) {
          return {
            ok: true, status: 200,
            text: async () => JSON.stringify({
              sources: SOURCES.map((name) =>
                ({ name, polite: true, ready: true, note: null })),
            }),
          } as Response;
        }
        if (url.includes("/literature/search")) {
          return {
            ok: true, status: 200,
            text: async () => JSON.stringify({
              query: "resistance", results: [PAPER], sources: {},
              found: 1, returned_by_sources: 1, note: "",
            }),
          } as Response;
        }
        return { ok: true, status: 200, text: async () => "[]" } as Response;
      });
  }

  async function searchFor(term: string) {
    const input = await screen.findByLabelText(/Search literature/);
    fireEvent.change(input, { target: { value: term } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
    await waitFor(() => expect(screen.getByText(/Consumption and resistance/))
      .toBeTruthy());
  }

  it("says the board could not be read rather than showing an empty one",
     async () => {
    serve(() => ({ ok: false, status: 503,
                   body: { detail: "The excerpt store is unavailable." } }));

    render(<Literature projectId="p1" />);
    await searchFor("resistance");

    await waitFor(() =>
      expect(screen.getByText(/excerpt store is unavailable/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeTruthy();
  });

  it("shows the board when it was read", async () => {
    // The other half: the section appearing has to mean the excerpts are
    // really there, which it only does if a failure looks different.
    serve(() => ({ ok: true, status: 200, body: { excerpts: [{
      id: "ex_1", source_id: "src_1", page: 4,
      citation: "Author (2024)", context: "a sentence taken from the paper",
      source_title: "Consumption and resistance",
    }] } }));

    render(<Literature projectId="p1" />);
    await searchFor("resistance");

    await waitFor(() => expect(screen.getByText(/Taken from papers/)).toBeTruthy());
    expect(screen.getByText(/Author \(2024\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /try again|retry/i })).toBeNull();
  });
});
