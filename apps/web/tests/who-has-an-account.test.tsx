/**
 * The list of people with an account on this installation.
 *
 * The panel's own sentence is "Everyone with an account on this installation.
 * There is no public sign-up: accounts are added from inside, by someone
 * already signed in." Directly beneath it, the list mapped over `people?.` —
 * and a failed request set `people` to `null`, which draws no rows.
 *
 * So a reader who is themselves signed in, and who therefore knows at least
 * one account exists, was shown a list saying there are none. It is the same
 * defect as the excerpt board (D233) and the link suggester (D235): an
 * absence rendered identically to a refusal, under a sentence that turns the
 * absence into a claim.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Accounts } from "@/components/settings";
import { ApiError, api } from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const PEOPLE = [
  { id: "usr_1", display_name: "Ada", email: "ada@example.org", is_admin: true },
];

describe("who has an account here", () => {
  it("says the list could not be read rather than showing no one", async () => {
    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError(503, "The accounts service is unavailable."));

    render(<Accounts />);

    await waitFor(() =>
      expect(screen.getByText(/accounts service is unavailable/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeTruthy();
  });

  it("lists the people when the list was read", async () => {
    // The other half: an empty list has to mean there is nobody, and it only
    // means that if the case where nobody found out looks different.
    vi.spyOn(api, "get").mockResolvedValue(PEOPLE as never);

    render(<Accounts />);

    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /try again|retry/i })).toBeNull();
  });
});
