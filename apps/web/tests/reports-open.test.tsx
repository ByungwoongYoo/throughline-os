/**
 * The Reports screen, opened (plan §4.11, Slice 3 item 3.1).
 *
 * Every failure guarded here is a thing that was *true and invisible*. The
 * provenance behind every cited number was true only after a press; the export
 * refusal was a disabled button with an eleven-point footnote; the three files
 * a researcher comes to this screen to take away had no heading over them, so
 * the inventory ranked the snapshot among the capabilities nobody found while
 * looking straight at it; and `GET .../staleness` — the route that says whether
 * a .docx already sent still states the numbers the analyses produce — had no
 * caller at all.
 *
 * `tests/reports.test.tsx` covers re-cutting a talk and the drafting rule. This
 * file is only the opening, and it is written against the DOM rather than
 * against a spy: what these items changed is what a reader can see without
 * pressing anything, which is not a fact about which function was called.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportDetail, Reports, provenanceLine } from "@/components/reports";
import type { Artifact, ArtifactBlock, Citation, Connection } from "@/lib/api";
import { api } from "@/lib/api";

/*
 * Typed against the contract, because this suite has twice been sent chasing a
 * missing button that was really a fixture missing a field the component
 * iterates (`reports.test.tsx:21-29`).
 */
function citation(over: Partial<Citation> = {}): Citation {
  return {
    id: "cit_1", locator: "", entailment: "supported", entailment_detail: "",
    target_kind: "analysis_run", target: { id: "arun_1", method: "pearson_correlation" },
    ...over,
  };
}

function block(over: Partial<ArtifactBlock> = {}): ArtifactBlock {
  return {
    id: "blk_1", sequence: 1, block_type: "paragraph",
    text: "Consumption tracks resistance (r = 0.88).", notes: "",
    resolved: { r: 0.88 },
    value_provenance: [{ name: "r", source: "con_1", path: "estimate" }],
    citations: [citation()],
    ...over,
  };
}

function report(over: Partial<Artifact> = {}): Artifact {
  return {
    id: "art_1", title: "Antibiotic use and resistance", artifact_type: "report",
    purpose: "report the finding", status: "draft", version: 1,
    blocks: [block()], findings: [],
    integrity: { publishable: true, blocks_checked: 4, problems: [], warnings: [] },
    renders: [],
    ...over,
  };
}

const STALENESS = {
  artifact_id: "art_1", title: "Antibiotic use and resistance",
  live_hash: "abc", drifted: [],
  renders: [
    { id: "ren_1", fmt: "docx", storage_key: "k1", resolved_hash: "old",
      artifact_version: 1, created_at: "2026-09-01T00:00:00Z",
      state: "values_changed",
      detail: "The values in this export no longer match what the analyses say." },
    { id: "ren_2", fmt: "pdf", storage_key: "k2", resolved_hash: "abc",
      artifact_version: 1, created_at: "2026-09-02T00:00:00Z",
      state: "current",
      detail: "Every value in this export matches what the analyses say now." },
  ],
  note: "1 export (docx) states values the analyses no longer produce.",
};

/** Answers by path, so the artifact and its staleness are separate answers. */
function serve(artifact: Artifact = report(), staleness: unknown = STALENESS) {
  return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (String(path).endsWith("/staleness")) return staleness as never;
    return artifact as never;
  });
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(cleanup);

