/**
 * A paper found by search can be read into the project, not only cited (D410).
 *
 * Add imports the citation; nothing ever fetched the open-access text, so a
 * paper that arrived by search had no passages and its claims could not be
 * located. The deliberate act now exists beside Add, for open-access papers
 * that name a PDF, and it says what happened in words.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Literature } from "@/components/literature";
import { ApiError, api } from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const PAPER = {
  title: "Consumption and resistance", authors: ["Chen"], year: 2024,
  doi: "10.1/found", arxiv_id: null, pmid: null, venue: "", abstract: "",
  url: "https://arxiv.org/abs/2401.00001", pdf_url: "https://arxiv.org/pdf/2401.00001",
  open_access: true, cited_by: 3, source: "arxiv", provenance: {}, disagreements: {},
};

async function found(paper: object, fullText: (url: string) => unknown) {
  vi.spyOn(api, "get").mockImplementation(async (url: string) =>
    (url.includes("excerpts") ? { excerpts: [] } : { sources: [] }) as never);
  const post = vi.spyOn(api, "post").mockImplementation(async (url: string) => {
    if (url === "/api/literature/search") {
      return { query: "resistance", results: [paper], sources: {}, found: 1,
               returned_by_sources: 1, note: "" } as never;
    }
    if (url.endsWith("/literature/import")) return { source_id: "src_1" } as never;
    return fullText(url) as never;
  });
  render(<Literature projectId="prj_1" />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "resistance" } });
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
  await screen.findByText(PAPER.title);
  return post;
}

describe("reading a found paper into the project", () => {
  it("imports it, then asks for its text, and says it is being read", async () => {
    const post = await found(PAPER, () => ({ note: "Consumption and resistance is being read." }));

    fireEvent.click(screen.getByRole("button", { name: /add and read the full text/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/projects/prj_1/sources/src_1/full-text", {}));
    expect(await screen.findByText(/is being read/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /being read/i })).toHaveProperty("disabled", true);
  });

  it("says why, in the server's words, when the text cannot be fetched", async () => {
    await found(PAPER, () => { throw new ApiError(400, "That address answered with a login page."); });

    fireEvent.click(screen.getByRole("button", { name: /add and read the full text/i }));

    expect(await screen.findByText(/Not read: .*login page/)).toBeTruthy();
  });

  it("is not offered for a paper with no open-access copy", async () => {
    await found({ ...PAPER, open_access: false, pdf_url: "" }, () => ({}));
    expect(screen.queryByRole("button", { name: /read the full text/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^add$/i })).toBeTruthy();
  });
});
