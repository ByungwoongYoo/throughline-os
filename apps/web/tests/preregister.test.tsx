/**
 * Registering a hypothesis before looking.
 *
 * The route had no caller anywhere, while the screen above it reported
 * departures from registrations that could never be created — its empty state
 * was true, permanent, and not something a researcher could act on.
 *
 * The tests that matter here are about what the registration is *for*: it is
 * what earns a result its exemption from multiple-comparison correction, so a
 * form that lets someone register a prediction which cannot be wrong, or that
 * implies a plan was recorded when none was, would do more harm than the
 * missing screen did.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  Preregister, covariatesFrom, planIsCheckable,
} from "@/components/preregister";
import { ApiError, api } from "@/lib/api";

const registered = {
  id: "prereg_1",
  plan_recorded: true,
  note: "Registered. A result testing this is confirmatory and is left out of "
      + "the exploratory family — provided the test comes after this "
      + "registration, and the analysis that runs is the one registered.",
};

async function openForm() {
  render(<Preregister projectId="prj_1" />);
  await userEvent.click(screen.getByRole("button", { name: /Register a hypothesis/ }));
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("the prediction has to be able to be wrong", () => {
  it("will not submit without a direction", async () => {
    /*
     * The server refuses a directionless prediction and says why, but a form
     * that lets it be sent has already asked the researcher to write something
     * meaningless and then told them off for it.
     */
    const post = vi.spyOn(api, "post").mockResolvedValue(registered);
    await openForm();
    await userEvent.type(screen.getByLabelText(/^The hypothesis/),
                         "Antibiotic use increases resistance.");
    await userEvent.click(screen.getByRole("button", { name: /Register it/ }));

    expect(post).not.toHaveBeenCalled();
  });

  it("offers only the directions the domain accepts", async () => {
    await openForm();
    const options = screen.getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(options).toEqual(["increase", "decrease", "difference", "no_effect"]);
  });

  it("says why the direction is required", async () => {
    await openForm();
    expect(screen.getByText(/cannot be wrong/)).toBeTruthy();
  });
});

