/**
 * The source detail's four dead ends (D205, plan §4.8).
 *
 * Every one of these is the same defect wearing a different hat: a capability
 * that exists, is reachable, and hands the researcher nowhere afterwards.
 *
 * `CohortTree onSelect` and `DatabaseTables onImported` were both *declared*
 * and never supplied, so pressing a subset did nothing and importing a table
 * left the researcher standing on a failed source with no route to the dataset
 * they had just made — the third instance of the pattern
 * `board/CardDetail.tsx:6-9` names by hand. Importing a table was also
 * invisible from the list, so the only way to find it was to open failed
 * sources one at a time. And nothing anywhere linked forward from a profiled
 * schema to Variables, which is the screen that stops a chart being titled
 * `resistance_pct`.
 *
 * What is pinned here is the part that will decay first: a control exists only
 * where pressing it goes somewhere (§123), and where it cannot go anywhere the
 * screen says so in words rather than removing the control or lighting a row
 * in a colour and nothing else (§118).
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceDetail, Sources } from "@/components/views";
import type { Source } from "@/lib/api";

type Answer = unknown;

/** An API that answers by path, as the connection-detail tests do. */
function serve(routes: Record<string, Answer>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace(/^https?:\/\/[^/]+/, "");
      const path = url.split("?")[0];
      calls.push(`${init?.method ?? "GET"} ${path}`);
      const answer = routes[path];
      if (answer === undefined) {
        return { ok: false, status: 404,
                 text: async () => JSON.stringify({ detail: `not stubbed: ${path}` }) } as Response;
      }
      return { ok: true, status: 200,
               text: async () => JSON.stringify(answer) } as Response;
    });
  return calls;
}

const DATASET_SOURCE = {
  id: "src_1", title: "national-surveillance.csv", source_type: "dataset",
  ingestion_status: "ready", ingestion_detail: "", trust_level: "trusted",
  created_at: "2026-01-01", paper: null,
  dataset: {
    dataset_id: "ds_1", dataset_version_id: "dsv_1", version: 1,
    row_count: 1000, column_count: 2, quality_report: {},
  },
};

const COLUMNS = [
  { name: "resistance_pct", physical_type: "float", semantic_type: "ratio",
    unit: "%", missing_count: 0, unique_count: 40, sensitivity: "public",
    ordinal: 0, statistics: {} },
  { name: "consumption_ddd", physical_type: "float", semantic_type: "ratio",
    unit: "DDD", missing_count: 0, unique_count: 55, sensitivity: "public",
    ordinal: 1, statistics: {} },
];

const COHORTS = {
  dataset_version_id: "dsv_1",
  counted_on_other_data: [],
  cohorts: [{
    id: "coh_1", name: "High consumption", parent_id: null, depth: 0,
    row_count: 400, parent_count: 1000, total_count: 1000, sentence: "",
    definition: [{ column: "consumption_ddd", min: 20, max: null }],
  }],
};

function routes(over: Record<string, Answer> = {}) {
  return {
    "/api/projects/prj_1/sources/src_1": DATASET_SOURCE,
    "/api/dataset-versions/dsv_1/columns": COLUMNS,
    "/api/dataset-versions/dsv_1/cohorts": COHORTS,
    ...over,
  };
}

async function openDetail(props: Record<string, unknown> = {},
                          over: Record<string, Answer> = {}) {
  const calls = serve(routes(over));
  const view = render(
    <SourceDetail projectId="prj_1" sourceId="src_1" onDiscover={() => {}}
                  {...props} />);
  await screen.findByRole("heading", { name: /national-surveillance/ });
  return { ...view, calls };
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("pressing a subset shows the column it was drawn on", () => {
  it("lights the row and says which column, not only which colour", async () => {
    /*
     * The jump has to be legible without seeing the highlight: a row lit only
     * by a background tells a screen-reader user and a low-vision reader
     * nothing at all (§118), so the sentence under the table names the column
     * and the subset that pointed at it.
     */
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "High consumption" }));

    const said = await screen.findByText(/the column .High consumption. is drawn on/);
    expect(said.textContent).toContain("consumption_ddd");
  });

  it("puts the keyboard where the scroll went", async () => {
    /*
     * §30 — a jump that only scrolls strands a keyboard user where they were,
     * and the next Tab carries on from the top of the document past everything
     * the scroll skipped.
     */
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "High consumption" }));

    await waitFor(() => {
      const row = document.activeElement as HTMLElement;
      expect(row.tagName).toBe("TR");
      expect(row.textContent).toContain("consumption_ddd");
    });
  });

  it("says so when the subset was drawn on a column this profile does not have", async () => {
    /*
     * A subset can outlive the version it was counted on. Silence here would
     * read as a broken control, which is the §123 breach this whole file is
     * about, arriving by a different door.
     */
    await openDetail({}, {
      "/api/dataset-versions/dsv_1/cohorts": {
        ...COHORTS,
        cohorts: [{ ...COHORTS.cohorts[0],
                    definition: [{ column: "gone_column", min: 1, max: null }] }],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "High consumption" }));

    expect(await screen.findByText(/which this profile does not have/)).toBeTruthy();
  });

  it("renders a subset as text where there is no schema to jump into", async () => {
    /** §123 — no schema below means nowhere to go, so it is not a control. */
    await openDetail({}, { "/api/dataset-versions/dsv_1/columns": [] });
    // Scoped to the tree: the "Inside" select repeats every subset's name as
    // an option, which is the form and the tree agreeing rather than a bug.
    const tree = await screen.findByRole("list");
    expect(within(tree).getByText("High consumption")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "High consumption" })).toBeNull();
  });
});

