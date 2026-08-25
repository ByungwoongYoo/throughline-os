/**
 * The panel that finally links the launchers to the product.
 *
 * They have existed since T071 and were mentioned only in the README — which is
 * the wrong place by definition, because T071 exists for somebody who has never
 * opened a terminal, and that person is not reading a markdown file in a
 * repository.
 *
 * The two properties worth pinning are about restraint rather than function:
 * only this machine's door is shown, and the security warning arrives before
 * the click rather than after it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StartingPanel } from "@/components/settings";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const MAC = {
  platform: "darwin", supported: true,
  file: "launchers/Throughline.command",
  path: "/app/launchers/Throughline.command", present: true,
  how: "Double-click it in Finder.",
  warning: "Unsigned, so the first time macOS will refuse it. Right-click the file and choose Open, once.",
  needs_desktop_entry: false, desktop_entry_installed: null,
  command: "python scripts/manage.py start",
};

const LINUX = {
  ...MAC, platform: "linux", file: "launchers/throughline.sh",
  path: "/app/launchers/throughline.sh", warning: null,
  how: "Add Throughline to your applications menu, then launch it from there.",
  needs_desktop_entry: true, desktop_entry_installed: false,
};

function stub(byPath: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = Object.keys(byPath).find((k) => url.includes(k));
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify(key ? byPath[key] : {}),
      } as Response;
    });
}

describe("Starting Throughline", () => {
  it("names the launcher for this machine", async () => {
    stub({ "/api/system/launchers": MAC });
    render(<StartingPanel />);
    await waitFor(() => expect(
      screen.getByText("launchers/Throughline.command")).toBeTruthy());
  });

  it("shows only this platform's door", async () => {
    /** Choosing between three is work the software has already done. */
    stub({ "/api/system/launchers": MAC });
    const { container } = render(<StartingPanel />);
    await waitFor(() => expect(
      screen.getByText("launchers/Throughline.command")).toBeTruthy());
    expect(container.textContent).not.toMatch(/Throughline\.bat|throughline\.sh/);
  });

  it("warns about the unsigned first run before it happens", async () => {
    stub({ "/api/system/launchers": MAC });
    render(<StartingPanel />);
    await waitFor(() => expect(screen.getByText(/Right-click/)).toBeTruthy());
  });

  it("always offers the terminal command as well", async () => {
    /** The launcher is the convenience; the command is what somebody can read,
     *  paste into an issue, or fall back to. */
    stub({ "/api/system/launchers": MAC });
    render(<StartingPanel />);
    await waitFor(() => expect(
      screen.getByText("python scripts/manage.py start")).toBeTruthy());
  });

  it("offers the menu entry on Linux, where a clicked script does nothing", async () => {
    stub({ "/api/system/launchers": LINUX });
    render(<StartingPanel />);
    await waitFor(() => expect(
      screen.getByRole("button", { name: /Add to applications menu/ })).toBeTruthy());
  });

  it("does not offer a menu entry where it means nothing", async () => {
    stub({ "/api/system/launchers": MAC });
    render(<StartingPanel />);
    await waitFor(() => expect(screen.getByText(/Right-click/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /applications menu/ })).toBeNull();
  });

  it("posts when the menu entry is asked for", async () => {
    const spy = stub({
      "/api/system/launchers/desktop-entry": { installed: true, note: "Added." },
      "/api/system/launchers": LINUX,
    });
    render(<StartingPanel />);
    await waitFor(() => expect(
      screen.getByRole("button", { name: /Add to applications menu/ })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Add to applications menu/ }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith(
      "/api/system/launchers/desktop-entry",
      expect.objectContaining({ method: "POST" })));
  });

  it("says when the launcher is not in this installation", async () => {
    /** Pointing somebody at a file that is not on their disk costs more trust
     *  than saying nothing. */
    stub({ "/api/system/launchers": { ...MAC, present: false } });
    render(<StartingPanel />);
    await waitFor(() => expect(
      screen.getByText(/not in this installation/)).toBeTruthy());
  });

  it("still names a way in on a platform with no door", async () => {
    stub({ "/api/system/launchers": {
      platform: "freebsd14", supported: false,
      note: "There is no double-click launcher for freebsd14. Start it with: python scripts/manage.py start",
    } });
    render(<StartingPanel />);
    await waitFor(() => expect(screen.getByText(/no double-click launcher/)).toBeTruthy());
  });
});
