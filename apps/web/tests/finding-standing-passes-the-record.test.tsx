/**
 * The panel that reads a finding hands on what it read.
 *
 * `FindingLifecycle` is tested: give it `recordedChecks` and it shows them.
 * `FindingStanding` is the component the rail actually renders — it fetches
 * the finding and passes the pieces down — and no test named it. So the whole
 * feature depended on one prop being forwarded, and dropping that prop would
 * have left every existing test green with nothing on the screen.
 *
 * This codebase has found that shape twice already: a well-tested component
 * whose caller computed the wrong flag, and a helper that was right and never
 * called.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindingStanding } from "@/components/lifecycle";
import { api } from "@/lib/api";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

const FINDING = {
  id: "fnd_1",
  lifecycle_status: "exploratory",
  evidence: { total: 2 },
  recorded_checks: {
    robustness: { outcome: "violated", detail: "the residuals fan out" },
  },
  history: [],
};

function serve(over: Record<string, unknown> = {}) {
  vi.spyOn(api, "get").mockResolvedValue({ ...FINDING, ...over } as never);
  render(<FindingStanding findingId="fnd_1" />);
}

describe("the finding standing panel", () => {
  it("reads the finding and says where it stands", async () => {
    serve();
    expect(await screen.findByText(/exploratory/i)).toBeTruthy();
  });

  it("passes the recorded checks down to the promotion form", async () => {
    serve();
    (await screen.findByRole("button", { name: /validated/i })).click();
    await waitFor(() =>
      expect(screen.getByText(/recorded this as violated/i)).toBeTruthy());
    expect(screen.getByText(/the residuals fan out/)).toBeTruthy();
  });

  it("works for a finding the system observed nothing about", async () => {
    serve({ recorded_checks: {} });
    (await screen.findByRole("button", { name: /validated/i })).click();
    await waitFor(() =>
      expect(screen.getByText(/Robustness checks/i)).toBeTruthy());
    expect(screen.queryByText(/recorded this as violated/i)).toBeNull();
  });

  it("reports the evidence it was given", async () => {
    serve();
    expect(await screen.findByText(/2 pieces of linked evidence/)).toBeTruthy();
  });
});
