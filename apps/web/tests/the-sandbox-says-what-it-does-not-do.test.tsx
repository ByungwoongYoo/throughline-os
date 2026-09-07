/**
 * What "this runs in the sandbox" means (§ a claim with nothing behind it).
 *
 * `policy_report()` composes an unusually honest account of the analysis
 * sandbox — what is enforced, what is only best-effort, what is not attempted
 * at all — and its own docstring says every value there was once a hardcoded
 * `True` beside a real `platform.system()`, "the one shape of dishonesty this
 * file exists to prevent". The report is stored with every run and served on
 * every capabilities request.
 *
 * Nothing displayed it. `Capabilities.analysis.isolation` was typed as
 * `Record<string, unknown>` — an opaque bag no component could render — so a
 * researcher deciding whether to run an analysis over data they were trusted
 * with could not learn that the filesystem isolation is not kernel-level, or
 * that blocking network egress happens in Python and a determined library can
 * step around it. The form told them "this runs in the sandbox" and offered no
 * way to ask what that was.
 *
 * The ordering is the substance of these tests. Eleven enforced controls listed
 * first would read as reassurance; the two that are missing are the only reason
 * to open it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { RunAnalysis } from "@/components/runanalysis";
import { api } from "@/lib/api";

const POLICY = {
  platform: "Darwin",
  mechanism: "posix_rlimit_process_group",
  enforced: { separate_process: true, no_shell: true, cpu_limit: true },
  best_effort: { network_egress_disabled: "python_level_only" },
  not_enforced: { kernel_level_filesystem_isolation: true, gpu_quota: true },
  limits: { timeout_seconds: 120, memory_mb: 2048, cpu_seconds: 120 },
  note: "Process-level isolation suitable for the platform's own declarative "
      + "analysis methods. Arbitrary or model-authored code requires container "
      + "isolation and is refused until that exists.",
};

const CAPABILITIES = {
  retrieval: { lexical: true, semantic: false, model: null, note: null },
  analysis: {
    sandbox: true, methods: ["t_test"],
    method_variables: { t_test: [{ role: "outcome", takes: "one" }] },
    isolation: POLICY,
  },
  llm: { configured: false, note: "" },
};

/* The real `Source` shape: the form filters on `s.dataset`, not on a kind. */
const SOURCES = [{
  id: "s1", title: "trial.csv", source_type: "upload",
  ingestion_status: "ready", ingestion_detail: "", trust_level: "verified",
  created_at: "2026-01-01T00:00:00Z",
  dataset: {
    dataset_id: "d1", dataset_version_id: "v1", version: 1,
    row_count: 120, column_count: 6, quality_report: {},
  },
}];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Open the form, which is where the claim is made. */
async function openForm() {
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.includes("capabilities")) return CAPABILITIES;
    if (path.includes("sources")) return SOURCES;
    return [];
  });
  render(<RunAnalysis projectId="p1" />);
  // The form is behind a button; the claim being tested is inside the form.
  fireEvent.click(screen.getByRole("button", { name: /specify an analysis/i }));
  await waitFor(() => expect(document.querySelector(".sandbox-policy")).toBeTruthy());
  return document.querySelector(".sandbox-policy") as HTMLElement;
}

describe("the form says what the sandbox does not do", () => {
  it("shows the disclosure at all", async () => {
    const panel = await openForm();
    expect(panel.textContent).toMatch(/what it does not protect against/i);
  });

  it("names what is not attempted", async () => {
    const panel = await openForm();
    expect(panel.textContent).toMatch(/kernel level filesystem isolation/i);
    expect(panel.textContent).toMatch(/gpu quota/i);
  });

  it("marks the control that is only best-effort as only best-effort", async () => {
    /*
     * The most important line in the report. "Network egress disabled" read
     * alone is a guarantee; "python level only" is the truth, and the gap
     * between them is what a researcher handling data under an agreement needs.
     */
    const panel = await openForm();
    expect(panel.textContent).toMatch(/attempted, not guaranteed/i);
    expect(panel.textContent).toMatch(/network egress disabled/i);
    expect(panel.textContent).toMatch(/python level only/i);
  });

  it("puts the limits before the reassurance", async () => {
    const text = (await openForm()).textContent ?? "";
    expect(text.indexOf("Not attempted"))
      .toBeLessThan(text.indexOf("Enforced"));
  });

  it("carries the refusal for code it will not run", async () => {
    const panel = await openForm();
    expect(panel.textContent).toMatch(/refused until that exists/i);
  });

  it("states the limits a run is held to", async () => {
    const panel = await openForm();
    expect(panel.textContent).toMatch(/120 seconds/);
    expect(panel.textContent).toMatch(/2048 MB/);
  });

  it("names the mechanism, so two machines can be compared", async () => {
    const panel = await openForm();
    expect(panel.textContent).toMatch(/posix rlimit process group/i);
    expect(panel.textContent).toMatch(/Darwin/);
  });
});

describe("an older server that reports less", () => {
  it("shows what it has rather than failing", async () => {
    /*
     * The same shape is stored with every run, so a historical run carries
     * whichever fields the version that wrote it knew about. A required field
     * would turn "this report grew" into a screen that will not render.
     */
    vi.spyOn(api, "get").mockImplementation(async (path: string) => {
      if (path.includes("capabilities")) {
        return { ...CAPABILITIES, analysis: {
          ...CAPABILITIES.analysis,
          isolation: { not_enforced: { gpu_quota: true } },
        } };
      }
      if (path.includes("sources")) return SOURCES;
      return [];
    });
    render(<RunAnalysis projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /specify an analysis/i }));
    await waitFor(() =>
      expect(document.querySelector(".sandbox-policy")).toBeTruthy());
    const panel = document.querySelector(".sandbox-policy") as HTMLElement;
    expect(panel.textContent).toMatch(/gpu quota/i);
    expect(panel.textContent).not.toMatch(/undefined/);
  });
});