describe("importing a table leads to the dataset it made", () => {
  const FAILED = {
    ...DATASET_SOURCE, ingestion_status: "failed", dataset: null,
    ingestion_detail:
      "This database holds 2 tables and a dataset is one table, so which one "
      + "to read is not something to guess: rates (40 rows), sites (12 rows). "
      + "Choose one to import, or export the table you want as CSV.",
  };

  it("opens the new source with the id the import returned", async () => {
    /*
     * `onImported` was declared on `DatabaseTables` and passed by nobody, so
     * the one route out of a failed database went nowhere and the researcher
     * was left on the failure.
     */
    const opened = vi.fn();
    serve(routes({
      "/api/projects/prj_1/sources/src_1": FAILED,
      "/api/projects/prj_1/sources/src_1/tables": {
        filename: "amr.sqlite", note: "Importing a table copies its rows.",
        tables: [{ name: "rates", kind: "table", rows: 40, columns: ["a", "b"] }],
      },
      "/api/projects/prj_1/sources/src_1/tables/rates":
        { source_id: "src_new", rows: 40, note: "Imported 40 rows." },
    }));
    render(<SourceDetail projectId="prj_1" sourceId="src_1"
                         onDiscover={() => {}} onOpenSource={opened} />);

    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith("src_new"));
  });
});

describe("the sources list says which failure is a choice", () => {
  const failed: Source = {
    id: "src_2", title: "amr.sqlite", source_type: "dataset",
    ingestion_status: "failed", trust_level: "trusted", created_at: "2026-01-01",
    ingestion_detail:
      "This database holds 2 tables and a dataset is one table, so which one "
      + "to read is not something to guess: rates (40 rows), sites (12 rows).",
    paper: null, dataset: null,
  };

  const list = (sources: Source[]) => render(
    <Sources
      sources={{ data: sources, error: null, loading: false, reload: () => {} }}
      onSelect={() => {}} upload={() => {}} uploading={false} uploadError={null} />);

  it("marks a failed database whose tables can still be imported", () => {
    /*
     * Wiring `onImported` alone leaves the capability undiscoverable: importing
     * a table is reachable only from a failed source's detail, and the list gave
     * no reason to open that one rather than any other failure.
     */
    list([failed]);
    const row = screen.getByText("amr.sqlite").closest("tr")!;
    expect(within(row).getByText("importable")).toBeTruthy();
  });

  it("does not mark an ordinary failure as a choice somebody can make", () => {
    /*
     * The word is read out of the server's own refusal. A failure that says
     * something else gets no word at all rather than the wrong one.
     */
    list([{ ...failed, ingestion_detail: "No readable text was found in this document." }]);
    expect(screen.queryByText("importable")).toBeNull();
  });
});

describe("the schema bridges to the screen that names its columns", () => {
  it("counts the columns with no approved label and offers Variables", async () => {
    /*
     * Variables is the reason a chart stops being titled `resistance_pct`, and
     * nothing linked forward to it from the data it describes. The count is of
     * rows on this screen against the labels the server sent — not a statistic
     * about the data, which is what "nothing is computed in the browser" is
     * about.
     */
    const go = vi.fn();
    await openDetail({ onGo: go, labels: { resistance_pct: "Resistance (%)" } });

    expect(await screen.findByText(/1 of 2 columns have no approved label/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Review them/ }));
    expect(go).toHaveBeenCalledWith("variables");
  });

  it("states the good case rather than falling silent", async () => {
    /** An empty downstream slot is an offer, not an absence (principle 7). */
    await openDetail({
      onGo: () => {},
      labels: { resistance_pct: "Resistance (%)", consumption_ddd: "Consumption" },
    });
    expect(await screen.findByText(/Every one of these 2 columns has an approved label/))
      .toBeTruthy();
  });

  it("keeps the sentence and drops the control where there is nowhere to go", async () => {
    /** §123 again: the count still stands, the button does not appear. */
    await openDetail({ labels: {} });
    expect(await screen.findByText(/2 of 2 columns have no approved label/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Review them/ })).toBeNull();
  });

  it("claims nothing about labels it was never given", async () => {
    /*
     * A component with no labels map cannot know how many are approved, and
     * "0 of 2" would be a false statement rather than a missing one.
     */
    await openDetail();
    await screen.findByText("resistance_pct");
    expect(screen.queryByText(/approved label/)).toBeNull();
  });
});
