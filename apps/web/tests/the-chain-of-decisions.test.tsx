/**
 * The subset tree, and the two numbers it must never collapse into one.
 *
 * Every figure in a gated analysis is about the last box in a chain, and each
 * box is a judgement somebody made. The tree is the only place a reader sees
 * all of them — so what it must get right is that a subset's share of its
 * parent and its share of everything are different facts, and that a count
 * computed on other bytes is never shown as though it were current.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CohortTree } from "@/components/cohorts";
import { api } from "@/lib/api";

const LISTING = {
  dataset_version_id: "dsv_1",
  counted_on_other_data: [],
  cohorts: [
    { id: "c1", name: "Live cells", parent_id: null, depth: 0,
      row_count: 800, parent_count: 1000, total_count: 1000, sentence: "" },
    { id: "c2", name: "CD3+ T cells", parent_id: "c1", depth: 1,
      row_count: 200, parent_count: 800, total_count: 1000, sentence: "" },
  ],
};


/**
 * A row of the tree, by name.
 *
 * Scoped to the list because the "inside" selector repeats every subset's
 * name as an option — a plain text query matches both, which is the tree and
 * the form agreeing rather than a bug.
 */
async function row(name: string) {
  const list = await screen.findByRole("list");
  return within(list).getByText(name).closest("li")!;
}

function serve(body: unknown) {
  return vi.spyOn(api, "get").mockResolvedValue(body as never);
}

describe("the chain of decisions", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows both shares, because they answer different questions", async () => {
    /**
     * 200 of 800 is 25% of its parent and 20% of everything. A reader given
     * one while assuming the other has been misled by an accurate number.
     */
    serve(LISTING);

    render(<CohortTree projectId="prj_1" datasetVersionId="dsv_1" />);

    const found = await row("CD3+ T cells");
    expect(within(found).getByText("25.00%")).toBeTruthy();
    expect(within(found).getByText("20.00%")).toBeTruthy();
  });

  it("labels which share is which", async () => {
    serve(LISTING);

    render(<CohortTree projectId="prj_1" datasetVersionId="dsv_1" />);

    const found = await row("CD3+ T cells");
    expect(within(found).getByText("of parent")).toBeTruthy();
    expect(within(found).getByText("of all rows")).toBeTruthy();
  });

  it("indents a child under its parent", async () => {
    // Indentation is the parent relationship. Drawn flat, two siblings' shares
    // invite comparison as though they had the same denominator.
    serve(LISTING);

    render(<CohortTree projectId="prj_1" datasetVersionId="dsv_1" />);

    const child = await row("CD3+ T cells");
    const parent = await row("Live cells");
    expect(child.getAttribute("style")).toContain("1.1rem");
    expect(parent.getAttribute("style")).toContain("0rem");
  });

  it("says when a count came from other bytes", async () => {
    /**
     * A dataset version is immutable, but a subset can outlive one. A count
     * shown against data it was not computed on is exactly what the recorded
     * hash exists to prevent.
     */
    serve({ ...LISTING, counted_on_other_data: ["c2"] });

    render(<CohortTree projectId="prj_1" datasetVersionId="dsv_1" />);

    const found = await row("CD3+ T cells");
    expect(within(found).getByText(/earlier version of this data/)).toBeTruthy();
    const clean = await row("Live cells");
    expect(within(clean).queryByText(/earlier version/)).toBeNull();
  });

  it("refuses to call a subset a result", async () => {
    serve(LISTING);

    render(<CohortTree projectId="prj_1" datasetVersionId="dsv_1" />);

    expect(await screen.findByText(/not a result/)).toBeTruthy();
    expect(screen.getByText(/nothing was fitted/i)).toBeTruthy();
  });

  it("says nothing has been drawn yet, rather than showing an empty table",
     async () => {
    serve({ ...LISTING, cohorts: [] });

    render(<CohortTree projectId="prj_1" datasetVersionId="dsv_1" />);

    expect(await screen.findByText(/No subsets yet/)).toBeTruthy();
  });

  it("shows a dash rather than dividing by zero", async () => {
    serve({
      ...LISTING,
      cohorts: [{ id: "c1", name: "Empty", parent_id: null, depth: 0,
                  row_count: 0, parent_count: 0, total_count: 0, sentence: "" }],
    });

    render(<CohortTree projectId="prj_1" datasetVersionId="dsv_1" />);

    const found = await row("Empty");
    expect(within(found).getAllByText("—").length).toBe(2);
  });

  it("treats a body without a list as none, rather than blanking the screen",
     async () => {
    /**
     * Found by another screen's tests, which answer every request with the
     * shape that screen expects. In the product the same thing arrives from a
     * response that changed underneath a running client, and a chart area
     * that goes blank is a worse answer than "no subsets yet".
     */
    serve([]);

    render(<CohortTree projectId="prj_1" datasetVersionId="dsv_1" />);

    expect(await screen.findByText(/No subsets yet/)).toBeTruthy();
  });

  it("records a subset by posting it, and never counts one itself", async () => {
    /**
     * The counts come back from the server. A number a client worked out for
     * itself is one nobody can trace to the rows it came from — and this
     * route had no caller at all until the route-reachability guard said so.
     */
    serve(LISTING);
    const post = vi.spyOn(api, "post").mockResolvedValue({ id: "c9" } as never);

    render(<CohortTree projectId="prj_1" datasetVersionId="dsv_1" />);
    await row("Live cells");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Seniors" } });
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "age" } });
    fireEvent.change(screen.getByLabelText("At least"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: /record subset/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/api/projects/prj_1/cohorts");
    expect(body.name).toBe("Seniors");
    expect(body.definition).toEqual([{ column: "age", min: 70, max: null }]);
    // No count is sent: the server computes it from the rows.
    expect(JSON.stringify(body)).not.toMatch(/row_count|count"/);
  });

  it("can nest a new subset inside an existing one", async () => {
    serve(LISTING);
    const post = vi.spyOn(api, "post").mockResolvedValue({ id: "c9" } as never);

    render(<CohortTree projectId="prj_1" datasetVersionId="dsv_1" />);
    await row("Live cells");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sub" } });
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "age" } });
    fireEvent.change(screen.getByLabelText("At most"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Inside"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: /record subset/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0][1] as Record<string, unknown>).parent_id).toBe("c1");
  });
});
