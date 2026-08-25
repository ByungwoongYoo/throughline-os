/**
 * The first button a new researcher ever presses.
 *
 * T003 shipped the worked example with a stated caveat: nothing proved the
 * button reached the endpoint. The reason was structural — `FirstProject` was
 * module-private inside `page.tsx`, so the one control standing between a new
 * account and a working project was the one control no test could import.
 *
 * The endpoint has always been covered (`tests/test_worked_example.py` builds
 * the project through the real pipeline). What was uncovered is the wire
 * between them, which is where a dead button lives.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FirstProject } from "@/components/FirstProject";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const USER = { display_name: "Dr Chen" } as never;

function stubFetch(response: Partial<Response> & { ok: boolean }) {
  return vi.spyOn(globalThis, "fetch")
    .mockResolvedValue({ text: async () => "", ...response } as Response);
}

describe("opening the worked example", () => {
  it("posts to the example endpoint", async () => {
    const fetchSpy = stubFetch({ ok: true });
    render(<FirstProject onCreated={vi.fn()} user={USER} />);

    fireEvent.click(screen.getByRole("button", { name: /Open a worked example/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects/example", { method: "POST" }));
  });

  it("tells the workspace to reload once it exists", async () => {
    /** Without this the project is created and the screen never moves. */
    stubFetch({ ok: true });
    const onCreated = vi.fn();
    render(<FirstProject onCreated={onCreated} user={USER} />);

    fireEvent.click(screen.getByRole("button", { name: /Open a worked example/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("says what failed rather than going quiet", async () => {
    /**
     * §104 — a dead button teaches nothing. This is a researcher's first
     * interaction with the product, and a silent failure here is the worst
     * possible first impression: nothing happened and nothing said why.
     */
    stubFetch({ ok: false, status: 500, text: async () => "the database is unreachable" });
    render(<FirstProject onCreated={vi.fn()} user={USER} />);

    fireEvent.click(screen.getByRole("button", { name: /Open a worked example/ }));

    expect(await screen.findByText(/could not be created/)).toBeInTheDocument();
    expect(screen.getByText(/database is unreachable/)).toBeInTheDocument();
  });

  it("re-enables the button after a failure", async () => {
    /**
     * A failure that leaves the control disabled is indistinguishable from a
     * broken product — the researcher cannot even retry.
     */
    stubFetch({ ok: false, status: 500, text: async () => "nope" });
    render(<FirstProject onCreated={vi.fn()} user={USER} />);

    const button = screen.getByRole("button", { name: /Open a worked example/ });
    fireEvent.click(button);

    await screen.findByText(/could not be created/);
    expect(button).not.toBeDisabled();
  });

  it("offers a blank project as well as the example", () => {
    /**
     * The example is offered first deliberately, but a researcher who came
     * with their own question must not have to open someone else's data first.
     */
    render(<FirstProject onCreated={vi.fn()} user={USER} />);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
  });
});
