/**
 * Specifying an analysis by hand.
 *
 * The route that turns a specification into a sandboxed run had no caller. Every
 * analysis came out of a discovery sweep or was a fork of one, so the questions
 * a researcher could ask were exactly the ones the sweep happened to ask for
 * them — and a hypothesis they had *registered* could not be run at all.
 *
 * The tests turn on the two ways a form like this does harm rather than good:
 * by building a specification the server will refuse after submitting, and by
 * letting a method be chosen without the reason being written down first.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { RunAnalysis, complete, rolesFor } from "@/components/runanalysis";
import { ApiError, api } from "@/lib/api";

const CAPABILITIES = {
  retrieval: { lexical: true, semantic: false, model: null, note: null },
  analysis: {
    sandbox: true,
    methods: ["pearson_correlation", "linear_regression", "descriptive"],
    method_variables: {
      pearson_correlation: [{ role: "x", takes: "one" }, { role: "y", takes: "one" }],
      linear_regression: [{ role: "outcome", takes: "one" },
                          { role: "predictors", takes: "many" }],
      descriptive: [{ role: "columns", takes: "many" }],
    },
    isolation: {},
  },
  llm: { configured: false, note: "" },
};

const SOURCES = [
  {
    id: "src_1", title: "amr.csv", source_type: "upload", ingestion_status: "ready",
    trust_level: "unverified", created_at: "2026-01-01T00:00:00Z",
    dataset: {
      dataset_id: "ds_1", dataset_version_id: "dsv_1", version: 1,
      row_count: 1200, column_count: 3, quality_report: {},
    },
  },
  {
    id: "src_2", title: "notes.pdf", source_type: "upload", ingestion_status: "ready",
    trust_level: "unverified", created_at: "2026-01-01T00:00:00Z", dataset: null,
  },
];

const REGISTRATIONS = [
  { id: "prereg_1", hypothesis: "Antibiotic consumption increases resistance." },
];

const COLUMNS = [
  { ordinal: 0, name: "consumption", original_name: "consumption", physical_type: "float",
    semantic_type: "continuous", unit: null, missing_count: 0, unique_count: 900,
    statistics: {}, sensitivity: "none" },
  { ordinal: 1, name: "resistance", original_name: "resistance", physical_type: "float",
    semantic_type: "continuous", unit: null, missing_count: 0, unique_count: 880,
    statistics: {}, sensitivity: "none" },
  { ordinal: 2, name: "gdp_per_capita", original_name: "GDP per capita",
    physical_type: "float", semantic_type: "continuous", unit: null, missing_count: 0,
    unique_count: 200, statistics: {}, sensitivity: "none" },
];

function serve(over: Record<string, unknown> = {}) {
  return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path in over) return over[path] as never;
    if (path.includes("/capabilities")) return CAPABILITIES as never;
    if (path.includes("/sources")) return SOURCES as never;
    if (path.includes("/columns")) return COLUMNS as never;
    if (path.includes("/deviations")) return { registrations: REGISTRATIONS } as never;
    throw new Error(`unexpected request: ${path}`);
  });
}

async function openForm() {
  render(<RunAnalysis projectId="prj_1" />);
  await userEvent.click(screen.getByRole("button", { name: /Specify an analysis/ }));
  await screen.findByLabelText(/^Dataset/);
}

async function pick(label: RegExp | string, value: string) {
  await userEvent.selectOptions(screen.getByLabelText(label), value);
}

beforeEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// Columns are picked, never typed
// ---------------------------------------------------------------------------

describe("the columns", () => {
  it("offers the dataset's real columns rather than a box to type one in", async () => {
    /*
     * `validate_spec` refuses an unknown column with a 422, so a researcher who
     * types `GDP per capita` for a header spelled `gdp_per_capita` finds out
     * after submitting. The interface should make the mistake impossible.
     */
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");

    const x = await screen.findByLabelText("x");
    expect(x.tagName).toBe("SELECT");
    expect(screen.getAllByRole("option", { name: /gdp_per_capita/ }).length)
      .toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText(/column/i)).toBeNull();
  });

  it("reads the columns of the dataset that was chosen", async () => {
    const get = serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await waitFor(() => expect(get)
      .toHaveBeenCalledWith("/api/dataset-versions/dsv_1/columns"));
  });

  it("offers only sources that carry a dataset", async () => {
    // A PDF has no columns. Offering it would produce a spec the server
    // refuses, having asked the researcher to choose it.
    serve();
    await openForm();
    expect(screen.queryByRole("option", { name: /notes.pdf/ })).toBeNull();
    expect(screen.getByRole("option", { name: /amr.csv/ })).toBeTruthy();
  });

  it("says what is missing when the project has no dataset at all", async () => {
    serve({ "/api/projects/prj_1/sources": [SOURCES[1]] });
    await userEvent.click(
      render(<RunAnalysis projectId="prj_1" />)
        .getByRole("button", { name: /Specify an analysis/ }));
    expect(await screen.findByText(/Nothing to analyse yet/)).toBeTruthy();
    expect(screen.getByText(/profiled dataset/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// One column or several
// ---------------------------------------------------------------------------

describe("how many columns a variable takes", () => {
  it("asks for several where the method wants several", async () => {
    /*
     * A string is iterable, so `predictors: "consumption"` reaches the executor
     * as a list of letters. It validates and then fails in the sandbox, after
     * the run has been queued and recorded.
     */
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "linear_regression");

    expect(await screen.findByRole("group", { name: "predictors" })).toBeTruthy();
    expect(screen.getByLabelText("outcome").tagName).toBe("SELECT");
  });

  it("sends a list for a many-column role and a bare name for a single one", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ analysis_run_id: "arun_1" });
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "linear_regression");
    await pick("outcome", "resistance");
    await userEvent.click(await screen.findByRole("checkbox", { name: /consumption/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /gdp_per_capita/ }));
    await userEvent.type(screen.getByLabelText(/Why this method/), "Continuous and linear.");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({
      method: "linear_regression",
      dataset_version_ids: ["dsv_1"],
      variables: { outcome: "resistance",
                   predictors: ["consumption", "gdp_per_capita"] },
    });
  });

  it("keeps the order predictors were chosen in", async () => {
    // The first predictor is the exposure and the rest are adjustments. A set
    // that reorders them changes which is which.
    const post = vi.spyOn(api, "post").mockResolvedValue({ analysis_run_id: "arun_1" });
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "linear_regression");
    await pick("outcome", "resistance");
    await userEvent.click(await screen.findByRole("checkbox", { name: /gdp_per_capita/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /consumption/ }));
    await userEvent.type(screen.getByLabelText(/Why this method/), "x");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0][1] as { variables: { predictors: string[] } })
      .variables.predictors).toEqual(["gdp_per_capita", "consumption"]);
  });

  it("takes the roles from the server rather than knowing them", () => {
    expect(rolesFor(CAPABILITIES as never, "linear_regression"))
      .toEqual([{ role: "outcome", takes: "one" },
                { role: "predictors", takes: "many" }]);
    expect(rolesFor(CAPABILITIES as never, "logistic_regression")).toEqual([]);
    expect(rolesFor(null, "pearson_correlation")).toEqual([]);
  });

  it("says it cannot ask when the server names a method it did not describe", async () => {
    /*
     * Rendering a form with no variables would let it be submitted and refused.
     * An older server sends no map at all, and guessing the shape is how a spec
     * fails after the run is recorded.
     */
    serve({ "/api/system/capabilities": {
      ...CAPABILITIES,
      analysis: { ...CAPABILITIES.analysis, methods: ["kruskal_wallis"],
                  method_variables: {} },
    } });
    await openForm();
    await pick(/^Method/, "kruskal_wallis");
    expect(await screen.findByText(/did not say which variables/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Claiming a registration
// ---------------------------------------------------------------------------

describe("a registered hypothesis", () => {
  it("offers the project's registrations to claim", async () => {
    /*
     * Until an analysis could be specified, nothing in the product ever claimed
     * a registration: the verbs that fed the ledger each recorded a look and
     * claimed nothing, so the deviation report walked from every registration
     * to an empty list of tests.
     */
    serve();
    await openForm();
    expect(await screen.findByRole("option",
      { name: /Antibiotic consumption increases resistance/ })).toBeTruthy();
  });

  it("sends the claim with the specification", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      analysis_run_id: "arun_1", confirmatory: true,
      standing: "Registered before this test.", looks_this_session: 1 });
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await pick("y", "resistance");
    await pick(/registered hypothesis/, "prereg_1");
    await userEvent.type(screen.getByLabelText(/Why this method/), "Continuous.");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ preregistration_id: "prereg_1" });
  });

  it("claims nothing by default", async () => {
    // Exploratory is the honest default. A form that pre-selected a
    // registration would hand out the exemption for a click.
    const post = vi.spyOn(api, "post").mockResolvedValue({
      analysis_run_id: "arun_1", confirmatory: false, standing: null,
      looks_this_session: 1 });
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await pick("y", "resistance");
    await userEvent.type(screen.getByLabelText(/Why this method/), "Continuous.");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ preregistration_id: null });
  });

  it("names no family, so the server decides which one this joins", async () => {
    /*
     * The correction still has to be right in the same way: a researcher who
     * sweeps and then specifies three analyses must have all of it corrected
     * together, or the flattering direction wins.
     *
     * What changed is who decides. This used to send a `session_id` the browser
     * had minted into `sessionStorage`, which made a *tab* the unit of
     * correction — invisible to the researcher, split across two windows, and
     * discarded on close while the looks themselves stayed in the database.
     * Sending nothing is now the correct request: the server resolves the
     * project's open line of enquiry, so there is one definition of "the same
     * sitting" rather than one per client.
     */
    const post = vi.spyOn(api, "post").mockResolvedValue({
      analysis_run_id: "arun_1", confirmatory: false, standing: null,
      looks_this_session: 1 });
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await pick("y", "resistance");
    await userEvent.type(screen.getByLabelText(/Why this method/), "Continuous.");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const sent = post.mock.calls[0][1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("session_id");
    expect(sent).not.toHaveProperty("enquiry_id");
  });

  it("says the claim is checked rather than taken on trust", async () => {
    serve();
    await openForm();
    expect(await screen.findByText(/Checked, not taken on trust/)).toBeTruthy();
  });

  it("asks nothing about registrations when the project has none", async () => {
    // A select with one option saying "no" is a question nobody can answer.
    serve({ "/api/projects/prj_1/deviations": { registrations: [] } });
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    expect(screen.queryByLabelText(/registered hypothesis/)).toBeNull();
  });
});

