/**
 * The version panel, and the two things it must not do.
 *
 * **It must not check on its own.** T073's first line is "never automatic", and
 * an effect that checked on mount would make it automatic by accident — every
 * visit to Settings becoming a network request nobody remembers agreeing to.
 * So there is a test that opening the panel reaches the version endpoint and
 * nothing else.
 *
 * **It must not report a failed check as being up to date.** Those render
 * identically and only one of them is true. A researcher on a train told they
 * are current has been told something false by a tool whose whole argument is
 * that it does not do that.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VersionPanel } from "@/components/settings";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const VERSION = {
  version: "beta-4",
  source: "release",
  commit: null,
  modified: false,
  note: "Built and stamped when this release was made.",
};

function stubFetch(byPath: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = Object.keys(byPath).find((k) => url.includes(k));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(key ? byPath[key] : {}),
      } as Response;
    });
}

describe("the version panel", () => {
  it("shows the running version without being asked", async () => {
    stubFetch({ "/api/system/version": VERSION });
    render(<VersionPanel />);
    await waitFor(() => expect(screen.getByText("beta-4")).toBeTruthy());
  });

  it("does not check for updates on its own", async () => {
    /** The one that keeps "never automatic" true. */
    const fetchSpy = stubFetch({ "/api/system/version": VERSION });
    render(<VersionPanel />);
    await waitFor(() => expect(screen.getByText("beta-4")).toBeTruthy());

    const checked = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/check"));
    expect(checked).toEqual([]);
  });

  it("checks when the button is pressed", async () => {
    const fetchSpy = stubFetch({
      "/api/system/version/check": { checked: true, update_available: false,
                                     channel: "main", following: "the main branch" },
      "/api/system/version": VERSION,
    });
    render(<VersionPanel />);
    await waitFor(() => expect(screen.getByText("beta-4")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Check for updates/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/system/version/check", expect.objectContaining({ method: "POST" })));
  });

  it("says it could not check, rather than saying up to date", async () => {
    /** The failure this panel exists to get right. */
    stubFetch({
      "/api/system/version/check": {
        checked: false, reason: "Could not reach the remote: no route to host",
      },
      "/api/system/version": VERSION,
    });
    render(<VersionPanel />);
    await waitFor(() => expect(screen.getByText("beta-4")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Check for updates/ }));

    await waitFor(() => expect(screen.getByText(/Could not check/)).toBeTruthy());
    expect(screen.queryByText(/Up to date/)).toBeNull();
  });

  it("names the command when an update exists, and says it backs up first", async () => {
    stubFetch({
      "/api/system/version/check": {
        checked: true, update_available: true, behind: 3, channel: "main",
        following: "the main branch", how: "python scripts/manage.py update",
      },
      "/api/system/version": VERSION,
    });
    render(<VersionPanel />);
    await waitFor(() => expect(screen.getByText("beta-4")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Check for updates/ }));

    await waitFor(() => expect(
      screen.getByText("python scripts/manage.py update")).toBeTruthy());
    // The reassurance that makes somebody willing to run it.
    expect(screen.getByText(/backs\s+up your database first/)).toBeTruthy();
  });

  it("admits an unknown version rather than inventing one", async () => {
    stubFetch({
      "/api/system/version": {
        version: null, source: "unknown", commit: null, modified: false,
        note: "No VERSION file and no git checkout.",
      },
    });
    render(<VersionPanel />);
    await waitFor(() => expect(screen.getByText("unknown")).toBeTruthy());
  });
});
