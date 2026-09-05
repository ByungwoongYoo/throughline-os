/**
 * Three readouts that were built and never shown, and one that was shown in
 * the wrong order (plan §4.5.4-5, §4.6.1, §4.10.1, §4.10.5).
 *
 * **The correction is a caption, not a footnote.** Three separate files state
 * that a q-value means nothing without the number of tests it was corrected
 * across, and this table stated it *after* the rows — so a first-timer reading
 * top to bottom met 7.44e-39 before the concept. The gloss now carries the
 * meaning before the method is named (D207).
 *
 * **A capped list says it is capped** (D201). Both lists that draw this table
 * are capped, neither said so, and `ChartTable` one directory away discloses
 * truncation in its *closed* summary.
 *
 * **A validation report opens.** `GET /api/validations/{report_id}` had no
 * caller in `apps/web`, and the figures each check was decided on — the
 * `evidence` blob `validation.py` records for every one of them — were
 * rendered nowhere.
 *
 * **`graph/path` has a caller.** Trace answers how a number was made; this
 * answers how two objects are related at all, and where the projection is
 * absent it states the reduced feature set in the server's own words rather
 * than failing (ADR 0002).
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionDetail, ConnectionsTable, EvidenceGraphView } from "@/components/views";
import type { Connection } from "@/lib/api";

const CONNECTION: Connection = {
  id: "conn_1", left_variable: "consumption", right_variable: "resistance",
  method: "pearson_correlation", lifecycle_status: "exploratory",
  estimate: 0.81, p_value: 0.001, q_value: 0.01, effect_size: 0.81,
  effect_size_name: "r", sample_size: 120, evidence_quality: "moderate",
  rank_score: 0.7, analysis_run_id: "arun_1", analysis_object_id: "obj_1",
  dataset_version_id: "dsv_1",
};

const OTHER: Connection = {
  ...CONNECTION, id: "conn_2", left_variable: "rainfall",
  right_variable: "yield", analysis_object_id: "obj_2",
};

const REPORT = {
  id: "vrep_1", status: "complete", passed: true, summary: "Held under every check.",
  created_at: "2026-09-01T09:00:00Z", checks: {},
  check_details: [{
    name: "outlier_sensitivity", outcome: "passed",
    detail: "The estimate held with the outliers dropped.",
    analysis_run_id: "arun_1",
  }],
};

const REPORT_DETAIL = {
  ...REPORT,
  finished_at: "2026-09-01T09:04:00Z",
  check_details: [{
    ...REPORT.check_details[0],
    evidence: { dropped_rows: 4, rows_used: 116, fraction: 0.033 },
  }],
};

type Answer = unknown | ((url: string) => unknown);

function serve(routes: Record<string, Answer>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL) => {
      const url = String(input).replace(/^https?:\/\/[^/]+/, "");
      const path = url.split("?")[0];
      calls.push(url);
      const answer = routes[path];
      if (answer === undefined) {
        return { ok: false, status: 404,
                 text: async () => JSON.stringify({ detail: `not stubbed: ${path}` }) } as Response;
      }
      const value = typeof answer === "function"
        ? (answer as (u: string) => unknown)(url) : answer;
      if (value && typeof value === "object" && "__status" in (value as object)) {
        const failure = value as { __status: number; detail: string };
        return { ok: false, status: failure.__status,
                 text: async () => JSON.stringify({ detail: failure.detail }) } as Response;
      }
      return { ok: true, status: 200,
               text: async () => JSON.stringify(value) } as Response;
    });
  return calls;
}

async function openDetail(over: Record<string, Answer> = {}) {
  const calls = serve({
    "/api/projects/prj_1/connections": [CONNECTION, OTHER],
    "/api/projects/prj_1/variables": { labels: {} },
    "/api/connections/conn_1/validations": [REPORT],
    "/api/validations/vrep_1": REPORT_DETAIL,
    "/api/dataset-versions/dsv_1/columns": [],
    "/api/analyses/arun_1": { id: "arun_1", status: "completed",
                              method: "pearson_correlation",
                              assumption_checks: [], result: {} },
    "/api/analyses/arun_1/plain-summary": null,
    ...over,
  });
  const view = render(<ConnectionDetail connectionId="conn_1" projectId="prj_1" />);
  await screen.findByRole("heading", { name: /consumption and resistance/ });
  return { ...view, calls };
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the connections table says what it is showing", () => {
  const table = (over: Record<string, unknown> = {}) => render(
    <ConnectionsTable connections={[CONNECTION]} error={null} loading={false}
                      reload={() => {}} onSelect={() => {}} {...over} />);

  it("puts the correction above the rows it qualifies", () => {
    /*
     * Position is the whole point: the sentence read *after* the table, so a
     * reader met a corrected number before anything said what it was
     * corrected across.
     */
    const { container } = table();
    const caption = screen.getByText(/is corrected by/).closest("p")!;
    const rows = container.querySelector("table")!;
    expect(caption.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("says what the correction means before it says its name", () => {
    /*
     * D207 — the gloss is visible text beside the word, not a tooltip, and the
     * meaning arrives before the method so a first-timer can read the sentence
     * straight through.
     */
    const caption = (() => { table(); return screen.getByText(/is corrected by/).closest("p")!; })();
    const text = caption.textContent ?? "";
    expect(text.indexOf("corrected for how many tests ran"))
      .toBeLessThan(text.indexOf("Benjamini–Hochberg"));
    expect(caption.querySelectorAll(".term").length).toBe(2);
  });

  it("discloses that it is showing the first of many", () => {
    /** D201 — a capped list that says nothing is a list that lies. */
    table({ total: 214 });
    expect(screen.getByText("Showing the first 1 of 214.")).toBeTruthy();
  });

  it("says nothing about totals it was not told", () => {
    /*
     * A caller that does not know the total must not be made to invent one,
     * and "1 of 1" would be a claim this component cannot support.
     */
    table();
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it("keeps every value under its own heading", () => {
    /** D209's guard, restated here because the caption moved above it. */
    const { container } = table({ total: 214 });
    const headers = [...container.querySelectorAll("thead th")]
      .map((h) => h.textContent?.trim());
    const cells = within(container.querySelectorAll("tbody tr")[0] as HTMLElement)
      .getAllByRole("cell").map((c) => c.textContent?.trim() ?? "");
    expect(cells.length).toBe(headers.length);
    expect(cells[headers.indexOf("q-value")]).toMatch(/0\.01/);
  });
});

describe("a validation report opens on its own record", () => {
  it("names what is inside it while it is closed", async () => {
    /*
     * Principle 4 — a `<details>` is allowed only when the closed summary
     * states what is in it, which is `ChartTable`'s law.
     */
    const { container } = await openDetail();
    const summary = await screen.findByText(/what each check measured/i);
    expect(summary.closest("details")!.hasAttribute("open")).toBe(false);
    expect(container.textContent).toContain("Held under every check.");
  });

  it("shows the figures each check was decided on, which the list never did", async () => {
    /*
     * `validation.py` records `dropped_rows`, `rows_used` and `fraction` for
     * the outlier check and the list above renders none of them — a verdict
     * whose arithmetic is invisible is an unaccountable verdict (LAW 1).
     */
    const { calls } = await openDetail();
    fireEvent.click(await screen.findByText(/what each check measured/i));

    await waitFor(() => expect(calls.some((u) => u.includes("/api/validations/vrep_1")))
      .toBe(true));
    expect(await screen.findByText("dropped rows")).toBeTruthy();
    expect(screen.getByText("116")).toBeTruthy();
  });

  it("calls a run that has not finished still running, not blank", async () => {
    /** Null is a state. An em dash would read as "not recorded". */
    await openDetail({
      "/api/validations/vrep_1": { ...REPORT_DETAIL, finished_at: null },
    });
    fireEvent.click(await screen.findByText(/what each check measured/i));
    expect(await screen.findByText("still running")).toBeTruthy();
  });
});

describe("how two objects are related, beside how the number was made", () => {
  it("states the distinction from Trace before anything is pressed", async () => {
    /*
     * This is the product's fourth provenance surface, and the inventory
     * already records provenance duplicated across three unrelated mechanisms.
     * An unexplained fourth compounds exactly that.
     */
    await openDetail();
    expect(await screen.findByText(/answers how this number was made/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "How are these connected?" })).toBeTruthy();
  });

  it("is where the band's entry puts the keyboard, not a second control", async () => {
    /*
     * The band's contract: an entry either performs the act or moves to the
     * real control already on the page. A second "How are these connected?"
     * button would be a second thing to keep in step with the picker beside
     * this one, and the two would eventually disagree about which object was
     * chosen.
     */
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "How are these connected? ↓" }));

    const panel = document.getElementById("connection-graph-path")!;
    expect(panel.parentElement!.contains(document.activeElement)).toBe(true);
    expect(screen.getAllByRole("button", { name: "How are these connected?" }))
      .toHaveLength(1);
  });

  it("says what is missing rather than greying the control out", async () => {
    /*
     * House rule: a refusal is a full sentence in place, never a disabled
     * button. A greyed control states nothing and cannot take the keyboard,
     * which also strands the band's jump on the block.
     */
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "How are these connected?" }));
    expect(await screen.findByText(/Choose the other result first/)).toBeTruthy();
  });

  it("offers only the results this project actually has", async () => {
    /*
     * The picker is built from the connections this screen already fetched —
     * no request, and nothing offered that does not exist, which is the rule
     * that builds the alias dropdown from the project's own variables.
     */
    await openDetail();
    const picker = await screen.findByLabelText("Another result in this project");
    expect(within(picker).getByRole("option", { name: "rainfall and yield" })).toBeTruthy();
    expect(within(picker).queryByRole("option", { name: /consumption and resistance/ }))
      .toBeNull();
  });

  it("walks the path the server returned, naming each relation", async () => {
    await openDetail({
      "/api/projects/prj_1/graph/path": {
        connected: true,
        path: [{ id: "obj_1", title: "Pearson on AMR", object_type: "analysis" },
               { id: "dsv", title: "national-surveillance", object_type: "dataset" },
               { id: "obj_2", title: "Pearson on yield", object_type: "analysis" }],
        relations: ["derived_from", "derived_from"], length: 2,
        staleness: { current: true, note: "The projection is up to date." },
        store: "neo4j",
      },
    });
    fireEvent.change(await screen.findByLabelText("Another result in this project"),
                     { target: { value: "obj_2" } });
    fireEvent.click(screen.getByRole("button", { name: "How are these connected?" }));

    expect(await screen.findByText("Pearson on yield")).toBeTruthy();
    expect(screen.getByText(/2 steps apart/)).toBeTruthy();
    // A structural relation is not evidence, and the panel refuses that reading.
    expect(screen.getByText(/does not say either one is evidence for the other/))
      .toBeTruthy();
  });

  it("states the reduced feature set in the server's words, not a failure", async () => {
    /*
     * ADR 0002 — PostgreSQL holds the record and Neo4j answers four traversal
     * queries when it is there. Absence is a capability statement; rendering
     * it as "That did not work" would teach a researcher their project is
     * broken.
     */
    await openDetail({
      "/api/projects/prj_1/graph/path": {
        __status: 503,
        detail: "No graph projection is configured. Provenance, evidence graphs "
              + "and search work exactly as normal; path-finding, influence "
              + "ranking and clustering need Neo4j.",
      },
    });
    fireEvent.change(await screen.findByLabelText("Another result in this project"),
                     { target: { value: "obj_2" } });
    fireEvent.click(screen.getByRole("button", { name: "How are these connected?" }));

    expect(await screen.findByText(/path-finding, influence ranking and clustering need Neo4j/))
      .toBeTruthy();
    expect(screen.queryByText("That did not work")).toBeNull();
  });

  it("keeps the panel and says why where there is no object to start from", async () => {
    /** Principle 7 — a missing control teaches that the product cannot do it. */
    await openDetail({
      "/api/projects/prj_1/connections":
        [{ ...CONNECTION, analysis_object_id: null }, OTHER],
    });
    expect(await screen.findByText(/no object in the graph for this connection to start from/))
      .toBeTruthy();
  });
});