describe("what a block's provenance amounts to, before any press", () => {
  it("names the method when the block's citations name exactly one", () => {
    expect(provenanceLine({
      value_provenance: [
        { name: "r", source: "con_1", path: "estimate" },
        { name: "n", source: "con_1", path: "sample_size" },
        { name: "p", source: "con_1", path: "p_value" },
      ],
      citations: [citation(), citation({ id: "cit_2" })],
    })).toBe("3 values from pearson correlation · 2 citations, all supported");
  });

  it("refuses to name a method when two are behind one block", () => {
    /*
     * "3 values from pearson correlation" under a sentence half of whose
     * numbers came from a regression is a false attribution, and a quiet one:
     * it reads like provenance and is a guess.
     */
    expect(provenanceLine({
      value_provenance: [{ name: "r", source: "con_1", path: "estimate" }],
      citations: [
        citation(),
        citation({ id: "cit_2", target: { id: "arun_2", method: "linear_regression" } }),
      ],
    })).toBe("1 value read from recorded rows · 2 citations, all supported");
  });

  it("prints unverified without waiting to be asked", () => {
    // The word the item is named for. A reference list that showed only the
    // checked ones would imply the rest had passed.
    expect(provenanceLine({
      value_provenance: [],
      citations: [citation(), citation({ id: "cit_2", entailment: "unverified" })],
    })).toBe("2 citations, 1 unverified");
  });

  it("names every entailment other than supported, not only unverified", () => {
    /*
     * `unsupported` is the alarming one and it is not the word §4.11.1 wrote
     * out. A footer that printed only the example's word would repeat the
     * defect it exists to fix.
     */
    expect(provenanceLine({
      value_provenance: [],
      citations: [
        citation({ id: "a", entailment: "unverified" }),
        citation({ id: "b", entailment: "unsupported" }),
        citation({ id: "c", entailment: "not_checkable" }),
      ],
    })).toBe("3 citations, 1 unverified, 1 unsupported, 1 not checkable");
  });

  it("says so when a block has values and no citations, and stays silent for a bare heading", () => {
    expect(provenanceLine({
      value_provenance: [{ name: "r", source: "con_1", path: "estimate" }],
      citations: [],
    })).toBe("1 value read from recorded rows");
    expect(provenanceLine({ value_provenance: [], citations: [] })).toBe("");
  });

  it("renders on the block itself with nothing pressed", async () => {
    // C21. The chain stays one press away; the line above it does not.
    serve(report({ blocks: [block({
      citations: [citation(), citation({ id: "cit_2", entailment: "unverified" })],
    })] }));
    render(<ReportDetail artifactId="art_1" projectId="prj_1" onOpenArtifact={() => {}} />);

    expect(await screen.findByText(/2 citations, 1 unverified/)).toBeTruthy();
    // And the chain is still there, still layered, not removed.
    expect(screen.getByRole("button", { name: /Where this came from/ })).toBeTruthy();
    expect(screen.queryByText(/Read from the recorded row when this page loaded/))
      .toBeNull();
  });
});

describe("the export refusal", () => {
  it("is a sentence naming the problems, not four buttons that cannot be pressed", async () => {
    /*
     * The rule is unchanged — a file outlives the warning that would have
     * accompanied it on screen. What is guarded is its shape: a disabled
     * control is the one form of refusal this codebase rejects everywhere
     * else, and a reader who has scrolled to Export is asking which block is
     * wrong, not being pointed back up the page.
     */
    serve(report({ integrity: {
      publishable: false, blocks_checked: 4,
      problems: [{ block_id: "blk_1", kind: "missing_run",
                   detail: "references a run that is gone" }],
      warnings: [] } }));
    render(<ReportDetail artifactId="art_1" projectId="prj_1" onOpenArtifact={() => {}} />);

    const refusal = await screen.findByText(/Export is blocked/);
    expect(refusal.textContent).toMatch(/missing run/);
    expect(refusal.textContent).toMatch(/references a run that is gone/);
    expect(screen.queryByRole("button", { name: "docx" })).toBeNull();
  });

  it("offers the formats once the check passes", async () => {
    serve(report());
    render(<ReportDetail artifactId="art_1" projectId="prj_1" onOpenArtifact={() => {}} />);

    const docx = await screen.findByRole("button", { name: "docx" });
    expect((docx as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Export is blocked/)).toBeNull();
  });

  it("still refuses honestly when the server named no block", async () => {
    // `publishable: false` with an empty list. An empty bullet list under a
    // promise of one is worse than saying the check named nothing.
    serve(report({ integrity: {
      publishable: false, blocks_checked: 4, problems: [], warnings: [] } }));
    render(<ReportDetail artifactId="art_1" projectId="prj_1" onOpenArtifact={() => {}} />);

    expect((await screen.findByText(/Export is blocked/)).textContent)
      .toMatch(/named no block/);
  });
});

