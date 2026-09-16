/**
 * Reading a paper without a model says where to get one (D412).
 *
 * A paper-first project ingests its PDF correctly and then locating its claims
 * refuses — "No model provider is configured" — as a red sentence with nowhere
 * to go. The refusal is its own status now (503), and the screen answers it
 * with what is needed, the local way to get it, and the way to Settings.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaimTest } from "@/components/claimtest";
import { ApiError, api } from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const paper = { id: "src_paper", title: "consumption_resistance.pdf",
                ingestion_status: "ready", dataset: null } as never;
const dataset = { id: "src_data", title: "amr.csv", ingestion_status: "ready",
                  dataset: { dataset_version_id: "dsv_1", row_count: 160, column_count: 4 } } as never;

function refuseWith(error: Error) {
  vi.spyOn(api, "get").mockResolvedValue({ source_id: "src_paper", claims: [] } as never);
  vi.spyOn(api, "post").mockRejectedValue(error);
}

async function readPaper(onConnectModel?: () => void) {
  render(<ClaimTest projectId="prj" sources={[paper, dataset]}
                    onConnectModel={onConnectModel} />);
  const [papers] = screen.getAllByRole("combobox");
  fireEvent.change(papers, { target: { value: "src_paper" } });
}

describe("a paper that needs a model to be read", () => {
  it("says what is needed and offers Settings", async () => {
    refuseWith(new ApiError(503, "No model provider is configured."));
    const onConnectModel = vi.fn();
    await readPaper(onConnectModel);

    const panel = await screen.findByRole("alert", { name: /a model is needed/i });
    expect(panel.textContent).toMatch(/ollama pull/);
    expect(panel.textContent).toMatch(/nothing leaves the computer/);
    fireEvent.click(screen.getByRole("button", { name: /choose a model in settings/i }));
    expect(onConnectModel).toHaveBeenCalledOnce();
  });

  it("keeps an ordinary refusal as a refusal", async () => {
    refuseWith(new ApiError(400, "'Paper' has no indexed passages."));
    await readPaper(vi.fn());

    expect(await screen.findByText(/no indexed passages/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /choose a model/i })).toBeNull();
  });
});

describe("the workspace wires the way to Settings", () => {
  it("passes Compare a route to the settings section, and Compare passes it on", async () => {
    // A forgotten prop renders the panel without its button, and no rendering
    // test of ClaimTest alone would notice. So the wiring is read from source.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const page = readFileSync(resolve(__dirname, "../app/workspace/page.tsx"), "utf8");
    const compare = readFileSync(resolve(__dirname, "../components/compare.tsx"), "utf8");
    expect(page).toMatch(/onConnectModel=\{\(\) => go\(\{ section: "settings"/);
    expect(compare).toMatch(/<ClaimTest[\s\S]*?onConnectModel=\{onConnectModel\}/);
  });
});