describe("the evidence graph hands its ids up once", () => {
  const GRAPH = {
    finding: { id: "fnd_1", title: "Use tracks resistance", statement: "",
               finding_type: "association", lifecycle_status: "candidate",
               causal_status: "not_assessed", confidence: null,
               created_at: "2026-09-01", limitations: [] },
    claims: [], challenges: [], note: null,
    balance: { supporting: 1, contradicting: 0 },
    analyses: [{ id: "arun_1", method: "pearson_correlation", result: null }],
    connections: [CONNECTION],
  };

  it("gives the caller the run and the connections without a second fetch", async () => {
    /*
     * The "Take it further" card needs `analyses[0].id` for a figure and a
     * connection for a report, and both are already on this wire. Two fetches
     * of one path are two copies that drift.
     */
    const calls = serve({ "/api/findings/fnd_1/evidence-graph": GRAPH });
    const loaded = vi.fn();
    render(<EvidenceGraphView findingId="fnd_1" onLoaded={loaded} />);

    await waitFor(() => expect(loaded).toHaveBeenCalledTimes(1));
    expect(loaded.mock.calls[0][0].analyses[0].id).toBe("arun_1");
    expect(loaded.mock.calls[0][0].connections[0].analysis_run_id).toBe("arun_1");
    expect(calls.filter((u) => u.includes("evidence-graph"))).toHaveLength(1);
  });

  it("renders exactly as before when nobody is listening", async () => {
    /** Optional, and its absence changes nothing on the screen. */
    serve({ "/api/findings/fnd_1/evidence-graph": GRAPH });
    render(<EvidenceGraphView findingId="fnd_1" />);
    expect(await screen.findByRole("heading", { name: "Use tracks resistance" }))
      .toBeTruthy();
  });
});
