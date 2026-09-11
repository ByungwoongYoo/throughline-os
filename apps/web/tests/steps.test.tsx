/**
 * The four steps of the claim test, and the state that is easiest to lose.
 *
 * The backend distinguishes "checked and passed" from "not checked" everywhere.
 * That distinction is a claim about the system's own diligence, and it costs
 * nothing to flatten: a ternary with two branches instead of three, and every
 * unchecked step silently starts rendering a tick.
 *
 * These tests pin the third state to the DOM so that flattening fails loudly.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { ClaimTest } from "@/components/claimtest";
import { api } from "@/lib/api";

const paper = {
  id: "src_paper", title: "paper.md", ingestion_status: "ready", dataset: null,
} as never;
const dataset = {
  id: "src_data", title: "data.csv", ingestion_status: "ready",
  dataset: { dataset_version_id: "dsv_1", row_count: 160, column_count: 4 },
} as never;

const claim = {
  claim_id: "clm_1",
  statement: "Consumption is associated with resistance.",
  exposure: "antibiotic consumption",
  outcome: "resistance prevalence",
  direction: "positive",
  claimed_design: "cross-sectional",
  source_id: "src_paper",
};

const located = {
  source_title: "paper.md", model: "test-model", prompt: "locate_claims v1",
  note: "", claims: [claim],
};

function verdict(outcome: string, extra: Record<string, unknown> = {}) {
  return {
    outcome, outcome_name: "An outcome", family: "not_testable",
    family_label: "Not testable", tone: "neutral",
    sentence: "A sentence about why.", guidance: "", reason_code: "r",
    confidence: 0.9, evidence_refs: [], transform_log: [], caveats: [],
    remedies: [], still_possible: [], state: "complete",
    method: "deterministic", pair: "paper_dataset", ...extra,
  };
}

/*
 * Drive the reasoning master to a verdict.
 *
 * The master made the pair a pair: the paper and the dataset are chosen above
 * everything, and the check is one deliberate act rather than a click on a
 * dataset's name. Four steps here, and each is a real one a researcher takes —
 * choose the paper, choose the data, take up a claim, ask whether it can be
 * tested. The selects are addressed by role and position because the visible
 * labels are one word each and the browser gives them no other name.
 */
async function runTest(result: Record<string, unknown>) {
  vi.mocked(api.post)
    .mockResolvedValueOnce(located as never)
    .mockResolvedValueOnce(result as never);

  render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);
  const [paperPicker, dataPicker] = screen.getAllByRole("combobox");
  fireEvent.change(paperPicker, { target: { value: "src_paper" } });
  fireEvent.change(dataPicker, { target: { value: "src_data" } });

  fireEvent.click(await screen.findByRole("button", { name: "Work with this claim" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check testability" }));
  // The verdict card's step list is what these tests read, so waiting for it
  // is waiting for the thing under test rather than for prose beside it.
  await waitFor(() =>
    expect(document.querySelector(".ct-steps")).toBeTruthy());
}

function stepStates() {
  return [...document.querySelectorAll(".ct-steps li")]
    .map((li) => [li.querySelector("b")?.textContent, li.getAttribute("data-state")]);
}

describe("the four steps", () => {
  it("marks an unchecked step as unchecked, never as passed", async () => {
    // The whole point. "We did not look" and "we looked and it was fine" are
    // different statements, and an interface that merged them would be lying by
    // omission about its own diligence.
    await runTest({
      verdict: verdict("P1", { family: "supported", family_label: "Supported" }),
      claim, dataset: { id: "dsv_1", name: "data.csv", design: "cross_sectional",
                        rows: 160 },
      testable: true, exposure_column: "ddd", outcome_column: "res_pct",
      unchecked: ["Population scope was not checked — it is not recorded on "
                  + "the paper."],
    });

    const states = Object.fromEntries(stepStates());
    expect(states["Scope overlaps"]).toBe("unchecked");
    expect(states["Constructs measured here"]).toBe("passed");
  });

  it("marks the step that stopped it as failed, and the rest as not reached", async () => {
    // Which step failed matters more than that one did: a missing mapping is a
    // chore, a design mismatch is a fact about the question.
    await runTest({
      verdict: verdict("P8"),
      claim, dataset: { id: "dsv_1", name: "data.csv", design: "cross_sectional",
                        rows: 160 },
      testable: false, exposure_column: null, outcome_column: null,
      unchecked: [],
    });

    const states = Object.fromEntries(stepStates());
    expect(states["Constructs measured here"]).toBe("failed");
    expect(states["Design can carry the claim"]).toBe("skipped");
    expect(states["Scope overlaps"]).toBe("skipped");
  });

  it("puts circularity at the first step, before anything else", async () => {
    // P7 is checked before every other test because a paper written from this
    // data makes the rest moot, and the sequence has to show that.
    await runTest({
      verdict: verdict("P7", { family: "needs_review",
                               family_label: "Needs review",
                               state: "refused_by_policy" }),
      claim, dataset: { id: "dsv_1", name: "data.csv", design: "cross_sectional",
                        rows: 160 },
      testable: false, exposure_column: null, outcome_column: null,
      unchecked: [],
    });

    const states = stepStates();
    expect(states[0][0]).toBe("Written independently of this data");
    expect(states[0][1]).toBe("failed");
    expect(states[1][1]).toBe("skipped");
  });

  it("gives every step state a word for screen readers, not only a glyph", async () => {
    // Part P. The ✓ ✕ · – marks are aria-hidden, so without the sr-only text a
    // screen reader hears four unlabelled list items.
    await runTest({
      verdict: verdict("P8"),
      claim, dataset: { id: "dsv_1", name: "data.csv", design: "cross_sectional",
                        rows: 160 },
      testable: false, exposure_column: null, outcome_column: null,
      unchecked: [],
    });

    const hidden = [...document.querySelectorAll(".ct-steps .sr-only")]
      .map((n) => n.textContent);
    expect(hidden.join(" ")).toMatch(/where it stopped/);
    expect(hidden.join(" ")).toMatch(/not reached/);
  });
});
