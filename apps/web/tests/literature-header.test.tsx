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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
