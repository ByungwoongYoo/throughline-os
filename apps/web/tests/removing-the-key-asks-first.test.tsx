/**
 * The stored API key is not removed by one click.
 *
 * §96 asks for a confirmation step before a destructive action, and this was
 * the one place in the product that had none: a `btn-danger` labelled
 * "Remove", and the key was gone. It is a credential the researcher has to go
 * back to the provider for, and may not have kept anywhere else.
 *
 * `ConfirmDialog` was already here for deleting a project. What matters is not
 * that the component is imported — a dialog that renders and is ignored is
 * worse than none — but that nothing is deleted until somebody confirms.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Models, Settings } from "@/components/settings";
import { api } from "@/lib/api";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

/** The shape `/api/system/models` really returns — typed against the
 *  component's own `Models`, because an object literal is a second copy of a
 *  contract and drifts from it silently.
 *
 *  That sentence was true of neither half for a while. The literal was not
 *  typed against anything — it was cast `as never` at the call site — and it
 *  had drifted exactly as the comment warned: `source: "saved"` is a value
 *  `registry.selection()` cannot produce (it says "chosen in the interface"
 *  or "environment"), and `saved`, sent on every response, was missing. Now
 *  it is checked with `satisfies`, so the next drift fails to compile. */
const MODELS = {
  hosted: {
    provider: "anthropic", model: "claude-opus-4", key_saved: true,
    key_hint: "abcd", local: false, billed: "per token",
    warning: "",
  },
  installed: [],
  selection: { provider: "anthropic", model: "claude-opus-4",
               source: "chosen in the interface" },
  saved: { provider: "anthropic", model: "claude-opus-4" },
  active: {
    name: "Claude", model: "claude-opus-4", usable: true, local: false,
    structured: true, note: null,
  },
  history: [],
  note: null,
  how_to_install: "",
} satisfies Models;

function serve() {
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.includes("/system/models")) return MODELS as never;
    if (path.includes("/capabilities")) return { packs: {} } as never;
    if (path.includes("/accounts")) return [] as never;
    if (path.includes("/version")) return { version: "1.8.0" } as never;
    return {} as never;
  });
  return vi.spyOn(api, "del").mockResolvedValue({ note: "removed" } as never);
}

async function remove() {
  const button = await screen.findByRole("button", { name: /^remove$/i });
  fireEvent.click(button);
}

describe("removing the saved key", () => {
  it("does not delete anything on the first click", async () => {
    const del = serve();
    render(<Settings />);
    await remove();

    // The whole point: the click opens a question, it does not act.
    await waitFor(() => expect(screen.getByText(/Remove the saved API key\?/i))
      .toBeTruthy());
    expect(del).not.toHaveBeenCalled();
  });

  it("says what is lost and what is not", async () => {
    serve();
    render(<Settings />);
    await remove();
    expect(await screen.findByText(/comes from\s+the provider/i)).toBeTruthy();
    expect(screen.getByText(/analyses and everything already recorded are/i))
      .toBeTruthy();
  });

  it("deletes once it is confirmed", async () => {
    const del = serve();
    render(<Settings />);
    await remove();
    fireEvent.click(await screen.findByRole("button", { name: /remove key/i }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/api/system/model-key"));
  });

  it("leaves the key alone when the question is declined", async () => {
    const del = serve();
    render(<Settings />);
    await remove();
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    // happy-dom leaves a closed `<dialog>`'s content in the document, so the
    // title is still queryable — the state that matters is whether the dialog
    // is open, and whether anything was deleted.
    await waitFor(() =>
      expect(document.querySelector("dialog")?.hasAttribute("open"))
        .toBeFalsy());
    expect(del).not.toHaveBeenCalled();
  });
});


/**
 * A saved choice that did not take.
 *
 * Startup re-applies the saved model so it does not "silently revert to the
 * environment default on every restart". When that fails it logs and carries
 * on, and `selection` truthfully says "environment" — while the choice itself
 * was sent and never shown. The drift that hook exists to prevent became
 * invisible in exactly the case where it happened.
 */
describe("a saved model choice that could not be applied", () => {
  function serveWith(models: Models) {
    vi.spyOn(api, "get").mockImplementation(async (path: string) => {
      if (path.includes("/system/models")) return models as never;
      if (path.includes("/capabilities")) return { packs: {} } as never;
      if (path.includes("/accounts")) return [] as never;
      if (path.includes("/version")) return { version: "1.8.0" } as never;
      return {} as never;
    });
  }

  it("says the choice exists and is not the one in use", async () => {
    serveWith({
      ...MODELS,
      selection: { provider: "ollama", model: null, source: "environment" },
    });
    render(<Settings />);

    const said = await screen.findByText(/could not be applied when/);
    expect(said.textContent).toMatch(/anthropic · claude-opus-4/);
    expect(said.getAttribute("role")).toBe("status");
  });

  it("says nothing when the saved choice is the one in use", async () => {
    serveWith(MODELS);
    render(<Settings />);

    await screen.findByText(/chosen in the interface/);
    expect(screen.queryByText(/could not be applied when/)).toBeNull();
  });

  it("says nothing when nothing was ever saved", async () => {
    // "environment" with no saved choice is the ordinary first-run state,
    // not a failure.
    serveWith({
      ...MODELS, saved: null,
      selection: { provider: "ollama", model: null, source: "environment" },
    });
    render(<Settings />);

    await screen.findByText("environment");
    expect(screen.queryByText(/could not be applied when/)).toBeNull();
  });
});