describe("what the server says the run counts as", () => {
  it("reports a refused exemption in the server's own words", async () => {
    /*
     * The interesting case. A rule restated in the interface could disagree
     * with the judgement that was actually recorded, and this is the judgement.
     */
    vi.spyOn(api, "post").mockResolvedValue({
      analysis_run_id: "arun_1", confirmatory: false,
      standing: "The analysis that ran differs from the one registered "
              + "(covariates), so this result was not predicted by the "
              + "registration.",
      looks_this_session: 4 });
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await pick("y", "resistance");
    await userEvent.type(screen.getByLabelText(/Why this method/), "Continuous.");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    expect(await screen.findByText(/differs from the one registered/)).toBeTruthy();
  });

  it("says how large the family this result is corrected against has become", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      analysis_run_id: "arun_1", confirmatory: false, standing: null,
      looks_this_session: 4 });
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await pick("y", "resistance");
    await userEvent.type(screen.getByLabelText(/Why this method/), "Continuous.");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    expect(await screen.findByText(/4 looks in this session/)).toBeTruthy();
    expect(screen.getByText(/corrected against/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The reason, before the number
// ---------------------------------------------------------------------------

describe("why this method", () => {
  it("will not run without a reason recorded", async () => {
    /*
     * §47: a method chosen after seeing what it produces is a search, not a
     * method. The run's own screen has a line waiting for this, which read "—"
     * for every run nobody could specify.
     */
    const post = vi.spyOn(api, "post").mockResolvedValue({ analysis_run_id: "arun_1" });
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await pick("y", "resistance");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    expect(post).not.toHaveBeenCalled();
  });

  it("says the reason is asked for before the result exists", async () => {
    serve();
    await openForm();
    expect(screen.getByText(/after seeing what it gives/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// A specification that would be refused
// ---------------------------------------------------------------------------

describe("an incomplete specification", () => {
  it("cannot be sent while a variable is unpicked", async () => {
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await userEvent.type(screen.getByLabelText(/Why this method/), "Continuous.");

    expect(screen.getByRole("button", { name: /Run it/ })
      .hasAttribute("disabled")).toBe(true);

    await pick("y", "resistance");
    expect(screen.getByRole("button", { name: /Run it/ })
      .hasAttribute("disabled")).toBe(false);
  });

  it("knows what complete means for each kind of role", () => {
    const roles = [{ role: "outcome", takes: "one" as const },
                   { role: "predictors", takes: "many" as const }];
    expect(complete(roles, { outcome: "y", predictors: ["x"] })).toBe(true);
    expect(complete(roles, { outcome: "y", predictors: [] })).toBe(false);
    expect(complete(roles, { outcome: "", predictors: ["x"] })).toBe(false);
    // A single name where a list is wanted is not complete: it is the failure
    // that reaches the executor as a list of letters.
    expect(complete(roles, { outcome: "y", predictors: "x" })).toBe(false);
    // No method chosen is not a complete specification of nothing.
    expect(complete([], {})).toBe(false);
  });

  it("clears the variables when the method changes", async () => {
    // `x` on a correlation and `outcome` on a regression are different roles;
    // carrying the old picks across would submit a variable the new method
    // does not have.
    const post = vi.spyOn(api, "post").mockResolvedValue({ analysis_run_id: "arun_1" });
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await pick("y", "resistance");
    await pick(/^Method/, "descriptive");
    await userEvent.click(await screen.findByRole("checkbox", { name: /consumption/ }));
    await userEvent.type(screen.getByLabelText(/Why this method/), "Summary first.");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0][1] as { variables: Record<string, unknown> }).variables)
      .toEqual({ columns: ["consumption"] });
  });

  it("clears the variables when the dataset changes", async () => {
    // The columns belong to the version. Keeping a pick across a change would
    // name a column the new dataset may not have.
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await pick(/^Dataset/, "");
    await pick(/^Dataset/, "dsv_1");
    expect((await screen.findByLabelText("x") as HTMLSelectElement).value).toBe("");
  });
});

// ---------------------------------------------------------------------------
// What the server says
// ---------------------------------------------------------------------------

describe("when the server refuses", () => {
  it("shows what it said rather than a generic failure", async () => {
    vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(422, "pearson_correlation requires variables: y"));
    serve();
    await openForm();
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await pick("y", "resistance");
    await userEvent.type(screen.getByLabelText(/Why this method/), "Continuous.");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/requires variables: y/);
  });

  it("hands back the queued run so the list can show it", async () => {
    const queued = vi.fn();
    vi.spyOn(api, "post").mockResolvedValue({ analysis_run_id: "arun_9" });
    serve();
    render(<RunAnalysis projectId="prj_1" onQueued={queued} />);
    await userEvent.click(screen.getByRole("button", { name: /Specify an analysis/ }));
    await screen.findByLabelText(/^Dataset/);
    await pick(/^Dataset/, "dsv_1");
    await pick(/^Method/, "pearson_correlation");
    await pick("x", "consumption");
    await pick("y", "resistance");
    await userEvent.type(screen.getByLabelText(/Why this method/), "Continuous.");
    await userEvent.click(screen.getByRole("button", { name: /Run it/ }));

    await waitFor(() => expect(queued).toHaveBeenCalledWith("arun_9"));
  });
});