describe("the exports of this document", () => {
  it("names each format and whether it still reflects the analyses", async () => {
    // §4.11.4 — the route had no caller, so `resolved_hash` was written on
    // every render since the schema was laid down and compared to nothing.
    serve();
    render(<ReportDetail artifactId="art_1" projectId="prj_1" onOpenArtifact={() => {}} />);

    const panel = (await screen.findByText(/Exported copies of this document/))
      .closest("div") as HTMLElement;
    expect(within(panel).getByText("docx")).toBeTruthy();
    expect(within(panel).getByText("values changed")).toBeTruthy();
    expect(within(panel).getByText("current")).toBeTruthy();
  });

  it("asks the project-scoped route the server actually exposes", async () => {
    const get = serve();
    render(<ReportDetail artifactId="art_1" projectId="prj_1" onOpenArtifact={() => {}} />);

    await waitFor(() => expect(get).toHaveBeenCalledWith(
      "/api/projects/prj_1/artifacts/art_1/staleness"));
  });

  it("renders nothing at all rather than claiming the copies are unchecked", async () => {
    /*
     * Without a project id the route cannot be called. "Could not be checked"
     * is a claim about the exported copies; the truth here is a claim about
     * the wiring, and `artifact_staleness.py` exists precisely to stop those
     * two being confused.
     */
    const get = serve();
    render(<ReportDetail artifactId="art_1" onOpenArtifact={() => {}} />);

    await screen.findByRole("heading", { name: /The report/ });
    expect(screen.queryByText(/Exported copies of this document/)).toBeNull();
    expect(get.mock.calls.map(([path]) => path)).not.toContain(
      "/api/projects/prj_1/artifacts/art_1/staleness");
  });

  it("re-reads after a fresh export, so it is not itself stale", async () => {
    // The one moment a reader is watching this panel is directly after
    // pressing a format, and that press is exactly what changes its answer.
    const get = serve();
    vi.spyOn(api, "post").mockResolvedValue({ storage_key: "k3", byte_size: 2048 } as never);
    render(<ReportDetail artifactId="art_1" projectId="prj_1" onOpenArtifact={() => {}} />);

    await screen.findByText(/Exported copies of this document/);
    const before = get.mock.calls.filter(([p]) => String(p).endsWith("/staleness")).length;

    await userEvent.click(screen.getByRole("button", { name: "docx" }));
    await waitFor(() => expect(
      get.mock.calls.filter(([p]) => String(p).endsWith("/staleness")).length,
    ).toBeGreaterThan(before));
  });
});

describe("the three take-aways have a name over them", () => {
  const connections = {
    data: [] as Connection[], error: null, loading: false, reload: () => {},
  };

  /*
   * Answers by path. A stub that returned `[]` for everything took the whole
   * screen down inside `CitationHealth`, which reads `by_entailment` — and the
   * failure reported itself as "the heading is not there", which is never what
   * it is (`tests/setup.ts:128-132` says so in its own words).
   */
  const health = {
    total: 0, resolved: 0, dangling: [], by_entailment: {},
    note: "Nothing is cited yet.",
  };
  const serveReports = () => vi.spyOn(api, "get").mockImplementation(
    async (path: string) => (String(path).endsWith("/citations/verify")
      ? health : []) as never);

  it("puts the results table, the bibliography and the snapshot in one named block", async () => {
    /*
     * C21: a control named /results\.csv|snapshot/i is visible on the Reports
     * screen without opening a report. All three were already on the screen
     * and read as more of the citation-integrity readout above them, which is
     * how the inventory ranked them unfound (§6 rank 8) while they were in
     * plain sight.
     */
    serveReports();
    render(<Reports projectId="prj_1" connections={connections} onSelect={() => {}} />);

    const block = (await screen.findByRole("heading", { name: /Take this away/ }))
      .closest("section") as HTMLElement;
    expect(within(block).getByRole("link", { name: /download the results table/i })
      .getAttribute("href")).toBe("/api/projects/prj_1/results.csv");
    expect(within(block).getByRole("link", { name: /download the snapshot/i })
      .getAttribute("href")).toBe("/api/projects/prj_1/snapshot.zip");
    expect(within(block).getByRole("button", { name: /Show the .bib/ })).toBeTruthy();
  });

  it("keeps the sentence that refuses to call the snapshot a backup", async () => {
    // The honest note is the reason the block is worth having; a heading that
    // arrived at the cost of it would be a bad trade.
    serveReports();
    render(<Reports projectId="prj_1" connections={connections} onSelect={() => {}} />);

    expect(await screen.findByText(/not a backup to restore from/)).toBeTruthy();
  });
});
