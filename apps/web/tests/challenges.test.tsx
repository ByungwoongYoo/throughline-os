/**
 * The critic's argument against a finding.
 *
 * The critic already ran, recorded a verdict, and could move a finding's
 * lifecycle — invisibly. A researcher saw a finding quietly marked weaker with
 * no way to ask why, which is the system taking the judgement and keeping the
 * argument: the failure the critic exists to prevent rather than perform.
 *
 * So what is tested is not that challenges render. It is that the *reasoning*
 * does, that an absence of criticism is never dressed up as endorsement, and
 * that a verdict with no working behind it says so rather than looking like a
 * display bug.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError, api } from "@/lib/api";
import { Challenges } from "@/components/challenges";
import * as useApiModule from "@/lib/useApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function serve(data: unknown, extra: Record<string, unknown> = {}) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue({
    data, error: null, loading: false, reload: vi.fn(), ...extra,
  } as never);
}

const WEAKENED = {
  id: "chal_1",
  verdict: "weakens",
  summary: "The effect does not survive the outlier being removed.",
  probes: [
    { name: "outlier_sensitivity", outcome: "fails",
      detail: "Dropping the single largest residual removes the effect." },
    { name: "assumption_normality", outcome: "passes", detail: "" },
  ],
  lifecycle_before: "validated",
  lifecycle_after: "candidate",
  created_at: "2026-08-15T10:00:00Z",
  finished_at: "2026-08-15T10:00:04Z",
};

describe("showing the argument, not only the verdict", () => {
  it("shows the checks that produced the verdict", () => {
    /**
     * The reason this component exists. A conclusion without its working is
     * something a researcher either accepts or ignores, and neither is what
     * they should do with it.
     */
    serve({ finding_id: "fnd_1", challenges: [WEAKENED], note: "1 challenge recorded." });
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);

    expect(screen.getByText("outlier_sensitivity")).toBeInTheDocument();
    expect(screen.getByText(/Dropping the single largest residual/)).toBeInTheDocument();
  });

  it("shows the lifecycle change the challenge caused", () => {
    /** The moment the system acted on its own argument. */
    serve({ finding_id: "fnd_1", challenges: [WEAKENED], note: "note" });
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);

    expect(screen.getByText(/moved validated → candidate/)).toBeInTheDocument();
  });

  it("does not report a lifecycle change when nothing moved", () => {
    serve({
      finding_id: "fnd_1",
      challenges: [{ ...WEAKENED, verdict: "holds",
                     lifecycle_before: "validated", lifecycle_after: "validated" }],
      note: "note",
    });
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);

    // Matched on the arrow, not the word: "moved" also appears inside
    // "removed" in the summary, which made this pass for the wrong reason.
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it("keeps the critic's own vocabulary rather than a severity scale", () => {
    /**
     * "holds", "weakens", "uncertain" and "disappears" are more precise than
     * any three-colour mapping, and turning "uncertain" amber teaches a reader
     * to scan for red instead of reading the sentence.
     */
    serve({
      finding_id: "fnd_1",
      challenges: [{ ...WEAKENED, verdict: "uncertain" }],
      note: "note",
    });
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);

    expect(screen.getByText("uncertain")).toBeInTheDocument();
  });
});

describe("what an absence means", () => {
  it("does not present an unchallenged finding as a sound one", () => {
    /**
     * "Nobody has argued against this" and "this survived criticism" are
     * different statements, and conflating them is how a finding acquires
     * authority nobody gave it.
     */
    serve({ finding_id: "fnd_1", challenges: [], note: "none" });
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);

    expect(screen.getByText(/not the same as it having survived one/))
      .toBeInTheDocument();
  });

  it("says so when a verdict arrived with no checks behind it", () => {
    /**
     * Otherwise an unargued verdict is indistinguishable from a component that
     * failed to render its probes.
     */
    serve({
      finding_id: "fnd_1",
      challenges: [{ ...WEAKENED, probes: [] }],
      note: "note",
    });
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);

    expect(screen.getByText(/recorded a verdict without the checks behind it/))
      .toBeInTheDocument();
  });
});

describe("loading and failure", () => {
  it("says what it is reading rather than spinning", () => {
    serve(null, { loading: true });
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);
    expect(screen.getByText(/what has been argued against this/)).toBeInTheDocument();
  });

  it("reports a failure instead of an empty, reassuring panel", () => {
    /**
     * The dangerous shape: the request fails, nothing renders, and the finding
     * reads as unchallenged when the truth is that nobody could look.
     */
    serve(null, { error: new Error("Database unreachable"), loading: false });
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing has challenged/)).not.toBeInTheDocument();
  });
});

describe("starting a challenge", () => {
  it("offers to run one when nothing has argued against the finding", async () => {
    /*
     * The empty state said "no critic has run against it yet — that is not the
     * same as it having survived one", and nothing could change that. The
     * screen displayed an adversarial process nobody could start.
     */
    serve({ finding_id: "fnd_1", challenges: [], note: "" });
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);
    expect(await screen.findByRole("button", { name: /Argue against/ })).toBeTruthy();
  });

  it("asks the critic to run against this finding", async () => {
    serve({ finding_id: "fnd_1", challenges: [], note: "" });
    const post = vi.spyOn(api, "post").mockResolvedValue({ status: "queued" });
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);

    fireEvent.click(await screen.findByRole("button", { name: /Argue against/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/findings/fnd_1/challenge", { confounders: [] }));
  });

  it("says what the server said when the critic cannot be started", async () => {
    serve({ finding_id: "fnd_1", challenges: [], note: "" });
    vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(404, "Finding not found."));
    render(<Challenges projectId="prj_1" findingId="fnd_1" />);

    fireEvent.click(await screen.findByRole("button", { name: /Argue against/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
