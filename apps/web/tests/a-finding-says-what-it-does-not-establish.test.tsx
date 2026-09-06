/**
 * A finding's own caveats reach the reader (§ sent on every request, shown to nobody).
 *
 * `graphs.evidence_graph` returns `limitations` at the top level, deliberately
 * beside the note explaining that no contradicting evidence "is not the same as
 * none existing". The whole response is shaped around what a reader should not
 * conclude — and that field was the one part of the shape the TypeScript type
 * never named, so it arrived on every request and reached no screen.
 *
 * Found by the reverse half of `test_the_interface_and_the_api_agree.py`: the
 * old guard asked whether the API still sends what a screen requires, which
 * catches a rename and cannot see a field no screen was ever taught to read.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { EvidenceGraphView, Findings } from "@/components/views";
import { api } from "@/lib/api";

const GRAPH = (over: Record<string, unknown> = {}) => ({
  finding: {
    id: "f1", title: "Sleep predicts recall", statement: "…",
    finding_type: "statistical", lifecycle_status: "candidate",
    // `association_only`, which is the value `CausalStatus` actually has.
    // This fixture said `associational` — the same near-miss that had been
    // sitting in the library note's own vocabulary, and the reason it read as
    // correct for so long.
    causal_status: "association_only", confidence: 0.6,
    created_at: "2026-01-01T00:00:00Z", limitations: [],
  },
  claims: [], analyses: [], connections: [], challenges: [],
  balance: { supporting: 2, contradicting: 0 },
  causal_reading: {
    status: "association_only",
    note: "Association only. The design does not support a causal claim.",
  },
  limitations: [],
  note: "No contradicting evidence has been recorded. That is not the same as "
      + "none existing.",
  ...over,
});

const show = (graph: Record<string, unknown>) => {
  vi.spyOn(api, "get").mockResolvedValue(graph);
  render(<EvidenceGraphView findingId="f1" />);
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("a finding that states its own limits", () => {
  const LIMITS = ["Observational; no randomisation.",
                  "Single site, so it may not generalise."];

  it("shows them", async () => {
    show(GRAPH({ limitations: LIMITS }));
    await waitFor(() =>
      expect(screen.getByText(/does not establish/i)).toBeTruthy());
    for (const limit of LIMITS) {
      expect(screen.getByText(limit)).toBeTruthy();
    }
  });

  it("shows them with the claim, not after the evidence has been weighed", async () => {
    /*
     * Placement is the argument. A caveat that appears below the supporting
     * and contradicting evidence arrives after the reader has formed a view,
     * which is the wrong moment for it.
     */
    show(GRAPH({ limitations: LIMITS }));
    await waitFor(() =>
      expect(screen.getByText(/does not establish/i)).toBeTruthy());
    const text = document.body.textContent ?? "";
    expect(text.indexOf("does not establish"))
      .toBeLessThan(text.indexOf("Claims and their evidence"));
  });

  it("keeps the note about absent contradicting evidence too", async () => {
    // Both say what not to conclude, and they are not substitutes: one is
    // about the evidence that is missing, the other about the claim's reach.
    show(GRAPH({ limitations: LIMITS }));
    await waitFor(() =>
      expect(screen.getByText(/does not establish/i)).toBeTruthy());
    expect(screen.getByText(/not the same as none existing/)).toBeTruthy();
  });
});

describe("a finding with no stated limits", () => {
  it("says nothing rather than showing an empty heading", async () => {
    // An empty "what this does not establish" would read as a claim that there
    // are no limits, which is the opposite of the point.
    show(GRAPH());
    await waitFor(() =>
      expect(screen.getByText("Sleep predicts recall")).toBeTruthy());
    expect(screen.queryByText(/does not establish/i)).toBeNull();
  });

  it("survives a response that omits the field", async () => {
    const graph = GRAPH();
    delete (graph as Record<string, unknown>).limitations;
    show(graph);
    await waitFor(() =>
      expect(screen.getByText("Sleep predicts recall")).toBeTruthy());
    expect(screen.queryByText(/does not establish/i)).toBeNull();
  });
});

