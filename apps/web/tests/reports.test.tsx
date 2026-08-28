/**
 * Re-cutting a report as a talk (§75).
 *
 * `POST /artifacts/{id}/presentation` had no caller, so a researcher with a
 * finished report had no way to get slides out of it except by writing them
 * again somewhere else — which is the thing the route exists to prevent. A
 * presentation is the same evidence at a different length, derived from the
 * report so both reference the same analysis runs; two documents assembled
 * separately drift into two accounts of one result.
 *
 * The screen had no tests of its own.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ReportDetail } from "@/components/reports";
import type { Artifact } from "@/lib/api";
import { ApiError, api } from "@/lib/api";

/*
 * Typed, so the compiler holds it to the contract.
 *
 * Untyped, this fixture had `problems` and no `warnings`, and the panel
 * iterates both — so the screen rendered nothing and every test reported that
 * it could not find the button, which was never the problem. That is twice now
 * in this suite; an object literal standing in for an API response is a second
 * copy of the contract, and only the compiler keeps the two together.
 */
const REPORT: Artifact = {
  id: "art_1",
  title: "Antibiotic use and resistance",
  artifact_type: "report",
  purpose: "report the finding",
  status: "draft",
  version: 1,
  blocks: [],
  findings: [],
  integrity: { publishable: true, blocks_checked: 4, problems: [], warnings: [] },
  renders: [],
};

function serve(artifact: Artifact = REPORT) {
  vi.spyOn(api, "get").mockResolvedValue(artifact as never);
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("re-cutting a report", () => {
  it("derives the talk from this report", async () => {
    serve();
    const post = vi.spyOn(api, "post").mockResolvedValue({ artifact_id: "art_2" });
    render(<ReportDetail artifactId="art_1" onOpenArtifact={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: /Re-cut as a talk/ }));
    expect(post).toHaveBeenCalledWith("/api/artifacts/art_1/presentation");
  });

  it("opens the talk rather than leaving the reader on the report", async () => {
    /*
     * Creating a second document and staying on the first is how a button
     * comes to look broken: the work happened and nothing on screen changed.
     */
    serve();
    vi.spyOn(api, "post").mockResolvedValue({ artifact_id: "art_2" });
    const opened = vi.fn();
    render(<ReportDetail artifactId="art_1" onOpenArtifact={opened} />);

    await userEvent.click(await screen.findByRole("button", { name: /Re-cut as a talk/ }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith("art_2"));
  });

  it("says why the slides and the paper cannot drift apart", async () => {
    // The reason to derive rather than rewrite, said where the decision is
    // made rather than in a document nobody opens.
    serve();
    render(<ReportDetail artifactId="art_1" onOpenArtifact={() => {}} />);
    expect(await screen.findByText(/same analysis runs as this report/)).toBeTruthy();
  });

  it("is not offered on a talk", async () => {
    // A presentation re-cut from a presentation would be a copy; the route
    // derives slides from a report's findings.
    serve({ ...REPORT, artifact_type: "presentation" });
    render(<ReportDetail artifactId="art_1" onOpenArtifact={() => {}} />);

    await screen.findByText(/Export/);
    expect(screen.queryByRole("button", { name: /Re-cut as a talk/ })).toBeNull();
  });

  it("shows what the server said when it refuses", async () => {
    serve();
    vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(400, "That report has no findings to cut into slides."));
    const opened = vi.fn();
    render(<ReportDetail artifactId="art_1" onOpenArtifact={opened} />);

    await userEvent.click(await screen.findByRole("button", { name: /Re-cut as a talk/ }));
    expect(await screen.findByText(/no findings to cut into slides/)).toBeTruthy();
    // And the reader is not sent to a document that was never made.
    expect(opened).not.toHaveBeenCalled();
  });

  it("does not offer to cut twice at once", async () => {
    serve();
    let release: (v: unknown) => void = () => {};
    vi.spyOn(api, "post").mockReturnValue(
      new Promise((resolve) => { release = resolve; }) as never);
    render(<ReportDetail artifactId="art_1" onOpenArtifact={() => {}} />);

    const button = await screen.findByRole("button", { name: /Re-cut as a talk/ });
    await userEvent.click(button);
    expect((await screen.findByRole("button", { name: /Cutting…/ })
      ) as HTMLButtonElement).toBeDisabled();
    release({ artifact_id: "art_2" });
  });
});

describe("export", () => {
  it("is blocked while integrity reports problems", async () => {
    // A file outlives the warning that would have accompanied it on screen.
    serve({ ...REPORT, integrity: {
      publishable: false, blocks_checked: 4,
      problems: [{ block_id: "blk_1", kind: "missing_run",
                   detail: "references a run that is gone" }],
      warnings: [] } });
    render(<ReportDetail artifactId="art_1" onOpenArtifact={() => {}} />);

    expect(await screen.findByText(/Export is blocked/)).toBeTruthy();
  });
});
