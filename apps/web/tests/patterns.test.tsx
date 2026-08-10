/**
 * The patterns screen.
 *
 * The most dangerous thing this screen could do is look like a list of
 * discoveries. It is a list of shapes, and the only thing standing between
 * those two readings is that every pattern renders its own refutation and that
 * multiplicity is read first.
 *
 * Both of those are one careless edit away from disappearing, so both are
 * pinned here.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { Patterns } from "@/components/patterns";
import { api } from "@/lib/api";

const multiplicity = {
  tests_run: 426, survived_correction: 3, false_discovery_rate: 0.05,
  expected_false_among_survivors: 0.2, discovery_runs: 3,
  note: "426 comparisons have been run in this project and 3 survived "
    + "correction. At a false-discovery rate of 0.05, roughly 0.2 of those "
    + "survivors are expected to be noise.",
};

const detected = {
  multiplicity,
  patterns: {
    probably_the_same_quantity: [{
      kind: "probably_the_same_quantity",
      variables: ["height_cm", "stature_cm"],
      headline: "height_cm and stature_cm move together almost perfectly",
      reading: "A correlation this tight usually means one quantity twice.",
      not_a_finding_because: "If these are the same quantity, the correlation "
        + "is arithmetic.",
      evidence_refs: ["conn_1"],
    }],
    recurring_variables: [], across_datasets: [],
    candidate_confounders: [], contradictions: [],
  },
  pattern_count: 1, connections_examined: 6, canonical_coverage: 3,
  note: "These are observations about the shape of results.",
};

const findings = {
  multiplicity, survivors: 1,
  note: "Nothing here is a Finding in the lifecycle sense until a person "
    + "promotes it.",
  findings: [{
    connection_id: "conn_1",
    variables: ["antibiotic_consumption", "resistance_prevalence"],
    direction: "positive", lifecycle_status: "exploratory",
    evidence_quality: "strong", sample_size: 160, canonical: true,
    supporting_patterns: [],
    contradicting_patterns: [{
      kind: "probably_the_same_quantity",
      variables: ["antibiotic_consumption", "resistance_prevalence"],
      headline: "these move together almost perfectly",
      not_a_finding_because: "If these are the same quantity, the correlation "
        + "is arithmetic.",
      evidence_refs: [],
    }],
    other_patterns: [],
    read_with: "This is the strongest surviving result in the project.",
  }],
};

function mount() {
  vi.mocked(api.get)
    .mockImplementation((path: string) =>
      Promise.resolve((path.includes("key-findings") ? findings : detected) as never));
  return render(<Patterns projectId="prj" />);
}

describe("multiplicity", () => {
  it("is shown before any pattern", async () => {
    // Not a caveat banner — the frame the rest of the page is read inside.
    mount();

    const context = (await screen.findAllByText(/expected to be noise/))[0];
    const heading = await screen.findByText(/Worth your attention/);
    expect(context.compareDocumentPosition(heading))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("states how many survivors are expected to be noise", async () => {
    mount();

    expect(await screen.findByText(/≈0\.2/)).toBeVisible();
    expect(screen.getAllByText(/expected to be noise/).length)
      .toBeGreaterThan(0);
  });
});

describe("patterns are not findings", () => {
  it("renders why each pattern is not a finding", async () => {
    mount();

    await waitFor(() =>
      expect(screen.getAllByText(/Why this is not a finding/).length)
        .toBeGreaterThan(0));
    expect(screen.getAllByText(/the correlation is arithmetic/).length)
      .toBeGreaterThan(0);
  });

  it("says a key finding is not yet a Finding", async () => {
    // §15 — a Finding is a lifecycle object a person promotes. Blurring that
    // would let the screen manufacture findings by listing candidates.
    mount();

    expect(await screen.findByText(/until a person promotes it/)).toBeVisible();
  });

  it("puts what argues against a result beside it, not in an appendix", async () => {
    // LAW 3. A caveat in a separate section is a caveat nobody reads.
    mount();

    const objection = await screen.findByText(/What argues against this/);
    const card = objection.closest(".pat-finding");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("antibiotic consumption");
  });
});

describe("the robustness tab", () => {
  it("offers the specification curve alongside the patterns", async () => {
    mount();

    const tab = await screen.findByRole("tab", { name: /Would it survive/ });
    tab.click();

    expect(await screen.findByText(/A dataset is needed|reason to adjust for/))
      .toBeVisible();
  });
});
