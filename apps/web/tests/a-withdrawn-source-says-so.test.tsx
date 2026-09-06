/**
 * A retracted source says so on its own page (§ sent on every request, declared nowhere).
 *
 * Harvesting marks a source withdrawn rather than deleting it — deleting would
 * destroy the reference *and* the evidence that it was withdrawn — and
 * `withdrawals.py` frames the question as "what of mine is now standing on
 * something withdrawn". The API sends `withdrawn_at` and `withdrawn_reason` on
 * every source. The `Source` type declared neither.
 *
 * So the harvest report announced a retraction once, at harvest time, to
 * whoever happened to be looking, and the one page about that source — the page
 * somebody opens while deciding whether to rest a finding on it — showed its
 * trust level, its ingestion status, and nothing at all.
 *
 * Found by the reverse contract check added in D210.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SourceDetail } from "@/components/views";
import { api } from "@/lib/api";

const SOURCE = (over: Record<string, unknown> = {}) => ({
  id: "src1", title: "Sleep and recall in undergraduates",
  source_type: "upload", ingestion_status: "ready", ingestion_detail: "",
  trust_level: "peer_reviewed", created_at: "2026-01-01T00:00:00Z",
  passage_count: 42, metadata: {}, paper: null, dataset: null,
  withdrawn_at: null, withdrawn_reason: null, ...over,
});

const show = (source: Record<string, unknown>) => {
  vi.spyOn(api, "get").mockResolvedValue(source);
  render(<SourceDetail projectId="p1" sourceId="src1" onDiscover={() => {}} />);
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("a source that was withdrawn upstream", () => {
  const WITHDRAWN = {
    withdrawn_at: "2026-06-01T00:00:00Z",
    withdrawn_reason: "Retracted by the journal: image duplication.",
  };

  it("says so", async () => {
    show(SOURCE(WITHDRAWN));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/withdrawn upstream/i);
  });

  it("gives the reason, because 'withdrawn' alone is not actionable", async () => {
    show(SOURCE(WITHDRAWN));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("image duplication");
  });

  it("is written above the status and the failure detail", () => {
    /*
     * Placement is the argument: a retraction changes what every finding
     * resting on this source is worth, so it outranks whether the file parsed.
     *
     * Asserted against the source rather than the DOM, and the reason is worth
     * recording. Three DOM attempts each gave an untrustworthy reading —
     * `container.textContent` and `container.innerHTML` came back empty while
     * `querySelector` on that same container found the element, and a
     * document-scoped version passed only because a previous test had left a
     * matching node behind. A failing render turned out to be an unflushed
     * state update rather than a defect, which is exactly the kind of thing an
     * unreliable instrument invents. Reading the order the JSX is written in
     * is weaker evidence, and it is evidence.
     */
    const view = readFileSync(
      join(__dirname, "..", "components", "views.tsx"), "utf8");
    const notice = view.indexOf('className="withdrawn"');
    const status = view.indexOf('<Status value={data.ingestion_status} />');
    const failure = view.indexOf('data.ingestion_status === "failed"');
    expect(notice, "no withdrawal notice in views.tsx").toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(-1);
    expect(failure).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(status);
    expect(notice).toBeLessThan(failure);
  });

  it("explains why it is still here", async () => {
    // A reader who sees a retracted source still listed needs to know that is
    // deliberate, or they will assume the system failed to remove it.
    show(SOURCE(WITHDRAWN));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent)
      .toMatch(/kept rather than deleted/i);
  });

  it("still says so when no reason was given", async () => {
    show(SOURCE({ withdrawn_at: "2026-06-01T00:00:00Z", withdrawn_reason: null }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/no reason was given/i);
  });
});

describe("a source in good standing", () => {
  it("says nothing about withdrawal", async () => {
    // A permanent "not withdrawn" notice would train a reader to skim past the
    // place a real one appears.
    show(SOURCE());
    await waitFor(() =>
      expect(screen.getByText(/Sleep and recall/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("survives a response that omits the fields", async () => {
    const source = SOURCE();
    delete (source as Record<string, unknown>).withdrawn_at;
    delete (source as Record<string, unknown>).withdrawn_reason;
    show(source);
    await waitFor(() =>
      expect(screen.getByText(/Sleep and recall/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