describe("what gets sent", () => {
  it("sends the hypothesis and direction", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(registered);
    await openForm();
    await userEvent.type(screen.getByLabelText(/^The hypothesis/),
                         "Antibiotic use increases resistance.");
    await userEvent.selectOptions(screen.getByRole("combobox"), "increase");
    await userEvent.click(screen.getByRole("button", { name: /Register it/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({
      hypothesis: "Antibiotic use increases resistance.",
      predicted_direction: "increase",
    });
  });

  it("distinguishes an unstated plan from an empty one", () => {
    /*
     * The domain treats these differently and it matters: "no covariates
     * stated" cannot be deviated from, while "stated, and there are none" can.
     * Sending `[]` for a field nobody filled in would claim a plan that was
     * never made.
     */
    expect(covariatesFrom("")).toBeNull();
    expect(covariatesFrom("   ")).toBeNull();
    expect(covariatesFrom("age, sex")).toEqual(["age", "sex"]);
    expect(covariatesFrom("age, , sex,")).toEqual(["age", "sex"]);
  });

  it("sends null rather than empty strings for what was left blank", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(registered);
    await openForm();
    await userEvent.type(screen.getByLabelText(/^The hypothesis/), "H");
    await userEvent.selectOptions(screen.getByRole("combobox"), "no_effect");
    await userEvent.click(screen.getByRole("button", { name: /Register it/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const sent = post.mock.calls[0][1] as Record<string, unknown>;
    for (const field of ["method", "design", "outcome", "exposure", "falsified_if"]) {
      expect(sent[field]).toBeNull();
    }
    expect(sent.covariates).toBeNull();
  });
});

describe("whether the plan can be checked", () => {
  it("counts any one of method, design or covariates", () => {
    const none = { method: "", design: "", covariates: "" };
    expect(planIsCheckable(none)).toBe(false);
    expect(planIsCheckable({ ...none, method: "linear_regression" })).toBe(true);
    expect(planIsCheckable({ ...none, design: "cohort" })).toBe(true);
    expect(planIsCheckable({ ...none, covariates: "age" })).toBe(true);
    // Whitespace is not a plan.
    expect(planIsCheckable({ ...none, method: "   " })).toBe(false);
  });

  it("warns while the form is open, not after it is submitted", async () => {
    /*
     * A registration with no plan still counts on its text, but every later
     * report says the comparison could not be made — which is not the same as
     * saying it passed. Saying so afterwards is too late to act on.
     */
    await openForm();
    expect(screen.getByText(/cannot be compared against a plan/)).toBeTruthy();

    await userEvent.type(screen.getByLabelText(/Method/), "linear_regression");
    await waitFor(() =>
      expect(screen.queryByText(/cannot be compared against a plan/)).toBeNull());
  });
});

describe("afterwards", () => {
  it("shows the server's own words about what was registered", async () => {
    // Whether the exemption holds depends on the plan and the timing, and the
    // server is the one that knows. Restating it here would let the two drift.
    vi.spyOn(api, "post").mockResolvedValue(registered);
    await openForm();
    await userEvent.type(screen.getByLabelText(/^The hypothesis/), "H");
    await userEvent.selectOptions(screen.getByRole("combobox"), "increase");
    await userEvent.click(screen.getByRole("button", { name: /Register it/ }));

    expect(await screen.findByText(/left out of the exploratory family/)).toBeTruthy();
  });

  it("tells the report above it to refresh", async () => {
    vi.spyOn(api, "post").mockResolvedValue(registered);
    const reloaded = vi.fn();
    render(<Preregister projectId="prj_1" onRegistered={reloaded} />);
    await userEvent.click(screen.getByRole("button", { name: /Register a hypothesis/ }));
    await userEvent.type(screen.getByLabelText(/^The hypothesis/), "H");
    await userEvent.selectOptions(screen.getByRole("combobox"), "increase");
    await userEvent.click(screen.getByRole("button", { name: /Register it/ }));

    await waitFor(() => expect(reloaded).toHaveBeenCalled());
  });

  it("shows what the server said when it refuses", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(
      400, "predicted_direction must be one of ('increase', 'decrease', "
         + "'difference', 'no_effect')"));
    await openForm();
    await userEvent.type(screen.getByLabelText(/^The hypothesis/), "H");
    await userEvent.selectOptions(screen.getByRole("combobox"), "increase");
    await userEvent.click(screen.getByRole("button", { name: /Register it/ }));

    expect(await screen.findByText(/must be one of/)).toBeTruthy();
    // And the form is still there to correct, not replaced by the error.
    expect(screen.getByRole("button", { name: /Register it/ })).toBeTruthy();
  });
});

/**
 * Mounting it somewhere other than Deviations (plan §4.10.3).
 *
 * Registering is only worth anything *before* the looking, and until now it was
 * reachable only from a panel on Connections — after. Discovery mounts the same
 * component, so what these guard is that it carries nothing from the screen it
 * was written for: it needs a project id and nothing else, it can be made quiet
 * enough to sit beside a screen that already has a primary action, and a
 * researcher can register a second hypothesis without reloading the page.
 */
describe("mounted on a screen of its own", () => {
  it("needs nothing but a project id", async () => {
    /** No `onRegistered`, no panel around it. A component that only works
     *  inside Deviations cannot be offered where it matters. */
    vi.spyOn(api, "post").mockResolvedValue(registered);
    render(<Preregister projectId="prj_1" />);
    await userEvent.click(
      screen.getByRole("button", { name: /Register a hypothesis/ }));
    await userEvent.type(screen.getByLabelText(/^The hypothesis/), "H");
    await userEvent.selectOptions(screen.getByRole("combobox"), "increase");
    await userEvent.click(screen.getByRole("button", { name: /Register it/ }));

    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("can be asked to be the quieter control", async () => {
    /*
     * Principle 2 gives every screen one `btn-primary`, and on Discovery that
     * one is the sweep. A second primary beside it makes the screen ask twice,
     * which is how a page stops having a primary action at all.
     */
    render(<Preregister projectId="prj_1" emphasis="secondary" />);
    const opener = screen.getByRole("button", { name: /Register a hypothesis/ });
    expect(opener.className).toContain("btn");
    expect(opener.className).not.toContain("btn-primary");
  });

  it("stays primary where it always was", async () => {
    /** Deviations' empty state exists to offer this; nothing about that mount
     *  changes, which is what makes the prop safe to add. */
    render(<Preregister projectId="prj_1" />);
    expect(screen.getByRole("button", { name: /Register a hypothesis/ }).className)
      .toContain("btn-primary");
  });

  it("offers a second registration without a reload", async () => {
    /*
     * A project has several hypotheses. A confirmation that permanently
     * replaces the control makes the second one reachable only by reloading
     * the screen — which on Discovery would also lose the sweep in progress.
     */
    vi.spyOn(api, "post").mockResolvedValue(registered);
    render(<Preregister projectId="prj_1" />);
    await userEvent.click(
      screen.getByRole("button", { name: /Register a hypothesis/ }));
    await userEvent.type(screen.getByLabelText(/^The hypothesis/), "first");
    await userEvent.selectOptions(screen.getByRole("combobox"), "increase");
    await userEvent.click(screen.getByRole("button", { name: /Register it/ }));

    await userEvent.click(await screen.findByRole(
      "button", { name: /Register another hypothesis/ }));

    // Empty, not the first hypothesis again: a covariate list left in place is
    // how one ends up registered against a plan nobody chose it for.
    expect((screen.getByLabelText(/^The hypothesis/) as HTMLTextAreaElement).value)
      .toBe("");
  });
});
