/**
 * Error rendering.
 *
 * A screen that says "That did not work — [object Object]" has told the
 * researcher nothing and told whoever they report it to even less. It happened
 * for a real 422, and it would have happened for every validation error in the
 * app, because `String(error)` on a parsed JSON body is always that.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Failure } from "@/components/primitives";

describe("failure messages", () => {
  it("never renders an object as [object Object]", () => {
    render(<Failure error={{ detail: [{ loc: ["query", "limit"],
                                        msg: "Input should be less than or "
                                             + "equal to 300" }] }} />);

    expect(document.body.textContent).not.toContain("[object Object]");
    expect(screen.getByText(/less than or equal to 300/)).toBeVisible();
  });

  it("names the field a validation error came from", () => {
    // "limit: …" is the difference between a researcher fixing it themselves
    // and filing a bug.
    render(<Failure error={{ detail: [{ loc: ["query", "limit"],
                                        msg: "too large" }] }} />);

    expect(screen.getByText(/limit: too large/)).toBeVisible();
  });

  it("renders a plain string detail", () => {
    render(<Failure error={{ detail: "That dataset belongs to another project." }} />);
    expect(screen.getByText(/another project/)).toBeVisible();
  });

  it("renders an Error's message", () => {
    render(<Failure error={new Error("Ollama is not reachable.")} />);
    expect(screen.getByText(/not reachable/)).toBeVisible();
  });

  it("falls back to JSON rather than to a cast", () => {
    render(<Failure error={{ unexpected: "shape" }} />);
    expect(document.body.textContent).not.toContain("[object Object]");
    expect(screen.getByText(/unexpected/)).toBeVisible();
  });
});
