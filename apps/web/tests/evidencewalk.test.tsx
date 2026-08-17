/**
 * A finding you can walk back from.
 *
 * The product calls itself the throughline, and measuring the provenance depth
 * found there wasn't one: a finding's detail screen offered a single action —
 * previewing a library note — and no route to the computation behind it, the
 * dataset it ran on, or the paper beside it. The chain was complete in the
 * database and unwalkable on screen, because `findings.object_id` was never set
 * and the query behind this panel gates its whole analyses branch on it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EvidenceGraphView } from "@/components/views";
import * as useApiModule from "@/lib/useApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function serve(data: unknown, extra: Record<string, unknown> = {}) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue({
    data, error: null, loading: false, reload: vi.fn(), ...extra,
  } as never);
}

const GRAPH = {
  finding: { id: "fnd_1", title: "consumption tracks resistance",
             lifecycle_status: "candidate" },
  balance: { supporting: 1, contradicting: 0 },
  note: "",
  claims: [],
  challenges: [],
  analyses: [
    { id: "arun_1", method: "pearson_correlation", status: "completed",
      result: { interpretation: "A strong positive association." } },
  ],
};

describe("walking back from a finding", () => {
  it("names the computation the finding rests on", () => {
    serve(GRAPH);
    render(<EvidenceGraphView findingId="fnd_1" />);

    expect(screen.getByText("pearson_correlation")).toBeInTheDocument();
    expect(screen.getByText("arun_1")).toBeInTheDocument();
  });

  it("opens the analysis when the step is clicked", () => {
    /**
     * The click that did not exist. From the analysis a researcher reaches the
     * dataset and the source, so this one step is what turns a dead end into a
     * chain.
     */
    const open = vi.fn();
    serve(GRAPH);
    render(<EvidenceGraphView findingId="fnd_1" onOpenAnalysis={open} />);

    fireEvent.click(screen.getByRole("button", { name: "pearson_correlation" }));
    expect(open).toHaveBeenCalledWith("arun_1");
  });

  it("renders the step as plain text where there is nowhere to navigate", () => {
    /**
     * A button that does nothing is worse than a row: it invites the click that
     * measuring this found missing.
     */
    serve(GRAPH);
    render(<EvidenceGraphView findingId="fnd_1" />);

    expect(screen.queryByRole("button", { name: "pearson_correlation" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("pearson_correlation")).toBeInTheDocument();
  });

  it("says nothing about computations when a finding has none", () => {
    /**
     * A finding recorded by hand before anything computed one is legitimate.
     * An empty "Computations behind it" heading would imply the chain broke.
     */
    serve({ ...GRAPH, analyses: [] });
    render(<EvidenceGraphView findingId="fnd_1" onOpenAnalysis={vi.fn()} />);

    expect(screen.queryByText(/Computations behind it/)).not.toBeInTheDocument();
  });
});
