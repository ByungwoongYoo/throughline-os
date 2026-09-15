/**
 * The administrator's controls, offered to the administrator (T166).
 *
 * The server now refuses the machine-level actions to anyone else — installing
 * packs, the model and its key, adding people, the desktop entry, and opening
 * sign-up to the network. A screen that still offered them would hand a
 * researcher buttons that only ever answer 403. So a non-administrator sees the
 * state and a sentence saying who can change it; the administrator sees the
 * controls.
 *
 * And the switch the docs promised: "turn on open registration in Settings"
 * pointed at a control that did not exist.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { Accounts, RegistrationPanel } from "@/components/settings";
import { api } from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const PEOPLE = [
  { id: "u1", email: "admin@lab.local", display_name: "Admin", is_admin: true },
  { id: "u2", email: "researcher@lab.local", display_name: "Researcher", is_admin: false },
];

describe("adding people", () => {
  it("is offered to the administrator", async () => {
    vi.spyOn(api, "get").mockResolvedValue(PEOPLE as never);
    render(<Accounts isAdmin />);

    expect(await screen.findByRole("button", { name: /add person/i })).toBeTruthy();
  });

  it("is not offered to anyone else, who is told who can", async () => {
    vi.spyOn(api, "get").mockResolvedValue(PEOPLE as never);
    render(<Accounts isAdmin={false} />);

    await screen.findByText("researcher@lab.local");
    expect(screen.queryByRole("button", { name: /add person/i })).toBeNull();
    expect(screen.getByText(/only the administrator of this installation can add people/i))
      .toBeTruthy();
    // Everyone still sees who has access: the list is not the administrator's.
    expect(screen.getByText("admin@lab.local")).toBeTruthy();
  });
});

describe("sign-up from the network", () => {
  it("says it is closed, and gives the administrator the switch", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ open: false, can_change: true } as never);
    render(<RegistrationPanel />);

    expect(await screen.findByText(/closed: accounts can only be created at this machine/i))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: /open sign-up to the network/i })).toBeTruthy();
  });

  it("asks before opening it, and opens it once confirmed", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ open: false, can_change: true } as never);
    const put = vi.spyOn(api, "put").mockResolvedValue({ open: true, can_change: true } as never);
    render(<RegistrationPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /open sign-up to the network/i }));
    // Nothing is sent until the consequence has been read.
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^open sign-up$/i }));

    await waitFor(() => expect(put).toHaveBeenCalledWith(
      "/api/system/registration", { open: true }));
    expect(await screen.findByText(/open: people on the network can create accounts/i))
      .toBeTruthy();
  });

  it("closes without asking — closing is the safe direction", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ open: true, can_change: true } as never);
    const put = vi.spyOn(api, "put").mockResolvedValue({ open: false, can_change: true } as never);
    render(<RegistrationPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /close sign-up/i }));

    await waitFor(() => expect(put).toHaveBeenCalledWith(
      "/api/system/registration", { open: false }));
  });

  it("shows anyone else the state and who can change it, with no switch", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ open: true, can_change: false } as never);
    render(<RegistrationPanel />);

    expect(await screen.findByText(/open: people on the network can create accounts/i))
      .toBeTruthy();
    expect(screen.queryByRole("button", { name: /sign-up/i })).toBeNull();
    expect(screen.getByText(/only the administrator of this installation can change this/i))
      .toBeTruthy();
  });

  it("states nothing when the server did not say", async () => {
    // A response without `open` is not "closed"; reading it as closed would be
    // a fact nobody reported.
    vi.spyOn(api, "get").mockResolvedValue({} as never);
    render(<RegistrationPanel />);

    await screen.findByRole("heading", { name: /sign-up from the network/i });
    expect(screen.queryByText(/closed:/i)).toBeNull();
    expect(screen.queryByText(/open:/i)).toBeNull();
  });
});

describe("the workspace tells Settings who is signed in", () => {
  it("passes the real role, so the default is never what a researcher sees", async () => {
    /*
     * `isAdmin` defaults to offering the controls — the server is the gate, so
     * a forgotten prop is less helpful, never a hole. But forgotten here, every
     * researcher would be offered buttons that answer 403, and no rendering test
     * would notice. So the wiring is read from source.
     */
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const page = readFileSync(resolve(__dirname, "../app/workspace/page.tsx"), "utf8");
    expect(page).toMatch(/<Settings[^>]*isAdmin=\{user\.is_admin === true\}/);
  });
});
