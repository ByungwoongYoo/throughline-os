/**
 * The Sources screen leads with the sources.
 *
 * `WithdrawnSources` is deliberately not a nav item — its own comment argues
 * that "a withdrawal is a fact about these sources rather than a place to
 * visit", and that is right. The same comment promises that "when nothing is
 * withdrawn this renders a single quiet line", and that was not true: it
 * rendered a full empty-state panel, heading and all, above the list.
 *
 * Measured in the running product, the first words on the Sources screen of a
 * project with three sources were "Nothing here has been withdrawn" — an
 * empty edge case, announced before the thing the screen is for.
 *
 * The caveat itself stays. `report.note` says the answer is only as current as
 * the last harvest, because repositories are not asked between runs, and
 * dropping that to tidy the layout would trade an honest sentence for a
 * cleaner one.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WithdrawnSources } from "@/components/withdrawn";
import { api } from "@/lib/api";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

const NOTE = "That is only as current as the last harvest — a repository is "
  + "not asked between runs.";

function serve(withdrawn: unknown[]) {
  vi.spyOn(api, "get").mockResolvedValue({ withdrawn, note: NOTE } as never);
  render(<WithdrawnSources projectId="prj_1" />);
}

describe("when nothing has been withdrawn", () => {
  it("is one quiet line, not an empty-state panel", async () => {
    serve([]);
    await waitFor(() =>
      expect(screen.getByText(/only as current as the last harvest/)).toBeTruthy());

    // `Empty` renders `div.empty` with a bold title paragraph, and that panel
    // is what put an absent edge case at the top of the Sources screen.
    expect(document.querySelector(".empty")).toBeNull();
    expect(document.querySelectorAll("p")).toHaveLength(1);
  });

  it("does not announce itself with a title", async () => {
    serve([]);
    await waitFor(() =>
      expect(screen.getByText(/only as current as the last harvest/)).toBeTruthy());
    // The measured first words of the Sources screen, which should now be
    // the sources themselves.
    expect(screen.queryByText("Nothing here has been withdrawn")).toBeNull();
  });

  it("keeps the caveat about how current the answer is", async () => {
    serve([]);
    await waitFor(() =>
      expect(screen.getByText(/only as current as the last harvest/)).toBeTruthy());
  });

  it("does not claim all is well", async () => {
    /** "Nothing was withdrawn" is a fact about the last harvest, not a
     *  clearance — the component's own comment says so. */
    serve([]);
    await waitFor(() => expect(screen.getByText(/withdrawn/i)).toBeTruthy());
    const text = document.body.textContent || "";
    expect(text).not.toMatch(/all clear|nothing to worry/i);
  });
});

describe("when something has been withdrawn", () => {
  const RETRACTED = [{
    id: "src_1", title: "A retracted paper", withdrawn_at: "2026-01-01",
    withdrawn_reason: "retracted by the publisher", oai_identifier: "oai:1",
    citations: 2, extractions: 1, artifacts: [], artifacts_count: 0,
  }];

  it("says so loudly, with a heading", async () => {
    /** The case that matters keeps its prominence — this is not a change to
     *  how a real withdrawal is presented. */
    serve(RETRACTED);
    await waitFor(() =>
      expect(screen.getByText(/Withdrawn upstream/i)).toBeTruthy());
    expect(screen.getByText(/A retracted paper/)).toBeTruthy();
  });
});
