/**
 * The screen that says what this installation cannot do, and offers to fix it.
 *
 * Exported for the same reason `FirstProject` was: T003 shipped a button that
 * no test could reach because the component was module-private, and the one
 * control between a researcher and a working capability is exactly the control
 * worth covering.
 *
 * What is being guarded here is not the layout. It is the two sentences a
 * researcher makes a decision on — **what is withheld** without the pack, and
 * **how large it is** — plus the wire between the button and the endpoint. A
 * pack list that renders beautifully and posts nowhere is the dead-button
 * defect this repository has already shipped once.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FeaturePacks } from "@/components/settings";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const PACKS = {
  speech: {
    installed: false,
    distribution: "throughline-domain",
    enables: "Transcribing recorded audio locally.",
    withheld_without_it: "Dictation is unavailable and typing is the alternative.",
    approximate_size: "**gigabytes** — it pulls in torch",
    install: "pip install 'throughline-domain[speech]'",
  },
  geo: {
    installed: true,
    distribution: "throughline-ingestion",
    enables: "Reading shapefiles.",
    withheld_without_it: "Geographic boundaries cannot be read.",
    approximate_size: "~2 MB",
    install: null,
  },
};

function stubFetch(bodies: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = Object.keys(bodies).find((k) => url.includes(k));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(key ? bodies[key] : {}),
      } as Response;
    });
}

describe("the feature packs screen", () => {
  it("lists every pack, installed or not", async () => {
    stubFetch({ capabilities: { packs: PACKS } });
    render(<FeaturePacks />);
    await waitFor(() => expect(screen.getByText("speech")).toBeTruthy());
    expect(screen.getByText("geo")).toBeTruthy();
  });

  it("says what is withheld, not only what is gained", async () => {
    /**
     * "Transcription unavailable" is a fact about the software. "Dictation is
     * unavailable and typing is the alternative" is a fact about the
     * researcher's day, and only the second one supports a decision.
     */
    stubFetch({ capabilities: { packs: PACKS } });
    render(<FeaturePacks />);
    await waitFor(() => expect(
      screen.getByText(/Dictation is unavailable/)).toBeTruthy());
  });

  it("shows the size before the download starts", async () => {
    /** speech pulls in torch. Somebody on a metered connection is entitled to
     *  know that in advance rather than afterwards. */
    stubFetch({ capabilities: { packs: PACKS } });
    render(<FeaturePacks />);
    await waitFor(() => expect(screen.getByText(/gigabytes/)).toBeTruthy());
  });

  it("offers no install button for something already installed", async () => {
    /** A button that runs a confirmed no-op teaches people to distrust buttons. */
    stubFetch({ capabilities: { packs: PACKS } });
    render(<FeaturePacks />);
    await waitFor(() => expect(screen.getByText("geo")).toBeTruthy());
    expect(screen.getAllByRole("button", { name: /Install/ })).toHaveLength(1);
  });

  it("shows the command beside the button, not instead of it", async () => {
    /** What somebody reads, pastes into an issue, or falls back to when the
     *  button fails on a machine nobody here can see. */
    stubFetch({ capabilities: { packs: PACKS } });
    render(<FeaturePacks />);
    await waitFor(() => expect(
      screen.getByText("pip install 'throughline-domain[speech]'")).toBeTruthy());
  });

  it("posts to the install endpoint for the pack that was clicked", async () => {
    const fetchSpy = stubFetch({ capabilities: { packs: PACKS } });
    render(<FeaturePacks />);
    await waitFor(() => expect(screen.getByText("speech")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Install/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/system/packs/speech/install",
      expect.objectContaining({ method: "POST" })));
  });

  it("renders nothing rather than an empty shell before the fetch lands", async () => {
    /** A "Feature packs" heading over no packs reads as "you have none". */
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}) as Promise<Response>);
    const { container } = render(<FeaturePacks />);
    expect(container.textContent).toBe("");
  });
});
