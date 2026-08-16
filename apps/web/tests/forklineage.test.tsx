/**
 * The sensitivity branch, made visible.
 *
 * A sensitivity analysis is the relationship between runs, not any one of them.
 * The schema has recorded ancestry and a reason since it was laid down, and
 * nothing ever displayed either — so a researcher could fork a run, change one
 * filter, and afterwards have no way to see the two were related.
 *
 * These tests are about the two ways showing it could still be useless: burying
 * the reason each step was taken, and turning a branch into something the
 * screen appears to disapprove of.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ForkLineage } from "@/components/forklineage";
import * as useApiModule from "@/lib/useApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function serve(data: unknown, extra: Record<string, unknown> = {}) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue({
    data, error: null, loading: false, reload: vi.fn(), ...extra,
  } as never);
}

const BRANCH = {
  run_id: "arun_4",
  depth: 2,
  ancestors: [
    { id: "arun_1", status: "succeeded", cycle: false,
      reason_for_the_fork_below: "Excluding the 1998 outlier." },
    { id: "arun_2", status: "succeeded", cycle: false,
      reason_for_the_fork_below: "Adjusting for GDP per capita." },
  ],
  children: [
    { id: "arun_5", fork_reason: "Restricting to Europe", status: "succeeded" },
  ],
  note: "This is variant 3 in a chain that began with an earlier analysis.",
};

describe("the history, read as a history", () => {
  it("shows what changed at each step, not what each run was", () => {
    /** "Why is this different from the one before it" is the actual question. */
    serve(BRANCH);
    render(<ForkLineage projectId="prj_1" runId="arun_4" />);

    expect(screen.getByText(/Excluding the 1998 outlier/)).toBeInTheDocument();
    expect(screen.getByText(/Adjusting for GDP per capita/)).toBeInTheDocument();
  });

  it("marks where the current run sits in the chain", () => {
    serve(BRANCH);
    render(<ForkLineage projectId="prj_1" runId="arun_4" />);
    expect(screen.getByText("this run")).toBeInTheDocument();
  });

  it("lists the branches taken from here with their reasons", () => {
    serve(BRANCH);
    render(<ForkLineage projectId="prj_1" runId="arun_4" />);

    expect(screen.getByText(/Restricting to Europe/)).toBeInTheDocument();
  });

  it("says plainly when a fork has no recorded reason", () => {
    /**
     * A branch with no reason is a result somebody kept. Blank space would let
     * it pass unnoticed; naming it is the point of the column.
     */
    serve({ ...BRANCH,
            children: [{ id: "arun_5", fork_reason: "", status: "succeeded" }] });
    render(<ForkLineage projectId="prj_1" runId="arun_4" />);

    expect(screen.getAllByText(/no reason was recorded/).length).toBeGreaterThan(0);
  });

  it("lets a reader open the run it came from", () => {
    const open = vi.fn();
    serve(BRANCH);
    render(<ForkLineage projectId="prj_1" runId="arun_4" onOpen={open} />);

    fireEvent.click(screen.getByRole("button", { name: "arun_1" }));
    expect(open).toHaveBeenCalledWith("arun_1");
  });
});

describe("restraint", () => {
  it("renders nothing for an original analysis with no branches", () => {
    /**
     * Most runs are these. A panel appearing on every one of them to say "no
     * relationship" is noise that teaches people to skip the region entirely.
     */
    serve({ run_id: "arun_1", depth: 0, ancestors: [], children: [],
            note: "This is an original analysis, not a variant of another." });
    const { container } = render(<ForkLineage projectId="prj_1" runId="arun_1" />);

    expect(container.firstChild).toBeNull();
  });

  it("does not disapprove of a branch", () => {
    /**
     * Forking is how sensitivity analysis is done. The dishonest version is
     * forking and reporting only the branch that worked, so a screen that
     * frowned at the eighth variant would discourage the behaviour it exists
     * to support.
     */
    serve({
      ...BRANCH,
      children: Array.from({ length: 8 }, (_, index) => ({
        id: `arun_${index + 10}`, fork_reason: `variant ${index}`,
        status: "succeeded",
      })),
    });
    const { container } = render(<ForkLineage projectId="prj_1" runId="arun_4" />);

    const text = container.textContent?.toLowerCase() ?? "";
    for (const word of ["warning", "too many", "excessive", "suspicious"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("a schema that permits nonsense", () => {
  it("says a chain loops back rather than showing a partial history", () => {
    serve({
      ...BRANCH,
      ancestors: [{ id: "arun_9", cycle: true, reason_for_the_fork_below: "" }],
    });
    render(<ForkLineage projectId="prj_1" runId="arun_4" />);

    expect(screen.getByText(/refers back to a run already in it/))
      .toBeInTheDocument();
  });
});
