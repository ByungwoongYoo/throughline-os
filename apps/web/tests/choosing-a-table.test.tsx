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
import { api } from "@/lib/api";

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

  it("renders nothing at all for a source that is not a database", async () => {
    /**
     * It sits under every failed ingestion, and most failures have nothing to
     * do with databases. Showing an error there would explain a problem the
     * researcher does not have.
     */
    vi.spyOn(api, "get").mockRejectedValue(new Error("not a SQLite database"));

    const { container } = render(
      <DatabaseTables projectId="prj_1" sourceId="src_1" />);

    await waitFor(() => expect(container.textContent).not.toMatch(/Reading the database/));
    expect(container.textContent).toBe("");
  });
});
