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
      canonical_unit: "%", column_unit: "%" },
    { mapping_id: "vm_2", confidence: 0.91, column_name: "ddd",
      semantic_type: "ratio", canonical_name: "consumption",
      display_label: "Antibiotic consumption", definition: null,
      canonical_unit: "DDD", column_unit: "DDD" },
  ],
  equivalent: {},
  note: "Only approved labels are used anywhere.",
};

const VOCABULARY = {
  pending: [{ id: "va_1", alias: "AMR", origin: "paper",
              canonical_label: "Resistance", canonical_name: "resistance" }],
  canonical_variables: 2, approved_aliases: 0, rejected_aliases: 0,
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
      "/api/variable-mappings/vm_1/decide",
      // Sent explicitly, including when there is nothing to say. The column
      // records whether the numbers still need converting, and "not answered"
      // has to be distinguishable from "nobody was asked".
      { approve: true, transformation: null });
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
      "/api/variable-mappings/vm_1/decide", { approve: false, transformation: null });
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

  it("counts the suggestions it refused, not only the ones it took", async () => {
    /*
     * `rejected_aliases` was sent on every request and named by nothing, so
     * the line counted approvals and stayed silent about refusals. This
     * product treats a refusal as an answer everywhere else — five
     * comparability verdicts, a capability that says what it withholds, a
     * sandbox that lists what it does not enforce — and a vocabulary
     * reporting only its approvals is the one asymmetry it argues against.
     */
    serve({ vocabulary: { ...VOCABULARY, approved_aliases: 3,
                          rejected_aliases: 4 } });
    render(<Variables projectId="prj_1" />);
    expect(await screen.findByText(/3 approved · 4 refused/)).toBeTruthy();
  });

  it("says none were refused rather than omitting the count", async () => {
    // A count that appears only when non-zero teaches a reader that its
    // absence means nothing, when it means zero.
    serve({ vocabulary: { ...VOCABULARY, approved_aliases: 3,
                          rejected_aliases: 0 } });
    render(<Variables projectId="prj_1" />);
    expect(await screen.findByText(/3 approved · 0 refused/)).toBeTruthy();
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

// ---------------------------------------------------------------------------
// Saying by hand what a term means
//
// `POST /projects/{id}/vocabulary` had no caller, so the vocabulary could only
// grow from what the system proposed while reading papers. The decide half was
// reachable and the propose half was not: the queue could be answered and
// never added to, and a researcher who knew their own field's word for
// something had no way to say so.
// ---------------------------------------------------------------------------

const CANONICAL = [
  { id: "cv_1", name: "resistance", label: "Resistance",
    definition: "Share of isolates resistant.", canonical_unit: "%" },
  { id: "cv_2", name: "consumption", label: "Antibiotic consumption",
    definition: null, canonical_unit: "DDD" },
];

describe("teaching the project a term", () => {
  const withVariables = { ...VOCABULARY, variables: CANONICAL };

  it("proposes the phrase against the variable that was chosen", async () => {
    serve({ vocabulary: withVariables });
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    render(<Variables projectId="prj_1" />);

    await userEvent.type(await screen.findByLabelText(/This phrase/), "AMR");
    await userEvent.selectOptions(
      screen.getByLabelText(/^means$/), "cv_1");
    await userEvent.click(screen.getByRole("button", { name: /Propose it/ }));

    expect(post).toHaveBeenCalledWith("/api/projects/prj_1/vocabulary", {
      phrase: "AMR", canonical_variable_id: "cv_1", origin: "researcher",
    });
  });

  it("records that a person typed it, not that a paper used it", async () => {
    // The queue shows where a term came from, and a phrase somebody typed is
    // not a phrase read out of a paper.
    serve({ vocabulary: withVariables });
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    render(<Variables projectId="prj_1" />);

    await userEvent.type(await screen.findByLabelText(/This phrase/), "AMR");
    await userEvent.selectOptions(screen.getByLabelText(/^means$/), "cv_1");
    await userEvent.click(screen.getByRole("button", { name: /Propose it/ }));

    expect((post.mock.calls[0][1] as Record<string, unknown>).origin)
      .toBe("researcher");
  });

  it("will not propose a phrase pointing at nothing", async () => {
    /*
     * The variable is chosen, never typed: a term attached to a variable this
     * project does not have resolves in no paper and looks, from outside,
     * exactly like one that works.
     */
    serve({ vocabulary: withVariables });
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    render(<Variables projectId="prj_1" />);

    await userEvent.type(await screen.findByLabelText(/This phrase/), "AMR");
    const propose = screen.getByRole("button", { name: /Propose it/ });
    expect((propose as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(propose);
    expect(post).not.toHaveBeenCalled();
  });

  it("says it is proposed rather than applied", async () => {
    serve({ vocabulary: withVariables });
    render(<Variables projectId="prj_1" />);
    expect(await screen.findByText(/resolves nothing until you decide it/))
      .toBeTruthy();
  });

  it("offers nothing to point at when the project has no variables yet", async () => {
    // An alias maps a phrase onto a variable this project has; until a label
    // is approved there are none, and the form would be a dead end.
    serve({ vocabulary: { ...VOCABULARY, variables: [] } });
    render(<Variables projectId="prj_1" />);
    await screen.findByText(/Vocabulary/);
    expect(screen.queryByLabelText(/This phrase/)).toBeNull();
  });

  it("says what the server said when a phrase is already ruled on", async () => {
    // An approved alias is not re-proposed and a rejected one is not
    // resurrected by somebody typing it again.
    serve({ vocabulary: withVariables });
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(
      409, "'AMR' already has a ruling in this project."));
    render(<Variables projectId="prj_1" />);

    await userEvent.type(await screen.findByLabelText(/This phrase/), "AMR");
    await userEvent.selectOptions(screen.getByLabelText(/^means$/), "cv_1");
    await userEvent.click(screen.getByRole("button", { name: /Propose it/ }));

    expect(await screen.findByText(/already has a ruling/)).toBeTruthy();
  });
});


/**
 * Whether approving this mapping leaves the numbers needing conversion.
 *
 * `variable_mappings.transformation_required` had a reader and no writer.
 * `visuals.variable_labels` reads it to keep a canonical unit off the axis of
 * a column whose values are not in it — a worse lie, that module says, than
 * printing the raw column name. Nothing in the product wrote it, and its one
 * test passed because the fixture wrote the column directly through a helper
 * documented as approving "as the mapping screen does", which the mapping
 * screen could not do.
 */
describe("whether the numbers still need converting", () => {
  const differing = {
    ...VARIABLES,
    pending: [{ mapping_id: "vm_1", confidence: 0.42, column_name: "gdp",
                semantic_type: "ratio", canonical_name: "gdp",
                display_label: "GDP per capita", definition: null,
                canonical_unit: "constant 2015 USD", column_unit: null }],
  };

  it("says nothing when both sides are in the same unit", async () => {
    serve();
    render(<Variables projectId="prj_1" />);

    await screen.findByText("res_pct");
    expect(screen.queryByText(/still need converting/)).toBeNull();
  });

  it("asks when the column does not say what its values are in", async () => {
    serve({ variables: differing });
    render(<Variables projectId="prj_1" />);

    expect(await screen.findByText(/does not say what unit/)).toBeVisible();
    expect(screen.getByRole("checkbox",
      { name: /still need converting/ })).toBeVisible();
  });

  it("records the answer with the approval", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({} as never);
    serve({ variables: differing });
    render(<Variables projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("checkbox",
      { name: /still need converting/ }));
    await userEvent.click(screen.getByRole("button", { name: "Use this label" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/variable-mappings/vm_1/decide",
      { approve: true,
        transformation: "values are not in constant 2015 USD" }));
  });

  it("approves without an answer when nobody gives one", async () => {
    // Silence is not "the values are fine". The label is approved, nothing is
    // recorded, and the axis carries no unit rather than a borrowed one.
    const post = vi.spyOn(api, "post").mockResolvedValue({} as never);
    serve({ variables: differing });
    render(<Variables projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button",
      { name: "Use this label" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/variable-mappings/vm_1/decide",
      { approve: true, transformation: null }));
  });

  it("states the conversion rather than asking, when both units are known",
     async () => {
    // The database holds both. Making the reviewer retype a fact it already
    // has is how a form teaches people to click through it.
    serve({ variables: { ...VARIABLES, pending: [{
      ...differing.pending[0], column_unit: "current USD" }] } });
    render(<Variables projectId="prj_1" />);

    expect(await screen.findByText(/is recorded in current USD/)).toBeVisible();
    expect(screen.queryByRole("checkbox",
      { name: /still need converting/ })).toBeNull();
  });
});
