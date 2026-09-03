/**
 * The promotion form shows what validation already found.
 *
 * Six robustness checks were asked of the researcher as radio buttons while
 * the system held measured answers to all six: `validate_connection` runs each
 * one as a real analysis in the sandbox and records its outcome under exactly
 * the names this form asks about. The two never met, so a researcher certified
 * from memory what the product had already observed — and could tick "passed"
 * on a check recorded as violated.
 *
 * The server refuses that contradiction now. This is the other half: the form
 * says what the record holds before an answer is given, so the refusal is
 * something the researcher can see coming rather than a wall they hit.
 *
 * The answers stay theirs. Showing a record is not filling one in.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FindingLifecycle, recordReads } from "@/components/lifecycle";

afterEach(cleanup);

describe("what a recorded outcome means", () => {
  it("treats a violation as standing against a claimed pass", () => {
    expect(recordReads("violated").against).toBe(true);
  });

  it("does not treat an untested check as a failure", () => {
    /**
     * `not_tested` is what confounder adjustment records whenever no
     * confounders were named. A researcher who adjusted for them by other
     * means is entitled to say so, and the server agrees — it refuses only
     * `violated`.
     */
    expect(recordReads("not_tested").against).toBe(false);
    expect(recordReads("noted").against).toBe(false);
    expect(recordReads("passed").against).toBe(false);
  });

  it("says something legible for an outcome it has not met", () => {
    const read = recordReads("some_new_outcome");
    expect(read.against).toBe(false);
    expect(read.text).toContain("some new outcome");
  });
});

describe("the promotion form", () => {
  const recorded = {
    robustness: { outcome: "violated", detail: "the residuals fan out" },
    sensitivity: { outcome: "passed", detail: "" },
  };

  it("shows the recorded outcome, and what was observed", async () => {
    render(
      <FindingLifecycle
        findingId="fnd_1"
        status="exploratory"
        evidenceTotal={3}
        recordedChecks={recorded}
      />,
    );
    // Open the promotion form for `validated`, which is where the checks live.
    const toValidated = screen.getByRole("button", { name: /validated/i });
    toValidated.click();

    expect(await screen.findByText(/recorded this as violated/i)).toBeTruthy();
    expect(screen.getByText(/the residuals fan out/)).toBeTruthy();
  });

  it("still renders when nothing was recorded", () => {
    /**
     * A finding written by hand has no validation report behind it, and the
     * form has to work for it — this is the ordinary case for the first
     * finding in a project.
     */
    render(
      <FindingLifecycle findingId="fnd_2" status="exploratory" evidenceTotal={1} />,
    );
    expect(screen.getByRole("button", { name: /validated/i })).toBeTruthy();
  });
});
