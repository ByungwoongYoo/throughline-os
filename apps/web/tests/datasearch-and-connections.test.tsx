/**
 * Two screens the rail renders that no test named: Find data, and the table
 * every connection list is drawn with.
 *
 * `ConnectionsTable` is the one that matters. `ConnectionList` — the rail's
 * Connections screen — is a six-line wrapper around it, and the discovery
 * screen draws the same table, so a defect here is wrong in two places at
 * once. It is also where a q-value is presented, which is the number this
 * product exists to keep honest.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsTable } from "@/components/views";
import { DataSearch } from "@/components/datasearch";
import { api } from "@/lib/api";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

function connection(over: Record<string, unknown> = {}) {
  return {
    id: "con_1", left_variable: "consumption", right_variable: "resistance",
    method: "pearson_correlation", lifecycle_status: "exploratory",
    estimate: 0.62, p_value: 0.001, q_value: 0.012, effect_size: 0.62,
    effect_size_name: "r", sample_size: 120, evidence_quality: "moderate",
    rank_score: 0.8, analysis_run_id: "arun_1", dataset_version_id: "dsv_1",
    discovery_run_id: "drun_1", rank_components: {}, ...over,
  };
}

const table = (connections: unknown, over: Record<string, unknown> = {}) =>
  render(
    <ConnectionsTable
      connections={connections as never} error={null} loading={false}
      reload={() => {}} onSelect={() => {}} {...over}
    />,
  );

describe("the connections table", () => {
  it("says which dataset each answer came from", () => {
    /*
     * A project may hold several datasets, and then two connections for one
     * pair are two studies rather than a contradiction — but only if the
     * table says which data each came from.
     *
     * Constructed here, not observed: I first reported this from two
     * opposite-signed rows in the worked example, which turned out to be in
     * two different projects, read through a query with no project filter.
     */
    table([
      connection({ id: "con_a", dataset_name: "national-surveillance.csv",
                   estimate: -0.209 }),
      connection({ id: "con_b", dataset_name: "amr_surveillance.csv",
                   estimate: 0.107 }),
    ]);
    expect(screen.getByText("national-surveillance.csv")).toBeTruthy();
    expect(screen.getByText("amr_surveillance.csv")).toBeTruthy();
  });

  it("says nothing rather than breaking when there is no dataset", () => {
    /** A connection made outside a discovery run has none. */
    table([connection({ dataset_name: null })]);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("shows the pair and its corrected q-value", () => {
    table([connection()]);
    expect(screen.getByText(/consumption/)).toBeTruthy();
    expect(screen.getByText(/resistance/)).toBeTruthy();
    // The corrected value, not the raw p — the whole point of the sweep.
    expect(screen.getByText(/0\.012/)).toBeTruthy();
  });

  it("says the lifecycle state rather than implying one", () => {
    table([connection({ lifecycle_status: "candidate" })]);
    expect(screen.getByText(/candidate/i)).toBeTruthy();
  });

  it("tells an empty project what would fill it", () => {
    table([]);
    expect(screen.getByText(/No connections yet/i)).toBeTruthy();
    expect(screen.getByText(/Run discovery/i)).toBeTruthy();
  });

  it("shows a failure with a way to retry, not a blank screen", () => {
    table(null, { error: new Error("the server said no") });
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeTruthy();
  });

  it("says it is reading rather than showing nothing", () => {
    table(null, { loading: true });
    expect(screen.getByText(/Reading connections/i)).toBeTruthy();
  });

  it("does not print a missing q-value as a number", () => {
    /** A candidate that was never corrected has no q. Rendering `null` as
     *  "0" would claim a significance nobody computed. */
    table([connection({ q_value: null, p_value: null })]);
    expect(screen.queryByText(/^0$/)).toBeNull();
  });
});

describe("finding data to work with", () => {
  const RESULTS = {
    query: "antimicrobial resistance",
    results: [{
      title: "Global AMR surveillance", repository: "Zenodo",
      authors: ["WHO"], year: 2024, doi: "10.5281/zenodo.1",
      description: "Panel of national resistance rates.",
      url: "https://example.invalid/1", licence: "CC-BY-4.0",
      files: [{ name: "amr.csv", format: "csv", bytes: 2048 }],
      files_listed: true, variables: ["resistance_pct"], rows: 120,
      embargoed: false, curated: true, related_paper_doi: null,
      usability: { usable: true, blockers: [], unknown: [],
                   readable_files: 1 },
    }],
    sources: { Zenodo: { ok: true, count: 1, note: null } },
    found: 1, usable: 1, unchecked: 0, note: "",
  };

  it("lists the repositories it can reach", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      repositories: [{ name: "Zenodo", curated: true, note: "open" }],
    } as never);
    render(<DataSearch />);
    expect(await screen.findByText(/Zenodo/)).toBeTruthy();
  });

  it("still renders when no repository can be reached", async () => {
    /** The offline case: this screen must not be a blank page because a
     *  network call failed at mount. */
    vi.spyOn(api, "get").mockRejectedValue(new Error("offline"));
    render(<DataSearch />);
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());
  });

  it("shows what a search found, and what it is good for", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ repositories: [] } as never);
    const post = vi.spyOn(api, "post").mockResolvedValue(RESULTS as never);
    render(<DataSearch />);

    // `fireEvent.change`, not a direct assignment: this is a controlled
    // input, and React never sees a value set on the node behind its back.
    fireEvent.change(screen.getByRole("textbox"),
                     { target: { value: "antimicrobial resistance" } });
    fireEvent.click(screen.getByRole("button", { name: /search|find/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(await screen.findByText(/Global AMR surveillance/)).toBeTruthy();
  });
});
