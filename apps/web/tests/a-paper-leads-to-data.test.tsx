/**
 * Starting from a paper reaches the data that could test it (D413).
 *
 * With a paper and no dataset, the claim test drew its waiting state and
 * offered only "Add a dataset": the paper's claims could not even be read, so
 * nothing joined a claim to data that could test it, and a paper-first project
 * never reached a finding. Now the paper can be read for its claims there, and
 * each claim offers Find data with its own terms filled in.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaimTest } from "@/components/claimtest";
import { DataSearch } from "@/components/datasearch";
import { ApiError, api } from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const paper = { id: "src_paper", title: "consumption_resistance.pdf",
                ingestion_status: "ready", dataset: null } as never;

const CLAIM = {
  claim_id: "clm_1", statement: "Antibiotic consumption is associated with resistance.",
  exposure: "antibiotic_consumption", outcome: "resistance_prevalence",
  direction: "positive", claimed_design: "cross_sectional", claimed_effect: "",
  locator: "p. 4", model: "qwen2.5:7b-instruct",
};

describe("a paper with no dataset yet", () => {
  it("can be read for its claims, and each claim leads to Find data", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ source_id: "src_paper", claims: [] } as never);
    const post = vi.spyOn(api, "post").mockResolvedValue({
      source_title: "consumption_resistance.pdf", claims: [CLAIM], note: "", model: "m", prompt: "p",
    } as never);
    const onFindData = vi.fn();
    render(<ClaimTest projectId="prj" sources={[paper]} onFindData={onFindData} />);

    fireEvent.click(screen.getByRole("button", { name: /read the claims in consumption_resistance/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.stringContaining("/api/sources/src_paper/claims"), expect.anything()));
    expect(await screen.findByText(CLAIM.statement)).toBeTruthy();
    // Still nothing that adjudicates: there is no dataset to test against.
    expect(screen.queryByRole("button", { name: /work with this claim/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /find data for this claim/i }));
    expect(onFindData).toHaveBeenCalledWith("antibiotic consumption resistance prevalence");
  });

  it("shows why a paper could not be read, including the way to a model", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ source_id: "src_paper", claims: [] } as never);
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(503, "No model provider is configured."));
    render(<ClaimTest projectId="prj" sources={[paper]} onConnectModel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /read the claims in/i }));

    expect(await screen.findByRole("button", { name: /choose a model in settings/i })).toBeTruthy();
  });
});

describe("Find data opened from a claim", () => {
  it("starts with the claim's terms, and searches only when asked", () => {
    const post = vi.spyOn(api, "post");
    vi.spyOn(api, "get").mockResolvedValue({ repositories: [] } as never);
    render(<DataSearch projectId="prj" initialQuery="antibiotic consumption resistance prevalence" />);

    expect((screen.getByRole("textbox") as HTMLInputElement).value)
      .toBe("antibiotic consumption resistance prevalence");
    expect(post).not.toHaveBeenCalled();
  });
});

describe("the workspace wires a claim to Find data", () => {
  it("routes onFindData to the data view with the query", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const page = readFileSync(resolve(__dirname, "../app/workspace/page.tsx"), "utf8");
    const compare = readFileSync(resolve(__dirname, "../components/compare.tsx"), "utf8");
    expect(page).toMatch(/onFindData=\{\(query\) => \{[\s\S]*?setDataQuery\(query\)[\s\S]*?view: "data"/);
    expect(page).toMatch(/<DataSearch[^>]*initialQuery=\{dataQuery\}/);
    expect(compare).toMatch(/<ClaimTest[\s\S]*?onFindData=\{onFindData\}/);
  });
});
