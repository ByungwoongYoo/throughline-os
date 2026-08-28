/**
 * What this project calls things (§ harmonization).
 *
 * Six routes here and the interface called one: it read the approved labels
 * and nothing could propose a label or approve one, so the approved set was
 * empty in every project for ever. The figures screen asks for those labels to
 * title its axes and always got none, which is why every chart in this system
 * reads `resistance_pct`.
 *
 * The property these tests protect is that nothing is applied until a person
 * approves it. An unreviewed label is a model's guess about somebody else's
 * data, and a screen that showed it as fact would put words in the
 * researcher's mouth and then let them publish the result.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Variables, confidenceReads } from "@/components/variables";
import { ApiError, api } from "@/lib/api";

const VARIABLES = {
  labels: {},
  pending: [
    { mapping_id: "vm_1", confidence: 0.42, column_name: "res_pct",
      semantic_type: "ratio", canonical_name: "resistance",
      display_label: "Resistance", definition: "Share of isolates resistant.",
      canonical_unit: "%" },
    { mapping_id: "vm_2", confidence: 0.91, column_name: "ddd",
      semantic_type: "ratio", canonical_name: "consumption",
      display_label: "Antibiotic consumption", definition: null,
      canonical_unit: "DDD" },
  ],
  equivalent: {},
  note: "Only approved labels are used anywhere.",
};

const VOCABULARY = {
  pending: [{ id: "va_1", alias: "AMR", origin: "paper",
              canonical_label: "Resistance", canonical_name: "resistance" }],
  canonical_variables: 2, approved_aliases: 0,
  times_an_alias_resolved_a_term: 0,
  note: "This project's vocabulary grows as you confirm what terms mean.",
};

const SOURCES = [{ id: "src_1", title: "amr.csv",
                   dataset: { dataset_version_id: "dsv_1" } }];

function serve(over: Record<string, unknown> = {}) {
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (String(path).endsWith("/variables")) return (over.variables ?? VARIABLES) as never;
    if (String(path).endsWith("/vocabulary")) return (over.vocabulary ?? VOCABULARY) as never;
    if (String(path).endsWith("/sources")) return (over.sources ?? SOURCES) as never;
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("nothing is applied until a person approves it", () => {
  it("shows the server's own statement of that", async () => {
    serve();
    render(<Variables projectId="prj_1" />);
    expect(await screen.findByText(/Only approved labels are used anywhere/))
      .toBeTruthy();
  });

  it("says raw column names are showing while nothing is approved", async () => {
    serve({ variables: { ...VARIABLES, pending: [] } });
    render(<Variables projectId="prj_1" />);
    expect(await screen.findByText(/every screen shows the raw column names/))
      .toBeTruthy();
  });

  it("approves one mapping, by id", async () => {
    serve();
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    render(<Variables projectId="prj_1" />);

    const first = (await screen.findAllByText("res_pct"))[0].closest(".card")!;
    await userEvent.click(within(first as HTMLElement)
      .getByRole("button", { name: /Use this label/ }));

    expect(post).toHaveBeenCalledWith(
      "/api/variable-mappings/vm_1/decide", { approve: true });
  });

  it("rejects with a decision, not by ignoring it", async () => {
    // A reviewer's "no" is kept, so the same suggestion is not re-offered as
    // though it had never been considered.
    serve();
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    render(<Variables projectId="prj_1" />);

    const first = (await screen.findAllByText("res_pct"))[0].closest(".card")!;
    await userEvent.click(within(first as HTMLElement)
      .getByRole("button", { name: /^Reject$/ }));

    expect(post).toHaveBeenCalledWith(
      "/api/variable-mappings/vm_1/decide", { approve: false });
  });
});

describe("the review order", () => {
  it("keeps the server's order and says why it is that order", async () => {
    /*
     * Least confident first: those are the ones that need a person, and a
     * screen that sorted them alphabetically would bury them.
     */
    serve();
    render(<Variables projectId="prj_1" />);
    expect(await screen.findByText(/Least confident first/)).toBeTruthy();

    const columns = screen.getAllByText(/^(res_pct|ddd)$/).map((n) => n.textContent);
    expect(columns).toEqual(["res_pct", "ddd"]);
  });

  it("reads a confidence as a percentage, and says when there is none", () => {
    expect(confidenceReads(0.42)).toBe("42% confident");
    expect(confidenceReads(1)).toBe("100% confident");
    expect(confidenceReads(null)).toBe("no confidence recorded");
    expect(confidenceReads(Number.NaN)).toBe("no confidence recorded");
  });
});

describe("proposing labels", () => {
  it("asks the model to read a dataset's columns", async () => {
    serve();
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    render(<Variables projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /Suggest labels/ }));
    expect(post).toHaveBeenCalledWith("/api/dataset-versions/dsv_1/propose-labels");
  });

  it("says what the server said when no model is configured", async () => {
    /*
     * Proposing needs a model, and this is the failure a researcher can
     * actually act on. "Could not propose labels" would tell them nothing.
     */
    serve();
    vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(503, "No model provider is configured on this machine."));
    render(<Variables projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /Suggest labels/ }));
    expect(await screen.findByText(/No model provider is configured/)).toBeTruthy();
  });

  it("does not offer to read columns when there is no dataset", async () => {
    serve({ sources: [] });
    render(<Variables projectId="prj_1" />);
    expect(await screen.findByText(/No dataset to read/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Suggest labels/ })).toBeNull();
  });
});

describe("the vocabulary", () => {
  it("decides an alias with a status, not a boolean", async () => {
    // This route's shape differs from the label decision beside it, and
    // sending the wrong one would be accepted as a validation error rather
    // than doing what the reviewer asked.
    serve();
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    render(<Variables projectId="prj_1" />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Yes, that is what it means/ }));
    expect(post).toHaveBeenCalledWith(
      "/api/vocabulary/va_1/decide", { status: "approved" });
  });

  it("rejects with a status too", async () => {
    serve();
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    render(<Variables projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /^No$/ }));
    expect(post).toHaveBeenCalledWith(
      "/api/vocabulary/va_1/decide", { status: "rejected" });
  });

  it("repeats what does not learn, rather than only what does", async () => {
    /*
     * The claim this system must never make is that its judgements drift with
     * use. The server says so in its own words and the screen carries them.
     */
    serve();
    render(<Variables projectId="prj_1" />);
    expect(await screen.findByText(/vocabulary grows as you confirm what terms mean/))
      .toBeTruthy();
  });

  it("reports how often the vocabulary has actually helped", async () => {
    // So "it improves as you use it" can be checked rather than believed.
    serve({ vocabulary: { ...VOCABULARY, approved_aliases: 3,
                          times_an_alias_resolved_a_term: 7 } });
    render(<Variables projectId="prj_1" />);
    expect(await screen.findByText(/resolved a term 7 times/)).toBeTruthy();
  });
});

describe("the harmonization payoff", () => {
  it("names columns that measure the same thing across datasets", async () => {
    serve({ variables: { ...VARIABLES,
      equivalent: { resistance: ["res_pct", "resistance_percent"] } } });
    render(<Variables projectId="prj_1" />);

    expect(await screen.findByText(/Columns measuring the same thing/)).toBeTruthy();
    expect(screen.getByText(/res_pct · resistance_percent/)).toBeTruthy();
  });

  it("says nothing about equivalence when none has been established", async () => {
    serve();
    render(<Variables projectId="prj_1" />);
    await screen.findByText(/Column labels/);
    expect(screen.queryByText(/Columns measuring the same thing/)).toBeNull();
  });
});
