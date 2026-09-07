/**
 * The screen that keeps a refused database from being a dead end.
 *
 * Ingestion will not guess which table of several is the dataset, because the
 * wrong guess produces something that profiles perfectly and is not what the
 * researcher meant. The refusal is only honest if choosing is possible, which
 * is what this component is for.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseTables } from "@/components/databasetables";
import { SourceDetail } from "@/components/views";
import { ApiError, api } from "@/lib/api";

const LISTING = {
  filename: "study.sqlite",
  tables: [
    { name: "trial", kind: "table", rows: 300, columns: ["id", "dose"] },
    { name: "high_dose", kind: "view", rows: 40, columns: ["id", "dose"] },
  ],
  note: "Importing a table copies its rows into this project as a dataset of its own.",
};

describe("choosing a table", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists every table with its size", async () => {
    vi.spyOn(api, "get").mockResolvedValue(LISTING as never);

    render(<DatabaseTables projectId="prj_1" sourceId="src_1" />);

    expect(await screen.findByText("trial")).toBeTruthy();
    expect(screen.getByText("300")).toBeTruthy();
    expect(screen.getByText("high_dose")).toBeTruthy();
  });

  it("says which one is a view", async () => {
    vi.spyOn(api, "get").mockResolvedValue(LISTING as never);

    render(<DatabaseTables projectId="prj_1" sourceId="src_1" />);

    expect(await screen.findByText(/view/)).toBeTruthy();
  });

  it("imports the table that was asked for", async () => {
    vi.spyOn(api, "get").mockResolvedValue(LISTING as never);
    const post = vi.spyOn(api, "post").mockResolvedValue(
      { source_id: "src_2", rows: 300, note: "300 rows are being profiled." } as never);

    render(<DatabaseTables projectId="prj_1" sourceId="src_1" />);
    const buttons = await screen.findAllByRole("button", { name: /import/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0])
      .toBe("/api/projects/prj_1/sources/src_1/tables/trial");
  });

  it("escapes a table name that would otherwise change the URL", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      ...LISTING,
      tables: [{ name: "a/b?c", kind: "table", rows: 1, columns: ["x"] }],
    } as never);
    const post = vi.spyOn(api, "post").mockResolvedValue(
      { source_id: "src_2", rows: 1, note: "done" } as never);

    render(<DatabaseTables projectId="prj_1" sourceId="src_1" />);
    fireEvent.click(await screen.findByRole("button", { name: /import/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toContain("a%2Fb%3Fc");
  });

  it("says what happened, in the server's own words", async () => {
    vi.spyOn(api, "get").mockResolvedValue(LISTING as never);
    vi.spyOn(api, "post").mockResolvedValue(
      { source_id: "src_2", rows: 300, note: "300 rows are being profiled." } as never);

    render(<DatabaseTables projectId="prj_1" sourceId="src_1" />);
    fireEvent.click((await screen.findAllByRole("button", { name: /import/i }))[0]);

    expect(await screen.findByText(/300 rows are being profiled/)).toBeTruthy();
  });

  it("tells the screen a new source now exists", async () => {
    /*
     * Importing a table creates a *new* source, so the list of sources the
     * researcher is looking at is stale the moment it succeeds — the dataset
     * they just made is not in it. `onImported` had been offered by this
     * component and passed by nobody since it was written.
     */
    vi.spyOn(api, "get").mockResolvedValue(LISTING as never);
    vi.spyOn(api, "post").mockResolvedValue({
      source_id: "src_new", rows: 1, columns: 1, note: "Profiling.",
    } as never);
    const onImported = vi.fn();

    render(<DatabaseTables projectId="prj_1" sourceId="src_1"
                           onImported={onImported} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /import/i }))[0]);

    await waitFor(() => expect(onImported).toHaveBeenCalledWith("src_new"));
  });

  it("renders nothing at all for a source that is not a database", async () => {
    /**
     * It sits under every failed ingestion, and most failures have nothing to
     * do with databases. Showing an error there would explain a problem the
     * researcher does not have.
     */
    /*
     * 400 is what the endpoint raises for a file it cannot read as a database
     * — `UnsupportedDataset` becomes `HTTPException(400, ...)`. The fixture
     * used to be a bare `Error`, which no path in the product produces:
     * `api.get` throws `ApiError` for everything it hears back. That mattered
     * once silence stopped being the answer to every failure.
     */
    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError(400, "not a SQLite database"));

    const { container } = render(
      <DatabaseTables projectId="prj_1" sourceId="src_1" />);

    await waitFor(() => expect(container.textContent).not.toMatch(/Reading the database/));
    expect(container.textContent).toBe("");
  });

  it("says so when the tables could not be read at all", async () => {
    /**
     * The other half. Silence here means "this source is not a database",
     * and it only means that if the cases where nobody found out look
     * different. A 5xx or a dropped connection is one of those: the tables
     * may well be there.
     */
    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError(503, "The storage volume is unavailable."));

    render(<DatabaseTables projectId="prj_1" sourceId="src_1" />);

    await waitFor(() =>
      expect(screen.getByText(/storage volume is unavailable/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeTruthy();
  });

  it("stays quiet for a source that is simply not in this project", async () => {
    // 404 is the other expected refusal, and it is not this panel's business.
    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError(404, "No such source in this project."));

    const { container } = render(
      <DatabaseTables projectId="prj_1" sourceId="src_1" />);

    await waitFor(() => expect(container.textContent).not.toMatch(/Reading the database/));
    expect(container.textContent).toBe("");
  });
});

describe("the screen a table is imported from", () => {
  /*
   * Importing a table creates a *new* source, so the list of sources beside
   * this screen is stale the moment it succeeds — the dataset the researcher
   * just made is not in it, and nothing says so.
   *
   * `DatabaseTables` had offered `onImported` since it was written and the one
   * place that renders it passed nothing, so the callback had never fired in
   * the product. Rendered through `SourceDetail` rather than through
   * `DatabaseTables` on purpose: a test that passes the prop itself proves the
   * component calls what it is given, which was never in doubt, and leaves the
   * missing wire exactly as it was.
   */
  const SOURCE = {
    id: "src_1", title: "study.sqlite", trust_level: "unknown",
    ingestion_status: "failed", ingestion_detail: "Not one table.",
    dataset: null, paper: null, metadata: null, passage_count: 0,
    withdrawn_at: null, withdrawn_reason: null,
  };

  it("hears that a new source now exists", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path: string) => {
      if (path.includes("/tables")) return LISTING as never;
      return SOURCE as never;
    });
    vi.spyOn(api, "post").mockResolvedValue({
      source_id: "src_new", rows: 300, note: "300 rows are being profiled.",
    } as never);
    const onImported = vi.fn();

    render(<SourceDetail projectId="prj_1" sourceId="src_1"
                         onDiscover={() => {}} onImported={onImported} />);

    fireEvent.click((await screen.findAllByRole("button", { name: /import/i }))[0]);

    await waitFor(() => expect(onImported).toHaveBeenCalledWith("src_new"));
  });
});
