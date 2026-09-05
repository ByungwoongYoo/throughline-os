/**
 * The sign-in gate offers both doors as equal, labelled choices (T135, plan §4.2).
 *
 * The landing page's only button lands a brand-new visitor here, and they used
 * to meet "Welcome back" with "Sign in" as the primary and account creation as
 * an underlined link in body text — the walkthrough harness had to find and
 * press that link to get in. Now both paths are buttons, and the one that leads
 * depends on whether this browser has ever signed in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Home from "@/app/workspace/page";

const STATUS = { needs_setup: false, authenticated: false, user: null };

function gate() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input).split("?")[0];
    if (path.endsWith("/api/auth/status")) {
      return { ok: true, status: 200, text: async () => JSON.stringify(STATUS) } as Response;
    }
    return { ok: true, status: 200, text: async () => "{}" } as Response;
  });
  return render(<Home />);
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the gate on a browser that has never signed in", () => {
  it("leads with creating an account, and shows both choices as buttons", async () => {
    gate();
    const create = await screen.findByRole("button", { name: "Create an account" });
    const existing = screen.getByRole("button", { name: "I already have an account" });
    expect(create).toHaveAttribute("aria-pressed", "true");
    expect(create.className).toContain("btn-primary");
    expect(existing).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create your account");
    // The name field is part of creating, and the form says what it asks.
    expect(screen.getByPlaceholderText("Dr Chen")).toBeInTheDocument();
  });

  it("switches to signing in without a link buried in a sentence", async () => {
    gate();
    fireEvent.click(await screen.findByRole("button", { name: "I already have an account" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome back"));
    expect(screen.queryByText(/New here\?/)).toBeNull();
  });
});

describe("the gate on a browser that has signed in before", () => {
  it("leads with signing in", async () => {
    window.localStorage.setItem("throughline.account", "1");
    gate();
    const existing = await screen.findByRole("button", { name: "I already have an account" });
    expect(existing).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome back");
  });
});
