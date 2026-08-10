/**
 * The verdict renderer — one component, sixty outcomes.
 *
 * These are the frontend tests that carry scientific weight. A backend that
 * refuses correctly and an interface that renders the refusal as a red X have,
 * between them, told the researcher something false — so the assertions here
 * are about *meaning surviving the trip to the DOM*, not about markup.
 *
 * Three properties are load-bearing and each has a test that would fail loudly
 * if someone "tidied up" the component:
 *
 *  - `not testable` must not be styled as an error;
 *  - `failed` must never look like `contradicted`;
 *  - no verdict may be communicated by colour alone.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerdictBody, VerdictCard } from "@/components/Verdict";

function verdict(overrides: Partial<VerdictBody> = {}): VerdictBody {
  return {
    outcome: "P9",
    outcome_name: "Not testable — design mismatch",
    family: "not_testable",
    family_label: "Not testable",
    tone: "neutral",
    sentence: "The paper reports a cohort design and this data is cross "
      + "sectional.",
    guidance: "",
    reason_code: "design_cannot_carry_claim",
    confidence: 0.95,
    evidence_refs: [],
    transform_log: [],
    caveats: [],
    remedies: [],
    still_possible: [],
    state: "complete",
    method: "deterministic",
    pair: "paper_dataset",
    ...overrides,
  };
}

describe("the verdict card", () => {
  it("leads with the family word, not the outcome code", () => {
    // Six words a researcher can learn. The specific outcome is underneath.
    render(<VerdictCard verdict={verdict()} />);

    expect(screen.getByRole("heading", { level: 2 }))
      .toHaveTextContent("Not testable");
    expect(screen.getByText(/Not testable — design mismatch/)).toBeVisible();
  });

  it("renders the deterministic sentence verbatim", () => {
    // The sentence is written server-side precisely so every installation says
    // the same thing. The component must not paraphrase it.
    const body = verdict();
    render(<VerdictCard verdict={body} />);

    expect(screen.getByText(body.sentence)).toBeVisible();
  });

  it("states that a deterministic verdict does not depend on a model", () => {
    render(<VerdictCard verdict={verdict()} />);

    expect(screen.getByText(/does not depend on a model/)).toBeVisible();
  });

  it("gives every family a mark as well as a tint", () => {
    // Part P. Roughly one in twelve men cannot reliably separate the positive
    // and negative tints, and a verdict is exactly the wrong thing to
    // communicate by hue.
    const families: Array<VerdictBody["family"]> = [
      "supported", "qualified", "contradicted",
      "not_testable", "undetermined", "needs_review",
    ];

    for (const family of families) {
      const { container, unmount } = render(
        <VerdictCard verdict={verdict({ family })} />);
      const mark = container.querySelector(".vd-mark");
      expect(mark, `${family} has no mark`).not.toBeNull();
      expect(mark!.textContent!.trim().length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("does not style a refusal as an error", () => {
    // The strongest trust signal the product can send. A refusal rendered as a
    // failure teaches a researcher the tool is limited; rendered as an answer
    // it teaches them something about their question.
    const { container } = render(<VerdictCard verdict={verdict()} />);

    expect(container.querySelector(".vd-not_testable")).not.toBeNull();
    expect(container.querySelector(".vd-failed")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a system failure completely differently from a contradiction", () => {
    // A crashed job and a null result are opposite things, and conflating them
    // destroys trust the first time someone notices.
    const { container } = render(
      <VerdictCard verdict={verdict({ state: "failed" })} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/did not run/)).toBeVisible();
    expect(screen.getByText(/not a result about your data/)).toBeVisible();
    expect(container.querySelector(".vd-contradicted")).toBeNull();
  });

  it("shows a stale verdict as provisional", () => {
    render(<VerdictCard verdict={verdict({ state: "stale" })} />);

    expect(screen.getByText(/A source changed after this ran/)).toBeVisible();
  });
});

describe("what a verdict must never drop", () => {
  it("renders every caveat", () => {
    // LAW 3 lives here. A caveat computed server-side and silently not rendered
    // is worse than one never computed, because the backend's tests pass.
    render(<VerdictCard verdict={verdict({
      caveats: ["Agreement with one dataset is corroboration, not replication.",
                "Population scope was not checked."],
    })} />);

    expect(screen.getByText(/not replication/)).toBeVisible();
    expect(screen.getByText(/Population scope was not checked/)).toBeVisible();
  });

  it("renders what would fix it", () => {
    render(<VerdictCard verdict={verdict({
      remedies: ["Test this claim on data collected under a design that can "
                 + "carry it."],
    })} />);

    expect(screen.getByText(/data collected under a design/)).toBeVisible();
  });

  it("renders what is still possible", () => {
    // The half most tools omit. A researcher told only "no" concludes the tool
    // is limited; one told what remains possible learns the method.
    render(<VerdictCard verdict={verdict({
      still_possible: ["Test the weaker, associational form of the same claim."],
    })} />);

    expect(screen.getByText(/associational form/)).toBeVisible();
  });

  it("renders the transformations applied to make a comparison possible", () => {
    render(<VerdictCard verdict={verdict({
      transform_log: ["converted DDD per 1000 to DDD per 100"],
    })} />);

    expect(screen.getByText(/DDD per 100/)).toBeVisible();
  });
});

describe("confidence in the verdict itself", () => {
  it("separates a certain verdict from a suggestive one in words", () => {
    // Meta-uncertainty. A design mismatch read from recorded metadata is
    // certain; a claim pulled out of prose is not, and showing them identically
    // makes the certain one look negotiable.
    const { rerender } = render(
      <VerdictCard verdict={verdict({ confidence: 0.95 })} />);
    expect(screen.getByText(/high confidence/)).toBeVisible();

    rerender(<VerdictCard verdict={verdict({ confidence: 0.55 })} />);
    expect(screen.getByText(/low confidence/)).toBeVisible();
    expect(screen.getByText(/prompt to look, not a result/)).toBeVisible();
  });
});
