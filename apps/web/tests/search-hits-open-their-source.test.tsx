/**
 * A search hit leads to the passage's source (D203).
 *
 * Search sources showed rank, locator, section and two scores for every hit
 * and offered nothing to click: the one screen whose job is to find a passage
 * could not take the researcher to it. A search that cannot be followed back
 * to its document is a citation nobody can check, which in this product is the
 * failure everything else exists to prevent.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Search } from "@/components/views";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const RESULT = {
  query: "how many took part",
  strategy: "hybrid",
  retrieval_event_id: "ret_1",
  lexical_candidates: 4,
  semantic_candidates: 3,
  results: [{
    passage_id: "psg_1", source_id: "src_9",
    content: "In total 120 countries took part in the surveillance programme.",
    locator: "p. 3", page: 3, section: "Methods",
    lexical_score: 0.8, semantic_score: 0.7, fused_score: 0.75, rank: 1,
  }],
};

function stubSearch() {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true, status: 200, text: async () => JSON.stringify(RESULT),
  } as Response);
}

async function search() {
  fireEvent.change(screen.getByLabelText("Search the sources in this project"),
                   { target: { value: "how many took part" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText(/120 countries took part/);
}

describe("a search hit", () => {
  it("opens the source the passage came from", async () => {
    stubSearch();
    const open = vi.fn();
    render(<Search projectId="prj_1" onOpenSource={open} />);
    await search();

    fireEvent.click(screen.getByRole("button", { name: /open the source/i }));

    await waitFor(() => expect(open).toHaveBeenCalledWith("src_9"));
  });

  it("offers no dead control where there is nowhere to go", async () => {
    /** §123: a button that does nothing is worse than none. */
    stubSearch();
    render(<Search projectId="prj_1" />);
    await search();
    expect(screen.queryByRole("button", { name: /open the source/i })).toBeNull();
  });
});
