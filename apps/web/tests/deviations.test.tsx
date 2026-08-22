/**
 * The plan, against what was actually run.
 *
 * Nothing in science checks a pre-registration: the plan sits in a registry as a
 * document and the analysis happens in software that never saw it. This panel is
 * that comparison, so what it must not do is as important as what it shows.
 *
 * It must not scold — deviating is usually right, and a screen that treats every
 * deviation as misconduct gets closed, after which it catches nothing. It must
 * not let a registration with no plan read as a clean bill of health. And it must
 * not write the reason for a deviation, because that is the one sentence in a
 * methods section that has to be true.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Deviations } from "@/components/deviations";
import * as useApiModule from "@/lib/useApi";
import * as apiModule from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function serve(data: unknown, extra: Record<string, unknown> = {}) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue({
    data, error: null, loading: false, reload: vi.fn(), ...extra,
  } as never);
}

const DEVIATED = {
  registrations: [{
    id: "prereg_1",
    hypothesis: "Consumption raises resistance.",
    predicted_direction: "increase",
    plan_hash: "abc123",
    falsified_if: "no association at q < .05",
    as_registered: 1,
    deviated: 1,
    tests: [
      { id: "t1", description: "as registered", confirmatory: true, deviations: [] },
      { id: "t2", description: "with urbanisation added", confirmatory: false,
        deviations: [{ field: "covariates", registered: ["gdp"], executed: ["gdp", "urb"] },
                     { field: "method", registered: "spearman", executed: "pearson" }] },
    ],
  }],
  registered: 1, without_a_plan: 0, deviated: 1, looks: 12,
  note: "1 registration against 12 recorded looks at the data.",
};

describe("what was registered against what ran", () => {
  it("shows the hypothesis and what has been tested against it", () => {
    serve(DEVIATED);
    render(<Deviations projectId="prj_1" />);

    expect(screen.getByText(/Consumption raises resistance/)).toBeInTheDocument();
    expect(screen.getByText(/as registered/)).toBeInTheDocument();
  });

  it("names what differed, rather than only that something did", () => {
    /** "Deviated" alone is not actionable; "covariates, method" is. */
    serve(DEVIATED);
    render(<Deviations projectId="prj_1" />);

    expect(screen.getByText(/covariates, method/)).toBeInTheDocument();
  });

  it("shows the falsification criterion recorded before the result", () => {
    serve(DEVIATED);
    render(<Deviations projectId="prj_1" />);
    expect(screen.getByText(/no association at q < .05/)).toBeInTheDocument();
  });

  it("does not scold", () => {
    /**
     * Deviating is usually right — data arrives dirtier than planned and
     * assumptions fail. A panel that calls it misconduct gets closed, and then
     * it catches nothing at all.
     */
    serve(DEVIATED);
    const { container } = render(<Deviations projectId="prj_1" />);

    const text = container.textContent?.toLowerCase() ?? "";
    for (const word of ["misconduct", "violation", "warning", "invalid",
                        "cheat", "wrong"]) {
      expect(text).not.toContain(word);
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("a registration with no plan", () => {
  it("says the analyses could not be checked, rather than showing nothing", () => {
    /**
     * An empty deviation list under a plan-free registration reads as "all
     * clear". The truth is that no comparison was possible, which is the
     * opposite statement.
     */
    serve({
      ...DEVIATED,
      registrations: [{ ...DEVIATED.registrations[0], plan_hash: null, tests: [] }],
    });
    render(<Deviations projectId="prj_1" />);

    expect(screen.getByText(/not a pass/)).toBeInTheDocument();
    // Scoped to the note. The phrase also appears in the metadata line above
    // it, and an unscoped query would pass on that while the explanation
    // itself was missing.
    expect(screen.getByText(/could not be checked against one/))
      .toBeInTheDocument();
  });
});

describe("nothing registered", () => {
  it("says the work is exploratory rather than saying nothing", () => {
    /**
     * A reader of the write-up should know these results were exploratory, and
     * the only way that happens is somebody being told.
     */
    serve({ registrations: [], registered: 0, without_a_plan: 0, deviated: 0,
            looks: 30,
            note: "Nothing has been registered in this project, so every result "
                  + "here is exploratory." });
    render(<Deviations projectId="prj_1" />);

    expect(screen.getByText(/every result here is exploratory/)).toBeInTheDocument();
  });
});

describe("the methods section", () => {
  it("is drafted from the record on request, not on load", () => {
    /** Reading a panel should not be a request for a document. */
    serve(DEVIATED);
    const get = vi.spyOn(apiModule.api, "get").mockResolvedValue({} as never);
    render(<Deviations projectId="prj_1" />);

    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Draft the deviations/ }));
    expect(get).toHaveBeenCalledWith("/api/projects/prj_1/deviations/narrative");
  });

  it("leaves every reason blank", async () => {
    /**
     * The system knows what changed. Only the researcher knows why, and a
     * generated reason would be this software writing the one part of a methods
     * section that has to be true — a gap gets filled, an invention gets signed.
     */
    serve(DEVIATED);
    vi.spyOn(apiModule.api, "get").mockResolvedValue({
      text: "Registered: Consumption raises resistance.\n  Deviated (method): ran\n    Reason: ___",
      note: "Every deviation is left with a blank reason. Only you know why.",
    } as never);
    render(<Deviations projectId="prj_1" />);

    fireEvent.click(screen.getByRole("button", { name: /Draft the deviations/ }));

    expect(await screen.findByText(/Reason: ___/)).toBeInTheDocument();
    expect(screen.getByText(/Only you know why/)).toBeInTheDocument();
  });

  it("reports a failure to draft rather than showing an empty section", async () => {
    serve(DEVIATED);
    vi.spyOn(apiModule.api, "get").mockRejectedValue(new Error("unreachable"));
    render(<Deviations projectId="prj_1" />);

    fireEvent.click(screen.getByRole("button", { name: /Draft the deviations/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("loading and failure", () => {
  it("says what it is comparing", () => {
    serve(null, { loading: true });
    render(<Deviations projectId="prj_1" />);
    expect(screen.getByText(/Comparing the plan/)).toBeInTheDocument();
  });

  it("reports a failure rather than an empty comparison", () => {
    serve(null, { error: new Error("unreachable"), loading: false });
    render(<Deviations projectId="prj_1" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing registered/)).not.toBeInTheDocument();
  });
});
