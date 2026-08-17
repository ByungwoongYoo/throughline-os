/**
 * Harvesting an OAI-PMH repository.
 *
 * The screen next to this one is a search box, so the first thing this
 * interface has to teach is that harvesting is not searching. OAI-PMH has no
 * query verb: it lists by date and set, and a search field over it would have
 * to download an entire repository to answer while still missing whatever it
 * skipped. There is therefore no query input, and the tests below check that
 * the reason is on screen rather than left for the researcher to infer from an
 * absence.
 *
 * The rest is about not letting the two facts that need a person get buried:
 * that a harvest stopped short of the whole repository, and that something
 * already held has been withdrawn upstream.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Harvest } from "@/components/harvest";
import { api } from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const IDENTITY = {
  name: "arXiv", base_url: "https://export.arxiv.org/oai2", protocol: "2.0",
  admin_email: "admin@arxiv.org", earliest: "2007-05-23",
  deleted_record_policy: "persistent",
};

function typeUrl(value = "https://export.arxiv.org/oai2") {
  fireEvent.change(screen.getByLabelText("Repository base URL"),
                   { target: { value } });
}

describe("teaching what this is", () => {
  it("says the protocol cannot be searched", () => {
    render(<Harvest projectId="prj_1" />);
    expect(screen.getByText(/cannot be searched by keyword/)).toBeInTheDocument();
  });

  it("offers no query field, because there is no query verb", () => {
    render(<Harvest projectId="prj_1" />);
    expect(screen.queryByLabelText(/query/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });
});

describe("identify before harvest", () => {
  it("names the repository before anything is pulled from it", async () => {
    /**
     * One cheap request that answers "is this an OAI-PMH endpoint, and whose?".
     * Finding out a URL was wrong after three pages is worse than before one.
     */
    vi.spyOn(api, "get").mockResolvedValue(IDENTITY as never);
    render(<Harvest projectId="prj_1" />);
    typeUrl();
    fireEvent.click(screen.getByRole("button", { name: "Identify" }));

    expect(await screen.findByText("arXiv")).toBeInTheDocument();
    expect(screen.getByText(/records from 2007-05-23/)).toBeInTheDocument();
  });

  it("reports a bad address as an answer about the address", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("not an http(s) address"));
    render(<Harvest projectId="prj_1" />);
    typeUrl("not-a-url");
    fireEvent.click(screen.getByRole("button", { name: "Identify" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("cannot be run before an address is typed", () => {
    render(<Harvest projectId="prj_1" />);
    expect(screen.getByRole("button", { name: "Identify" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Harvest" })).toBeDisabled();
  });
});

describe("what a harvest reports", () => {
  function harvested(extra: Record<string, unknown> = {}) {
    vi.spyOn(api, "post").mockResolvedValue({
      added: 12, already_held: 3, withdrawn: [], pages: 2, truncated: false,
      note: "12 new sources stored.", repository: "https://export.arxiv.org/oai2",
      ...extra,
    } as never);
  }

  it("says what was stored", async () => {
    harvested();
    render(<Harvest projectId="prj_1" />);
    typeUrl();
    fireEvent.click(screen.getByRole("button", { name: "Harvest" }));

    expect(await screen.findByText(/12 new sources stored/)).toBeInTheDocument();
  });

  it("admits when it stopped short of the whole repository", async () => {
    /** Truncation passed off as completeness is a corpus with a hole in it. */
    harvested({ truncated: true });
    render(<Harvest projectId="prj_1" />);
    typeUrl();
    fireEvent.click(screen.getByRole("button", { name: "Harvest" }));

    expect(await screen.findByText(/there is more/)).toBeInTheDocument();
  });

  it("surfaces a withdrawal rather than burying it in a count", async () => {
    /**
     * A harvest reporting "12 stored" while quietly marking a held source
     * withdrawn hides the only part that needed a person.
     */
    harvested({ withdrawn: [{ source_id: "src_1", title: "Retracted cohort" }] });
    render(<Harvest projectId="prj_1" />);
    typeUrl();
    fireEvent.click(screen.getByRole("button", { name: "Harvest" }));

    expect(await screen.findByText(/has been withdrawn\s+upstream/))
      .toBeInTheDocument();
    expect(screen.getByText(/Sources screen lists what still rests on them/))
      .toBeInTheDocument();
  });

  it("keeps the ceiling visible and editable rather than hidden", async () => {
    /** An unbounded harvest pulls a national repository onto a laptop. */
    render(<Harvest projectId="prj_1" />);
    const limit = screen.getByLabelText("Maximum records") as HTMLInputElement;
    expect(limit.value).toBe("200");

    fireEvent.change(limit, { target: { value: "500" } });
    expect(limit.value).toBe("500");
  });
});
