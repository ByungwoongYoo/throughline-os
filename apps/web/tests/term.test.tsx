/**
 * A word a first-timer meets is glossed where they meet it (D207).
 *
 * Not a tooltip and not a glossary page: both are places a definition can
 * hide. The gloss is text beside the word, and the same word is defined the
 * same way on every screen because there is one table of glosses.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GLOSSES, Term, TermList } from "@/components/term";

afterEach(cleanup);

describe("a glossed term", () => {
  it("shows the word and its meaning as visible text", () => {
    render(<p>The <Term id="q-value" /> is 0.012.</p>);
    expect(screen.getByText("q-value")).toBeInTheDocument();
    expect(screen.getByText(/corrected for how many tests ran/)).toBeInTheDocument();
    // No title attribute anywhere: a tooltip is a hidden label.
    expect(document.querySelector("[title]")).toBeNull();
  });

  it("lets the sentence choose the word's form while keeping one meaning", () => {
    render(<Term id="lifecycle state">lifecycle</Term>);
    expect(screen.getByText("lifecycle")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(GLOSSES["lifecycle state"]))).toBeInTheDocument();
  });

  it("defines every term in one clause, not a paragraph", () => {
    for (const [word, gloss] of Object.entries(GLOSSES)) {
      expect(gloss.split(" ").length, word).toBeLessThanOrEqual(20);
      expect(gloss, word).not.toMatch(/\.\s/);
    }
  });
});

describe("a legend of terms", () => {
  it("prints every word with its meaning, in the order the columns run", () => {
    render(<TermList lead="What the columns say" ids={["estimate", "q-value", "n"]} />);
    expect(screen.getByText(/What the columns say/)).toBeInTheDocument();
    for (const id of ["estimate", "q-value", "n"] as const) {
      expect(screen.getByText(id)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(GLOSSES[id]))).toBeInTheDocument();
    }
    // Same rule as the inline form: no definition behind a hover.
    expect(document.querySelector("[title]")).toBeNull();
  });

  it("keeps the separator away from a screen reader", () => {
    const { container } = render(<TermList ids={["r", "n"]} />);
    expect(container.querySelector(".term-legend-sep")).toHaveAttribute("aria-hidden", "true");
  });
});
