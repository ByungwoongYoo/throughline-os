/**
 * The result card — where a number becomes a sentence.
 *
 * This is the component with the most room to mislead, because it is the one
 * that translates. A backend that computes q = 0.049 correctly and a card that
 * renders "strong evidence" have together told the researcher something the
 * statistics do not support.
 *
 * So these tests assert the translation, not the layout: which word is chosen,
 * whether the lifecycle stage survives, and whether a missing value degrades
 * rather than crashes.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultCard } from "@/components/ResultCard";
import type { Connection } from "@/lib/api";

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn_1",
    left_variable: "consumption_ddd",
    right_variable: "resistance_pct",
    relationship_type: "correlation",
    method: "pearson_correlation",
    lifecycle_status: "exploratory",
    estimate: 0.88,
    p_value: 1e-40,
    q_value: 1e-38,
    effect_size: 0.88,
    effect_size_name: "pearson_r",
    sample_size: 160,
    evidence_quality: "strong",
    rank_score: 0.9,
    ...overrides,
  } as Connection;
}

describe("the result card", () => {
  it("leads with a sentence, not a coefficient", () => {
    // Part C. A researcher reads prose first; the number is corroboration of
    // the sentence, not the other way round.
    const { container } = render(<ResultCard connection={connection()} />);

    const sentence = container.querySelector(".rc-sentence");
    expect(sentence).not.toBeNull();
    expect(sentence!.textContent!.length).toBeGreaterThan(20);
  });

  it("keeps the exact estimate available alongside the word", () => {
    render(<ResultCard connection={connection()} />);

    expect(screen.getByText(/0\.88/)).toBeVisible();
  });

  it("does not crash when a pair has no coefficient", () => {
    // A categorical pair tested for association has no Pearson r. One null of
    // these took down the whole Figures screen once; a card must degrade.
    expect(() => render(<ResultCard connection={connection({
      estimate: null, effect_size: null, effect_size_name: "cramers_v",
    })} />)).not.toThrow();
  });

  it("never calls an exploratory result validated", () => {
    // The lifecycle word is the single most consequential piece of text on this
    // card: promotion through those states is earned by robustness checks, and
    // an interface that upgrades it in wording has asserted something no test
    // established.
    render(<ResultCard connection={connection({
      lifecycle_status: "exploratory" })} />);

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/validated|replicated/i);
  });

  it("shows a canonical label rather than a raw column name", () => {
    // Part C — zero raw names outside the mapping screen.
    render(<ResultCard connection={connection()} labels={{
      consumption_ddd: "antibiotic consumption",
      resistance_pct: "resistance prevalence",
    }} />);

    expect(screen.getAllByText(/antibiotic consumption/).length)
      .toBeGreaterThan(0);
  });

  it("falls back to the column name rather than throwing", () => {
    // A missing label is a defect; a card that throws is a worse one.
    expect(() => render(<ResultCard connection={connection()} />)).not.toThrow();
    expect(document.body.textContent).toContain("consumption_ddd");
  });

  it("shows the lifecycle stage in researcher's words", () => {
    render(<ResultCard connection={connection({
      lifecycle_status: "candidate" })} />);

    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("candidate_");
  });

  it("reports weak evidence as weak", () => {
    render(<ResultCard connection={connection({
      evidence_quality: "weak", q_value: 0.04, estimate: 0.18 })} />);

    expect(document.body.textContent).toMatch(/weak/i);
  });
});
