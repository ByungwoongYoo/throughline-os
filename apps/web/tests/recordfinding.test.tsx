/**
 * Recording a finding, which the browser could not do.
 *
 * `PLAN.md` §137 item 5: after validation the overview says "Record a finding —
 * NEXT", the Findings section renders zero buttons, and no `api.post` to
 * `/findings` existed anywhere in this app. The capability was in the API and
 * exercised by the suite; it was unreachable by click. The Findings empty state
 * told the researcher to record one — an instruction for an action the
 * interface did not offer.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecordFinding } from "@/components/recordfinding";
import * as apiModule from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const PROPS = {
  projectId: "prj_1",
  connectionId: "conn_1",
  defaultTitle: "consumption tracks resistance",
  validated: true,
};

function open() {
  fireEvent.click(screen.getByRole("button", { name: "Record a finding" }));
}

describe("the step the workflow was missing", () => {
  it("sends the connection with the finding", async () => {
    /**
     * The link that makes the finding checkable afterwards. Without it the
     * finding is recorded and immediately unverifiable — which is the state
     * every finding was in before the edge behind this existed.
     */
    const post = vi.spyOn(apiModule.api, "post")
      .mockResolvedValue({ finding_id: "fnd_1", lifecycle_status: "candidate" } as never);
    render(<RecordFinding {...PROPS} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/projects/prj_1/findings",
      expect.objectContaining({ from_connections: ["conn_1"] })));
  });

  it("will not record without a title", () => {
    render(<RecordFinding {...PROPS} defaultTitle="" />);
    open();
    expect(screen.getByRole("button", { name: "Record it" })).toBeDisabled();
  });

  it("says the finding starts as a candidate", async () => {
    /**
     * Recording is not promoting. A researcher who thinks they have published a
     * result is the failure this sentence prevents.
     */
    vi.spyOn(apiModule.api, "post")
      .mockResolvedValue({ finding_id: "fnd_1", lifecycle_status: "candidate" } as never);
    render(<RecordFinding {...PROPS} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));

    expect(await screen.findByText(/starts as a/)).toBeInTheDocument();
    expect(screen.getByText(/candidate/)).toBeInTheDocument();
  });

  it("reports a failure rather than pretending it recorded", async () => {
    vi.spyOn(apiModule.api, "post").mockRejectedValue(new Error("nope"));
    render(<RecordFinding {...PROPS} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Recorded as a finding/)).not.toBeInTheDocument();
  });
});

describe("not overclaiming at the moment somebody is pleased", () => {
  it("offers no control to call the result causal", () => {
    /**
     * A dropdown offering "causal" beside a correlation, just after a result
     * survived its checks, is the easiest place in the product to overclaim.
     * The finding is recorded as not-assessed and the screen says so.
     */
    render(<RecordFinding {...PROPS} />);
    open();

    // The disclaimer has to be present, not merely un-contradicted: silence
    // about causality is what lets a reader assume it was judged.
    // Read from the rendered text rather than with getByText: the sentence is
    // split by a <b> around "not assessed", and a cross-element match fails on
    // markup rather than on meaning.
    const rendered = (document.body.textContent ?? "").toLowerCase();
    expect(rendered).toContain("not assessed");
    expect(rendered).toContain("nothing here asserts");

    // No control that could assert one. "causes" is deliberately not searched
    // for as a bare substring — it occurs inside the disclaimer itself
    // ("nothing here asserts that one variable causes the other"), and matching
    // it there failed this test against the exact sentence that makes the
    // property true.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    const text = document.body.textContent?.toLowerCase() ?? "";
    for (const phrase of ["mark as causal", "causal finding", "this causes"]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("records an unvalidated connection but says what it is", () => {
    /**
     * Blocking the button would enforce a rule the lifecycle already enforces
     * structurally, in the one place where it only removes the researcher's
     * judgement. Saying plainly what an untested result is does the work.
     */
    render(<RecordFinding {...PROPS} validated={false} />);

    expect(screen.getByText(/has not survived a validation run/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record a finding" })).not.toBeDisabled();
  });

  it("says nothing about validation when the connection survived one", () => {
    render(<RecordFinding {...PROPS} validated />);
    expect(screen.queryByText(/has not survived/)).not.toBeInTheDocument();
  });
});
