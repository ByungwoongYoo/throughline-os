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
import {
  ProvenanceLogLink, ReplayReceiptLink, ReproductionScriptLink,
} from "@/components/provenancelog";

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

describe("taking the script away", () => {
  it("offers the reproduction script for the run it was given", () => {
    render(<ReproductionScriptLink runId="arun_1" />);
    const link = screen.getByRole("link", { name: /download the script/i });
    expect(link.getAttribute("href")).toBe("/api/analyses/arun_1/reproduce.py");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("says what the script does not do", () => {
    /**
     * The misreading this exists to prevent: a script that prints a p-value
     * looks like the whole analysis. It is one step of it, without the
     * correction that decided whether the result stood.
     */
    render(<ReproductionScriptLink runId="arun_1" />);
    expect(screen.getByText(/not a finding/i)).toBeTruthy();
    expect(screen.getByText(/assumption checks/i)).toBeTruthy();
  });
});

describe("taking the replay contract away", () => {
  it("offers a receipt beside the recorded run", () => {
    render(<ReplayReceiptLink runId="arun_1" />);
    const link = screen.getByRole("link", { name: /replay receipt/i });
    expect(link.getAttribute("href")).toBe("/api/analyses/arun_1/receipt.json");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("states that the receipt is one-run evidence, not a finding replay", () => {
    render(<ReplayReceiptLink runId="arun_1" />);
    expect(screen.getByText(/one analysis run/i)).toBeTruthy();
    expect(screen.getByText(/not the assumption checks/i)).toBeTruthy();
  });
});
