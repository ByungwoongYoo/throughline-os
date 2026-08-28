/**
 * Moving a finding along its lifecycle (LAW 3).
 *
 * Nothing could promote a finding, retire one, or mark one conflicted: the
 * transition route had no caller, so every finding stayed where it was created
 * for ever — while the findings screen opened by saying a finding must link to
 * evidence "before it can be promoted past candidate", describing a rule
 * nothing could exercise.
 *
 * The tests here are mostly about the three states of a robustness check. The
 * domain refuses validation differently for a check that was never run and one
 * that ran and failed, and a screen that collapsed the two — as a checkbox
 * would — could quietly assert a result nobody produced.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  FindingLifecycle, LEGAL_NEXT, REQUIRED_CHECKS, checksToSend,
} from "@/components/lifecycle";
import { ApiError, api } from "@/lib/api";

beforeEach(() => { vi.restoreAllMocks(); });

const mount = (status: string, evidenceTotal = 3, onMoved?: () => void) =>
  render(<FindingLifecycle findingId="fnd_1" status={status}
                           evidenceTotal={evidenceTotal} onMoved={onMoved} />);

describe("only the moves the server will accept", () => {
  it("offers the legal next states and nothing else", () => {
    mount("candidate");
    expect(screen.getByRole("button", { name: /Move to exploratory/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Move to deprecated/ })).toBeTruthy();
    // A candidate may never jump straight to validated.
    expect(screen.queryByRole("button", { name: /Move to validated/ })).toBeNull();
  });

  it("says a deprecated finding has nowhere to go", () => {
    // Rather than showing an empty row of buttons and leaving the reader to
    // wonder whether the screen failed to load.
    mount("deprecated");
    expect(screen.getByText(/where its lifecycle ends/)).toBeTruthy();
  });

  it("never proposes a move out of a terminal state", () => {
    expect(LEGAL_NEXT.deprecated).toEqual([]);
  });
});

describe("evidence is named before the attempt, not after the refusal", () => {
  it("says there is none, and what that prevents", () => {
    mount("candidate", 0);
    expect(screen.getByText(/no linked evidence/)).toBeTruthy();
    expect(screen.getByText(/claim about the world/)).toBeTruthy();
  });

  it("does not lecture when evidence is attached", () => {
    mount("candidate", 4);
    expect(screen.getByText(/4 pieces of linked evidence/)).toBeTruthy();
    expect(screen.queryByText(/claim about the world/)).toBeNull();
  });
});

describe("a robustness check has three states, not two", () => {
  it("asks for every check the server requires", async () => {
    mount("exploratory");
    await userEvent.click(screen.getByRole("button", { name: /Move to validated/ }));
    for (const check of REQUIRED_CHECKS) {
      expect(screen.getByRole("group", { name: check.replace(/_/g, " ") })).toBeTruthy();
    }
  });

  it("omits an unanswered check rather than sending it as failed", () => {
    /*
     * The server reads a missing check as "not run" and `false` as "ran and
     * failed", and refuses validation differently for each. Sending the first
     * as the second asserts a result nobody produced.
     */
    expect(checksToSend({ robustness: "unanswered", outliers: "failed",
                          sensitivity: "passed" }))
      .toEqual({ outliers: false, sensitivity: true });
  });

  it("sends nothing at all when nothing was answered", () => {
    expect(checksToSend({})).toEqual({});
    expect(checksToSend({ robustness: "unanswered" })).toEqual({});
  });

  it("defaults every check to not run", async () => {
    // A default of "passed" would validate findings nobody checked; a default
    // of "failed" would assert failures nobody observed.
    mount("exploratory");
    await userEvent.click(screen.getByRole("button", { name: /Move to validated/ }));
    await userEvent.type(screen.getByRole("textbox"), "It held up.");

    const post = vi.spyOn(api, "post").mockResolvedValue({});
    await userEvent.click(screen.getByRole("button", { name: /^Move to validated$/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0][1] as Record<string, unknown>).checks).toEqual({});
  });

  it("does not ask for checks on a move that does not require them", async () => {
    mount("candidate");
    await userEvent.click(screen.getByRole("button", { name: /Move to exploratory/ }));
    expect(screen.queryByText(/Robustness checks/)).toBeNull();
  });
});

describe("what gets sent", () => {
  it("will not move a finding without a recorded reason", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    mount("candidate");
    await userEvent.click(screen.getByRole("button", { name: /Move to exploratory/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Move to exploratory$/ }));
    expect(post).not.toHaveBeenCalled();
  });

  it("sends the target state, the reason and the answered checks", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    mount("exploratory");
    await userEvent.click(screen.getByRole("button", { name: /Move to validated/ }));
    await userEvent.type(screen.getByRole("textbox"), "Survived every check.");
    for (const check of REQUIRED_CHECKS) {
      const group = screen.getByRole("group", { name: check.replace(/_/g, " ") });
      await userEvent.click(within(group).getByLabelText("passed"));
    }
    await userEvent.click(screen.getByRole("button", { name: /^Move to validated$/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe("/api/findings/fnd_1/transition");
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.to_status).toBe("validated");
    expect(body.reason).toBe("Survived every check.");
    expect(Object.values(body.checks as Record<string, boolean>))
      .toEqual(REQUIRED_CHECKS.map(() => true));
  });

  it("tells the screen to reread the finding once it has moved", async () => {
    vi.spyOn(api, "post").mockResolvedValue({});
    const moved = vi.fn();
    mount("candidate", 3, moved);
    await userEvent.click(screen.getByRole("button", { name: /Move to exploratory/ }));
    await userEvent.type(screen.getByRole("textbox"), "It replicated.");
    await userEvent.click(screen.getByRole("button", { name: /^Move to exploratory$/ }));
    await waitFor(() => expect(moved).toHaveBeenCalled());
  });
});

describe("when the server refuses", () => {
  it("repeats which checks are missing, rather than 'could not promote'", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(
      422, "Cannot validate without these robustness checks: missingness, outliers"));
    mount("exploratory");
    await userEvent.click(screen.getByRole("button", { name: /Move to validated/ }));
    await userEvent.type(screen.getByRole("textbox"), "Looks fine.");
    await userEvent.click(screen.getByRole("button", { name: /^Move to validated$/ }));

    expect(await screen.findByText(/missingness, outliers/)).toBeTruthy();
  });

  it("repeats that there is no evidence, and keeps the form open", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new ApiError(
      409, "Finding fnd_1 has no linked evidence and cannot become exploratory."));
    mount("candidate", 0);
    await userEvent.click(screen.getByRole("button", { name: /Move to exploratory/ }));
    await userEvent.type(screen.getByRole("textbox"), "It looks real.");
    await userEvent.click(screen.getByRole("button", { name: /^Move to exploratory$/ }));

    // Specifically in the alert: the standing note above also says there is no
    // evidence, and matching either of them would not prove the refusal was
    // reported at all.
    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("no linked evidence");
    expect(screen.getByRole("button", { name: /^Move to exploratory$/ })).toBeTruthy();
  });
});
