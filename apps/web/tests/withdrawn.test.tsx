/**
 * The withdrawn-sources panel.
 *
 * This is the last step of something the system has known for a while and could
 * not say: a source marked withdrawn had no reader, then no route, then no
 * screen. A retracted paper could sit in a corpus, be quoted verbatim, be cited
 * in an exported report, and nothing anywhere would tell anybody.
 *
 * What is tested is not that it renders. It is the three ways this screen could
 * be true and still useless:
 *
 *   naming a count instead of the draft, so nobody knows what to open
 *   reading as an alarm, so it gets dismissed and then ignored when it matters
 *   implying an all-clear the data cannot support
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { WithdrawnSources } from "@/components/withdrawn";
import { api } from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const CITED = {
  id: "src_1",
  title: "Antimicrobial resistance in nine countries",
  withdrawn_at: "2026-08-01T00:00:00Z",
  withdrawn_reason: "The repository no longer publishes this record.",
  oai_identifier: "oai:repo:1",
  citations: 3,
  extractions: 1,
  artifacts: [{ id: "art_1", title: "Draft for Lancet ID" }],
  artifacts_count: 1,
};

const UNCITED = {
  ...CITED,
  id: "src_2",
  title: "A paper nothing references",
  citations: 0,
  extractions: 0,
  artifacts: [],
  artifacts_count: 0,
};

function serve(body: unknown) {
  return vi.spyOn(api, "get").mockResolvedValue(body as never);
}

describe("what still rests on a withdrawn source", () => {
  it("names the draft rather than counting it", async () => {
    serve({ withdrawn: [CITED], note: "1 source has been withdrawn upstream." });
    render(<WithdrawnSources projectId="prj_1" />);

    // The count is what you skim; the title is what makes you open it.
    expect(await screen.findByText("Draft for Lancet ID")).toBeInTheDocument();
  });

  it("says plainly when nothing cites it, rather than staying silent", async () => {
    serve({ withdrawn: [UNCITED], note: "1 source has been withdrawn upstream." });
    render(<WithdrawnSources projectId="prj_1" />);

    expect(await screen.findByText(/Not cited in any written work yet/))
      .toBeInTheDocument();
  });

  it("carries the reason the repository gave, not one of its own", async () => {
    serve({ withdrawn: [CITED], note: "note" });
    render(<WithdrawnSources projectId="prj_1" />);

    expect(await screen.findByText(/no longer publishes this record/))
      .toBeInTheDocument();
  });

  it("shows citation and extraction counts as supporting detail", async () => {
    serve({ withdrawn: [CITED], note: "note" });
    render(<WithdrawnSources projectId="prj_1" />);

    expect(await screen.findByText(/3 citations/)).toBeInTheDocument();
    expect(screen.getByText(/1 extraction/)).toBeInTheDocument();
  });
});

describe("not crying wolf", () => {
  it("does not present a withdrawal as a retraction", async () => {
    /**
     * An embargo, a correction and a retraction arrive identically. A screen
     * that shouts retraction is dismissed the first time it is wrong, and after
     * that it is furniture — including the one time it matters.
     */
    serve({ withdrawn: [CITED], note: "1 source has been withdrawn upstream." });
    const { container } = render(<WithdrawnSources projectId="prj_1" />);

    await screen.findByText("Draft for Lancet ID");
    expect(container.textContent?.toLowerCase()).not.toContain("retracted");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers no button that decides for the researcher", async () => {
    /**
     * The right response depends on why the record was withdrawn, and this
     * software does not know why. A "remove source" button would be a confident
     * wrong move of exactly the kind the rest of the system refuses to make.
     */
    serve({ withdrawn: [CITED], note: "note" });
    render(<WithdrawnSources projectId="prj_1" />);

    await screen.findByText("Draft for Lancet ID");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("an empty result", () => {
  it("does not claim an all-clear the data cannot support", async () => {
    serve({
      withdrawn: [],
      note: "Nothing in this project has been withdrawn upstream. That is only "
          + "as current as the last harvest — a repository is not asked between runs.",
    });
    render(<WithdrawnSources projectId="prj_1" />);

    expect(await screen.findByText(/as current as the last harvest/))
      .toBeInTheDocument();
  });
});

describe("while it is loading, and when it fails", () => {
  it("says what it is checking rather than spinning silently", async () => {
    vi.spyOn(api, "get").mockImplementation(() => new Promise(() => {}));
    render(<WithdrawnSources projectId="prj_1" />);

    expect(screen.getByText(/Checking what has been withdrawn/)).toBeInTheDocument();
  });

  it("reports a failure instead of rendering an empty all-clear", async () => {
    /**
     * The dangerous failure mode: the request errors, the list is empty, and the
     * screen reads as "nothing withdrawn" when the truth is "nobody checked".
     */
    vi.spyOn(api, "get").mockRejectedValue(new Error("Database unreachable"));
    render(<WithdrawnSources projectId="prj_1" />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/has been withdrawn/)).not.toBeInTheDocument();
  });
});
