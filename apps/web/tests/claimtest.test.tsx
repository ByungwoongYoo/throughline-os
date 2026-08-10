/**
 * The claim test screen.
 *
 * The backend is careful to distinguish "checked and passed" from "not
 * checked", because merging them is a lie by omission about the system's own
 * diligence. That distinction is only worth anything if it survives to the
 * screen, and it is exactly the kind of thing that gets flattened by a
 * well-meaning simplification of a ternary.
 *
 * So the tests here are about which of the four steps is marked, with what, and
 * whether the paper's words are ever paraphrased.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { ClaimTest } from "@/components/claimtest";
import { api } from "@/lib/api";

const paper = {
  id: "src_paper", title: "consumption_resistance.md",
  ingestion_status: "ready", dataset: null,
} as never;

const dataset = {
  id: "src_data", title: "amr_surveillance.csv", ingestion_status: "ready",
  dataset: { dataset_version_id: "dsv_1", row_count: 160, column_count: 4 },
} as never;

describe("choosing a paper", () => {
  it("asks for both a paper and a dataset before offering anything", () => {
    render(<ClaimTest projectId="prj" sources={[paper]} />);

    expect(screen.getByText(/A paper and a dataset are needed/)).toBeVisible();
  });

  it("says plainly that a refusal is the point", () => {
    render(<ClaimTest projectId="prj" sources={[paper]} />);

    expect(screen.getByText(/says plainly when it could not/)).toBeVisible();
  });

  it("lists only papers as papers", () => {
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);

    expect(screen.getByText("consumption_resistance.md")).toBeVisible();
    expect(screen.queryByText("amr_surveillance.csv")).toBeNull();
  });
});

describe("located claims", () => {
  const located = {
    source_title: "consumption_resistance.md",
    model: "qwen2.5:7b-instruct",
    prompt: "locate_claims v1",
    note: "",
    claims: [{
      claim_id: "clm_1",
      statement: "Antibiotic consumption is positively associated with "
        + "resistance prevalence (r = 0.72, p < 0.001).",
      exposure: "antibiotic consumption",
      outcome: "resistance prevalence",
      direction: "positive",
      claimed_design: "cross-sectional",
      source_id: "src_paper",
    }],
  };

  it("quotes the paper rather than paraphrasing it", async () => {
    // LAW 4. The statement is stored verbatim precisely so a verdict about it
    // can be checked against the source, and a summary here would break that.
    vi.mocked(api.post).mockResolvedValueOnce(located as never);
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);

    screen.getByText("consumption_resistance.md").click();

    const quote = await screen.findByText(new RegExp("r = 0\\.72"));
    expect(quote.tagName.toLowerCase()).toBe("blockquote");
  });

  it("attributes the reading to the model that made it", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(located as never);
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);

    screen.getByText("consumption_resistance.md").click();

    expect(await screen.findByText(/qwen2\.5:7b-instruct/)).toBeVisible();
    expect(screen.getByText(/they are not findings/)).toBeVisible();
  });

  it("reports a paper with no locatable claim rather than showing nothing", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      ...located, claims: [],
      note: "No testable empirical claim was found.",
    } as never);
    render(<ClaimTest projectId="prj" sources={[paper, dataset]} />);

    screen.getByText("consumption_resistance.md").click();

    expect(await screen.findByText(/No testable claim found/)).toBeVisible();
  });
});
