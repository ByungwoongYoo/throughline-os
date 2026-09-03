/**
 * What a researcher is told the moment their finding is recorded.
 *
 * `RecordFinding` sends `from_connections`, and a finding recorded from a
 * connection now carries the analysis behind it as its evidence. The success
 * message still said "Promoting it needs evidence attached" — which was true
 * when nothing in the product could attach any, and now sends a researcher
 * looking for a step that has already happened.
 *
 * The same wrong sentence was on the overview screen. This is its other half.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordFinding } from "@/components/recordfinding";
import { api } from "@/lib/api";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

function record(validated = true) {
  vi.spyOn(api, "post").mockResolvedValue({ finding_id: "fnd_1" } as never);
  render(
    <RecordFinding
      projectId="prj_1"
      connectionId="con_1"
      defaultTitle="Consumption tracks resistance"
      validated={validated}
    />,
  );
}

async function submit() {
  screen.getByRole("button", { name: /record a finding/i }).click();
  await waitFor(() => screen.getByRole("button", { name: /^record it$/i }));
  screen.getByRole("button", { name: /^record it$/i }).click();
  await waitFor(() => screen.getByText(/Recorded as a finding/i));
}

describe("the message after a finding is recorded", () => {
  it("sends the connection, so the evidence travels with it", async () => {
    record();
    await submit();
    expect(api.post).toHaveBeenCalledWith(
      expect.stringContaining("/findings"),
      expect.objectContaining({ from_connections: ["con_1"] }),
    );
  });

  it("does not tell the researcher to go and attach evidence", async () => {
    record();
    await submit();
    expect(screen.queryByText(/needs evidence attached/i)).toBeNull();
  });

  it("says the analysis behind it is its evidence", async () => {
    record();
    await submit();
    expect(screen.getByText(/analysis behind/i)).toBeTruthy();
  });

  it("still says a promotion has to be earned", async () => {
    /**
     * The rule the old sentence was protecting is real and must survive the
     * rewrite: having evidence is not the same as having passed the checks.
     */
    record();
    await submit();
    expect(screen.getByText(/candidate/i)).toBeTruthy();
  });
});
