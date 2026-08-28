/**
 * Finding ↔ finding, asked either way.
 *
 * This screen's own opening line says the sweep comes first "and the manual
 * picker is there for when they already have a suspicion". There was no
 * picker: `POST /projects/{id}/consistency` — which answers whether two
 * *named* results agree, and what would explain it if they do not — had no
 * caller anywhere. A researcher who already knew which two results bothered
 * them could not ask about them.
 *
 * The screen had no tests of any kind either.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Consistency } from "@/components/consistency";
import type { VerdictBody } from "@/components/Verdict";
import { ApiError, api } from "@/lib/api";

/*
 * Typed, so the compiler holds the fixture to the contract.
 *
 * An untyped object literal here silently omitted `still_possible`, and the
 * card reads `.length` on it — so the screen rendered nothing at all and the
 * test reported only that it could not find a combobox. The server always
 * sends the field (every one of these is a dataclass list with a default), so
 * the component is right and the fixture was lying about the shape.
 */
const verdict: VerdictBody = {
  outcome: "F7", outcome_name: "Genuine disagreement",
  family: "contradicted", family_label: "Contradicted",
  tone: "warn", sentence: "These two results disagree.",
  guidance: "Report both.", reason_code: "R12", confidence: 0.8,
  evidence_refs: ["conn_1", "conn_2"], transform_log: [], caveats: [],
  remedies: [], still_possible: [], state: "settled",
  method: "pearson_correlation", pair: "conn_1/conn_2",
};

const side = (id: string) => ({
  id, variables: ["consumption_ddd", "resistance_pct"], direction: "positive",
  significant: true, method: "pearson_correlation",
  lifecycle_status: "exploratory", sample_size: 120,
  dataset: "amr.csv", dataset_version: 1,
});

const REPORT = {
  verdict, left: side("conn_1"), right: side("conn_2"),
  multiplicity: { tests_run: 12, survived_correction: 3 },
  checks_passed: ["staleness", "harmonisation", "dataset version"],
};

const SWEEP = {
  pairs_compared: 1, reports: [REPORT],
  multiplicity: { tests_run: 12 }, note: "Twelve comparisons in this project.",
};

const CONNECTIONS = [
  { id: "conn_1", left_variable: "consumption_ddd", right_variable: "resistance_pct",
    method: "pearson_correlation" },
  { id: "conn_2", left_variable: "consumption_ddd", right_variable: "resistance_pct",
    method: "spearman_correlation" },
];

function serve(over: Record<string, unknown> = {}) {
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (String(path).includes("/connections")) {
      return (over.connections ?? CONNECTIONS) as never;
    }
    return (over.sweep ?? SWEEP) as never;
  });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("asking about two in particular", () => {
  it("cannot ask whether a result agrees with itself", async () => {
    /*
     * The domain refuses it — "a result is trivially consistent with itself" —
     * and an interface that offers the question and then reports the refusal
     * has wasted the researcher's move. The chosen result is simply not in the
     * other list.
     */
    serve();
    render(<Consistency projectId="prj_1" />);
    const selects = await screen.findAllByRole("combobox");

    await userEvent.selectOptions(selects[0], "conn_1");
    const other = within(selects[1]).getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(other).toEqual(["conn_2"]);
  });

  it("asks the server about the two that were chosen", async () => {
    serve();
    const post = vi.spyOn(api, "post").mockResolvedValue(REPORT);
    render(<Consistency projectId="prj_1" />);
    const selects = await screen.findAllByRole("combobox");

    await userEvent.selectOptions(selects[0], "conn_1");
    await userEvent.selectOptions(selects[1], "conn_2");
    await userEvent.click(screen.getByRole("button", { name: /Are these consistent/ }));

    expect(post).toHaveBeenCalledWith("/api/projects/prj_1/consistency", {
      left_connection_id: "conn_1", right_connection_id: "conn_2",
    });
  });

  it("will not ask until both have been chosen", async () => {
    serve();
    const post = vi.spyOn(api, "post").mockResolvedValue(REPORT);
    render(<Consistency projectId="prj_1" />);
    const selects = await screen.findAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "conn_1");

    const ask = screen.getByRole("button", { name: /Are these consistent/ });
    expect((ask as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(ask);
    expect(post).not.toHaveBeenCalled();
  });

  it("shows what was ruled out, not only the verdict", async () => {
    /*
     * The list is the claim. A disagreement is real only because staleness,
     * harmonisation and the dataset version have been excluded first; asserted
     * without that, "these contradict" is two numbers side by side.
     */
    serve();
    vi.spyOn(api, "post").mockResolvedValue(REPORT);
    render(<Consistency projectId="prj_1" />);
    const selects = await screen.findAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "conn_1");
    await userEvent.selectOptions(selects[1], "conn_2");
    await userEvent.click(screen.getByRole("button", { name: /Are these consistent/ }));

    await waitFor(() => expect(screen.getAllByText("staleness").length)
      .toBeGreaterThan(0));
    expect(screen.getAllByText("harmonisation").length).toBeGreaterThan(0);
  });

  it("says what the server said when it refuses", async () => {
    serve();
    vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(400, "A result is trivially consistent with itself."));
    render(<Consistency projectId="prj_1" />);
    const selects = await screen.findAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "conn_1");
    await userEvent.selectOptions(selects[1], "conn_2");
    await userEvent.click(screen.getByRole("button", { name: /Are these consistent/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent)
      .toContain("trivially consistent with itself");
  });

  it("does not offer a pairing when there is nothing to pair", async () => {
    serve({ connections: [CONNECTIONS[0]] });
    render(<Consistency projectId="prj_1" />);
    await screen.findByText(/tested more than once/);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("one report reads the same however it was asked for", () => {
  it("renders a swept pair and a chosen pair through the same component", async () => {
    /*
     * The sweep used to have its own copy of this markup. Two copies of a
     * verdict drift, and then the same disagreement reads differently
     * depending on which question surfaced it — which is the one thing a
     * verdict must not do.
     */
    serve();
    vi.spyOn(api, "post").mockResolvedValue(REPORT);
    render(<Consistency projectId="prj_1" />);

    await screen.findByText(/tested more than once/);
    const fromSweep = screen.getAllByText("These two results disagree.").length;

    /*
     * Waited for, not assumed. The sweep and the list of results are two
     * separate requests, and the picker does not exist until the second one
     * lands — so reaching for the selects straight after the sweep text passed
     * alone and failed under the full suite, where the second request had not
     * resolved yet.
     */
    const selects = await screen.findAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "conn_1");
    await userEvent.selectOptions(selects[1], "conn_2");
    await userEvent.click(screen.getByRole("button", { name: /Are these consistent/ }));

    await waitFor(() => expect(
      screen.getAllByText("These two results disagree.").length)
      .toBe(fromSweep + 1));
  });
});
