/**
 * One vocabulary for the lifecycle (plan §4.6.3, item 2.10).
 *
 * The same six states were said three ways at once: `ResultCard` printed
 * "Tested — needs replication", the `Status` pill printed `exploratory`, and
 * the transition buttons printed the verb "move" plus the raw word. A reader
 * meeting all three on one screen had to work out that they named one fact,
 * and the buttons said nothing at all about which way a move went — retiring
 * a finding, the only irreversible move on the screen, looked exactly like a
 * promotion.
 *
 * These tests hold down three things: that the old copy is gone, that every
 * state the *domain* knows has a phrase (read out of the enum file, so adding
 * a state to the schemas package and not to the table fails here rather than
 * shipping a raw word to a researcher), and that a transition button says
 * where it goes and which way that is.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FindingLifecycle, statePhrase, transitionCopy } from "@/components/lifecycle";
import { LIFECYCLE } from "@/components/ResultCard";
import { Status } from "@/components/primitives";

const WEB = join(__dirname, "..");
const ENUMS = join(WEB, "..", "..", "packages", "schemas", "src",
                   "throughline_schemas", "enums.py");

/** Every member of one `StrEnum` in the schemas package. */
function enumValues(name: string): string[] {
  const source = readFileSync(ENUMS, "utf8");
  const start = source.indexOf(`class ${name}(StrEnum):`);
  expect(start, `${name} is not in ${ENUMS}`).toBeGreaterThan(-1);
  const next = source.indexOf("\nclass ", start + 1);
  const body = source.slice(start, next === -1 ? undefined : next);
  return [...body.matchAll(/^\s+[A-Z_]+ = "(\w+)"$/gm)].map((m) => m[1]);
}

function componentSources(): { path: string; text: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  return walk(join(WEB, "components"))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

describe("the states the domain knows all have words", () => {
  it("reads the enum file, rather than a list somebody kept in step by hand", () => {
    // Without this, a regex that matched nothing would leave every assertion
    // below quantified over an empty set and passing while checking nothing.
    expect(enumValues("FindingLifecycle")).toContain("candidate");
    expect(enumValues("ConnectionLifecycle")).toContain("rejected");
    expect(enumValues("FindingLifecycle").length).toBeGreaterThanOrEqual(6);
  });

  it.each([...enumValues("FindingLifecycle"), ...enumValues("ConnectionLifecycle")])(
    "%s has a plain phrase and a verb", (state) => {
      /*
       * A state with no entry falls back to its own machine word, which is
       * exactly the thing this item removed. Adding one to the schemas
       * package without adding its words here fails here.
       */
      const words = LIFECYCLE[state];
      expect(words, `${state} has no entry in LIFECYCLE`).toBeTruthy();
      expect(words.label.length).toBeGreaterThan(0);
      expect(words.action.split(" ").length).toBeGreaterThan(1);
    });

  /**
   * States whose machine word is already the plain word, and why.
   *
   * An entry here is a claim somebody can argue with, not a hole in the rule:
   * "replicated" needs no translation because it means, in English, exactly
   * what the domain uses it for. `validated` is deliberately not here — it
   * reads "Checked — survived the robustness checks", because a validated
   * finding has not been reproduced by anybody.
   */
  const ALREADY_PLAIN = new Set(["replicated"]);

  it("never shows a machine word where a phrase belongs", () => {
    // `candidate` reading "candidate" would satisfy "has a phrase" while
    // teaching the reader nothing.
    for (const [state, words] of Object.entries(LIFECYCLE)) {
      if (ALREADY_PLAIN.has(state)) continue;
      expect(words.label.toLowerCase(), state).not.toBe(state);
      expect(words.label, state).not.toContain("_");
    }
  });

  it("gives two different states two different phrases", () => {
    // `validated` and `replicated` both read "Replicated", so a finding that
    // had survived the checks was described as one that had been reproduced.
    const labels = Object.values(LIFECYCLE).map((w) => w.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("the old copy is gone from the components tree", () => {
  it("no component says the verb plus the raw state word", () => {
    /*
     * "Move to deprecated" named the destination in a vocabulary the reader
     * had not been taught, and said nothing about the move being the one
     * nothing comes back from.
     */
    const states = Object.keys(LIFECYCLE).join("|");
    for (const { path, text } of componentSources()) {
      expect(text, path).not.toContain("Move to deprecated");
      expect(text, path).not.toMatch(new RegExp(`Move to (${states})`, "i"));
    }
  });
});

describe("a transition button says where it goes, and which way", () => {
  it("names retirement as the end of the line", () => {
    const copy = transitionCopy("candidate", "deprecated");
    expect(copy.action).toBe("Retire this finding");
    expect(copy.direction).toMatch(/end of its lifecycle/);
  });

  it("calls a promotion forward and a demotion back", () => {
    expect(transitionCopy("candidate", "exploratory").direction).toMatch(/step forward/);
    expect(transitionCopy("validated", "replicated").direction).toMatch(/step forward/);
    // Being contradicted is not a rung on the ladder, and saying "back" would
    // suggest it is a state a finding was in before.
    expect(transitionCopy("validated", "conflicted").direction).toMatch(/sideways/);
    expect(transitionCopy("conflicted", "exploratory").direction).toMatch(/way out of/);
  });

  it("puts the direction on the buttons themselves", () => {
    render(<FindingLifecycle findingId="fnd_1" status="candidate" evidenceTotal={2} />);

    const retire = screen.getByRole("button", { name: /Retire this finding/ });
    expect(retire.textContent).toMatch(/nothing follows from there/);
    // The raw word rides along, because it is what the API, an export and a
    // support thread will call the same state.
    expect(retire.textContent).toContain("deprecated");
  });

  it("glosses the two words the panel would otherwise assume (D207)", () => {
    render(<FindingLifecycle findingId="fnd_1" status="candidate" evidenceTotal={2} />);

    expect(screen.getByText(/how far a result has got through validation/)).toBeTruthy();
    expect(screen.getByText(/licenses the word/)).toBeTruthy();
  });
});

describe("the status pill speaks the same vocabulary", () => {
  it("leads with the phrase and keeps the machine word beside it", () => {
    const { container } = render(<Status value="exploratory" />);

    expect(container.textContent).toContain(statePhrase("exploratory"));
    expect(container.textContent).toContain("exploratory");
  });

  it("leaves a status that is not a lifecycle state alone", () => {
    /*
     * Run states, ingestion states and assumption outcomes share this pill and
     * are their own vocabularies — `globals.css` says so at `.status-passed`.
     * Translating `passed` into "Replicated" would teach a false equivalence.
     */
    const { container } = render(<Status value="not_tested" />);
    expect(container.textContent).toBe("not tested");
  });

  it("lets a caller refuse the translation for a word it synthesised", () => {
    // The validation verdict rendered as "validated"/"conflicted" is about a
    // check, not about a finding's lifecycle.
    const { container } = render(<Status value="validated" raw />);
    expect(container.textContent).toBe("validated");
  });
});
