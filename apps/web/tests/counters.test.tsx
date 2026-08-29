/**
 * Counting things, in the number of things there are.
 *
 * The overview strip is the first screen a researcher opens, and with one
 * dataset loaded it read "1 Datasets". The labels were hard-coded plurals.
 *
 * Deriving the singular is not an option: dropping the "s" from "Analyses"
 * gives "Analyse", and that is the second label in the strip. So both forms
 * are stated, and `Meter` requires them — a counter that cannot forget is
 * worth more than one that guesses.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Meter, Stat } from "@/components/primitives";

const text = (ui: React.ReactElement) => render(ui).container.textContent;

describe("a counter", () => {
  it("says one dataset, not one datasets", () => {
    expect(text(<Meter label="Datasets" one="Dataset" value={1} />))
      .toBe("1Dataset");
  });

  it("keeps the plural for anything else", () => {
    expect(text(<Meter label="Datasets" one="Dataset" value={3} />))
      .toBe("3Datasets");
  });

  it("says zero in the plural, because none is not one", () => {
    expect(text(<Meter label="Findings" one="Finding" value={0} />))
      .toBe("0Findings");
  });

  it("handles a singular that is not the plural minus a letter", () => {
    // The label that makes derivation impossible.
    expect(text(<Meter label="Analyses" one="Analysis" value={1} />))
      .toBe("1Analysis");
  });
});

describe("a statistic", () => {
  it("uses the singular for one", () => {
    expect(text(<Stat label="pages" one="page" value={1} />)).toBe("1page");
  });

  it("leaves a label alone when it counts nothing", () => {
    // "evidence quality" is not a quantity, and neither is a version string.
    expect(text(<Stat label="evidence quality" value="moderate" />))
      .toBe("moderateevidence quality");
  });

  it("does not mistake the string 1 for the number 1", () => {
    // A formatted value arrives as text; only a real count can be singular.
    expect(text(<Stat label="rows" one="row" value={"1"} />)).toBe("1rows");
  });
});
