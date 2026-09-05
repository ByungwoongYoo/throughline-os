/**
 * The fragility panel.
 *
 * The risk with a single number is that it becomes a score: quoted bare, an
 * E-value reads like a quality mark and invites comparison across unrelated
 * results. So these tests hold down that the number never appears without what
 * it means, what it rests on, and its refusal to be read as evidence of
 * causation — and that a method it cannot convert is explained rather than
 * shown as an error or hidden.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Fragility } from "@/components/fragility";
import { api } from "@/lib/api";

const REPORT = {
  variables: ["rainfall", "yield"],
  estimate: 0.4,
  e_value: 2.6,
  e_value_limit: 1.42,
  headline: 1.42,
  interval_note: "The confidence limit nearest the null is 0.1.",
  assumptions: [
    "The correlation was converted to a risk ratio by d = 2r / sqrt(1 - r^2).",
    "An E-value is conditional on the association being real.",
  ],
  sentence:
    "E-value (the confidence limit nearest the null): 1.42.\n" +
    "An unmeasured confounder would need to be associated with both variables " +
    "by a risk ratio of at least 1.42 each.\n" +
    "This is not evidence that one variable affects the other.",
};

describe("how fragile is this", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the number, labelled, under the sentence", async () => {
    vi.spyOn(api, "get").mockResolvedValue(REPORT as never);

    render(<Fragility connectionId="con_1" />);

    expect(await screen.findByText("1.42")).toBeTruthy();
    // Labelled in words, and glossed on first use (D207): a bare 1.42 is a
    // quantity with no claim attached.
    // The label above the figure, not the server's own sentence lower down.
    expect(screen.getByText("E-value")).toBeTruthy();
    expect(screen.getByText(
      /how much stronger than everything measured an unmeasured cause/))
      .toBeTruthy();
  });

  it("answers the heading with a sentence before it shows a number", async () => {
    /**
     * Item 2.11, and ResultCard's law applied here: the panel answered "how
     * fragile is this?" with a 2.4rem "1.42" and put the sentence that made
     * it mean something underneath, where it reached a reader who had already
     * formed an impression of the number.
     */
    vi.spyOn(api, "get").mockResolvedValue(REPORT as never);

    const { container } = render(<Fragility connectionId="con_1" />);
    await screen.findByText("1.42");

    const first = container.querySelector("section.fragility h2 + p");
    const text = first?.textContent?.trim() ?? "";
    expect(text).not.toMatch(/^[\d.]/);
    expect(text.split(/\s+/).length).toBeGreaterThanOrEqual(8);
    // The number the sentence carries is the server's, said in words rather
    // than recomputed.
    expect(text).toMatch(/1.42 times stronger/);
  });

  it("says a fragile result would not take much, in the same sentence", async () => {
    vi.spyOn(api, "get").mockResolvedValue(
      { ...REPORT, headline: 1.05 } as never);

    render(<Fragility connectionId="con_1" />);

    expect(await screen.findByText(/would be enough to explain this away/))
      .toBeTruthy();
  });

  it("keeps the assumptions closed, behind a summary that says what they are",
     async () => {
    /**
     * Principle 4 — depth may be layered, but a closed summary has to state
     * what is inside it, or the layering is a hide.
     */
    vi.spyOn(api, "get").mockResolvedValue(REPORT as never);

    const { container } = render(<Fragility connectionId="con_1" />);
    await screen.findByText("1.42");

    const details = container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent)
      .toMatch(/2 assumptions behind the conversion/);
  });

  it("names both variables the confounder would have to touch", async () => {
    vi.spyOn(api, "get").mockResolvedValue(REPORT as never);

    render(<Fragility connectionId="con_1" />);

    expect(await screen.findByText(/rainfall/)).toBeTruthy();
    expect(screen.getByText(/yield/)).toBeTruthy();
  });

  it("never shows the number without refusing a causal reading", async () => {
    vi.spyOn(api, "get").mockResolvedValue(REPORT as never);

    render(<Fragility connectionId="con_1" />);

    await screen.findByText("1.42");
    expect(screen.getByText(/not evidence that one variable affects the other/))
      .toBeTruthy();
  });

  it("carries the assumptions the conversion rests on", async () => {
    vi.spyOn(api, "get").mockResolvedValue(REPORT as never);

    render(<Fragility connectionId="con_1" />);

    expect(await screen.findByText(/converted to a risk ratio/)).toBeTruthy();
    expect(screen.getByText(/conditional on the association being real/))
      .toBeTruthy();
  });

  it("explains a method it cannot convert, rather than showing an error", async () => {
    /**
     * Not every connection is a correlation. A red failure banner would say
     * something is broken, and silence would leave a researcher unsure whether
     * the number was withheld or never existed.
     */
    vi.spyOn(api, "get").mockRejectedValue(new Error("not defined for linear_regression"));

    render(<Fragility connectionId="con_1" />);

    await waitFor(() =>
      expect(screen.getByText(/no number is shown rather than a confident one/))
        .toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks a fragile result without turning the number into a pass mark",
     async () => {
    vi.spyOn(api, "get").mockResolvedValue(
      { ...REPORT, headline: 1.05, e_value_limit: 1.05 } as never);

    render(<Fragility connectionId="con_1" />);

    const value = await screen.findByText("1.05");
    expect(value.getAttribute("data-fragile")).toBe("yes");
  });

  it("does not mark a robust result as fragile", async () => {
    vi.spyOn(api, "get").mockResolvedValue(
      { ...REPORT, headline: 4.2, e_value_limit: 4.2 } as never);

    render(<Fragility connectionId="con_1" />);

    const value = await screen.findByText("4.20");
    expect(value.getAttribute("data-fragile")).toBe("no");
  });

  it("says no number rather than crashing on a body without one", async () => {
    /**
     * Found by the connection screen's own tests, whose fixtures answer every
     * `api.get` with connection data: this panel read the number off one of
     * them and took the whole screen down. In the product the same shape
     * arrives from a response that changed underneath a running client.
     */
    vi.spyOn(api, "get").mockResolvedValue({ id: "con_1", method: "x" } as never);

    render(<Fragility connectionId="con_1" />);

    await waitFor(() =>
      expect(screen.getByText(/no number is shown rather than a confident one/))
        .toBeTruthy());
  });
});
