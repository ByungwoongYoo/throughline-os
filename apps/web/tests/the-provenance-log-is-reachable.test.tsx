/**
 * The provenance log has a control on the screen it describes.
 *
 * A capability with no control is a capability nobody has — §74 twice over.
 * This one sits on the finding's own screen rather than with the other
 * exports, because it is about a particular result: a researcher wants it
 * while looking at the thing it describes.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProvenanceLogLink } from "@/components/provenancelog";

afterEach(cleanup);

describe("taking the reproducibility record away", () => {
  it("offers a download for the finding it was given", () => {
    render(<ProvenanceLogLink findingId="fnd_1" />);
    const link = screen.getByRole("link", { name: /provenance log/i });

    expect(link.getAttribute("href")).toBe("/api/findings/fnd_1/provenance.md");
    // Saved, not navigated to: a Markdown file rendered in a tab is something
    // somebody has to copy out by hand.
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("says what is in the file, since the link alone would not", () => {
    render(<ProvenanceLogLink findingId="fnd_1" />);
    expect(screen.getByText(/seed/i)).toBeTruthy();
    expect(screen.getByText(/library versions/i)).toBeTruthy();
    expect(screen.getByText(/hash of the data/i)).toBeTruthy();
  });

  it("points at whichever finding is open", () => {
    render(<ProvenanceLogLink findingId="fnd_other" />);
    expect(screen.getByRole("link", { name: /provenance log/i })
      .getAttribute("href")).toContain("fnd_other");
  });
});