describe("the list says which claims carry caveats", () => {
  /*
   * The detail view shows the caveats; the list is where a researcher decides
   * which finding to open. Presented identically, a claim with three stated
   * limits and a claim with none look like equally settled results — and the
   * qualification arrives only after the choice has been made.
   *
   * The count rather than the text: three sentences of qualification per row
   * would bury the titles the list exists to show.
   */
  const listOf = (findings: unknown[]) => {
    vi.spyOn(api, "get").mockImplementation(async (path: string) =>
      (path.includes("/findings") ? findings : { findings: {}, connections: {} }));
    render(<Findings projectId="p1" onSelect={() => {}} />);
  };

  const finding = (over: Record<string, unknown> = {}) => ({
    id: "f1", title: "Sleep predicts recall", statement: "…",
    finding_type: "statistical", lifecycle_status: "candidate",
    // `association_only`, like the graph fixture above. This second copy was
    // missed when that one was corrected, which is the argument for the guard
    // rather than for another careful read.
    causal_status: "association_only", confidence: 0.6,
    created_at: "2026-01-01T00:00:00Z", ...over,
  });

  it("marks a finding that states limits", async () => {
    listOf([finding({ limitations: ["Observational.", "Single site."] })]);
    await waitFor(() =>
      expect(screen.getByText(/Sleep predicts recall/)).toBeTruthy());
    expect(screen.getByText(/2 stated limits/)).toBeTruthy();
  });

  it("counts one as one", async () => {
    listOf([finding({ limitations: ["Observational."] })]);
    await waitFor(() =>
      expect(screen.getByText(/Sleep predicts recall/)).toBeTruthy());
    expect(screen.getByText(/1 stated limit(?!s)/)).toBeTruthy();
  });

  it("says nothing for a finding that states none", async () => {
    // A "0 stated limits" on every unqualified claim would be noise, and worse,
    // would read as a positive assurance that there are none to state.
    listOf([finding({ limitations: [] })]);
    await waitFor(() =>
      expect(screen.getByText(/Sleep predicts recall/)).toBeTruthy());
    expect(screen.queryByText(/stated limit/)).toBeNull();
  });

  it("survives a response that omits the field", async () => {
    listOf([finding()]);
    await waitFor(() =>
      expect(screen.getByText(/Sleep predicts recall/)).toBeTruthy());
    expect(screen.queryByText(/stated limit/)).toBeNull();
  });
});

describe("what a finding says about cause", () => {
  /*
   * `causal_status` was on the finding from the beginning and read by no
   * screen. The findings *list* printed it as a bare token — "causal status:
   * possible causal" — and the finding a researcher opens to decide what it
   * establishes said nothing about cause at all, while the library note
   * exported to somebody else's reference manager carried a full sentence.
   * The person receiving the citation was told more about causality than the
   * person who made the finding.
   */
  it("says it, in the server's words rather than the client's", async () => {
    show(GRAPH({
      causal_reading: {
        status: "possible_causal",
        note: "A causal reading is possible and is not established. It "
            + "survived the checks that were applied; those checks cannot "
            + "rule out an unmeasured common cause.",
      },
    }));

    await waitFor(() =>
      expect(screen.getByText(/is possible and is not established/)).toBeTruthy());
    // The raw token is not what a reader is left with.
    expect(screen.queryByText(/^possible_causal$/)).toBeNull();
  });

  it("says so when causation was never assessed", async () => {
    /*
     * The case a silent screen is most likely to have a reader assume away.
     * An unassessed finding is not a weak causal claim; it is no causal claim,
     * and the section appears for it like any other.
     */
    show(GRAPH({
      causal_reading: {
        status: "not_assessed",
        note: "Causation was not assessed. This is an association; nothing "
            + "here supports a causal reading of it.",
      },
    }));

    await waitFor(() =>
      expect(screen.getByText(/Causation was not assessed/)).toBeTruthy());
  });

  it("puts it above the caveats, which are a different kind of thing",
     async () => {
    // Cause is a qualification on what the finding *is*; the limitations are
    // qualifications on what it covers. Read in the wrong order the causal
    // sentence looks like one more caveat among several.
    show(GRAPH({
      causal_reading: { status: "not_assessed", note: "Causation was not assessed." },
      limitations: ["Single site."],
    }));

    await waitFor(() => expect(screen.getByText(/Single site/)).toBeTruthy());
    const html = document.body.innerHTML;
    expect(html.indexOf("says about cause"))
      .toBeLessThan(html.indexOf("does not establish"));
  });
});
