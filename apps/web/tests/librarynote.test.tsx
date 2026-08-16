/**
 * Previewing a finding as a library note.
 *
 * The write path is built, tested and idempotent — and has never made a call
 * against a real Zotero library. So this ships the half that cannot damage
 * anything, and the most important test here asserts the absence of a button:
 * a write into a decade of somebody's accumulated reading is not a thing to
 * offer on the strength of a passing test suite.
 *
 * The other half is that the preview must be the note. A preview that differs
 * from what would be sent is not a preview, which is why the HTML is rendered
 * as composed rather than reformatted for the screen.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LibraryNote } from "@/components/librarynote";
import * as useApiModule from "@/lib/useApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const HTML = [
  "<h2>Consumption tracks resistance</h2>",
  "<p>Higher consumption is associated with higher resistance.</p>",
  "<p><b>Causation.</b> Causation was not assessed.</p>",
  "<p><b>Multiple comparisons.</b> 24 tests were run on this data.</p>",
].join("\n");

function serve(data: unknown, extra: Record<string, unknown> = {}) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue({
    data, error: null, loading: false, reload: vi.fn(), ...extra,
  } as never);
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: /Preview this as a library note/ }));
}

describe("nothing is fetched until asked", () => {
  it("starts closed, so opening a finding does not compose a note", () => {
    serve(null);
    render(<LibraryNote projectId="prj_1" findingId="fnd_1" sessionId="ses_1" />);

    expect(screen.getByRole("button", { name: /Preview this as a library note/ }))
      .toBeInTheDocument();
    expect(screen.queryByText(/As a library note/)).not.toBeInTheDocument();
  });
});

describe("the preview is the note", () => {
  it("renders the composed note rather than a summary of it", () => {
    serve({ finding_id: "fnd_1", html: HTML });
    render(<LibraryNote projectId="prj_1" findingId="fnd_1" sessionId="ses_1" />);
    open();

    expect(screen.getByText("Consumption tracks resistance")).toBeInTheDocument();
    expect(screen.getByText(/Causation was not assessed/)).toBeInTheDocument();
  });

  it("carries the caveats that have to survive leaving this system", () => {
    /**
     * A note read years later, by someone without the context, in a tool that
     * cannot link back here. Everything needed to judge the claim is inside it.
     */
    serve({ finding_id: "fnd_1", html: HTML });
    render(<LibraryNote projectId="prj_1" findingId="fnd_1" sessionId="ses_1" />);
    open();

    expect(screen.getByText(/24 tests were run/)).toBeInTheDocument();
  });

  it("does not execute markup that arrived in the composed note", () => {
    /**
     * The composer escapes every value it interpolates, so a finding titled
     * with a script tag arrives inert. This asserts the end of that chain:
     * what reaches the page is text, not a live element.
     */
    serve({
      finding_id: "fnd_1",
      html: "<h2>&lt;script&gt;alert(1)&lt;/script&gt;</h2>",
    });
    const { container } = render(
      <LibraryNote projectId="prj_1" findingId="fnd_1" sessionId="ses_1" />);
    open();

    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
  });
});

describe("what is deliberately not offered", () => {
  it("has no button that writes to a library", () => {
    /**
     * The test that matters most here. The write path has never run against a
     * real library, and a reference library is not version-controlled and has
     * no undo.
     */
    serve({ finding_id: "fnd_1", html: HTML });
    render(<LibraryNote projectId="prj_1" findingId="fnd_1" sessionId="ses_1" />);
    open();

    for (const label of [/send/i, /write/i, /export to zotero/i, /save to/i]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("says why, rather than leaving the absence to be noticed", () => {
    serve({ finding_id: "fnd_1", html: HTML });
    render(<LibraryNote projectId="prj_1" findingId="fnd_1" sessionId="ses_1" />);
    open();

    expect(screen.getByText(/never run against a real library/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been written anywhere/)).toBeInTheDocument();
  });
});

describe("failure", () => {
  it("reports it instead of showing an empty note", () => {
    serve(null, { error: new Error("No such finding") });
    render(<LibraryNote projectId="prj_1" findingId="fnd_1" sessionId="ses_1" />);
    open();

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
