/**
 * "How was this made?"
 *
 * The screen that answers LAW 1 for a researcher — the derivation chain from a
 * number back to the rows and the code that produced it — had no test of any
 * kind, and one sentence in it was a false provenance claim.
 *
 * It said "This is a source artifact — nothing was derived to make it" whenever
 * the ancestor list was empty. An analysis whose lineage edges were never
 * written looks identical from there, so the sentence reported the record as
 * *complete* rather than *missing* — the flattering direction, on the one
 * screen whose whole job is not to flatter. This project has already shipped
 * that exact failure once: `findings.object_id` was never set by either caller,
 * so the evidence graph returned claims and nothing else, always, and looked
 * fine doing it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyChain, ProvenanceChain } from "@/components/views";
import type { Provenance } from "@/lib/api";
import { ApiError, api } from "@/lib/api";

const DERIVED: Provenance = {
  artifact: { id: "obj_run", object_type: "analysis",
              title: "pearson_correlation — consumption × resistance",
              created_at: "2026-01-01T00:00:00Z" },
  direct_inputs: [{ source_artifact_id: "obj_dsv", lineage_type: "calculated_from" }],
  ancestors: [
    { artifact_id: "obj_dsv", depth: 1, object_type: "dataset",
      title: "amr.csv v1" },
    { artifact_id: "obj_src", depth: 2, object_type: "paper",
      title: "Karim 2019" },
  ],
  origin: "derived",
};

function serve(over: Partial<Provenance> = {}) {
  return vi.spyOn(api, "get").mockResolvedValue({ ...DERIVED, ...over } as never);
}

beforeEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// An empty chain is not one thing
// ---------------------------------------------------------------------------

describe("what an empty chain is allowed to claim", () => {
  it("does not call a derived artifact a source when nothing explains it", async () => {
    /*
     * The defect. An analysis is made from a dataset by construction, so an
     * empty chain under one means the derivation was never written down — and
     * saying "nothing was derived to make it" states the opposite.
     */
    serve({ ancestors: [], origin: "unrecorded" });
    render(<ProvenanceChain objectId="obj_run" />);

    // Wait on what must *appear*, never on what is absent: "no 'source
    // artifact' on screen" is already true while the skeleton is up, so
    // waiting for it returned on the first tick and the assertion below raced
    // the fetch. Green on an idle machine, red under load — which is how it
    // failed, in preflight, on a run that had nothing to do with this file.
    // The test two below already knows this hazard in its role-based form.
    expect(await screen.findByText(/was not written down/)).toBeTruthy();
    expect(screen.queryByText(/source artifact/)).toBeNull();
  });

  it("reads as a gap rather than as an answer", async () => {
    // A missing chain is a question about the record. Rendered as a quiet
    // footnote it reads as a property of the artifact.
    serve({ ancestors: [], origin: "unrecorded" });
    render(<ProvenanceChain objectId="obj_run" />);

    // Found by its words first: the loading skeleton also carries role=status,
    // so asking for the role alone resolves before the chain has arrived.
    const said = await screen.findByText(/Something did/);
    expect(said.getAttribute("role")).toBe("status");
  });

  it("says the chain legitimately starts here for something uploaded", async () => {
    serve({
      artifact: { ...DERIVED.artifact, object_type: "dataset", title: "amr.csv" },
      ancestors: [], origin: "uploaded",
    });
    render(<ProvenanceChain objectId="obj_dsv" />);

    expect(await screen.findByText(/came into the project from outside/)).toBeTruthy();
    expect(screen.queryByText(/was not written down/)).toBeNull();
  });

  it("guesses neither way when the server did not say", () => {
    /*
     * An older server sends no origin. Picking one would be exactly how the
     * original sentence came to be there.
     */
    render(<EmptyChain origin={undefined} />);

    const text = document.body.textContent!;
    expect(text).toMatch(/No derivation is recorded/);
    expect(text).not.toMatch(/source artifact/);
    expect(text).not.toMatch(/came into the project from outside/);
  });

  it("distinguishes the three cases rather than describing them alike", () => {
    const said = (origin?: string) => {
      const { container } = render(<EmptyChain origin={origin} />);
      return container.textContent;
    };
    expect(new Set([said("uploaded"), said("unrecorded"), said(undefined)]).size)
      .toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The chain itself
// ---------------------------------------------------------------------------

describe("a chain that was recorded", () => {
  it("names what the artifact was made from, deepest last", async () => {
    serve();
    render(<ProvenanceChain objectId="obj_run" />);

    expect(await screen.findByText(/amr.csv v1/)).toBeTruthy();
    expect(screen.getByText(/Karim 2019/)).toBeTruthy();
  });

  it("shows how far back each step is", async () => {
    // Depth is what makes this a chain rather than a list: a dataset one step
    // away and a paper two steps away are different claims about the number.
    serve();
    render(<ProvenanceChain objectId="obj_run" />);

    expect(await screen.findByText("depth 1")).toBeTruthy();
    expect(screen.getByText("depth 2")).toBeTruthy();
  });

  it("names the artifact being explained, so the chain has a subject", async () => {
    serve();
    render(<ProvenanceChain objectId="obj_run" />);
    expect(await screen.findByText(/pearson_correlation — consumption/)).toBeTruthy();
  });

  it("says nothing about a missing chain when there is one", async () => {
    serve();
    render(<ProvenanceChain objectId="obj_run" />);
    await screen.findByText(/amr.csv v1/);

    expect(screen.queryByText(/No derivation is recorded/)).toBeNull();
    expect(screen.queryByText(/was not written down/)).toBeNull();
  });

  it("asks the server for the artifact it was given", async () => {
    const get = serve();
    render(<ProvenanceChain objectId="obj_seven" />);
    await waitFor(() => expect(get)
      .toHaveBeenCalledWith("/api/objects/obj_seven/provenance"));
  });

  it("reports a failure rather than an empty chain", async () => {
    /*
     * A chain that could not be read must not render as a chain with nothing
     * in it — that is the same conflation the origin field exists to end.
     */
    vi.spyOn(api, "get").mockRejectedValue(new ApiError(404, "Artifact not found."));
    render(<ProvenanceChain objectId="obj_gone" />);

    expect(await screen.findByText(/Artifact not found/)).toBeTruthy();
    expect(screen.queryByText(/No derivation is recorded/)).toBeNull();
  });
});
